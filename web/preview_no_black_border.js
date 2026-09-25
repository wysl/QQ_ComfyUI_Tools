import { app } from "../../../scripts/app.js";

const NODE_TYPE = "QQPreviewNoBlackBorder";
const MIN_NODE_WIDTH = 240;
const MIN_NODE_HEIGHT = 90;
const PATCH_RETRIES = 24;

function previewImage(node) {
    return node?.imgs?.find((image) => image?.complete && image.naturalWidth > 0) || null;
}

function widgetsBottom(node) {
    let bottom = 30;
    for (const widget of node?.widgets || []) {
        const y = Number.isFinite(widget.last_y) ? widget.last_y : bottom;
        const height = Number.isFinite(widget.height) ? widget.height : 24;
        bottom = Math.max(bottom, y + height);
    }
    return bottom + 4;
}

function fitNodeToImage(node, image) {
    if (!image?.naturalWidth || !image.naturalHeight || typeof node.setSize !== "function") return;
    const top = widgetsBottom(node);
    const width = Math.max(MIN_NODE_WIDTH, Number(node.size?.[0]) || MIN_NODE_WIDTH);
    const height = top + Math.max(48, width * image.naturalHeight / image.naturalWidth) + 8;
    const nextHeight = Math.round(height);
    if (Math.abs((node.size?.[1] || 0) - nextHeight) > 2) {
        node.setSize([width, nextHeight]);
    }
}

function drawImagePreview(node, ctx) {
    const image = previewImage(node);
    if (!image) return false;
    fitNodeToImage(node, image);

    const top = widgetsBottom(node);
    const width = Math.max(1, node.size[0] - 8);
    const height = Math.max(1, node.size[1] - top - 8);
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    const x = (node.size[0] - drawWidth) * 0.5;
    const y = top + (height - drawHeight) * 0.5;

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, x, y, drawWidth, drawHeight);
    ctx.restore();
    return true;
}

function patchNodeMethods(nodeType) {
    const prototype = nodeType?.prototype;
    if (!prototype || prototype.__qqPreviewNoBlackBorderPatched) return;
    prototype.__qqPreviewNoBlackBorderPatched = true;

    const originalCreated = prototype.onNodeCreated;
    prototype.onNodeCreated = function qqPreviewCreated() {
        const result = originalCreated?.apply(this, arguments);
        this.resizable = true;
        schedulePreviewPatch(this);
        return result;
    };

    const originalConfigured = prototype.onConfigure;
    prototype.onConfigure = function qqPreviewConfigured() {
        const result = originalConfigured?.apply(this, arguments);
        this.resizable = true;
        schedulePreviewPatch(this);
        return result;
    };

    const originalExecuted = prototype.onExecuted;
    prototype.onExecuted = function qqPreviewExecuted(output) {
        const result = originalExecuted?.apply(this, arguments);
        schedulePreviewPatch(this);
        return result;
    };

    const originalDraw = prototype.onDrawForeground;
    prototype.onDrawForeground = function qqPreviewDraw(ctx) {
        if (!drawImagePreview(this, ctx)) return originalDraw?.apply(this, arguments);
    };
}

function patchPreview(node) {
    const image = previewImage(node);
    if (!image) return false;
    fitNodeToImage(node, image);
    return true;
}

function schedulePreviewPatch(node) {
    if (!node || node.__qqPreviewNoBlackBorderScheduled) return;
    node.__qqPreviewNoBlackBorderScheduled = true;
    let retries = PATCH_RETRIES;
    const attempt = () => {
        node.__qqPreviewNoBlackBorderScheduled = false;
        if (patchPreview(node) || retries <= 0) return;
        retries -= 1;
        node.__qqPreviewNoBlackBorderScheduled = true;
        requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
}

app.registerExtension({
    name: "QQ.PreviewNoBlackBorder",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name === NODE_TYPE) patchNodeMethods(nodeType);
    },
    onNodeOutputsUpdated() {
        for (const node of app.graph?._nodes || []) {
            if (node?.type === NODE_TYPE || node?.comfyClass === NODE_TYPE) schedulePreviewPatch(node);
        }
    },
});

