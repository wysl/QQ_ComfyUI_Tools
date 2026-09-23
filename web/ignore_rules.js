import { app } from "../../scripts/app.js";

const NODE_TYPE = "WyslIgnoreRules";
const MODE_ALWAYS = 0;
const MODE_NEVER = 2;

function nodesOf(graph) {
    if (!graph) return [];
    if (Array.isArray(graph._nodes)) return graph._nodes;
    if (graph._nodes_by_id) return Object.values(graph._nodes_by_id);
    return [];
}

function widget(node, name) {
    return (node.widgets || []).find((entry) => entry.name === name);
}

function enabled(node) {
    const value = widget(node, "启用")?.value;
    return value === true || value === 1 || value === "true" || value === "启用";
}

function patterns(node, name) {
    return String(widget(node, name)?.value || "")
        .split(/[,，;；\n]+/)
        .map((line) => line.trim())
        .filter(Boolean);
}

function matches(pattern, value) {
    const text = String(value || "");
    if (!pattern || !text) return false;
    if (/[\\^$.*+?()[\]{}|]/.test(pattern)) {
        try { return new RegExp(pattern).test(text); } catch { return false; }
    }
    return text.includes(pattern);
}

function matchesAny(patternsToCheck, values) {
    return patternsToCheck.some((pattern) => values.some((value) => matches(pattern, value)));
}

function nodeText(node) {
    const values = [node.title, node.type, node.comfyClass, node.constructor?.title];
    for (const input of node.inputs || []) values.push(input?.label, input?.name);
    for (const entry of node.widgets || []) values.push(entry?.label, entry?.name, entry?.value);
    return values.filter((value) => typeof value === "string");
}

function isRuleNode(node) {
    return node?.comfyClass === NODE_TYPE || node?.type === NODE_TYPE;
}

function muteNode(node, muted) {
    const graph = node.graph;
    const target = muted ? MODE_NEVER : (node._wyslSavedMode ?? MODE_ALWAYS);
    if (muted && node.mode !== MODE_NEVER) node._wyslSavedMode = node.mode ?? MODE_ALWAYS;
    if (!muted) delete node._wyslSavedMode;
    if (graph?.canvas?.onNodeModeChange) graph.canvas.onNodeModeChange(node, target);
    else if (typeof node.setMode === "function") node.setMode(target);
    else node.mode = target;
}

function apply(graph) {
    const all = nodesOf(graph);
    const ruleNodes = all.filter(isRuleNode);
    const active = ruleNodes.filter(enabled);
    const nodePatterns = active.flatMap((node) => patterns(node, "节点"));
    const widgetPatterns = active.flatMap((node) => patterns(node, "选框"));

    for (const node of all) {
        if (isRuleNode(node)) continue;
        const ignoreWholeNode = matchesAny(nodePatterns, nodeText(node));
        muteNode(node, ignoreWholeNode);
        for (const entry of node.widgets || []) {
            const ignoreWidget = ignoreWholeNode || matchesAny(widgetPatterns, [entry?.label, entry?.name, entry?.value]);
            entry.disabled = ignoreWidget;
            entry.computedDisabled = ignoreWidget;
            if (entry.element) entry.element.style.display = ignoreWidget ? "none" : "";
        }
        node.widgets_height = undefined;
        node.setDirtyCanvas?.(true, true);
    }
    graph?.setDirtyCanvas?.(true, true);
}

app.registerExtension({
    name: "Wysl.IgnoreRules",
    loadedGraphNode(node) {
        if (isRuleNode(node)) apply(node.graph || app.graph);
    },
    setup() {
        const original = app.graph?.change;
        if (app.graph && original && !app.graph._wyslIgnoreWrapped) {
            app.graph._wyslIgnoreWrapped = true;
            app.graph.change = function () {
                const result = original.apply(this, arguments);
                apply(this);
                return result;
            };
        }
        setInterval(() => apply(app.canvas?.graph || app.graph), 500);
    },
});
