import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { createCardSurface, injectCardCSS, CARD_MEDIA_HEIGHT } from "./card_render.js";

// 卡面模式：框选一段能出结果的流水线 → 选区工具栏「卡面模式」→ 收进子图，
// 子图表面渲染卡面：生成中实时进度，完成后只显示结果媒体（无文件名等信息）。
// 双击子图可展开编辑内部节点。复用 card_render 的图像/视频/音频频谱渲染。

const COMMAND_ID = "QQ.CardMode";

// 卡面宿主节点隐藏 ComfyUI 原生输出预览（.image-preview，带文件名/尺寸），
// 只留自己的卡面（.qq-card-stage，独立的 node-widget）。
// 按节点 id 注入 CSS 规则：data-node-id 由 Vue 稳定维护，手动加 class 会被重渲染冲掉。
function hideNativePreview(node) {
    const styleId = `qq-card-hide-${node.id}`;
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent =
        `.lg-node[data-node-id="${node.id}"] .image-preview{display:none!important}` +
        `.lg-node[data-node-id="${node.id}"] [data-testid="node-widget"]:not(:has(.qq-card)){display:none!important}` +
        `.lg-node[data-node-id="${node.id}"] .grid-cols-subgrid.justify-between:not(:has(.qq-card)){display:none!important}`;
    document.head.append(style);
}

function unhideNativePreview(node) {
    document.getElementById(`qq-card-hide-${node.id}`)?.remove();
}

// 卡面只显示结果：隐藏子图提升出来的输入控件（如 image 文件选择器会显示文件名）。
// 代理控件可能在附着后才生成，故多次补隐藏。
function hideInputWidgets(node) {
    const hide = () => {
        let changed = false;
        for (const widget of node.widgets || []) {
            if (widget.name === "qq_card_mode" || widget.type === "qq_card_mode") continue;
            if (widget.hidden) continue;
            widget.hidden = true;
            widget.options ||= {};
            widget.options.hidden = true;
            widget.computeSize = () => [0, -4];
            changed = true;
        }
        if (changed) node.setDirtyCanvas?.(true, true);
    };
    hide();
    queueMicrotask(hide);
    setTimeout(hide, 300);
    setTimeout(hide, 1200);
}

// 子图内部输出节点的 executed 事件 id 为「宿主:内部」嵌套格式；宿主自身也匹配。
function cardEventMatches(eventNodeId, hostId) {
    const nid = String(eventNodeId ?? "");
    const host = String(hostId);
    return nid === host || nid.startsWith(`${host}:`);
}

function selectedNodes() {
    const canvas = app.canvas;
    const items = canvas?.selectedItems;
    let nodes = [];
    if (items instanceof Set) nodes = [...items];
    else if (items && typeof items === "object") nodes = Object.values(items);
    else if (canvas?.selected_nodes) nodes = Object.values(canvas.selected_nodes);
    return nodes.filter((n) => n && n.id != null && !n.subgraph);
}

// 卡面模式只显示自己的卡面结果：移除子图原生预览暴露（带文件名/尺寸的那块）。
// 卡面独立监听 executed 事件，不依赖预览暴露，故移除后结果仍正常呈现。
function clearNativePreview(node) {
    try {
        const el = document.querySelector("#vue-app") || document.querySelector("[data-v-app]");
        const pe = el?.__vue_app__?.config?.globalProperties?.$pinia?._s?.get("previewExposure");
        if (!pe?.clearHost) return;
        const run = () => { try { pe.clearHost(node.id); } catch { /* 忽略 */ } };
        run();
        queueMicrotask(run);
        setTimeout(run, 300);
    } catch { /* 忽略 */ }
}

function attachCard(node) {
    if (!node || node.__qqCardModeSetup) return;
    node.__qqCardModeSetup = true;
    node.properties ||= {};
    node.properties.qqCardMode = true;
    const surface = createCardSurface(node, { emptyText: "卡面模式\n运行流水线后在此呈现结果" });
    clearNativePreview(node);
    hideNativePreview(node);
    hideInputWidgets(node);

    const originalExecuted = node.onExecuted;
    node.onExecuted = function (output) {
        const result = originalExecuted?.apply(this, arguments);
        surface.exitRunning();
        surface.renderResult(output || {});
        node.setDirtyCanvas?.(true, true);
        return result;
    };
    const onExecuted = (event) => {
        if (cardEventMatches(event?.detail?.node, node.id)) {
            surface.exitRunning();
            surface.renderResult(event.detail?.output || {});
        }
    };
    const onStart = () => surface.enterRunning();
    const onEnd = () => {
        surface.exitRunning();
        const saved = node.properties.qq_card_ui;
        if (saved && (saved.images?.length || saved.videos?.length || saved.audio?.length)) surface.renderResult(saved);
    };
    api.addEventListener("executed", onExecuted);
    api.addEventListener("execution_start", onStart);
    api.addEventListener("execution_success", onEnd);
    api.addEventListener("execution_error", onEnd);
    api.addEventListener("execution_interrupted", onEnd);

    const originalRemoved = node.onRemoved;
    node.onRemoved = function () {
        surface.destroy();
        unhideNativePreview(node);
        api.removeEventListener?.("executed", onExecuted);
        api.removeEventListener?.("execution_start", onStart);
        api.removeEventListener?.("execution_success", onEnd);
        api.removeEventListener?.("execution_error", onEnd);
        api.removeEventListener?.("execution_interrupted", onEnd);
        return originalRemoved?.apply(this, arguments);
    };

    node.addDOMWidget("qq_card_mode", "qq_card_mode", surface.root, {
        serialize: false, hideOnZoom: false, margin: 4, getMinHeight: () => CARD_MEDIA_HEIGHT + 40,
    });
    node.resizable = true;
    node.__qqCardSurface = surface;
}

function convertSelectionToCard() {
    const nodes = selectedNodes();
    if (!nodes.length) {
        console.warn("[QQ-卡面模式] 请先框选一段流水线节点");
        return;
    }
    const graph = app.graph;
    if (typeof graph?.convertToSubgraph !== "function") {
        console.warn("[QQ-卡面模式] 当前前端不支持子图转换");
        return;
    }
    let subgraphNode;
    try {
        const result = graph.convertToSubgraph(new Set(nodes));
        subgraphNode = result?.node;
    } catch (error) {
        console.warn("[QQ-卡面模式] 转子图失败", error);
        return;
    }
    if (!subgraphNode) return;
    subgraphNode.properties ||= {};
    subgraphNode.properties.qqCardMode = true;
    attachCard(subgraphNode);
    try { app.canvas?.select?.(subgraphNode); } catch { /* 忽略 */ }
    app.canvas?.setDirty?.(true, true);
}

app.registerExtension({
    name: "QQ.CardMode",
    setup() { injectCardCSS(); },
    commands: [
        {
            id: COMMAND_ID,
            label: "卡面模式",
            icon: "icon-[lucide--layout-panel-top]",
            function: convertSelectionToCard,
        },
    ],
    getSelectionToolboxCommands() {
        return selectedNodes().length ? [COMMAND_ID] : [];
    },
    // 读档恢复：子图节点带 qqCardMode 标记时重新附着卡面
    nodeCreated(node) {
        if (node?.properties?.qqCardMode) attachCard(node);
        else queueMicrotask(() => { if (node?.properties?.qqCardMode) attachCard(node); });
    },
});
