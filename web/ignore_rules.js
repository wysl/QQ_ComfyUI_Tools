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
    const values = [node.title, node.type, node.comfyClass];
    for (const input of node.inputs || []) values.push(input?.label, input?.name);
    for (const entry of node.widgets || []) values.push(entry?.label, entry?.name, entry?.value);
    return values.filter((value) => typeof value === "string");
}

function isRuleNode(node) {
    return node?.comfyClass === NODE_TYPE || node?.type === NODE_TYPE;
}

function muteNode(node, muted) {
    const target = muted ? MODE_NEVER : (node._wyslSavedMode ?? MODE_ALWAYS);
    if (muted && node.mode !== MODE_NEVER) node._wyslSavedMode = node.mode ?? MODE_ALWAYS;
    if (!muted) delete node._wyslSavedMode;
    if (node.mode === target) return;
    try {
        if (typeof node.setMode === "function") node.setMode(target);
        else node.mode = target;
    } catch {
        // Ignore widgets that reject the mode change.
    }
}

function fadeWidget(entry, hidden) {
    if (!entry) return;
    const element = entry.element;
    if (element?.style) element.style.display = hidden ? "none" : "";
}

function apply(graph) {
    const all = nodesOf(graph);
    const active = all.filter(isRuleNode).filter(enabled);
    const nodePatterns = active.flatMap((node) => patterns(node, "节点"));
    const widgetPatterns = active.flatMap((node) => patterns(node, "选框"));

    for (const node of all) {
        if (isRuleNode(node)) continue;
        const ignoreWholeNode = matchesAny(nodePatterns, nodeText(node));
        muteNode(node, ignoreWholeNode);
        for (const entry of node.widgets || []) {
            const ignoreWidget = ignoreWholeNode
                || matchesAny(widgetPatterns, [entry?.label, entry?.name, entry?.value]);
            fadeWidget(entry, ignoreWidget);
        }
        node.setDirtyCanvas?.(true, true);
    }
    graph?.setDirtyCanvas?.(true, true);
}

function guardedApply(graph) {
    try {
        apply(graph);
    } catch (error) {
        console.warn("Wysl-忽略规则失败", error);
    }
}

app.registerExtension({
    name: "Wysl.IgnoreRules",
    loadedGraphNode(node) {
        if (isRuleNode(node)) guardedApply(node.graph || app.graph);
    },
    setup() {
        setInterval(() => guardedApply(app.canvas?.graph || app.graph), 500);
    },
});
