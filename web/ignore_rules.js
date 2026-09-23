import { app } from "../../scripts/app.js";

// Wysl-绕过规则
// 用「文字」或「正则」匹配 节点标题 或 组名，把匹配到的节点设为 ComfyUI 的「绕过(Bypass)」。
//
// 规则语法：
//   - 多条规则用逗号分隔（也支持中文逗号、分号、换行）
//   - 普通文字 = 包含匹配；含正则符号（^ $ * . + ? ( ) [ ] { } |）时按正则匹配
//   - 规则前加 ! 表示「排除」：即使被其它规则命中也不会被绕过（排除优先）
//
// 示例：
//   节点: ^Get_图片, !Get_图片 1
//   组:   ^预处理, !保留组
//
// 依据官方 ComfyUI_frontend 源码：
//   src/lib/litegraph/src/types/globalEnums.ts
//     LGraphEventMode = { ALWAYS:0, ON_EVENT:1, NEVER:2, ON_TRIGGER:3, BYPASS:4 }
//   src/composables/graph/useGroupMenuOptions.ts
//     官方组操作：groupNodes.forEach(n => n.mode = mode) → canvas.setDirty() → graph.change()

const NODE_TYPE = "WyslIgnoreRules";
const TAG = "[Wysl-绕过规则]";
const EXCLUDE_PREFIX = "!";

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

// 规则前加 ! = 排除
function isExclusion(rule) {
    return String(rule ?? "").trim().startsWith(EXCLUDE_PREFIX);
}

function stripExclusion(rule) {
    const text = String(rule ?? "").trim();
    return isExclusion(text) ? text.slice(EXCLUDE_PREFIX.length).trim() : text;
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

function nodeText(node) {
    return [node?.title, node?.type, node?.comfyClass].filter((v) => typeof v === "string");
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

// 把规则分成 命中(include) / 排除(exclude) 两组，! 前缀进入排除组
function splitRules(entries) {
    const include = [];
    const exclude = [];
    for (const entry of entries) {
        const target = isExclusion(entry) ? exclude : include;
        const pattern = stripExclusion(entry);
        if (pattern) target.push(pattern);
    }
    return { include, exclude };
}

function applyRules(graph) {
    const nodes = allNodes(graph);
    if (!nodes.length) return null;

    const groups = allGroups(graph);
    const active = nodes.filter((node) => isRuleNode(node) && isEnabled(node));

    const nodeEntry = [];
    const groupEntry = [];
    for (const rule of active) {
        nodeEntry.push(...patterns(rule, "节点"));
        groupEntry.push(...patterns(rule, "组"));
    }
    const nodeRules = splitRules(nodeEntry);
    const groupRules = splitRules(groupEntry);

    // 1) 命中集合（节点规则 + 组规则）
    const targets = new Set();
    for (const node of nodes) {
        if (isRuleNode(node)) continue;
        if (hitAny(nodeRules.include, nodeText(node))) targets.add(node);
    }
    for (const group of groups) {
        if (!groupRules.include.length) break;
        if (hitAny(groupRules.include, groupTitle(group))) {
            for (const node of nodesInGroup(group)) targets.add(node);
        }
    }

    // 2) 排除集合（! 规则的节点 + ! 规则命中的组内节点），排除优先
    const excluded = new Set();
    if (nodeRules.exclude.length) {
        for (const node of nodes) {
            if (isRuleNode(node)) continue;
            if (hitAny(nodeRules.exclude, nodeText(node))) excluded.add(node);
        }
    }
    if (groupRules.exclude.length) {
        for (const group of groups) {
            if (hitAny(groupRules.exclude, groupTitle(group))) {
                for (const node of nodesInGroup(group)) excluded.add(node);
            }
        }
    }
    for (const node of excluded) targets.delete(node);

    let changed = false;
    for (const node of nodes) {
        if (isRuleNode(node)) continue;
        if (setBypassed(node, targets.has(node))) changed = true;
    }

    if (changed) {
        try { graph.setDirtyCanvas?.(true, true); } catch { /* 忽略 */ }
        try { graph.change?.(); } catch { /* 忽略 */ }
    }

    return {
        ruleCount: active.length,
        nodeInclude: nodeRules.include.length,
        nodeExclude: nodeRules.exclude.length,
        groupInclude: groupRules.include.length,
        groupExclude: groupRules.exclude.length,
        bypassed: targets.size,
        excluded: excluded.size,
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
    console.log(TAG, "扩展已加载（支持 ! 排除）");
    let lastLog = 0;
    const tick = () => {
        if (!app || app.loading_graph || app.configuringGraph) return;
        const result = safeApply();
        const now = Date.now();
        const hasRules = result && (result.nodeInclude + result.nodeExclude
            + result.groupInclude + result.groupExclude) > 0;
        if (hasRules && now - lastLog > 5000) {
            lastLog = now;
            console.log(
                TAG,
                `规则 ${result.ruleCount} 条 | 节点 ${result.nodeInclude}/排除 ${result.nodeExclude}`
                + ` | 组 ${result.groupInclude}/排除 ${result.groupExclude}`
                + ` | 已绕过 ${result.bypassed} | 被排除 ${result.excluded} | 本轮变更: ${result.changed}`,
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
