import { app } from "../../scripts/app.js";

// QQ-魔术贴：放进某个组里，用「模式」开关整组绕过。
//   绕过 = 组内除魔术贴以外的所有节点设为 Bypass
//   启用 = 恢复这些节点原来的 mode（只恢复魔术贴/绕过规则标记过的，用户手动绕过不动）
// 魔术贴自己永远不被绕过，也不受 QQ-绕过规则 控制（见 ignore_rules.js 的 isProtectedNode）。
//
// 绕过记录与 ignore_rules.js 共用 node.properties.wyslPrevMode，
// 两套机制改同一个节点时靠「已标记才恢复」的规则收敛，不会互相踩坏原状态。
//
// 组归属判定：优先用 group.recomputeInsideNodes() 后的 group.nodes；
// 取不到时退化为按位置矩形包含判定（不同前端版本组 API 有差异，双保险）。

const NODE_TYPE = "QQGroupBypassTag";
const TAG = "[QQ-魔术贴]";
const PROP_PREV_MODE = "wyslPrevMode";
// 所有权标记：被魔术贴接管的节点，QQ-绕过规则 一律不碰（见 ignore_rules.js）
const PROP_TAG_OWNED = "wyslTagOwned";
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
        if (Array.isArray(g.groups)) out.push(...g.groups);
        for (const node of (g._nodes || [])) {
            if (node && node.subgraph) visit(node.subgraph, depth + 1);
        }
    };
    visit(graph);
    return out;
}

function groupRect(group) {
    const pos = group?.pos || group?._pos;
    const size = group?.size || group?._size;
    if (!Array.isArray(pos) || !Array.isArray(size)) return null;
    return { x: pos[0], y: pos[1], w: size[0], h: size[1] };
}

function nodeInGroupRect(node, group) {
    const rect = groupRect(group);
    const pos = node?.pos;
    if (!rect || !Array.isArray(pos)) return false;
    return pos[0] >= rect.x && pos[1] >= rect.y
        && pos[0] <= rect.x + rect.w && pos[1] <= rect.y + rect.h;
}

function nodesInGroup(group) {
    if (!group) return [];
    try { group.recomputeInsideNodes?.(); } catch { /* 忽略 */ }
    if (Array.isArray(group.nodes) && group.nodes.length) return group.nodes;
    if (Array.isArray(group._nodes) && group._nodes.length) return group._nodes;
    return [];
}

// 组成员：官方 nodes 列表优先，空时按位置兜底
function membersOf(group, nodes) {
    const listed = nodesInGroup(group);
    if (listed.length) return listed;
    return nodes.filter((node) => nodeInGroupRect(node, group));
}

function titleHeightOf(node) {
    const value = Number(globalThis.LiteGraph?.NODE_TITLE_HEIGHT);
    return Number.isFinite(value) && value >= 0 ? value : 30;
}

// 节点整体（含标题栏）与组矩形是否相交。魔术贴常贴在组的下边缘、
// 身体露在组外，只按左上角判定会误判成「不在任何组内」而彻底失效。
function nodeOverlapsGroup(node, group) {
    const rect = groupRect(group);
    const pos = node?.pos;
    if (!rect || !Array.isArray(pos)) return false;
    const size = Array.isArray(node.size) ? node.size : [0, 0];
    const top = pos[1] - titleHeightOf(node);
    return pos[0] + size[0] >= rect.x && pos[0] <= rect.x + rect.w
        && pos[1] + size[1] >= rect.y && top <= rect.y + rect.h;
}

// 一次算好每个组的成员集合，避免每个节点都重算一遍。
function buildMemberSets(groups, nodes) {
    const map = new Map();
    for (const group of groups) map.set(group, new Set(membersOf(group, nodes)));
    return map;
}

