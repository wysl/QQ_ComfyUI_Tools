import { app } from "../../scripts/app.js";

const NODE_TYPE = "WyslIgnoreRules";
const MUTED = 2;

function graphNodes(graph) {
    return graph?._nodes || [];
}

function widget(node, name) {
    return (node.widgets || []).find((entry) => entry.name === name);
}

function enabled(node) {
    const value = widget(node, "启用")?.value;
    return value === true || value === 1 || value === "true" || value === "启用";
}

function rules(node, name) {
    return String(widget(node, name)?.value || "")
        .split(/[,，;；\n]+/)
        .map((line) => line.trim())
        .filter(Boolean);
}

function matches(rule, value) {
    const text = String(value || "");
    if (!rule || !text) return false;
    if (/[\\^$.*+?()[\]{}|]/.test(rule)) {
        try {
            return new RegExp(rule).test(text);
        } catch {
            return false;
        }
    }
    return text.includes(rule);
}

function anyMatch(patterns, values) {
    return patterns.some((rule) => values.some((value) => matches(rule, value)));
}

function names(node) {
    const values = [node.title, node.type, node.comfyClass];
    for (const input of node.inputs || []) values.push(input?.name, input?.label);
    for (const entry of node.widgets || []) values.push(entry?.name, entry?.label, entry?.value);
    return values.filter((value) => typeof value === "string");
}

function controller(node) {
    return node?.comfyClass === NODE_TYPE || node?.type === NODE_TYPE;
}

function setMode(node, mode) {
    if (typeof node.setMode === "function") node.setMode(mode);
    else node.mode = mode;
}

function applyRules(graph) {
    if (!graph) return;
    const controllers = graphNodes(graph).filter(controller);
    const active = controllers.filter(enabled);
    const nodeRules = active.flatMap((node) => rules(node, "节点"));
    const widgetRules = active.flatMap((node) => rules(node, "选框"));
    let ignoredNodes = 0;
    let ignoredWidgets = 0;

    for (const node of graphNodes(graph)) {
        if (controller(node)) continue;
        const ignoreNode = anyMatch(nodeRules, names(node));
        if (ignoreNode) {
            if (node.mode !== MUTED) node._wyslPreviousMode = node.mode ?? 0;
            setMode(node, MUTED);
            ignoredNodes += 1;
        } else if (node._wyslPreviousMode != null) {
            setMode(node, node._wyslPreviousMode);
            delete node._wyslPreviousMode;
        }

        for (const entry of node.widgets || []) {
            const ignoreWidget = ignoreNode || anyMatch(widgetRules, [entry?.name, entry?.label, entry?.value]);
            entry.disabled = ignoreWidget;
            entry.computedDisabled = ignoreWidget;
            if (entry.element) entry.element.style.display = ignoreWidget ? "none" : "";
            if (ignoreWidget) ignoredWidgets += 1;
        }
        node.widgets_height = undefined;
        node.setDirtyCanvas?.(true, true);
    }

    for (const node of controllers) {
        const base = String(widget(node, "名称")?.value || "忽略规则");
        node.title = enabled(node)
            ? `${base} · 已忽略 ${ignoredNodes} 个节点 / ${ignoredWidgets} 个选框`
            : base;
    }
    graph.setDirtyCanvas?.(true, true);
}

app.registerExtension({
    name: "Wysl.IgnoreRules",
    setup() {
        if (globalThis.__wyslIgnoreRulesTimer) return;
        globalThis.__wyslIgnoreRulesTimer = setInterval(() => {
            try {
                applyRules(app.canvas?.graph || app.graph);
            } catch (error) {
                console.warn("Wysl-忽略规则失败", error);
            }
        }, 250);
    },
});
