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

/** Subgraph instances on the current canvas. */
function subgraphInstances() {
    const graph = app.rootGraph ?? app.graph;
    const instances = (graph?._nodes ?? []).filter(
        (node) => node?.isSubgraphNode?.() && node?.subgraph,
    );
    return { graph, instances };
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

async function prepareTemplate({ notify = true } = {}) {
    const { graph, instances } = subgraphInstances();
    if (!graph) throw new Error("没有打开的工作流");
    if (!instances.length) throw new Error("当前工作流没有子图，手机界面需要子图提升参数");

    const { output, workflow } = await app.graphToPrompt();
    const parameters = [];
    const unbound = [];
    for (const instance of instances) {
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
                ...widgetBounds(instance, entry.name),
            });
        }
    }
    if (unbound.length) {
        console.warn("[QQ Mobile] parameters without writable targets:", unbound);
    }
    if (parameters.length && unbound.length === parameters.length) {
        throw new Error(
            `全部 ${parameters.length} 个参数都无法定位写入目标，请报告此工作流的子图结构`,
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

app.registerExtension({
    name: "QQ.MobileUI",
    async setup() {
        await attachButton();
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
    keybindings: [{ combo: { key: "m", alt: true, shift: true }, commandId: "qq.mobile.open" }],
    actionBarButtons: [
        {
            icon: "icon-[lucide--smartphone] size-4",
            tooltip: BUTTON_TOOLTIP,
            onClick: () => openMobile({}),
        },
    ],
});

// Exposed for tests and for the phone page to trigger a refresh.
globalThis.qqMobile = { prepareTemplate };
