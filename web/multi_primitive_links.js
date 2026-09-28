import { app } from "../../scripts/app.js";

// QQ-多值输入 专用连线样式：
//   - 颜色固定草绿色
//   - 平时 5% 透明度（几乎隐形，长线不脏画面）
//   - 鼠标选中或悬停连线任一端节点时 90% 透明度 + 流动高亮
// 只改 link.color / link.flow 这两个渲染属性，不改连线拓扑、不进 prompt。

const NODE_TYPE = "QQ-多值输入";
const LEGACY_NODE_TYPE = "QQMultiPrimitive";
const TAG = "[QQ-多值输入连线]";
const GRASS_IDLE = "rgba(124, 199, 55, 0.05)";
const GRASS_ACTIVE = "rgba(154, 230, 60, 0.9)";

function graphLinks(graph) {
    if (!graph) return [];
    if (graph._links instanceof Map) return [...graph._links.values()];
    if (graph.links instanceof Map) return [...graph.links.values()];
    return Object.values(graph.links || {});
}

function isMultiSource(graph, link) {
    const source = graph?.getNodeById?.(link?.origin_id);
    return source?.type === NODE_TYPE || source?.type === LEGACY_NODE_TYPE;
}

function isActiveLink(graph, link, selectedIds, hoverId) {
    return selectedIds.has(link?.origin_id) || selectedIds.has(link?.target_id)
        || hoverId === link?.origin_id || hoverId === link?.target_id;
}

function styleFor(active) {
    return { color: active ? GRASS_ACTIVE : GRASS_IDLE, flow: active };
}

function applyLinkStyles(graph, selectedIds, hoverId) {
    if (!graph) return null;
    let touched = 0;
    for (const link of graphLinks(graph)) {
        if (!isMultiSource(graph, link)) continue;
        const active = isActiveLink(graph, link, selectedIds, hoverId);
        const style = styleFor(active);
        if (link.color !== style.color || Boolean(link.flow) !== style.flow) {
            link.color = style.color;
            link.flow = style.flow;
            touched += 1;
        }
    }
    if (touched) {
        try { graph.setDirtyCanvas?.(true, true); } catch { /* 忽略 */ }
    }
    return touched;
}

function currentState() {
    const canvas = app?.canvas;
    const selected = new Set();
    const selectedNodes = canvas?.selected_nodes || canvas?.selectedItems;
    if (selectedNodes) {
        for (const key of Object.keys(selectedNodes)) {
            const node = selectedNodes[key];
            if (node?.id != null) selected.add(node.id);
            else if (!Number.isNaN(Number(key))) selected.add(Number(key));
        }
        if (selectedNodes instanceof Set) {
            for (const node of selectedNodes) if (node?.id != null) selected.add(node.id);
        }
    }
    const hover = canvas?.node_over?.id ?? null;
    return { selected, hover };
}

function start() {
    if (globalThis.__qqMultiLinkTimer) return;
    globalThis.__qqMultiLinkTimer = setInterval(() => {
        if (!app || app.loading_graph || app.configuringGraph) return;
        const graph = app.canvas?.graph || app.graph;
        if (!graph) return;
        const { selected, hover } = currentState();
        applyLinkStyles(graph, selected, hover);
    }, 160);
}

app.registerExtension({
    name: "QQ.MultiPrimitiveLinks",
    setup() {
        start();
        console.info(TAG, "已加载：多值输入连线为草绿色，选中/悬停端点节点时高亮");
    },
});
