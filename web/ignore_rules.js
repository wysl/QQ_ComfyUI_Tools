import { app } from "../../scripts/app.js";

const NODE_TYPE = "WyslIgnoreRules";
const MODE_NEVER = 2;

function nodesOf(graph) {
    if (!graph) return [];
    if (Array.isArray(graph._nodes)) return graph._nodes;
    if (graph._nodes_by_id) return Object.values(graph._nodes_by_id);
    return [];
}

function getWidget(node, name) {
    if (!Array.isArray(node?.widgets)) return null;
    return node.widgets.find((entry) => entry && entry.name === name) || null;
}

function isEnabled(node) {
    const value = getWidget(node, "启用")?.value;
    return value === true || value === 1 || value === "true" || value === "启用";
}

function patternList(node, name) {
    const raw = String(getWidget(node, name)?.value ?? "");
    return raw.split(/[,，;；\n]+/).map((item) => item.trim()).filter(Boolean);
}

function textMatches(pattern, value) {
    const text = String(value ?? "");
    if (!pattern || !text) return false;
    if (/[\\^$.*+?()[\]{}|]/.test(pattern)) {
        try { return new RegExp(pattern).test(text); } catch { return false; }
    }
    return text.includes(pattern);
}

function hitAny(patterns, values) {
    for (const pattern of patterns) {
        for (const value of values) {
            if (textMatches(pattern, value)) return true;
        }
    }
    return false;
}

function searchableText(node) {
    const values = [node.title, node.type, node.comfyClass];
    for (const input of node.inputs || []) values.push(input?.label, input?.name);
    for (const entry of node.widgets || []) values.push(entry?.label, entry?.name, entry?.value);
    return values.filter((value) => typeof value === "string");
}

function isRuleNode(node) {
    return node?.comfyClass === NODE_TYPE || node?.type === NODE_TYPE;
}

function hideWidget(entry, hidden) {
    const element = entry?.element;
    if (!element || !element.style) return;
    element.style.display = hidden ? "none" : "";
}

function applyRules(graph) {
    const all = nodesOf(graph);
    if (!all.length) return;

    const active = all.filter(isRuleNode).filter(isEnabled);
    const nodePatterns = [];
    const widgetPatterns = [];
    for (const node of active) {
        nodePatterns.push(...patternList(node, "节点"));
        widgetPatterns.push(...patternList(node, "选框"));
    }

    for (const node of all) {
        if (isRuleNode(node)) continue;
        try {
            const ignoreNode = hitAny(nodePatterns, searchableText(node));
            if (ignoreNode) {
                if (node.mode !== MODE_NEVER) {
                    if (node._wyslPrevMode === undefined) node._wyslPrevMode = node.mode ?? 0;
                    node.mode = MODE_NEVER;
                }
            } else if (node._wyslPrevMode !== undefined) {
                node.mode = node._wyslPrevMode;
                delete node._wyslPrevMode;
            }

            for (const entry of node.widgets || []) {
                hideWidget(entry, ignoreNode || hitAny(widgetPatterns, [entry?.label, entry?.name, entry?.value]));
            }
            node.setDirtyCanvas?.(true, true);
        } catch (error) {
            console.warn("Wysl-忽略规则：跳过节点", node?.title, error);
        }
    }
}

function safeApply() {
    try {
        applyRules(app.canvas?.graph || app.graph);
    } catch (error) {
        console.warn("Wysl-忽略规则失败", error);
    }
}

app.registerExtension({
    name: "Wysl.IgnoreRules",
    setup() {
        const tick = () => {
            if (app.graph && !app.loading_graph && !app.configuringGraph) {
                safeApply();
            }
        };
        if (!globalThis.__wyslIgnoreTimer) globalThis.__wyslIgnoreTimer = setInterval(tick, 600);
        setTimeout(tick, 1500);
    },
});
