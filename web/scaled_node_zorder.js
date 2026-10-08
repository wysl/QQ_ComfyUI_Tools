import { app } from "../../scripts/app.js";

// QQ-缩放节点沉底：画布层级 = graph._nodes 数组顺序（越后越上层），
// 选中/拖拽会触发 bringToFront 把节点甩到数组末尾，导致缩放过的节点
// 像牛皮癣一样浮在未缩放节点上面。这里约定：
//   1) 工作流加载后，稳定排序：缩放节点(scale != 1)整体沉到未缩放节点之下，
//      缩放节点之间按 scale 升序（缩得越小越靠底）；
//   2) 拦截 bringToFront：缩放节点被点选/拖拽时不再跳回最上层。
// 未缩放节点的交互行为完全不变。

function scaleOf(node) {
    const scale = Number(node?.scale);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function isScaled(node) {
    return Math.abs(scaleOf(node) - 1) > 0.001;
}

function restack(graph) {
    const nodes = graph?._nodes;
    if (!Array.isArray(nodes) || nodes.length < 2) return;
    const keyed = nodes.map((node, index) => ({ node, index, scaled: isScaled(node), scale: scaleOf(node) }));
    keyed.sort((a, b) => {
        if (a.scaled !== b.scaled) return a.scaled ? -1 : 1;
        if (a.scaled) return a.scale - b.scale || a.index - b.index;
        return a.index - b.index;
    });
    const next = keyed.map((item) => item.node);
    if (next.some((node, index) => node !== nodes[index])) {
        nodes.length = 0;
        for (const node of next) nodes.push(node);
        graph.setDirtyCanvas?.(true, true);
    }
}

function guardBringToFront(target, name) {
    const original = target?.[name];
    if (typeof original !== "function" || original.__qqScaledGuard) return;
    const wrapped = function qqScaledBringToFront(node, ...rest) {
        if (isScaled(node)) {
            this.setDirty?.(true, true);
            return undefined;
        }
        return original.call(this, node, ...rest);
    };
    wrapped.__qqScaledGuard = true;
    target[name] = wrapped;
}

app.registerExtension({
    name: "QQ.ScaledNodeZOrder",
    setup() {
        guardBringToFront(app.graph, "bringToFront");
        guardBringToFront(app.canvas, "bringToFront");
        const canvasProto = Object.getPrototypeOf(app.canvas);
        guardBringToFront(canvasProto, "bringToFront");
        const nodeProto = globalThis.LiteGraph?.LGraphNode?.prototype
            || Object.getPrototypeOf(app.graph?._nodes?.[0] || {});
        guardBringToFront(nodeProto, "bringToFront");
        restack(app.graph);
    },
    afterConfigureGraph() {
        guardBringToFront(app.graph, "bringToFront");
        restack(app.graph);
    },
    loadedGraphNode(node) {
        // 加载期间逐个节点回调结束后再统一排序一次，避免被后续追加打乱
        clearTimeout(globalThis.__qqScaledRestackTimer);
        globalThis.__qqScaledRestackTimer = setTimeout(() => restack(app.graph), 0);
        return node;
    },
});
