import { app } from "../../scripts/app.js";

// QQ-缩放节点沉底：画布层级 = graph._nodes 数组顺序（越后越上层），
// 选中/拖拽会触发 bringToFront 把节点甩到数组末尾，导致缩放过的节点
// 像牛皮癣一样浮在未缩放节点上面。这里约定：
//   1) 工作流加载后，稳定排序：缩放节点(scale != 1)整体沉到未缩放节点之下，
//      缩放节点之间按 scale 升序（缩得越小越靠底）；
//   2) 拦截 bringToFront：缩放节点被点选/拖拽时不再跳回最上层。
// 未缩放节点的交互行为完全不变。开关在 设置 → QQ 分类下。

const SETTING_ID = "QQ.ScaledNodeZOrder.Enabled";
let enabled = true;

function scaleOf(node) {
    const scale = Number(node?.scale);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function isScaled(node) {
    return Math.abs(scaleOf(node) - 1) > 0.001;
}

function restack(graph) {
    if (!enabled) return;
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
        if (enabled && isScaled(node)) {
            this.setDirty?.(true, true);
            return undefined;
        }
        return original.call(this, node, ...rest);
    };
    wrapped.__qqScaledGuard = true;
    target[name] = wrapped;
}

function installGuards() {
    guardBringToFront(app.graph, "bringToFront");
    guardBringToFront(app.canvas, "bringToFront");
    const canvasProto = Object.getPrototypeOf(app.canvas);
    guardBringToFront(canvasProto, "bringToFront");
    const nodeProto = globalThis.LiteGraph?.LGraphNode?.prototype
        || Object.getPrototypeOf(app.graph?._nodes?.[0] || {});
    guardBringToFront(nodeProto, "bringToFront");
}

app.registerExtension({
    name: "QQ.ScaledNodeZOrder",
    settings: [
        {
            id: SETTING_ID,
            category: ["QQ", "画布", "缩放节点沉底"],
            name: "缩放节点默认置于未缩放节点下一层",
            tooltip: "开启后：加载工作流时缩放(scale≠1)节点稳定沉到未缩放节点之下（越小越靠底），且点选/拖拽不再跳回顶层；关闭恢复 ComfyUI 默认层级行为。",
            type: "boolean",
            defaultValue: true,
            onChange(value) {
                enabled = Boolean(value);
                if (enabled) restack(app.graph);
            },
        },
    ],
    setup() {
        try {
            enabled = Boolean(app.ui.settings.getSettingValue?.(SETTING_ID, true) ?? true);
        } catch {
            enabled = true;
        }
        installGuards();
        restack(app.graph);
    },
    afterConfigureGraph() {
        installGuards();
        restack(app.graph);
    },
    loadedGraphNode(node) {
        clearTimeout(globalThis.__qqScaledRestackTimer);
        globalThis.__qqScaledRestackTimer = setTimeout(() => restack(app.graph), 0);
        return node;
    },
});
