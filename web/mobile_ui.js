import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

/**
 * "手机界面" entry point.
 *
 * ComfyUI expands subgraphs into a flat API prompt with app.graphToPrompt(),
 * and that expansion depends on node runtime definitions, bypass splicing and
 * virtual nodes. Re-doing it on the server is therefore not trustworthy, so
 * this extension expands the *open* workflow once, derives which slot every
 * promoted input feeds, and POSTs both to /qq_mobile/template. The phone page
 * then only rewrites values in an already-correct prompt.
 */

const BUTTON_TOOLTIP = "打开手机界面（竖屏，仅显示提升参数）";
const TEMPLATE_ENDPOINT = "/qq_mobile/template";
const MOBILE_PAGE = "/qq_mobile/";
const BUTTON_GROUP_CLASS = "qq-mobile-top-menu-group";

/** Frontend virtual node whose values win over subgraph promoted inputs. */
const MULTI_PRIMITIVE_TYPE = "QQ-多值输入";
const MULTI_PRIMITIVE_LEGACY = "QQMultiPrimitive";
const MULTI_PRIMITIVE_GROUP = "多值输入";

const getBasePath = () => {
    const { pathname } = window.location;
    return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
};

const mobileUrl = (path) => `${getBasePath()}${path}`;

const ICON = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="7" y="2.5" width="10" height="19" rx="2.2"></rect>
  <path d="M10.6 5.3h2.8"></path>
  <circle cx="12" cy="18.4" r="0.9" fill="currentColor" stroke="none"></circle>