// 深度 = 1 + 该节点还属于几个「其它组」。
// 只认官方成员列表，不看组的矩形：部分前端版本的组几何拿不到，
// 一旦依赖矩形，所有节点都会被算成深度 1，嵌套组就被误当第一层。
function groupDepthForNode(group, node, groups, nodes, memberSets) {
    if (!group || !node) return -1;
    let depth = 1;
    for (const candidate of groups) {
        if (candidate === group) continue;
        const set = memberSets?.get(candidate);
        const inside = set
            ? set.has(node)
            : membersOf(candidate, nodes).includes(node);
        if (inside) depth += 1;
    }
    return depth;
}

// 魔术贴所属组：优先常规判定；都落空时退化为「节点整体与组矩形相交」的兜底
function groupForTag(node, groups, nodes) {
    const direct = groupOf(node, groups, nodes);
    if (direct) return direct;
    const overlapping = groups
        .filter((group) => nodeOverlapsGroup(node, group))
        .sort((a, b) => groupSize(a) - groupSize(b));
    return overlapping[0] || null;
}

function membersAtDepth(group, nodes, groups, depth, memberSets) {
    const members = memberSets?.get(group) ? [...memberSets.get(group)] : membersOf(group, nodes);
    if (depth <= 0) return members;
    return members.filter(
        (node) => groupDepthForNode(group, node, groups, nodes, memberSets) <= depth,
    );
}

function isTagNode(node) {
    return node?.comfyClass === NODE_TYPE || node?.type === NODE_TYPE;
}

function tagMode(node) {
    const widget = (node?.widgets || []).find((entry) => entry && entry.name === "模式");
    const value = widget?.value;
    return value === MODE_BYPASS ? MODE_BYPASS : MODE_ON;
}

function tagDepth(node) {
    const widget = (node?.widgets || []).find((entry) => entry && entry.name === "忽略深度");
    const value = Number(widget?.value);
    return Number.isFinite(value) ? Math.max(0, Math.min(5, Math.trunc(value))) : 0;
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
        if (node.mode === BYPASS) {
            // 已经是绕过（可能由绕过规则先做的），接管所有权但不动原状态记录
            if (node.properties) node.properties[PROP_TAG_OWNED] = true;
            return false;
        }
        writePrevMode(node, node.mode ?? ALWAYS);
        if (node.properties) node.properties[PROP_TAG_OWNED] = true;
        node.mode = BYPASS;
        return true;
    }
    if (!marked) {
        if (node.properties) delete node.properties[PROP_TAG_OWNED];
        return false;
    }
    node.mode = prev !== undefined ? prev : ALWAYS;
    clearPrevMode(node);
    if (node.properties) delete node.properties[PROP_TAG_OWNED];
    return true;
}

function groupSize(group) {
    const rect = groupRect(group);
    return rect ? Math.abs(rect.w * rect.h) : Number.POSITIVE_INFINITY;
}

