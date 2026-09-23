import { app } from "../../../scripts/app.js";

const NODE_TYPE = "WyslIgnoreRules";
const MUTED = 2;

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
    const values = [node.title, node.type, node.comfyClass, node.constructor?.title];
    for (const entry of node.widgets || []) values.push(entry?.name, entry?.label, entry?.value);
    for (const input of node.inputs || []) values.push(input?.name, input?.label);
    return values.filter((value) => typeof value === "string");
}

function isController(node) {
    return node?.comfyClass === NODE_TYPE || node?.type === NODE_TYPE;
}

function applyRules(graph) {
    const controllers = graphNodes(graph).filter(isController);
    const enabled = controllers.filter(isEnabled);
    const nodeRules = enabled.flatMap((node) => linesOf(node, "节点"));
    const widgetRules = enabled.flatMap((node) => linesOf(node, "选框"));
    let changed = false;
    for (const node of graphNodes(graph)) {
        if (isController(node)) continue;
        const ignoreNode = anyMatch(nodeRules, nodeNames(node));
        if (ignoreNode) {
            if (node.mode !== MUTED) {
                node._wyslIgnorePreviousMode = node.mode ?? 0;
                node.mode = MUTED;
                changed = true;
            }
        } else if (node._wyslIgnorePreviousMode != null) {
            node.mode = node._wyslIgnorePreviousMode;
            delete node._wyslIgnorePreviousMode;
            changed = true;
        }
        for (const entry of node.widgets || []) {
            const ignoreWidget = ignoreNode || anyMatch(widgetRules, [entry?.name, entry?.label, entry?.value]);
            if (entry.disabled !== ignoreWidget || entry.computedDisabled !== ignoreWidget) {
                entry.disabled = ignoreWidget;
                entry.computedDisabled = ignoreWidget;
                changed = true;
            }
        }
    }
    if (changed) graph.setDirtyCanvas?.(true, true);
}

app.registerExtension({
    name: "Wysl.IgnoreRules",
    setup() {
        globalThis.__wyslIgnoreRulesTimer = setInterval(() => {
            try {
                applyRules(app.graph);
            } catch (error) {
                console.warn("Wysl-忽略规则失败", error);
            }
        }, 300);
    },
});
