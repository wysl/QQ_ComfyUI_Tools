import { app } from "../../scripts/app.js";

// Wysl-绕过规则
// 用「文字」或「正则」匹配 节点标题 或 组名，把匹配到的节点设为 ComfyUI 的「绕过(Bypass)」状态。
//
// 依据官方 ComfyUI_frontend 源码：
//   src/lib/litegraph/src/types/globalEnums.ts
//     LGraphEventMode = { ALWAYS:0, ON_EVENT:1, NEVER:2, ON_TRIGGER:3, BYPASS:4 }
//   src/composables/graph/useGroupMenuOptions.ts
//     官方「组」操作：groupNodes.forEach(n => n.mode = mode) → canvas.setDirty() → graph.change()
//
// 注意：切换模式后必须调用 graph.change()，Node 2.0 / Vue 渲染才会重绘。

const NODE_TYPE = "WyslIgnoreRules";
const TAG = "[Wysl-绕过规则]";

// 官方枚举：BYPASS = 4。运行时优先读 LiteGraph，读不到就用字面值。
function bypassMode() {
    return globalThis.LiteGraph?.LGraphEventMode?.BYPASS ?? 4;
}

function currentGraph() {
    const candidates = [
        app?.canvas?.graph,
        app?.graph,
        globalThis.LGraphCanvas?.active_canvas?.graph,
    ];
    for (const g of candidates) {
        if (g && (Array.isArray(g._nodes) || g._nodes_by_id)) return g;
    }
    return null;
}

function allNodes(graph) {
    if (!graph) return [];
    if (Array.isArray(graph._nodes)) return graph._nodes.slice();
    if (graph._nodes_by_id) return Object.values(graph._nodes_by_id);
    return [];
}

function allGroups(graph) {
    return Array.isArray(graph?._groups) ? graph._groups.slice() : [];
}

function getWidget(node, name) {
    if (!Array.isArray(node?.widgets)) return null;
    return node.widgets.find((entry) => entry && entry.name === name) || null;
}

function isEnabled(node) {
    const value = getWidget(node, "启用")?.value;
    return value === true || value === 1 || value === "true" || value === "启用";
}

function patterns(node, name) {
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

function hitAny(patternList, values) {
    for (const pattern of patternList) {
        for (const value of values) {
            if (textMatches(pattern, value)) return true;
        }
    }
    return false;
}

function isRuleNode(node) {
    return node?.comfyClass === NODE_TYPE || node?.type === NODE_TYPE;
}

function groupTitle(group) {
    return [group?.title, group?.name].filter((v) => typeof v === "string");
}

function nodesInGroup(group) {
    if (!group) return [];
    try { group.recomputeInsideNodes?.(); } catch { /* 忽略 */ }
    if (Array.isArray(group.nodes)) return group.nodes;
    if (Array.isArray(group._nodes)) return group._nodes;
    return [];
}

// 设为绕过 / 恢复原状态
function setBypassed(node, bypass) {
    const BYPASS = bypassMode();
    if (bypass) {
        if (node.mode === BYPASS) return false;
        if (node._wyslPrevMode === undefined) node._wyslPrevMode = node.mode ?? 0;
        node.mode = BYPASS;
        return true;
    }
    if (node._wyslPrevMode !== undefined) {
        node.mode = node._wyslPrevMode;
        delete node._wyslPrevMode;
        return true;
    }
    return false;
}

function applyRules(graph) {
    const nodes = allNodes(graph);
    if (!nodes.length) return null;

    const groups = allGroups(graph);
    const active = nodes.filter((node) => isRuleNode(node) && isEnabled(node));

    const nodePatterns = [];
    const groupPatterns = [];
    for (const rule of active) {
        nodePatterns.push(...patterns(rule, "节点"));
        groupPatterns.push(...patterns(rule, "组"));
    }

    // 计算本轮应被绕过的节点
    const targets = new Set();
    for (const node of nodes) {
        if (isRuleNode(node)) continue;
        if (hitAny(nodePatterns, [node.title, node.type, node.comfyClass])) {
            targets.add(node);
        }
    }
    for (const group of groups) {
        if (!groupPatterns.length) break;
        if (hitAny(groupPatterns, groupTitle(group))) {
            for (const node of nodesInGroup(group)) targets.add(node);
        }
    }

    let changed = false;
    for (const node of nodes) {
        if (isRuleNode(node)) continue;
        if (setBypassed(node, targets.has(node))) changed = true;
    }

    if (changed) {
        // 官方做法：canvas.setDirty() + graph.change() 才会重绘
        try { graph.setDirtyCanvas?.(true, true); } catch { /* 忽略 */ }
        try { graph.change?.(); } catch { /* 忽略 */ }
    }

    return {
        ruleCount: active.length,
        nodePatterns: nodePatterns.length,
        groupPatterns: groupPatterns.length,
        bypassed: targets.size,
        changed,
    };
}

function safeApply() {
    try {
        const graph = currentGraph();
        return graph ? applyRules(graph) : null;
    } catch (error) {
        console.warn(TAG, "执行失败", error);
        return null;
    }
}

function start() {
    if (globalThis.__wyslBypassTimer) return;
    console.log(TAG, "扩展已加载");
    let lastLog = 0;
    const tick = () => {
        if (!app || app.loading_graph || app.configuringGraph) return;
        const result = safeApply();
        const now = Date.now();
        if (result && (result.nodePatterns || result.groupPatterns) && now - lastLog > 5000) {
            lastLog = now;
            console.log(
                TAG,
                `规则 ${result.ruleCount} 条 | 节点 ${result.nodePatterns} / 组 ${result.groupPatterns}`
                + ` | 已绕过 ${result.bypassed} 个节点 | 本轮变更: ${result.changed}`,
            );
        }
    };
    globalThis.__wyslBypassTimer = setInterval(tick, 800);
    setTimeout(tick, 2000);
}

app.registerExtension({
    name: "Wysl.IgnoreRules",
    setup() {
        start();
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name === NODE_TYPE) start();
    },
});
