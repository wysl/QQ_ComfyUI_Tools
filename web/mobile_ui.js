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
    // Every QQ-多值输入 node on the canvas, in visit order. A workflow can use
    // several (one per stage), and their slots then need to stay apart: the
    // same slot name in two nodes is a different thing to set.
    const multiNodes = [];
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
            multiNodes.push(node);
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
                    // Filled in below, once every node is known: the heading
                    // needs to say which node it belongs to.
                    _nodeId: node.id,
                    ...numberBounds(widget),
                });
            }
        }
    };
    visit(graph);

    // One heading per node when the workflow uses more than one, so two
    // "提示词" slots are never two identical rows with no explanation. A single
    // node keeps the plain section name — nothing to disambiguate.
    if (multiNodes.length > 1) {
        multiNodes.forEach((node, index) => {
            const heading = multiNodeTitle(node, index);
            for (const parameter of parameters) {
                if (parameter._nodeId === node.id) parameter.group = heading;
            }
        });
    }
    for (const parameter of parameters) delete parameter._nodeId;
    return parameters;
}

/**
 * Heading for one QQ-多值输入 node.
 *
 * The node's own title when the user renamed it ("主图参数"), otherwise a
 * numbered default. LiteGraph fills `title` with the type name, which would be
 * the same on every node — that case falls back to the number.
 */