</svg>`;

/**
 * Media loading nodes the phone page turns into pickers.
 *
 * Each entry names the node type and the widget that holds the chosen file.
 * `media` decides which extensions the picker offers, and `state` marks nodes
 * that keep a JSON media bundle instead of a single file name.
 */
const MEDIA_WIDGETS = {
    LoadImage: { widget: "image", media: "image" },
    LoadImageMask: { widget: "image", media: "image" },
    LoadVideo: { widget: "file", media: "video" },
    LoadAudio: { widget: "audio", media: "audio" },
    VHS_LoadVideo: { widget: "video", media: "video" },
    VHS_LoadAudio: { widget: "audio", media: "audio" },
    "QQ-多媒体加载": { widget: "media_state", media: "image", state: true },
    QQMediaLoader: { widget: "media_state", media: "image", state: true },
};

/** File-name suffix -> media kind, for combo values that are real files. */
const MEDIA_FILE_RE = /\.(png|jpe?g|webp|bmp|gif|avif|tiff|mp4|webm|mov|mkv|avi|m4v|mp3|wav|flac|ogg|m4a|aac|opus)$/i;

/**
 * Whether a node will take part in execution.
 *
 * LiteGraph modes: 0 ALWAYS, 1 ON_EVENT, 2 NEVER (muted), 3 ON_TRIGGER,
 * 4 BYPASS. Muted and bypassed nodes are excluded from the prompt, so their
 * inputs cannot be edited meaningfully from the phone.
 */
function isNodeActive(node) {
    const mode = Number(node?.mode ?? 0);
    return mode !== 2 && mode !== 4;
}

/** Subgraph instances on the current canvas. */
function subgraphInstances() {
    const graph = app.rootGraph ?? app.graph;
    const instances = (graph?._nodes ?? []).filter(
        (node) =>
            node?.isSubgraphNode?.() &&
            node?.subgraph &&
            // A muted or bypassed instance is not executed, so its promoted
            // inputs have nothing to write to.
            isNodeActive(node),
    );
    return { graph, instances };
}

/**
 * Read a media loading node as a phone parameter.
 *
 * The node keeps its choice in an ordinary widget: a file name for LoadImage
 * and friends, or a JSON media bundle for QQ-多媒体加载. Both are reachable
 * through the same (node id, widget name) target the rest of the page uses.
 */
function mediaParameter(node, spec, container, labelPrefix) {
    const widget = (node.widgets ?? []).find((entry) => entry?.name === spec.widget);
    if (!widget) return null;

    const targets = [[String(node.id), spec.widget]];
    let value = widget.value;
    if (spec.state) {
        // Parse the JSON bundle so the phone can show a list of names.
        value = parseMediaState(widget.value, spec.media);
    }

    const id = String(node.id);
    return {
        key: `${id}:${spec.widget}`,
        name: spec.widget,
        label: labelPrefix || node.title || spec.widget,
        type: spec.state ? "STRING" : "COMBO",
        value,
        options: spec.state ? null : comboOptions(widget),
        targets,
        group: node.title || undefined,
        media: spec.media,
        mediaState: Boolean(spec.state),
        multiple: Boolean(spec.state),
        min: null,
        max: null,
        step: null,
        multiline: false,
    };
}

/** Parse a QQ-多媒体加载 state string into the list shown on the phone. */
function parseMediaState(raw, kind) {
    if (raw && typeof raw === "object") return raw;
    let parsed = null;
    try {
        parsed = typeof raw === "string" && raw.trim().startsWith("{")
            ? JSON.parse(raw)
            : null;
    } catch {
        parsed = null;
    }
    const key = kind === "video" ? "videos" : kind === "audio" ? "audios" : "images";
    if (!parsed) return [];
    const list = parsed[key];
    return Array.isArray(list)
        ? list.map((item) => (item && typeof item === "object" ? item.filename : item)).filter(Boolean)
        : [];
}

/** Media loaders on the canvas, as phone parameters.
 *
 * Muted (NEVER) and bypassed (BYPASS) nodes are skipped: a bypassed loader
 * does not contribute media, so offering its picker would let the user choose
 * a file that never gets used. This mirrors how the frontend drops those nodes
 * from the prompt altogether.
 */
function mediaParameters(graph) {
    const found = [];
    const visit = (container) => {
        for (const node of container?._nodes ?? []) {
            if (node?.subgraph) {
                visit(node.subgraph);
                continue;
            }
            const spec = MEDIA_WIDGETS[node?.type];
            if (!spec) continue;
            if (!isNodeActive(node)) continue;
            const parameter = mediaParameter(node, spec, container);
            if (parameter) found.push(parameter);
        }
    };
    visit(graph);
    return found;
}

/**
 * Collect parameters from ``QQ-多值输入`` nodes.
 *
 * That node is a frontend virtual node: it never appears in the submitted
 * prompt. Instead each of its output slots is linked to a real node input, and
 * the value flows there at submit time. So a parameter's write targets are the
 * real inputs at the far end of those links.
 *
 * Labels come from the widget label, which the node keeps in sync with the
 * target input's name.
 */
function multiPrimitiveParameters(graph) {
    const parameters = [];
    const visit = (container) => {
        for (const node of container?._nodes ?? []) {
            if (node?.subgraph) {
                visit(node.subgraph);
                continue;
            }
            if (node?.type !== MULTI_PRIMITIVE_TYPE && node?.type !== MULTI_PRIMITIVE_LEGACY) {
                continue;
            }
            // A muted or bypassed node contributes no values at all.
            if (!isNodeActive(node)) continue;
            const links = container.links instanceof Map
                ? [...container.links.values()]
                : Object.values(container.links ?? {});
            const linkById = new Map();
            for (const link of links) {
                if (link?.id != null) linkById.set(Number(link.id), link);
            }
            const nodesById = new Map();
            for (const other of container._nodes ?? []) {
                if (other?.id != null) nodesById.set(Number(other.id), other);
            }

            for (const widget of node.widgets ?? []) {
                const slot = widget?.__h3MultiPrimitiveSlot;
                if (slot == null) continue;
                const output = node.outputs?.[slot];
                const targets = [];
                for (const linkId of output?.links ?? []) {
                    const link = linkById.get(Number(linkId));
                    if (!link) continue;
                    const target = nodesById.get(Number(link.target_id));
                    const inputName = target?.inputs?.[Number(link.target_slot)]?.name;
                    if (!inputName) continue;
                    const entry = [String(link.target_id), inputName];
                    if (!targets.some(([id, name]) => id === entry[0] && name === entry[1])) {
                        targets.push(entry);
                    }
                }
                parameters.push({
                    key: `${node.id}:${widget.name}`,
                    name: widget.name,
                    label: widget.label || inputLabel(node, slot) || widget.name,
                    type: widgetTypeToSlot(widget, output),
                    value: widget.value,
                    options: comboOptions(widget),
                    targets,
                    group: MULTI_PRIMITIVE_GROUP,
                    ...numberBounds(widget),
                });
            }
        }
    };
    visit(graph);
    return parameters;
}

/** Readable name for one multi-primitive output slot. */
function inputLabel(node, slot) {
    const name = node?.outputs?.[slot]?.name;
    if (!name) return "";
    // Slot names end with an ordinal ("任务模式 1"); the label is the prefix.
    return String(name).replace(/\s+\d+$/, "");
}

/** Widget type -> the SlotType the page's form switches on. */
function widgetTypeToSlot(widget, output) {
    const type = String(widget?.type || "").toLowerCase();
    if (type === "combo") return "COMBO";
    if (type === "toggle" || type === "boolean") return "BOOLEAN";
    if (type === "number") {
        return Number.isInteger(widget?.value) ? "INT" : "FLOAT";
    }
    if (type === "text" || type === "customtext") return "STRING";
    return String(output?.type || "STRING");
}

function comboOptions(widget) {
    const values = widget?.options?.values;
    const resolved = typeof values === "function" ? values() : values;
    return Array.isArray(resolved) ? [...resolved] : null;
}

function numberBounds(widget) {
    const options = widget?.options ?? {};
    if (String(widget?.type || "").toLowerCase() !== "number") {
        return { min: null, max: null, step: null, multiline: false };
    }
    return {
        min: Number.isFinite(options.min) ? options.min : null,
        max: Number.isFinite(options.max) ? options.max : null,
        step: Number.isFinite(options.step) ? options.step : null,
        multiline: false,
    };
}

/**
 * Map each promoted input of an instance to the concrete (execId, inputName)
 * slots it feeds.
 *
 * Anchored on the input node's own slot order: `definition.inputs[index]`
 * lists the link ids that leave promoted input `index`, and each of those
 * links names the inner node input receiving the value.
 */
function promotedTargets(instance) {
    const definition = instance.subgraph;
    if (!definition) return [];
    const instanceId = String(instance.id);
    // Runtime link ids are strings while slot ids are numbers, so every
    // comparison below is done on numbers.
    const links = definition.links instanceof Map
        ? [...definition.links.values()]
        : Object.values(definition.links ?? {});
    const linkById = new Map();
    for (const link of links) {
        if (link?.id != null) linkById.set(Number(link.id), link);
    }
    const nodesById = new Map();
    for (const node of definition.nodes ?? []) {
        if (node?.id != null) nodesById.set(Number(node.id), node);
    }
    const outputNodeId = Number(definition.outputNode?.id ?? -20);
    const slots = definition.inputs ?? [];

    return slots.map((slot, index) => {
        const targets = [];
        for (const linkId of slot.linkIds ?? []) {
            const link = linkById.get(Number(linkId));
            if (!link) continue;
            const targetId = Number(link.target_id);
            // Skip links that leave the subgraph entirely.
            if (targetId === outputNodeId) continue;
            const target = nodesById.get(targetId);
            const inputName = target?.inputs?.[Number(link.target_slot)]?.name;
            if (!inputName) continue;
            const entry = [`${instanceId}:${targetId}`, inputName];
            if (!targets.some(([id, name]) => id === entry[0] && name === entry[1])) {
                targets.push(entry);
            }
        }
        return {
            name: slot.name,
            label: slot.label || slot.localized_name || slot.name,
            type: String(slot.type || "STRING"),
            value: widgetValue(instance, slot.name),
            options: widgetOptions(instance, slot.name),
            index,
            targets,
        };
    });
}

function widgetByName(instance, name) {
    return (instance.widgets ?? []).find((widget) => widget?.name === name);
}

function widgetValue(instance, name) {
    const widget = widgetByName(instance, name);
    if (widget) return widget.value;
    const slot = (instance.inputs ?? []).find((input) => input?.name === name);
    if (slot && slot.widget) {
        const byWidget = widgetByName(instance, slot.widget.name);
        if (byWidget) return byWidget.value;
    }
    return null;
}

function widgetOptions(instance, name) {
    const widget = widgetByName(instance, name);
    const values = widget?.options?.values;
    const resolved = typeof values === "function" ? values() : values;
    return Array.isArray(resolved) ? [...resolved] : null;
}

/** Numbers and bounds the phone form needs to render a usable control. */
function widgetBounds(instance, name) {
    const widget = widgetByName(instance, name);
    const options = widget?.options ?? {};
    return {
        min: Number.isFinite(options.min) ? options.min : null,
        max: Number.isFinite(options.max) ? options.max : null,
        step: Number.isFinite(options.step) ? options.step : null,
        multiline: Boolean(options.multiline),
    };
}

/** Which output nodes of the workflow should be shown on the phone. */
function outputNodes(graph) {
    return (graph?._nodes ?? [])
        .filter((node) => node?.constructor?.nodeData?.output_node || node?.isOutputNode)
        .map((node) => String(node.id));
}

/**
 * Display title for one subgraph instance's parameter group.
 *
 * The user's own node title wins (that is what they see on the canvas), then
 * the subgraph's name. *counters* is per-build state so repeated calls produce
 * stable titles instead of drifting suffixes.
 */
function groupTitle(instance, total, counters) {
    const title = String(
        instance.title || instance.subgraph?.name || `子图 ${instance.id}`,
    ).trim();
    if (total <= 1) return title;
    const count = (counters.get(title) ?? 0) + 1;
    counters.set(title, count);
    return count === 1 ? title : `${title} (${count})`;
}

async function prepareTemplate({ notify = true } = {}) {
    const { graph, instances } = subgraphInstances();
    if (!graph) throw new Error("没有打开的工作流");

    const { output, workflow } = await app.graphToPrompt();
    const parameters = [];
    const unbound = [];

    // ``QQ-多值输入`` takes priority: when the workflow drives its inputs
    // through one, those are the values the user means, so the subgraph's
    // promoted inputs are not shown at all.
    const multi = multiPrimitiveParameters(graph);
    // Media loaders are listed first: on a phone the picture to work from is
    // the first thing chosen, and it is what makes the workflow image-to-image.
    const media = mediaParameters(graph);
    if (media.length) {
        for (const entry of media) parameters.push(entry);
    }
    if (multi.length) {
        for (const entry of multi) {
            if (!entry.targets.length) unbound.push(entry.label || entry.name);
            parameters.push(entry);
        }
    } else if (instances.length) {
        // A pipeline often holds several subgraph instances, frequently of the
        // same definition. Their promoted inputs share names ("prompt", "seed"),
        // so each group needs a title or the form becomes ambiguous.
        const counters = new Map();
        for (const instance of instances) {
            const group = groupTitle(instance, instances.length, counters);
            for (const entry of promotedTargets(instance)) {
                if (!entry.targets.length) unbound.push(entry.label || entry.name);
                parameters.push({
                    key: `${instance.id}:${entry.name}`,
                    name: entry.name,
                    label: entry.label,
                    type: entry.type,
                    value: entry.value,
                    options: entry.options,
                    targets: entry.targets,
                    group,
                    ...widgetBounds(instance, entry.name),
                });
            }
        }
    } else if (!parameters.length) {
        throw new Error("当前工作流既没有子图，也没有 QQ-多值输入 或媒体加载节点");
    }

    if (unbound.length) {
        console.warn("[QQ Mobile] parameters without writable targets:", unbound);
    }
    if (parameters.length && unbound.length === parameters.length) {
        throw new Error(
            `全部 ${parameters.length} 个参数都无法定位写入目标，请报告此工作流的结构`,
        );
    }

    const workflowKey = app.activeWorkflow?.path
        || `unsaved-${workflow?.id ?? Date.now()}`;
    const response = await api.fetchApi(TEMPLATE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            workflow: workflowKey,
            title: workflowTitle(),
            prompt: output,
            parameters,
            outputs: outputNodes(graph),
            // Replayed as extra_pnginfo.workflow on submit. Nodes with an
            // EXTRA_PNGINFO input look themselves up in it by node id, and
            // SaveImage embeds it in the written file.
            graph: workflow,
        }),
    });
    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`模板保存失败: ${detail.slice(0, 200)}`);
    }
    if (notify) {
        app.extensionManager?.toast?.add?.({
            severity: unbound.length ? "warn" : "success",
            summary: "手机界面已就绪",
            detail: unbound.length
                ? `${parameters.length} 个参数，${unbound.length} 个无法写入`
                : `${parameters.length} 个参数`,
            life: unbound.length ? 6000 : 2500,
        });
    }
    return { workflow: workflowKey, parameters: parameters.length, unbound };
}

/** Human name for the current workflow, falling back to its file name. */
function workflowTitle() {
    const active = app.activeWorkflow;
    const name = active?.filename || active?.name || "";
    if (name) return String(name).replace(/\.json$/i, "");
    const subgraph = (app.rootGraph ?? app.graph)?._nodes
        ?.find((node) => node?.isSubgraphNode?.());
    return subgraph?.subgraph?.name || "当前工作流";
}

const openMobile = async (event) => {
    let workflowKey = "";
    try {
        const prepared = await prepareTemplate({ notify: false });
        workflowKey = prepared.workflow;
    } catch (error) {
        console.warn("[QQ Mobile] prepare failed:", error);
        app.extensionManager?.toast?.add?.({
            severity: "error",
            summary: "无法准备手机界面",
            detail: String(error?.message || error),
            life: 6000,
        });
        return;
    }
    const query = workflowKey ? `?workflow=${encodeURIComponent(workflowKey)}` : "";
    const url = mobileUrl(`${MOBILE_PAGE}${query}`);
    if (event?.shiftKey || event?.ctrlKey || event?.metaKey) {
        window.open(url, "_blank");
        return;
    }
    window.location.assign(url);
};

const createButton = async () => {
    const { ComfyButton } = await import("../../../scripts/ui/components/button.js");
    const button = new ComfyButton({
        icon: "qq-mobile",
        tooltip: BUTTON_TOOLTIP,
        app,
        enabled: true,
        classList: "comfyui-button comfyui-menu-mobile-collapse primary",
    });
    button.element.setAttribute("aria-label", BUTTON_TOOLTIP);
    button.element.title = BUTTON_TOOLTIP;
    if (button.iconElement) {
        button.iconElement.innerHTML = ICON;
        button.iconElement.style.width = "1.2rem";
        button.iconElement.style.height = "1.2rem";
        button.iconElement.style.display = "flex";
    }
    button.element.addEventListener("click", openMobile);
    return button;
};

const attachButton = async (attempt = 0) => {
    if (document.querySelector(`.${BUTTON_GROUP_CLASS}`)) return;
    const settingsGroup = app.menu?.settingsGroup;
    if (!settingsGroup?.element?.parentElement) {
        if (attempt > 120) return;
        requestAnimationFrame(() => attachButton(attempt + 1));
        return;
    }
    const button = await createButton();
    const { ComfyButtonGroup } = await import("../../../scripts/ui/components/buttonGroup.js");
    const group = new ComfyButtonGroup(button);
    group.element.classList.add(BUTTON_GROUP_CLASS);
    settingsGroup.element.before(group.element);
};

// Expose the entry point before registering, so the phone page and tests keep
// working even if the UI registration below fails for any reason.
globalThis.qqMobile = { prepareTemplate };

/**
 * Register the extension defensively.
 *
 * A throw anywhere in this descriptor (a duplicate keybinding, a changed
 * internal import, a missing component) aborts the whole registration, and the
 * visible result is "the button silently does not exist". Registering in
 * stages — and retrying without the optional parts — keeps the core entry
 * point usable and surfaces the reason in the console.
 */
function register(opts) {
    try {
        app.registerExtension({ name: "QQ.MobileUI", ...opts });
        return true;
    } catch (error) {
        return error;
    }
}

const core = {
    async setup() {
        try {
            await attachButton();
        } catch (error) {
            console.warn("[QQ Mobile] toolbar button unavailable:", error);
        }
    },
    commands: [
        {
            id: "qq.mobile.open",
            label: "打开手机界面",
            icon: "icon-[lucide--smartphone]",
            function: () => openMobile({}),
        },
        {
            id: "qq.mobile.prepare",
            label: "同步手机界面模板",
            icon: "icon-[lucide--refresh-cw]",
            function: () => prepareTemplate({ notify: true }),
        },
    ],
    actionBarButtons: [
        {
            icon: "icon-[lucide--smartphone] size-4",
            tooltip: BUTTON_TOOLTIP,
            onClick: () => openMobile({}),
        },
    ],
};

// Ctrl/Cmd+Alt+M: Alt+Shift+M is already bound to Comfy.Canvas.ToggleMinimap,
// and a duplicate keybinding throws during registration.
const shortcut = {
    keybindings: [{ combo: { key: "m", ctrl: true, alt: true }, commandId: "qq.mobile.open" }],
};

for (const attempt of [{ ...core, ...shortcut }, core, {}]) {
    const error = register(attempt);
    if (error === true) break;
    console.warn("[QQ Mobile] registration attempt failed, retrying simpler:", error);
}
