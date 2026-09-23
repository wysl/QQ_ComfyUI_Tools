import { app } from "../../scripts/app.js";

// Wysl-忽略规则
// 用「文字」或「正则」匹配 节点标题 或 组名，把匹配到的设为 ComfyUI 的忽略(Never)状态。
//
// 依据官方 ComfyUI_frontend 实现：
//   - 节点忽略: node.mode = LGraphEventMode.NEVER (2)          // useGroupMenuOptions.ts
//   - 组忽略:   组内全部节点 mode = NEVER, 用 group.nodes + recomputeInsideNodes()
//   - 改完需 graph.change() 触发重绘（Node 2.0 / Vue 渲染同样依赖它）

const NODE_TYPE = "WyslIgnoreRules";
const TAG = "[Wysl-忽略规则]";

function neverMode() {
    return globalThis.LiteGraph?.LGraphEventMode?.NEVER ?? 2;
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
    if (!Array.isArray(graph?._groups)) return [];
    return graph._groups.slice();
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
    // 含正则元字符时按正则匹配，否则按包含匹配
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

function setIgnored(node, ignore) {
    const NEVER = neverMode();
    if (ignore) {
        if (node._wyslPrevMode === undefined) node._wyslPrevMode = node.mode ?? 0;
        if (node.mode !== NEVER) {
            node.mode = NEVER;
            return true;
        }
        return false;
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

    // 计算本轮应被忽略的节点集合
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
        if (setIgnored(node, targets.has(node))) changed = true;
    }

    if (changed) {
        // 关键：通知画布重绘（Vue / Node 2.0 渲染依赖此调用）
        try { graph.change?.(); } catch { /* 忽略 */ }
        try { graph.setDirtyCanvas?.(true, true); } catch { /* 忽略 */ }
    }

    return {
        ruleCount: active.length,
        nodePatterns: nodePatterns.length,
        groupPatterns: groupPatterns.length,
        ignored: targets.size,
        changed,
    };
}

function safeApply() {
    try {
        const graph = currentGraph();
        if (!graph) return null;
        return applyRules(graph);
    } catch (error) {
        console.warn(TAG, "执行失败", error);
        return null;
    }
}

function start() {
    if (globalThis.__wyslIgnoreTimer) return;
    console.log(TAG, "扩展已加载，规则匹配将在 2 秒后开始");
    let lastLog = 0;
    const tick = () => {
        if (!app || app.loading_graph || app.configuringGraph) return;
        const result = safeApply();
        const now = Date.now();
        if (result && (result.nodePatterns || result.groupPatterns) && now - lastLog > 5000) {
            lastLog = now;
            console.log(
                TAG,
                `规则 ${result.ruleCount} 条 | 节点规则 ${result.nodePatterns} 条 / 组规则 ${result.groupPatterns} 条`
                + ` | 已忽略 ${result.ignored} 个节点 | 本轮变更: ${result.changed}`,
            );
        }
    };
    globalThis.__wyslIgnoreTimer = setInterval(tick, 800);
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