function multiNodeTitle(node, index) {
    const title = String(node?.title || "").trim();
    const generic = !title
        || title === MULTI_PRIMITIVE_TYPE
        || title === MULTI_PRIMITIVE_LEGACY
        || title === "多值输入";
    return generic ? `多值输入 ${index + 1}` : title;
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

/**
 * Every workflow saved in the editor's workflow directory.
 *
 * The phone cannot expand a workflow by itself (SetNode/GetNode and virtual
 * nodes only exist in the frontend), so a pipeline has to be prepared here
 * first. Listing the library means the picker can show all of them.
 */
async function listWorkflowFiles() {
    try {
        const response = await api.fetchApi("/qq_mobile/workflows");
        if (!response.ok) return [];
        const data = await response.json();
        return Array.isArray(data.workflows) ? data.workflows : [];
    } catch (error) {
        console.warn("[QQ Mobile] workflow listing failed:", error);
        return [];
    }
}

/** Keys of the templates the server already holds. */
async function preparedWorkflowKeys() {
    try {
        const response = await api.fetchApi("/qq_mobile/state");
        if (!response.ok) return new Set();
        const data = await response.json();
        return new Set((data.templates || []).map((item) => item.workflow));
    } catch {
        return new Set();
    }
}

/**
 * Prepare every saved workflow that is not prepared yet.
 *
 * Preparing needs the real graph, so each workflow is loaded, expanded and
 * then the user's own workflow is put back. That is why this runs only when
 * the user explicitly asks for it, and why it reports progress.
 */
async function prepareAllWorkflows({ notify = true } = {}) {
    if (batchRunning) return { prepared: 0, skipped: 0 };
    const files = await listWorkflowFiles();
    if (!files.length) return { prepared: 0, skipped: 0 };

    const known = await preparedWorkflowKeys();
    const missing = files.filter((file) => file.id && !known.has(`unsaved-${file.id}`));
    if (!missing.length) return { prepared: 0, skipped: files.length };

    // Keep what the user was working on, to restore at the end.
    let restore = null;
    try {
        restore = (await app.graphToPrompt()).workflow;
    } catch {
        restore = null;
    }

    batchRunning = true;
    toast(`正在准备 ${missing.length} 条流水线…`, 8000);
    let prepared = 0;
    let notApplicable = 0;
    const failures = [];
    try {
        for (const [index, file] of missing.entries()) {
            try {
                const response = await api.fetchApi(
                    `/api/userdata/workflows%2F${encodeURIComponent(file.path)}`,
                );
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const workflow = await response.json();
                await app.loadGraphData(workflow, true, true);
                await prepareTemplate({
                    notify: false,
                    workflowKey: `unsaved-${file.id}`,
                    title: file.name,
                    folder: file.folder,
                });
                prepared += 1;
            } catch (error) {
                const message = String(error?.message || error);
                // A workflow with nothing to expose is not a failure: it is
                // simply not a phone pipeline (no subgraph, no 多值输入, no
                // media loader).
                if (message.includes("既没有子图")) {
                    notApplicable += 1;
                } else {
                    failures.push(`${file.name}: ${message}`);
                }
            }
            if (notify && index % 5 === 0) {
                toast(`准备中 ${index + 1}/${missing.length}…`, 4000);
            }
        }
    } finally {
        batchRunning = false;
        if (restore) {
            try {
                await app.loadGraphData(restore, true, true);
            } catch (error) {
                console.warn("[QQ Mobile] could not restore the workflow:", error);
            }
        }
    }

    if (failures.length) {
        console.warn("[QQ Mobile] workflows that failed to prepare:", failures);
    }
    if (notify) {
        app.extensionManager?.toast?.add?.({
            severity: failures.length ? "warn" : "success",
            summary: `已准备 ${prepared} 条流水线`,
            detail: failures.length
                ? `${failures.length} 条失败，详见控制台`
                : `${notApplicable} 条无手机可用参数`,
            life: failures.length ? 8000 : 4000,
        });
    }
    return { prepared, skipped: files.length - missing.length, notApplicable, failures };
}

/** Guards against overlapping batch runs. */
let batchRunning = false;

/** Small progress toast; the page's own toast() lives in the phone HTML. */
function toast(text, life = 2500) {
    app.extensionManager?.toast?.add?.({
        severity: "info",
        summary: text,
        life,
    });
}

const GROUP_TAG_TYPE = "QQGroupBypassTag";
const GROUP_TAG_MODE = "模式";
const GROUP_TAG_ON = "启用";
const GROUP_TAG_OFF = "绕过";

/**
 * Group switches the phone is allowed to flip.
 *
 * A QQ-魔术贴 bypasses every node in its group while its 模式 widget says
 * 绕过. When a QQ-多值输入 drives that widget, the phone can turn the whole
 * group on — but a bypassed node is missing from the prompt entirely, so the
 * prompt has to be rebuilt for that state instead of patched.
 *
 * The wiring is read from the graph itself: the link that feeds the tag's
 * 模式 input comes from a QQ-多值输入 output slot, and that slot's widget is
 * the phone parameter that carries the switch.
 */
function switchableTags(graph) {
    const tags = [];
    const visit = (container) => {
        const links = container.links instanceof Map
            ? [...container.links.values()]
            : Object.values(container.links ?? {});
        const nodesById = new Map();
        for (const node of container._nodes ?? []) {
            if (node?.id != null) nodesById.set(Number(node.id), node);
        }
        for (const node of container._nodes ?? []) {
            if (node?.type !== GROUP_TAG_TYPE) continue;
            const modeSlot = (node.inputs ?? []).findIndex(
                (input) => input?.name === GROUP_TAG_MODE,
            );
            if (modeSlot < 0) continue;
            const link = links.find((entry) => (
                Number(entry?.target_id) === Number(node.id)
                && Number(entry?.target_slot) === modeSlot
            ));
            if (!link) continue;
            const source = nodesById.get(Number(link.origin_id));
            if (!source) continue;
            if (source.type !== MULTI_PRIMITIVE_TYPE && source.type !== MULTI_PRIMITIVE_LEGACY) {
                continue;
            }
            const slot = Number(link.origin_slot);
            const slotWidget = (source.widgets ?? []).find(
                (widget) => widget?.__h3MultiPrimitiveSlot === slot,
            );
            if (!slotWidget) continue;
            const modeWidget = (node.widgets ?? []).find(
                (widget) => widget?.name === GROUP_TAG_MODE,
            );
            if (!modeWidget) continue;
            tags.push({
                id: String(node.id),
                node,
                widget: modeWidget,
                // The 多值输入 and the slot widget that carries the value. The
                // multi keeps writing its value into the tag, so it — not the
                // tag's widget — is what decides the state.
                source: source,
                slotWidget,
                // The phone parameter that carries the switch.
                key: `${source.id}:${slotWidget.name}`,
                default: String(slotWidget.value ?? GROUP_TAG_OFF),
            });
        }
        for (const node of container._nodes ?? []) {
            if (node?.subgraph) visit(node.subgraph);
        }
    };
    visit(graph);
    return tags;
}

/** Stable name for one combination of switch states. */
function variantKey(pairs) {
    return pairs
        .map(([tag, value]) => `${tag}=${value}`)
        .sort()
        .join(";");
}

/** The states one group switch can be in. */
function tagStates(tag) {
    const options = tag.widget?.options;
    if (Array.isArray(options) && options.length > 1) return options.map((value) => String(value));
    return [GROUP_TAG_OFF, GROUP_TAG_ON];
}

/**
 * Put one group switch into a state.
 *
 * The QQ-多值输入 owns the value: it writes it into the tag's widget
 * (applySlotToGraph) and the tag then bypasses or restores its group. Setting
 * the tag's widget directly would not stick — the multi writes it back on its
 * next tick.
 */
function applyTagState(tag, value) {
    const widget = tag.slotWidget;
    if (!widget) return;
    widget.value = value;
    widget.callback?.(value, app.canvas, tag.source, app.canvas?.graph_mouse || [0, 0], {});
}

/**
 * Build one prompt per combination of switch states.
 *
 * ``app.graphToPrompt`` re-applies the 魔术贴 state before it runs, so setting
 * the switch and asking for the prompt yields exactly the prompt that state
 * produces — the group members are restored or bypassed, and the consumers
 * are rewired accordingly.
 */
async function promptVariants(graph, tags) {
    if (!tags.length) return { variants: {}, switches: [], media: [] };

    const original = tags.map((tag) => tag.slotWidget?.value);
    const switches = tags.map((tag) => ({
        tag: tag.id,
        key: tag.key,
        default: tag.default,
    }));
    const variants = {};
    // Media loaders of a bypassed group are missing from the canvas state,
    // so they are collected while every state is applied. Otherwise the phone
    // would never offer a picker for a group it can switch on.
    const media = [];
    try {
        // Every state per tag, but keep the number of prompts sane.
        const perTag = tags.map((tag) => tagStates(tag));
        let combos = [[]];
        for (const states of perTag) {
            combos = combos.flatMap((prefix) => states.map((state) => [...prefix, state]));
        }
        if (combos.length > 8) {
            console.warn(
                `[QQ Mobile] ${tags.length} group switches is too many to pre-build;`
                + " only the canvas state and the all-on state are prepared.",
            );
            combos = [
                perTag.map((states) => states[0]),
                perTag.map((states) => states[states.length - 1]),
            ];
        }
        for (const combo of combos) {
            tags.forEach((tag, index) => applyTagState(tag, combo[index]));
            const { output } = await app.graphToPrompt();
            variants[variantKey(tags.map((tag, index) => [tag.id, combo[index]]))] = output;
            for (const entry of mediaParameters(graph)) {
                if (!media.some((known) => known.key === entry.key)) media.push(entry);
            }
        }
    } finally {
        // Put the canvas back the way the user left it.
        tags.forEach((tag, index) => applyTagState(tag, original[index]));
        await app.graphToPrompt();
    }
    return { variants, switches, media };
}

async function prepareTemplate(options = {}) {
    const { notify = true, workflowKey: keyOverride, title, folder } = options;
    const { graph, instances } = subgraphInstances();
    if (!graph) throw new Error("没有打开的工作流");

    const multi = multiPrimitiveParameters(graph);
    // A group switch the phone can flip decides which nodes exist in the
    // prompt, so the variants have to be built before the parameters are read.
    const tags = switchableTags(graph);
    const { variants: variantsByState, switches, media: switchableMedia } = await promptVariants(graph, tags);
    const stateKey = variantKey(tags.map((tag) => [
        tag.id,
        String(tag.slotWidget?.value ?? tag.widget.value),
    ]));
    const { output, workflow } = await app.graphToPrompt();
    const parameters = [];
    const unbound = [];

    // ``QQ-多值输入`` takes priority: when the workflow drives its inputs
    // through one, those are the values the user means, so the subgraph's
    // promoted inputs are not shown at all.
    // Media loaders are listed first: on a phone the picture to work from is
    // the first thing chosen, and it is what makes the workflow image-to-image.
    const media = mediaParameters(graph);
    for (const entry of media) parameters.push(entry);
    // Loaders that only exist once a group is switched on are listed too:
    // the phone may turn that group on, and a picker that appears only
    // afterwards cannot be used.
    for (const entry of switchableMedia) {
        if (!parameters.some((known) => known.key === entry.key)) parameters.push(entry);
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

    const workflowKey = keyOverride
        || app.activeWorkflow?.path
        || `unsaved-${workflow?.id ?? Date.now()}`;
    const signature = graphSignature(graph);
    // The prompt for the canvas state is the default; the other states are
    // kept aside so the phone can pick the right one when it flips a switch.
    const variants = { ...variantsByState };
    variants[stateKey] = output;
    const response = await api.fetchApi(TEMPLATE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            workflow: workflowKey,
            title: title || workflowTitle(),
            // Folder inside the workflow directory, so the phone can group the
            // library the way the editor does.
            folder: folder || "",
            prompt: output,
            // One prompt per combination of group-switch states.
            variants,
            // Which phone parameter drives which switch.
            switches,
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
    lastPushedSignature = signature;
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
    return { workflow: workflowKey, parameters: parameters.length, unbound, signature };
}

/**
 * Fingerprint of everything the phone form is derived from.
 *
 * The phone form is built from a snapshot, so a later change on the canvas —
 * most importantly a QQ-多值输入 switch that flips a bypass rule and thereby
 * enables a media loader — has to trigger a fresh snapshot. The signature
 * captures node presence, node mode and the parameter list, which are exactly
 * the things that make the form differ.
 *
 * Only graph state is included, so the watcher can compare a cheap structural
 * signature before rebuilding the (much more expensive) parameter list.
 */
function graphSignature(graph) {
    const parts = [];
    const visit = (container) => {
        for (const node of container?._nodes ?? []) {
            if (node?.subgraph) {
                visit(node.subgraph);
                continue;
            }
            parts.push(`${node?.id}:${node?.type}:${Number(node?.mode ?? 0)}`);
        }
    };
    visit(graph);
    const text = parts.join(";");
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${parts.length}-${(hash >>> 0).toString(36)}`;
}

/** Last graph signature pushed, so the watcher skips identical states. */
let lastPushedSignature = "";
let watcherTimer = null;
let prepareBusy = false;

/**
 * Prepare a workflow the phone asked for.
 *
 * Only a browser holding the real graph can expand a workflow, so the phone
 * leaves a request and the editor picks it up. The workflow is loaded, expanded
 * and put away again, and the canvas the user was working on is restored —
 * exactly what the bulk run does, but for one workflow.
 */
async function servePrepareRequests() {
    if (prepareBusy) return;
    let requests = [];
    try {
        const response = await api.fetchApi("/qq_mobile/prepare");
        if (!response.ok) return;
        const data = await response.json();
        requests = (data?.requests || []).filter((entry) => entry?.state === "pending");
    } catch (error) {
        return;
    }
    if (!requests.length) return;

    for (const request of requests) {
        const workflowKey = String(request.workflow || "");
        const path = String(request.path || "");
        if (!workflowKey || !path) continue;
        prepareBusy = true;
        // Keep what the user was working on, to restore at the end.
        let restore = null;
        try {
            restore = (await app.graphToPrompt()).workflow;
        } catch {
            restore = null;
        }
        try {
            const response = await api.fetchApi(
                `/api/userdata/workflows%2F${encodeURIComponent(path)}`,
            );
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const workflow = await response.json();
            await app.loadGraphData(workflow, true, true);
            await prepareTemplate({
                notify: false,
                workflowKey,
                title: request.title || workflowKey,
                folder: request.folder || "",
            });
            // The stored template settles the request on the server.
        } catch (error) {
            const message = String(error?.message || error);
            console.warn("[QQ Mobile] prepare request failed:", message);
            try {
                await api.fetchApi("/qq_mobile/prepare-result", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        workflow: workflowKey,
                        ok: false,
                        error: message,
                    }),
                });
            } catch {
                /* 忽略 */
            }
        } finally {
            if (restore) {
                try {
                    await app.loadGraphData(restore, true, true);
                } catch (error) {
                    console.warn("[QQ Mobile] could not restore the workflow:", error);
                }
            }
            prepareBusy = false;
        }
    }
}

/**
 * Keep the pushed template in step with the canvas.
 *
 * A bypass rule can enable a media loader long after the page was prepared
 * (for example the user flips a QQ-多值输入 switch to 启用). Without this the
 * phone would keep showing the stale form until the button was pressed again.
 */
function startTemplateWatcher() {
    if (watcherTimer) return;
    watcherTimer = setInterval(async () => {
        if (!app || app.loading_graph || app.configuringGraph) return;
        // A batch run swaps workflows on purpose; syncing mid-run would push
        // whichever one happens to be loaded.
        if (batchRunning) return;
        // The phone may be waiting for a workflow to be prepared.
        try {
            await servePrepareRequests();
        } catch (error) {
            console.warn("[QQ Mobile] prepare requests skipped:", error);
        }
        try {
            const { graph, instances } = subgraphInstances();
            if (!graph) return;
            // Workflows may have no subgraph at all and still be supported
            // (QQ-多值输入 or media loaders only), so do not require one here.
            const usable =
                instances.length > 0 ||
                hasMultiPrimitive(graph) ||
                hasMediaLoader(graph);
            if (!usable) return;
            // Structural check only: cheap enough to run every tick.
            if (graphSignature(graph) === lastPushedSignature) return;
            await prepareTemplate({ notify: false });
        } catch (error) {
            console.warn("[QQ Mobile] template auto-sync skipped:", error);
        }
    }, 2500);
}

/** Cheap existence checks, without building the parameter list. */
function hasMultiPrimitive(graph) {
    let found = false;
    const visit = (container) => {
        for (const node of container?._nodes ?? []) {
            if (found) return;
            if (node?.subgraph) {
                visit(node.subgraph);
                continue;
            }
            if (node?.type === MULTI_PRIMITIVE_TYPE || node?.type === MULTI_PRIMITIVE_LEGACY) {
                found = true;
                return;
            }
        }
    };
    visit(graph);
    return found;
}

function hasMediaLoader(graph) {
    let found = false;
    const visit = (container) => {
        for (const node of container?._nodes ?? []) {
            if (found) return;
            if (node?.subgraph) {
                visit(node.subgraph);
                continue;
            }
            if (MEDIA_WIDGETS[node?.type]) {
                found = true;
                return;
            }
        }
    };
    visit(graph);
    return found;
}

/**
 * Name shown as the phone page title: the *workflow* name, not a subgraph's.
 *
 * A subgraph instance is often titled by the pipeline stage it wraps ("Text to
 * Image (Z-Image-Turbo)"), which reads as if that stage were the whole
 * pipeline. So the workflow's own name is preferred, and a subgraph title is
 * never used as a fallback.
 *
 * The document title is the most dependable source: the frontend renders it as
 * ``<workflow name> - ComfyUI`` (prefixed with ``*`` while unsaved), and it is
 * exactly the name the user sees on the canvas tab. The workflow object itself
 * carries no name field, and ``app.activeWorkflow`` is not populated in every
 * frontend version.
 */
function workflowTitle() {
    const cleaned = (value) =>
        String(value || "")
            .replace(/\s+-\s+ComfyUI\s*$/i, "")
            .replace(/^\*+/, "")
            .replace(/\.json$/i, "")
            .trim();

    // 1. What the browser tab shows: "<workflow> - ComfyUI".
    const fromDocument = cleaned(document.title);
    // "ComfyUI" alone means no workflow is open.
    if (fromDocument && fromDocument.toLowerCase() !== "comfyui") {
        return fromDocument;
    }

    // 2. An explicitly saved file name, when the frontend exposes one.
    const active = app.activeWorkflow;
    const fromFile = cleaned(active?.filename || active?.name || "");
    if (fromFile) return fromFile;

    // 3. The graph's own name, if a package set one.
    const graph = app.rootGraph ?? app.graph;
    const fromGraph = cleaned(graph?.name || graph?.title || "");
    if (fromGraph) return fromGraph;

    // 4. Nothing usable: say so instead of borrowing a stage name.
    return "手机界面";
}

/**
 * Check whether a phone could reach this server at all.
 *
 * The phone opens the page at whatever address the user types, which is not
 * necessarily one the desktop editor can see. What can be checked from here
 * is whether ComfyUI was started in a way that accepts remote connections:
 * ``--listen`` binds 0.0.0.0 (or a NIC address), while a bare local run binds
 * 127.0.0.1 and is unreachable from a phone.
 *
 * Falls back to treating the server as reachable when the setting cannot be
 * read, so a detection failure never blocks the feature.
 */
async function probeMobileReachable() {
    try {
        const response = await api.fetchApi("/qq_mobile/reachability");
        if (!response.ok) return { reachable: true, known: false };
        const data = await response.json();
        return data;
    } catch (error) {
        console.warn("[QQ Mobile] reachability probe failed:", error);
        return { reachable: true, known: false };
    }
}

const openMobile = async (event) => {
    // Prepare the current workflow so it appears in the list, but do not force
    // the user into it: the picker below is where a pipeline is chosen.
    let prepared = null;
    try {
        prepared = await prepareTemplate({ notify: false });
    } catch (error) {
        console.warn("[QQ Mobile] prepare failed:", error);
        app.extensionManager?.toast?.add?.({
            severity: "warn",
            summary: "当前工作流无法生成手机界面",
            detail: String(error?.message || error),
            life: 5000,
        });
    }

    const probe = await probeMobileReachable();
    if (probe.known && !probe.reachable) {
        app.extensionManager?.toast?.add?.({
            severity: "error",
            summary: "手机无法访问这个 ComfyUI",
            detail: probe.hint || "请用 --listen 0.0.0.0 启动 ComfyUI，并确认端口可被局域网访问",
            life: 9000,
        });
        return;
    }
    // Opened on this machine, so the address here is not one a phone can use.
    // Tell the user what to type there instead.
    if (probe.suggested_url && !probe.via_proxy) {
        app.extensionManager?.toast?.add?.({
            severity: "info",
            summary: "手机请访问下面的地址",
            detail: probe.suggested_url,
            life: 12000,
        });
    }

    // Only the workflow that is open gets prepared. Expanding every saved
    // workflow here would block the click for seconds and swap the canvas
    // once per file; the phone prepares the one it is asked for instead.
    const params = new URLSearchParams();
    if (prepared?.workflow) params.set("workflow", prepared.workflow);
    const query = params.toString() ? `?${params.toString()}` : "";
    const url = mobileUrl(`${MOBILE_PAGE}${query}`);
    if (event?.shiftKey || event?.ctrlKey || event?.metaKey) {
        window.open(url, "_blank");
        return;
    }
    window.location.assign(url);
};

/**
 * Toolbar glyph, drawn inline.
 *
 * The toolbar's icons come from a Material webfont that ComfyUI ships as a
 * subset: `mdi-cellphone` exists in the stylesheet but not always in the
 * font file, and a missing glyph renders as a hollow box. An SVG has no such
 * dependency and keeps the toolbar's stroked look at the same 13×15 size.
 */
const ICON_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="7" y="2.6" width="10" height="18.8" rx="2.4"></rect>
  <path d="M10.8 5.4h2.4"></path>
  <path d="M11 18.6h2"></path>
</svg>`;

/**
 * Build the toolbar button ourselves.
 *
 * `ComfyButton` is a frontend-internal component: it returns a wrapper whose
 * inner <button> is rendered by the framework, so children added from outside
 * are wiped on mount (the icon ended up 0×0, or on a neighbouring button).
 * A plain <button> carrying the toolbar's own classes gets the same styling
 * without that problem, and the SVG inside is ours.
 */
const createButton = () => {
    const button = document.createElement("button");
    button.type = "button";
    // The class set the toolbar's icon buttons use in this frontend version.
    button.className = "comfyui-button comfyui-menu-mobile-collapse qq-mobile-toolbar";
    button.title = BUTTON_TOOLTIP;
    button.setAttribute("aria-label", BUTTON_TOOLTIP);
    button.innerHTML = ICON_SVG;
    // The other toolbar glyphs (star, vacuum, share) sit directly on the bar:
    // no chip behind them, and the ink is whatever the bar uses.
    Object.assign(button.style, {
        background: "transparent",
        border: "0",
        color: "inherit",
        boxShadow: "none",
    });
    const svg = button.querySelector("svg");
    if (svg) {
        svg.style.width = "17px";
        svg.style.height = "17px";
        svg.style.display = "block";
    }
    button.addEventListener("click", openMobile);
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
    const button = createButton();
    // The group class doubles as the "already attached" marker.
    button.classList.add(BUTTON_GROUP_CLASS);
    settingsGroup.element.before(button);
};

// Expose the entry points before registering, so the phone page and tests keep
// working even if the UI registration below fails for any reason.
globalThis.qqMobile = { prepareTemplate, prepareAllWorkflows };

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
        // Keep the phone's copy of the form current as the canvas changes.
        try {
            startTemplateWatcher();
        } catch (error) {
            console.warn("[QQ Mobile] template watcher unavailable:", error);
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
            // Same glyph as the toolbar button, and likewise an SVG: the icon
            // classes this API expects resolve to the same subsetted webfont.
            icon: "qq-mobile-icon",
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
