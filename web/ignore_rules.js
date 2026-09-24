import { app } from "../../scripts/app.js";

// Wysl-绕过规则
// 用「文字」或「正则」匹配 节点标题 或 组名，把匹配到的节点设为「绕过(Bypass)」。
//
// 规则语法（节点 / 组 两个输入框各自独立）：
//   - 多条规则用逗号分隔（也支持中文逗号、分号、换行）
//   - 普通文字 = 包含匹配；含正则符号（^ $ * . + ? ( ) [ ] { } |）时按正则
//   - 规则前加 ! = 排除，优先级最高
//
// 依据官方 ComfyUI_frontend 源码：
//   src/lib/litegraph/src/types/globalEnums.ts
//     LGraphEventMode = { ALWAYS:0, ON_EVENT:1, NEVER:2, ON_TRIGGER:3, BYPASS:4 }
//   src/lib/litegraph/src/LGraphNode.ts
//     mode 是 getter/setter，真实状态存在 _state；node.properties 会随工作流序列化
//   src/composables/graph/useGroupMenuOptions.ts
//     官方组操作：foreach(n => n.mode = mode) -> setDirty -> graph.change()
//
// 恢复策略（上一版失效的根因）：
//   旧版把原状态记在 node._wyslPrevMode，但它不参与序列化，
//   工作流保存再加载就丢失，导致「关闭」无法恢复。
//   现改为记进 node.properties（官方序列化字段），并兜底恢复为 ALWAYS。

const NODE_TYPE = "WyslIgnoreRules";
const TAG = "[Wysl-绕过规则]";
const EXCLUDE_PREFIX = "!";
const PROP_PREV_MODE = "wyslPrevMode";

function enums() {
    const e = globalThis.LiteGraph?.LGraphEventMode;
    return {
        ALWAYS: e?.ALWAYS ?? 0,
        NEVER: e?.NEVER ?? 2,
        BYPASS: e?.BYPASS ?? 4,
    };
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

// 收集所有图（含子图）中的节点
function allNodes(graph) {
    const found = [];
    const seen = new Set();
    const visit = (g, depth = 0) => {
        if (!g || depth > 8) return;
        const list = Array.isArray(g._nodes)
            ? g._nodes
            : (g._nodes_by_id ? Object.values(g._nodes_by_id) : []);
        for (const node of list) {
            if (!node || seen.has(node)) continue;
            seen.add(node);
            found.push(node);
            if (node.subgraph) visit(node.subgraph, depth + 1);
        }
    };
    visit(graph);
    return found;
}

// 收集所有图（含子图）中的组
function allGroups(graph) {
    const out = [];
    const visit = (g, depth = 0) => {
        if (!g || depth > 8) return;
        if (Array.isArray(g._groups)) out.push(...g._groups);
        for (const node of (g._nodes || [])) {
            if (node && node.subgraph) visit(node.subgraph, depth + 1);
        }
    };
    visit(graph);
    return out;
}

function getWidget(node, name) {
    if (!Array.isArray(node?.widgets)) return null;
    return node.widgets.find((entry) => entry && entry.name === name) || null;
}

function isEnabled(node) {
    const value = getWidget(node, "启用")?.value;
    return value === true || value === 1 || value === "true" || value === "启用";
}

function isExclusion(rule) {
    return String(rule ?? "").trim().startsWith(EXCLUDE_PREFIX);
}

function stripExclusion(rule) {
    const text = String(rule ?? "").trim();
    return text.startsWith(EXCLUDE_PREFIX) ? text.slice(EXCLUDE_PREFIX.length).trim() : text;
}

function patterns(node, name) {
    const raw = String(getWidget(node, name)?.value ?? "");
    return raw.split(/[,，;；\n]+/).map((s) => s.trim()).filter(Boolean);
}

function textMatches(pattern, value) {
    const text = String(value ?? "");
    if (!pattern || !text) return false;
    if (/[\\^$.*+?()[\]{}|]/.test(pattern)) {
        try { return new RegExp(pattern).test(text); } catch { return false; }
    }
    return text.includes(pattern);
}

function hitAny(list, values) {
    for (const p of list) {
        for (const v of values) {
            if (textMatches(p, v)) return true;
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

function splitRules(entries) {
    const include = [];
    const exclude = [];
    for (const entry of entries) {
        const pattern = stripExclusion(entry);
        if (!pattern) continue;
        (isExclusion(entry) ? exclude : include).push(pattern);
    }
    return { include, exclude };
}

// 读取原状态：优先 node.properties（会随工作流保存），兼容旧版 _wyslPrevMode
function readPrevMode(node) {
    const fromProps = node?.properties?.[PROP_PREV_MODE];
    if (typeof fromProps === "number") return fromProps;
    const legacy = node?._wyslPrevMode;
    if (typeof legacy === "number") return legacy;
    return undefined;
}

function writePrevMode(node, mode) {
    try {
        if (node.properties) node.properties[PROP_PREV_MODE] = mode;
    } catch { /* 忽略 */ }
    node._wyslPrevMode = mode;
}

function clearPrevMode(node) {
    try {
        if (node.properties) delete node.properties[PROP_PREV_MODE];
    } catch { /* 忽略 */ }
    delete node._wyslPrevMode;
}

function setBypassed(node, bypass) {
    const { ALWAYS, BYPASS } = enums();
    const prev = readPrevMode(node);

    if (bypass) {
        if (node.mode === BYPASS) return false;
        if (prev === undefined) writePrevMode(node, node.mode ?? ALWAYS);
        node.mode = BYPASS;
        return true;
    }

    if (node.mode !== BYPASS) {
        if (prev !== undefined) clearPrevMode(node);
        return false;
    }
    node.mode = prev !== undefined ? prev : ALWAYS;
    clearPrevMode(node);
    return true;
}

function applyRules(graph) {
    const nodes = allNodes(graph);
    if (!nodes.length) return null;

    const groups = allGroups(graph);
    const active = nodes.filter((n) => isRuleNode(n) && isEnabled(n));

    const nodeEntry = [];
    const groupEntry = [];
    for (const rule of active) {
        nodeEntry.push(...patterns(rule, "节点"));
        groupEntry.push(...patterns(rule, "组"));
    }
    const nodeRules = splitRules(nodeEntry);
    const groupRules = splitRules(groupEntry);

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
                `规则 ${result.ruleCount} | 节点 ${result.nodeInclude}/排除 ${result.nodeExclude}`
                + ` | 组 ${result.groupInclude}/排除 ${result.groupExclude}`
                + ` | 已绕过 ${result.bypassed} | 被排除 ${result.excluded}`
                + ` | 本轮变更 ${result.changed}`,
            );
        }
    };
    globalThis.__wyslBypassTimer = setInterval(tick, 800);
    setTimeout(tick, 2000);
}

app.registerExtension({
    name: "Wysl.IgnoreRules",
    setup() { start(); },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name === NODE_TYPE) start();
    },
});
