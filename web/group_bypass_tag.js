import { app } from "../../scripts/app.js";

// QQ-魔术贴：放进某个组里，用「模式」开关整组绕过。
//   绕过 = 组内除魔术贴以外的所有节点设为 Bypass
//   启用 = 恢复这些节点原来的 mode（只恢复魔术贴/绕过规则标记过的，用户手动绕过不动）
// 魔术贴自己永远不被绕过，也不受 QQ-绕过规则 控制（见 ignore_rules.js 的 isProtectedNode）。
//
// 绕过记录与 ignore_rules.js 共用 node.properties.wyslPrevMode，
// 两套机制改同一个节点时靠「已标记才恢复」的规则收敛，不会互相踩坏原状态。

const NODE_TYPE = "QQGroupBypassTag";
const TAG = "[QQ-魔术贴]";
const PROP_PREV_MODE = "wyslPrevMode";
const MODE_ON = "启用";
const MODE_BYPASS = "绕过";

function enums() {
    const e = globalThis.LiteGraph?.LGraphEventMode;
    return {
        ALWAYS: e?.ALWAYS ?? 0,
        BYPASS: e?.BYPASS ?? 4,
    };
}

function currentGraph() {
    const candidates = [app?.canvas?.graph, app?.graph, globalThis.LGraphCanvas?.active_canvas?.graph];
    for (const g of candidates) {
        if (g && (Array.isArray(g._nodes) || g._nodes_by_id)) return g;
    }
    return null;
}

function allNodes(graph) {
    const found = [];
    const seen = new Set();
    const visit = (g, depth = 0) => {
        if (!g || depth > 8) return;
        const list = Array.isArray(g._nodes) ? g._nodes : (g._nodes_by_id ? Object.values(g._nodes_by_id) : []);
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

function nodesInGroup(group) {
    if (!group) return [];
    try { group.recomputeInsideNodes?.(); } catch { /* 忽略 */ }
    if (Array.isArray(group.nodes)) return group.nodes;
    if (Array.isArray(group._nodes)) return group._nodes;
    return [];
}

function isTagNode(node) {
    return node?.comfyClass === NODE_TYPE || node?.type === NODE_TYPE;
}

function tagMode(node) {
    const widget = (node?.widgets || []).find((entry) => entry && entry.name === "模式");
    const value = widget?.value;
    return value === MODE_BYPASS ? MODE_BYPASS : MODE_ON;
}

// 与 ignore_rules.js 完全一致的原状态记录，保证两套机制可以互相恢复
function hasOwnRecord(node) {
    return typeof node?.properties?.[PROP_PREV_MODE] === "number";
}

function readPrevMode(node) {
    const fromProps = node?.properties?.[PROP_PREV_MODE];
    if (typeof fromProps === "number") return fromProps;
    const legacy = node?._wyslPrevMode;
    return typeof legacy === "number" ? legacy : undefined;
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
    const marked = hasOwnRecord(node);
    const prev = readPrevMode(node);
    if (bypass) {
        if (node.mode === BYPASS) return false;
        writePrevMode(node, node.mode ?? ALWAYS);
        node.mode = BYPASS;
        return true;
    }
    if (!marked) return false;
    node.mode = prev !== undefined ? prev : ALWAYS;
    clearPrevMode(node);
    return true;
}

function groupSize(group) {
    const size = group?.size || group?._size;
    if (Array.isArray(size) && size.length > 1) return Math.abs(size[0] * size[1]);
    return Number.POSITIVE_INFINITY;
}

// 取包含该节点的最内层组（面积最小）
function groupOf(node, groups) {
    let best = null;
    let bestArea = Number.POSITIVE_INFINITY;
    for (const group of groups) {
        if (!nodesInGroup(group).includes(node)) continue;
        const area = groupSize(group);
        if (area < bestArea) {
            bestArea = area;
            best = group;
        }
    }
    return best;
}

function applyTag(graph) {
    if (!graph) return null;
    const nodes = allNodes(graph);
    const groups = allGroups(graph);
    const { ALWAYS, BYPASS } = enums();
    let changed = false;
    let tags = 0;
    let bypassed = 0;

    // 先收集每个组里的魔术贴：同组多个魔术贴时，只要有一个选「绕过」就整组绕过
    const tagsByGroup = new Map();
    for (const node of nodes) {
        if (!isTagNode(node)) continue;
        tags += 1;
        // 魔术贴自己不受任何绕过控制
        if (node.mode === BYPASS) {
            node.mode = ALWAYS;
            changed = true;
        }
        const group = groupOf(node, groups);
        if (!group) continue;
        if (!tagsByGroup.has(group)) tagsByGroup.set(group, []);
        tagsByGroup.get(group).push(node);
    }

    for (const [group, groupTags] of tagsByGroup) {
        const bypass = groupTags.some((tag) => tagMode(tag) === MODE_BYPASS);
        for (const node of nodesInGroup(group)) {
            if (isTagNode(node)) continue;
            if (setBypassed(node, bypass)) changed = true;
            if (bypass && node.mode === BYPASS) bypassed += 1;
        }
    }

    if (changed) {
        try { graph.setDirtyCanvas?.(true, true); } catch { /* 忽略 */ }
        try { graph.change?.(); } catch { /* 忽略 */ }
    }
    return { tags, bypassed, changed };
}

function safeApply() {
    try {
        return applyTag(currentGraph());
    } catch (error) {
        console.warn(TAG, "执行失败", error);
        return null;
    }
}

function start() {
    if (globalThis.__wyslGroupTagTimer) return;
    const tick = () => {
        if (!app || app.loading_graph || app.configuringGraph) return;
        safeApply();
    };
    globalThis.__wyslGroupTagTimer = setInterval(tick, 900);
    setTimeout(tick, 1500);
}

function install(nodeType) {
    const prototype = nodeType?.prototype;
    if (!prototype || prototype.__wyslGroupTagInstalled) return;
    prototype.__wyslGroupTagInstalled = true;
    const originalCreated = prototype.onNodeCreated;
    prototype.onNodeCreated = function onNodeCreatedGroupTag() {
        const result = originalCreated?.apply(this, arguments);
        const widget = (this.widgets || []).find((entry) => entry && entry.name === "模式");
        if (widget) {
            const originalCallback = widget.callback;
            widget.callback = (...args) => {
                const value = originalCallback?.apply(this, args);
                queueMicrotask(() => safeApply());
                return value;
            };
        }
        return result;
    };
}

app.registerExtension({
    name: "QQ.GroupBypassTag",
    setup() { start(); },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_TYPE) return;
        start();
        install(nodeType);
    },
});
