import { app } from "../../../scripts/app.js";

const NODE_TYPE = "WyslIgnoreRules";

function graphNodes(graph) {
    return graph?._nodes || [];
}

function widget(node, name) {
    return (node.widgets || []).find((entry) => entry.name === name);
}

function isEnabled(node) {
    const value = widget(node, "启用")?.value;
    return value === true || value === 1 || value === "true";
}

function linesOf(node, name) {
    return String(widget(node, name)?.value || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

function isRegex(rule) {
    return /[\\^$.*+?()[\]{}|]/.test(rule);
}

function matches(rule, value) {
    const text = String(value || "");
    if (!rule || !text) return false;
    if (!isRegex(rule)) return text.includes(rule);
    try {
        return new RegExp(rule).test(text);
    } catch {
        return false;
    }
}

function anyMatch(rules, values) {
    return rules.some((rule) => values.some((value) => matches(rule, value)));
}

function nodeNames(node) {
    return [node.title, node.type, node.comfyClass, node.constructor?.title]
        .filter((value) => typeof value === "string");
}

function applyRules(graph) {
    const controllers = graphNodes(graph).filter((node) => node.comfyClass === NODE_TYPE || node.type === NODE_TYPE);
    const enabled = controllers.filter(isEnabled);
    const nodeRules = enabled.flatMap((node) => linesOf(node, "节点"));
    const widgetRules = enabled.flatMap((node) => linesOf(node, "选框"));
    for (const node of graphNodes(graph)) {
        if (controllers.includes(node)) continue;
        const ignoreNode = anyMatch(nodeRules, nodeNames(node));
        if (node.mode !== LiteGraph.NEVER) node._wyslIgnorePreviousMode ??= node.mode;
        node.mode = ignoreNode ? LiteGraph.NEVER : (node._wyslIgnorePreviousMode ?? node.mode);
        if (!ignoreNode) delete node._wyslIgnorePreviousMode;

        for (const entry of node.widgets || []) {
            const ignoreWidget = ignoreNode || anyMatch(widgetRules, [entry?.name, entry?.label]);
            entry.disabled = ignoreWidget;
            entry.computedDisabled = ignoreWidget;
        }
    }
}

function signature(node) {
    return JSON.stringify((node.widgets || []).map((entry) => [entry.name, entry.value]));
}

app.registerExtension({
    name: "Wysl.IgnoreRules",
    setup() {
        globalThis.__wyslIgnoreRulesTimer = setInterval(() => {
            const graph = app.graph;
            if (!graph) return;
            const controllers = graphNodes(graph).filter((node) => node.comfyClass === NODE_TYPE || node.type === NODE_TYPE);
            const current = controllers.map(signature).join("\n");
            if (current === graph._wyslIgnoreSignature) return;
            graph._wyslIgnoreSignature = current;
            applyRules(graph);
            graph.setDirtyCanvas?.(true, true);
        }, 300);
    },
});
