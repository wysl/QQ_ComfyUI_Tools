import { app } from "../../scripts/app.js";

const NODE_TYPE = "QQMediaIndexOutput";
const MEDIA_BUNDLE_TYPE = "MINIMAX_H3_MEDIA_BUNDLE";
const MAX_OUTPUTS = 64;
const MIN_OUTPUTS = 1;
const MIN_NODE_WIDTH = 260;
const MIN_NODE_HEIGHT = 90;
const SCALE_MODE_WIDGET = "缩放模式";
const SCALE_WIDGETS = [
    "宽高比",
    "适配方式",
    "缩放算法",
    "对齐倍数",
    "缩放基准",
    "缩放长度",
    "背景颜色",
];
const HIDDEN_SCALE_WIDGETS = ["自定义宽度", "自定义高度"];
const GROUPS = [
    { key: "images", type: "IMAGE", label: "图片" },
    { key: "audios", type: "AUDIO", label: "音频" },
    { key: "videos", type: "VIDEO", label: "视频" },
];

// LiteGraph can call onResize for both layout changes and pointer drags. Only
// the latter should freeze the automatic compact layout.
let pointerHeld = false;
if (typeof document !== "undefined") {
    document.addEventListener("pointerdown", () => { pointerHeld = true; }, true);
    document.addEventListener("pointerup", () => { pointerHeld = false; }, true);
    document.addEventListener("pointercancel", () => { pointerHeld = false; }, true);
}

function graphLink(graph, linkId) {
    if (linkId == null || !graph) return null;
    if (typeof graph.getLink === "function") return graph.getLink(linkId);
    if (graph.links) return graph.links[linkId] ?? null;
    if (graph._links instanceof Map) return graph._links.get(linkId) ?? null;
    return graph._links?.[linkId] ?? null;
}

function connectedInput(node) {
    return node?.inputs?.find((input) => input?.name === "media") || node?.inputs?.[0];
}

function sourceConnection(node) {
    const input = connectedInput(node);
    const link = graphLink(node?.graph, input?.link);
    if (!link) return null;
    const sourceNode = node.graph?.getNodeById?.(link.origin_id);
    const sourceSlot = sourceNode?.outputs?.[link.origin_slot];
    if (!sourceNode || !sourceSlot) return null;
    return { input, link, sourceNode, sourceSlot };
}

function sourceState(sourceNode) {
    const stateWidget = sourceNode?.widgets?.find((widget) => widget?.name === "media_state");
    const raw = stateWidget?.value ?? sourceNode?.properties?.wysl_media_loader_state ?? sourceNode?.properties?.media_loader_state;
    try {
        const parsed = typeof raw === "string" ? JSON.parse(raw || "{}") : raw;
        return {
            images: Array.isArray(parsed?.images) ? parsed.images : [],
            audios: Array.isArray(parsed?.audios) ? parsed.audios : [],
            videos: Array.isArray(parsed?.videos) ? parsed.videos : [],
        };
    } catch {
        return { images: [], audios: [], videos: [] };
    }
}

function outputType(sourceSlot) {
    return String(sourceSlot?.type || "*").toUpperCase();
}

function isBundleConnection(connection) {
    const type = outputType(connection?.sourceSlot);
    const name = String(
        connection?.sourceSlot?.name
        || connection?.sourceSlot?.localized_name
        || connection?.sourceSlot?.label
        || "",
    ).toLowerCase();
    return type === MEDIA_BUNDLE_TYPE || name === "media_bundle" || name === "media bundle";
}

function sourceIsKnownLoader(connection) {
    const type = String(connection?.sourceNode?.type || "");
    return type === "QQMediaLoader" || type === "MiniMaxH3EasyMediaLoader";
}

