import { app } from "../../scripts/app.js";

// QQ-多值输入 专用连线样式：
//   - 颜色固定草绿色
//   - 平时 5% 透明度（几乎隐形，长线不脏画面）
//   - 鼠标选中或悬停连线任一端节点时 90% 透明度 + 流动高亮
// 只改 link.color / link.flow 这两个渲染属性，不改连线拓扑、不进 prompt。

const NODE_TYPE = "QQ-多值输入";
const LEGACY_NODE_TYPE = "QQMultiPrimitive";
const TAG = "[QQ-多值输入连线]";
const GRASS_IDLE = "rgba(124, 199, 55, 0)";
const GLOW_RGB = "124, 199, 55";
// 构建戳：控制台日志里用它确认浏览器加载的是哪一版
const BUILD = "2026-09-28.socket-ripple-3";
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

// 输出口接点圆点的外缘半径（LiteGraph 槽点约 4~5px），涟漪从它向外扩散 1px
const SOCKET_RADIUS = 4.5;

// 呼吸涟漪：半径 = 接点半径 + 0~1px，透明度反向呼吸；第二圈更淡做光晕感
function glowStyle(time, slot) {
    const wave = (Math.sin(time / 600 + slot * 1.7) + 1) / 2;
    return {
        radius: SOCKET_RADIUS + wave,
        alpha: 0.65 - wave * 0.45,
        lineWidth: 1,
        haloRadius: SOCKET_RADIUS + wave + 1.5,
        haloAlpha: (0.65 - wave * 0.45) * 0.4,
    };
}

function slotLocalPos(node, slot) {
    let absolute = null;
    try {
        absolute = node.getConnectionPos?.(false, slot);
    } catch { /* 忽略 */ }
    if (!absolute) return null;
    const x = Array.isArray(absolute) ? absolute[0] : absolute.x;
    const y = Array.isArray(absolute) ? absolute[1] : absolute.y;
    if (typeof x !== "number" || typeof y !== "number") return null;
    const origin = node.pos || [0, 0];
    return { x: x - origin[0], y: y - origin[1] };
}

function drawOutputGlows(node, ctx, time) {
    for (let slot = 0; slot < (node.outputs?.length || 0); slot += 1) {
        if (!node.outputs[slot]?.links?.length) continue;
        const pos = slotLocalPos(node, slot);
        if (!pos) continue;
        const glow = glowStyle(time, slot);
        ctx.save();
        ctx.lineWidth = glow.lineWidth;
        // 外圈淡光晕
        ctx.strokeStyle = `rgba(${GLOW_RGB}, ${glow.haloAlpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, glow.haloRadius, 0, Math.PI * 2);
        ctx.stroke();
        // 贴着接点圆点外缘的主涟漪
        ctx.strokeStyle = `rgba(${GLOW_RGB}, ${glow.alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, glow.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

// 光晕画在节点前景层：只有「有连线的输出口」才画。
// 挂在实例上而不是原型上——多值输入是虚拟节点，原型会被它自己的安装流程替换。
function installGlow(node) {
    if (!node || node.__qqGlowInstalled) return;
    node.__qqGlowInstalled = true;
    const original = typeof node.onDrawForeground === "function" ? node.onDrawForeground.bind(node) : null;
    node.onDrawForeground = function onDrawForegroundQQGlow(ctx, ...rest) {
        const result = original?.(ctx, ...rest);
        try {
            if (ctx && !this.flags?.collapsed) {
                drawOutputGlows(this, ctx, performance.now());
                // 请求下一帧重绘，呼吸动画才能连续
                this.setDirtyCanvas?.(true, false);
            }
        } catch { /* 绘制失败不影响节点 */ }
        return result;
    };
}

function applyLinkStyles(graph, selectedIds, hoverId) {
    if (!graph) return null;
    let touched = 0;
    for (const link of graphLinks(graph)) {
        if (!isMultiSource(graph, link)) continue;
        const active = isActiveLink(graph, link, selectedIds, hoverId);
        const style = styleFor(active);
        if (link.color !== style.color || Boolean(link.flow) !== style.flow
            || link.__qqStyle?.color !== style.color) {
            // 新渲染器读 link.color；旧绘制路径不读，靠 renderLink 钩子注入 __qqStyle
            link.color = style.color;
            link.flow = style.flow;
            link.__qqStyle = style;
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

// 新渲染器（CanvasPathRenderer）的描边/箭头/中心标记在 context 里，按链接临时抹掉
function patchCanvasLinkRenderer(canvas) {
    const renderer = canvas?.linkRenderer;
    if (!renderer || renderer.__qqPatched || typeof renderer.drawLink !== "function") return false;
    const originalDraw = renderer.drawLink.bind(renderer);
    renderer.drawLink = function drawLink(ctx, link, context) {
        const style = link?.__qqStyle;
        if (style && !style.flow && context?.style) {
            context = {
                ...context,
                style: { ...context.style, borderWidth: 0, showArrows: false, showCenterMarker: false },
            };
        }
        return originalDraw(ctx, link, context);
    };
    renderer.__qqPatched = true;
    return true;
}

// 旧绘制路径给 renderLink 传的 color 是 null，内部回退成默认色，link.color 被无视。
// 在这里按参数位注入我们自己的颜色/流动，两种渲染器就都生效了。
function patchLinkRenderer() {
    const canvasClass = globalThis.LGraphCanvas;
    const proto = canvasClass?.prototype;
    if (!proto || typeof proto.renderLink !== "function" || proto.__qqRenderLinkPatched) return false;
    const original = proto.renderLink;
    proto.renderLink = function renderLink(ctx, start, end, link, skipBorder, flow, color, ...rest) {
        const style = link?.__qqStyle;
        if (style) {
            color = style.color;
            flow = flow || style.flow;
            // 隐形态连黑色描边一起跳过，否则 alpha=0 的主线外面还会剩一圈淡边
            if (!style.flow) skipBorder = true;
        }
        return original.call(this, ctx, start, end, link, skipBorder, flow, color, ...rest);
    };
    proto.__qqRenderLinkPatched = true;
    return true;
}

function start() {
    if (globalThis.__qqMultiLinkTimer) return;
    globalThis.__qqMultiLinkTimer = setInterval(() => {
        if (!app || app.loading_graph || app.configuringGraph) return;
        const graph = app.canvas?.graph || app.graph;
        if (!graph) return;
        patchCanvasLinkRenderer(app.canvas);
        const { selected, hover } = currentState();
        applyLinkStyles(graph, selected, hover);
    }, 160);
}

app.registerExtension({
    name: "QQ.MultiPrimitiveLinks",
    nodeCreated(node) {
        if (node?.type !== NODE_TYPE && node?.type !== LEGACY_NODE_TYPE) return;
        installGlow(node);
    },
    setup() {
        const patched = patchLinkRenderer();
        start();
        console.info(TAG, "已加载：多值输入连线平时隐形，输出口带草绿呼吸光晕，选中/悬停端点时连线高亮 | renderLink 钩子:", patched ? "已安装" : "不需要/不可用", "| build:", BUILD, "| idle:", GRASS_IDLE);
    },
});