// 取包含该节点的最内层组（面积最小）；官方列表和位置判定都算
function groupOf(node, groups, nodes) {
    let best = null;
    let bestCount = Number.POSITIVE_INFINITY;
    let bestArea = Number.POSITIVE_INFINITY;
    for (const group of groups) {
        const listed = nodesInGroup(group);
        const inside = listed.includes(node) || nodeInGroupRect(node, group);
        if (!inside) continue;
        // 成员更少 = 更内层；成员数相同再比面积
        const count = listed.length || Number.POSITIVE_INFINITY;
        const area = groupSize(group);
        if (best === null || count < bestCount || (count === bestCount && area < bestArea)) {
            bestCount = count;
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
    const memberSets = buildMemberSets(groups, nodes);
    const { ALWAYS, BYPASS } = enums();
    let changed = false;
    let tags = 0;
    let bypassed = 0;
    const report = [];

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
        const group = groupForTag(node, groups, nodes);
        if (!group) {
            report.push(`#${node.id} ${tagMode(node)} 不在任何组内`);
            continue;
        }
        if (!tagsByGroup.has(group)) tagsByGroup.set(group, []);
        tagsByGroup.get(group).push({ node, depth: tagDepth(node) });
    }

    // 本组管到的全部候选成员（忽略深度），用于把「掉出当前深度」的节点放回来
    const covered = new Set();

    for (const [group, groupTags] of tagsByGroup) {
        const bypass = groupTags.some(({ node }) => tagMode(node) === MODE_BYPASS);
        const depth = Math.max(...groupTags.map(({ depth: value }) => value));
        const allMembers = membersOf(group, nodes).filter((node) => !isTagNode(node));
        const members = membersAtDepth(group, nodes, groups, depth, memberSets)
            .filter((node) => !isTagNode(node));
        const keep = new Set(members);
        for (const node of allMembers) covered.add(node);
        let released = 0;
        // 深度调小后，之前被本组接管的节点必须放回原状态，否则会永远停在绕过
        for (const node of allMembers) {
            if (keep.has(node)) continue;
            if (setBypassed(node, false)) {
                changed = true;
                released += 1;
            }
        }
        for (const node of members) {
            if (setBypassed(node, bypass)) changed = true;
            if (bypass && node.mode === BYPASS) bypassed += 1;
        }
        report.push(
            `组「${group.title || group.name || "?"}」${bypass ? "绕过" : "启用"}`
            + ` 深度 ${depth} 成员 ${members.length}`
            + (released ? ` 释放 ${released}` : ""),
        );
    }

    // 节点被移出组、或魔术贴被删掉时，同样要把它放回原状态
    for (const node of nodes) {
        if (isTagNode(node) || covered.has(node)) continue;
        if (!node?.properties?.[PROP_TAG_OWNED]) continue;
        if (setBypassed(node, false)) changed = true;
    }

    if (changed) {
        try { graph.setDirtyCanvas?.(true, true); } catch { /* 忽略 */ }
        try { graph.change?.(); } catch { /* 忽略 */ }
    }
    return { tags, bypassed, changed, report };
}

function safeApply() {
    try {
        return applyTag(currentGraph());
    } catch (error) {
        console.warn(TAG, "执行失败", error);
        return null;
    }
}

let lastLog = 0;
function loggedApply() {
    const result = safeApply();
    if (!result || !result.tags) return result;
    const now = Date.now();
    if (now - lastLog > 5000 || result.changed) {
        lastLog = now;
        console.log(TAG, `魔术贴 ${result.tags} | 已绕过 ${result.bypassed} | 变更 ${result.changed} | ${result.report.join(" ; ")}`);
    }
    return result;
}

function start() {
    if (globalThis.__wyslGroupTagTimer) return;
    const tick = () => {
        if (!app || app.loading_graph || app.configuringGraph) return;
        loggedApply();
    };
    globalThis.__wyslGroupTagTimer = setInterval(tick, 900);
    setTimeout(tick, 1500);

    // 排队前再同步一次，保证提交出去的 prompt 里绕过状态是最新的
    const originalGraphToPrompt = app.graphToPrompt?.bind(app);
    if (originalGraphToPrompt && !globalThis.__wyslGroupTagPromptHook) {
        globalThis.__wyslGroupTagPromptHook = true;
        app.graphToPrompt = async function (...args) {
            if (!app.loading_graph && !app.configuringGraph) safeApply();
            return originalGraphToPrompt(...args);
        };
    }
}

function install(nodeType) {
    const prototype = nodeType?.prototype;
    if (!prototype || prototype.__wyslGroupTagInstalled) return;
    prototype.__wyslGroupTagInstalled = true;
    const originalCreated = prototype.onNodeCreated;
    prototype.onNodeCreated = function onNodeCreatedGroupTag() {
        const result = originalCreated?.apply(this, arguments);
        const widgets = (this.widgets || []).filter((entry) => entry && ["模式", "忽略深度"].includes(entry.name));
        for (const widget of widgets) {
            const originalCallback = widget.callback;
            widget.callback = (...args) => {
                const value = originalCallback?.apply(this, args);
                queueMicrotask(() => loggedApply());
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

export { applyTag, groupDepthForNode, groupForTag, membersAtDepth };