function descriptorsForConnection(connection) {
    if (!connection) return [{ type: "*", name: "媒体 1" }];
    const state = sourceState(connection.sourceNode);
    if (sourceIsKnownLoader(connection)) {
        if (isBundleConnection(connection)) {
            const descriptors = [];
            for (const group of GROUPS) {
                const count = Math.min(MAX_OUTPUTS - descriptors.length, state[group.key].length);
                for (let index = 0; index < count; index += 1) {
                    descriptors.push({ type: group.type, name: `${group.label} ${index + 1}` });
                }
            }
            if (descriptors.length) return descriptors;
        } else if (outputType(connection.sourceSlot) === "IMAGE") {
            const count = Math.min(MAX_OUTPUTS, state.images.length);
            if (count > 0) return Array.from({ length: count }, (_, index) => ({
                type: "IMAGE",
                name: `图片 ${index + 1}`,
            }));
        }
    }

    const type = outputType(connection.sourceSlot);
    const label = type === "IMAGE" ? "图片" : type === "AUDIO" ? "音频" : type === "VIDEO" ? "视频" : "媒体";
    return [{ type: type || "*", name: `${label} 1` }];
}

function hasLinks(output) {
    return Boolean(output?.links?.length);
}

function connectedOutputCount(node) {
    let count = 0;
    for (let index = 0; index < (node.outputs?.length || 0); index += 1) {
        if (hasLinks(node.outputs[index])) count = index + 1;
    }
    return count;
}

function setOutputDescriptor(output, descriptor, index) {
    if (!output) return;
    const type = descriptor?.type || "*";
    const name = descriptor?.name || `媒体 ${index + 1}`;
    output.type = type;
    output.name = name;
    output.label = name;
    output.localized_name = name;
}

function resizeNodeToContent(node) {
    if (!node || node.__wyslMediaIndexUserResized) return;
    const outputHeight = 34 + Math.max(1, node.outputs?.length || 0) * 20;
    const mode = node.widgets?.find((widget) => widget?.name === SCALE_MODE_WIDGET);
    const scaleHeight = mode?.value === "按宽高比缩放" ? SCALE_WIDGETS.length * 20 : 0;
    const width = Math.max(MIN_NODE_WIDTH, Number(node.size?.[0]) || MIN_NODE_WIDTH);
    node.__wyslMediaIndexSizing = true;
    try {
        node.setSize?.([width, Math.max(MIN_NODE_HEIGHT, outputHeight + scaleHeight)]);
    } finally {
        node.__wyslMediaIndexSizing = false;
    }
}

function setScaleWidgetHidden(widget, hidden) {
    if (!widget) return;
    if (!Object.prototype.hasOwnProperty.call(widget, "__wyslMediaIndexOriginalType")) {
        widget.__wyslMediaIndexOriginalType = widget.type;
        widget.__wyslMediaIndexOriginalComputeSize = widget.computeSize;
    }
    widget.hidden = hidden;
    widget.type = hidden ? "hidden" : widget.__wyslMediaIndexOriginalType;
    widget.options ||= {};
    widget.options.hidden = hidden;
    if (hidden) widget.computeSize = () => [0, -4];
    else if (widget.__wyslMediaIndexOriginalComputeSize) widget.computeSize = widget.__wyslMediaIndexOriginalComputeSize;
    else delete widget.computeSize;
}

function syncScaleWidgetVisibility(node) {
    const mode = node?.widgets?.find((widget) => widget?.name === SCALE_MODE_WIDGET);
    const enabled = mode?.value === "按宽高比缩放";
    for (const name of HIDDEN_SCALE_WIDGETS) {
        setScaleWidgetHidden(node?.widgets?.find((widget) => widget?.name === name), true);
    }
    for (const name of SCALE_WIDGETS) {
        setScaleWidgetHidden(node?.widgets?.find((widget) => widget?.name === name), !enabled);
    }
    resizeNodeToContent(node);
}

function installScaleControls(node) {
    if (!node || node.__wyslMediaIndexScaleInstalled) return;
    node.__wyslMediaIndexScaleInstalled = true;
    const mode = node.widgets?.find((widget) => widget?.name === SCALE_MODE_WIDGET);
    if (mode) {
        const originalCallback = mode.callback;
        mode.callback = function onMediaIndexScaleModeChanged() {
            const result = originalCallback?.apply(this, arguments);
            syncScaleWidgetVisibility(node);
            node.setDirtyCanvas?.(true, true);
            return result;
        };
    }
    syncScaleWidgetVisibility(node);
}

