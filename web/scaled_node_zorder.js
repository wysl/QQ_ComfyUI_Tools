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

// ---- Nodes 2.0（Vue）：层级由布局 store 的 z-index 决定，Vue 每次渲染都会写回，
// 直接改 inline style.zIndex 会被覆盖。改用「data 属性 + CSS 变量 + !important」：
// Vue 不管理 data-qq-scaled / --qq-z，故能稳定压住缩放节点到未缩放之下。
const VUE_CSS_ID = "qq-scaled-zorder-css";
function installVueCSS() {
    if (document.getElementById(VUE_CSS_ID)) return;
    const style = document.createElement("style");
    style.id = VUE_CSS_ID;
    style.textContent = ".lg-node[data-qq-scaled]{z-index:var(--qq-z,0)!important}";
    document.head.append(style);
}

function applyVueZOrder() {
    if (!enabled) return;
    const graph = app.graph;
    if (!graph || typeof document.querySelectorAll !== "function") return;
    const els = [...document.querySelectorAll(".lg-node")];
    if (!els.length) return;
    const items = els
        .map((el) => ({ el, node: graph.getNodeById(Number(el.dataset.nodeId)) }))
        .filter((x) => x.node);
    const scaled = items.filter((x) => isScaled(x.node));
    // 未缩放节点清除标记，恢复 Vue 默认层级
    for (const x of items) {
        if (!isScaled(x.node) && x.el.hasAttribute("data-qq-scaled")) {
            x.el.removeAttribute("data-qq-scaled");
            x.el.style.removeProperty("--qq-z");
        }
    }
    if (!scaled.length) return;
    const unscaledZ = items.filter((x) => !isScaled(x.node))
        .map((x) => Number(getComputedStyle(x.el).zIndex) || 0);
    const minUnscaled = unscaledZ.length ? Math.min(...unscaledZ) : 1000;
    scaled.sort((a, b) => scaleOf(a.node) - scaleOf(b.node));
    const base = Math.max(0, minUnscaled - scaled.length - 1);
    scaled.forEach((x, i) => {
        x.el.setAttribute("data-qq-scaled", "1");
        x.el.style.setProperty("--qq-z", String(base + i));
    });
}

let vueObserver = null;
let vueRaf = 0;
function scheduleVue() {
    if (vueRaf || typeof requestAnimationFrame !== "function") return;
    vueRaf = requestAnimationFrame(() => { vueRaf = 0; applyVueZOrder(); });
}
function installVueObserver() {
    if (vueObserver || typeof MutationObserver !== "function") return;
    vueObserver = new MutationObserver(scheduleVue);
    vueObserver.observe(document.body, {
        subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class"],
    });
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
                if (enabled) {
                    restack(app.graph);
                    installVueCSS();
                    installVueObserver();
                    scheduleVue();
                }
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
        installVueCSS();
        installVueObserver();
        restack(app.graph);
        scheduleVue();
    },
    afterConfigureGraph() {
        installGuards();
        installVueCSS();
        installVueObserver();
        restack(app.graph);
        scheduleVue();
    },
    loadedGraphNode(node) {
        clearTimeout(globalThis.__qqScaledRestackTimer);
        globalThis.__qqScaledRestackTimer = setTimeout(() => {
            restack(app.graph);
            scheduleVue();
        }, 0);
        return node;
    },
});