function syncOutputs(node, force = false) {
    if (!node || !node.graph) return;
    const connection = sourceConnection(node);
    const descriptors = descriptorsForConnection(connection);
    const desired = Math.min(MAX_OUTPUTS, Math.max(MIN_OUTPUTS, descriptors.length, connectedOutputCount(node)));
    const signature = JSON.stringify({
        source: connection?.link?.id ?? connection?.link?.origin_id ?? null,
        count: desired,
        descriptors,
        links: node.outputs?.map((output) => output?.links?.length || 0),
    });
    if (!force && signature === node.__wyslMediaIndexSignature) return;
    node.__wyslMediaIndexSignature = signature;

    while ((node.outputs?.length || 0) < desired) {
        const index = node.outputs.length;
        node.addOutput(`媒体 ${index + 1}`, "*");
    }
    while ((node.outputs?.length || 0) > desired) {
        const last = node.outputs.length - 1;
        if (hasLinks(node.outputs[last])) break;
        node.removeOutput(last);
    }
    for (let index = 0; index < node.outputs.length; index += 1) {
        setOutputDescriptor(node.outputs[index], descriptors[index] || { type: "*", name: `媒体 ${index + 1}` }, index);
    }
    resizeNodeToContent(node);
    node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
}

function initializeNode(node) {
    if (!node || node.__wyslMediaIndexInitialized) return;
    node.__wyslMediaIndexInitialized = true;
    node.title = "QQ-媒体序号输出";
    node.resizable = true;
    node.__wyslMediaIndexUserResized = Boolean(node.properties?.wysl_media_index_user_resized);
    installScaleControls(node);
    while ((node.outputs?.length || 0) > MIN_OUTPUTS) node.removeOutput(node.outputs.length - 1);
    if (!(node.outputs?.length || 0)) node.addOutput("媒体 1", "*");
    resizeNodeToContent(node);
    syncOutputs(node, true);
    node.__wyslMediaIndexTimer = globalThis.setInterval(() => syncOutputs(node), 500);
}

function stopTimer(node) {
    if (node?.__wyslMediaIndexTimer) {
        globalThis.clearInterval(node.__wyslMediaIndexTimer);
        node.__wyslMediaIndexTimer = null;
    }
}

app.registerExtension({
    name: "QQ.MediaIndexOutput",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_TYPE) return;
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function onNodeCreatedQQMediaIndexOutput() {
            const result = originalCreated?.apply(this, arguments);
            initializeNode(this);
            return result;
        };
        const originalAdded = nodeType.prototype.onAdded;
        nodeType.prototype.onAdded = function onAddedQQMediaIndexOutput() {
            const result = originalAdded?.apply(this, arguments);
            initializeNode(this);
            syncScaleWidgetVisibility(this);
            syncOutputs(this, true);
            return result;
        };
        const originalConfigured = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function onConfigureQQMediaIndexOutput(info) {
            const result = originalConfigured?.apply(this, arguments);
            // Restore the persisted manual-resize choice after LiteGraph has
            // loaded node properties, then compact legacy oversized nodes.
            this.__wyslMediaIndexUserResized = Boolean(this.properties?.wysl_media_index_user_resized);
            initializeNode(this);
            syncScaleWidgetVisibility(this);
            syncOutputs(this, true);
            globalThis.setTimeout(() => {
                if (!this.__wyslMediaIndexUserResized) {
                    resizeNodeToContent(this);
                    this.setDirtyCanvas?.(true, true);
                }
            }, 0);
            return result;
        };
        const originalConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function onConnectionsChangeQQMediaIndexOutput(type) {
            const result = originalConnectionsChange?.apply(this, arguments);
            if (type === (globalThis.LiteGraph?.INPUT ?? 1) || type === (globalThis.LiteGraph?.OUTPUT ?? 2)) {
                queueMicrotask(() => syncOutputs(this, true));
            }
            return result;
        };
        const originalRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function onRemovedQQMediaIndexOutput() {
            stopTimer(this);
            return originalRemoved?.apply(this, arguments);
        };
        const originalResized = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function onResizeQQMediaIndexOutput() {
            const result = originalResized?.apply(this, arguments);
            if (pointerHeld && !this.__wyslMediaIndexSizing) {
                this.__wyslMediaIndexUserResized = true;
                this.properties ||= {};
                this.properties.wysl_media_index_user_resized = true;
            }
            return result;
        };
    },
});
