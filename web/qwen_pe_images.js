import { app } from "../../scripts/app.js";

// QQ-Qwen Image 2.1 AI提示词增强(PE or API) 的前端：只负责「显示几个参考图输入口」。
// 后端声明了 图片1 … 图片9 共 MAX_IMAGES 个可选输入，这里默认只留 MIN_IMAGES 个；
// 每接满一个就补下一个，尾部空闲的再收回去。接口序号就是 <imageN> 序号。

const NODE_TYPE = "QQQwenImage21PromptEnhancer";
const MIN_IMAGES = 1;
const MAX_IMAGES = 9;
const IMAGE_PREFIX = "图片";

// 后端是 INPUT_IS_LIST 节点，输入口必须保持列表语义，
// 否则接 QQ-多媒体加载 的 multi output 会被 ComfyUI 拆成「每张图执行一次」。
let imageInputIsList = true;

function imageName(slot) {
    return `${IMAGE_PREFIX}${slot + 1}`;
}

function isImageInput(input, index) {
    return Boolean(input) && String(input.name || "") === imageName(index);
}

function readDeclaredIsList(nodeData) {
    for (const group of [nodeData?.input?.optional, nodeData?.input?.required]) {
        const entry = group?.[imageName(0)];
        if (Array.isArray(entry) && entry[1] && typeof entry[1] === "object") {
            return Boolean(entry[1].isList);
        }
    }
    return true;
}

function hasLink(input) {
    if (!input) return false;
    if (input.link != null) return true;
    return Array.isArray(input.links) && input.links.some((linkId) => linkId != null);
}

// 目标数量 = 最后一个已连接输入的下一个，且不少于 MIN_IMAGES、不超过 MAX_IMAGES
function targetCount(node) {
    let lastConnected = 0;
    (node.inputs || []).forEach((input, index) => {
        if (hasLink(input)) lastConnected = index + 1;
    });
    return Math.min(MAX_IMAGES, Math.max(MIN_IMAGES, lastConnected + 1));
}

function markImageInput(input, slot) {
    if (!input) return;
    if (imageInputIsList) input.isList = true;
    input.label = imageName(slot);
}

function addImageInput(node) {
    const slot = node.inputs?.length || 0;
    if (slot >= MAX_IMAGES) return null;
    node.addInput(imageName(slot), "IMAGE");
    const input = node.inputs?.[slot];
    markImageInput(input, slot);
    return input ?? null;
}

function ensureImages(node, requestedCount) {
    const count = Math.min(MAX_IMAGES, Math.max(MIN_IMAGES, requestedCount));
    while ((node.inputs?.length || 0) < count) {
        if (!addImageInput(node)) break;
    }
    (node.inputs || []).forEach((input, index) => {
        if (isImageInput(input, index)) markImageInput(input, index);
    });
}

function dropTrailingFree(node, floor) {
    // 只从尾部回收「空闲」的口，已连线的绝不删除
    while ((node.inputs?.length || 0) > floor) {
        const last = node.inputs[node.inputs.length - 1];
        if (hasLink(last)) break;
        node.removeInput(node.inputs.length - 1);
    }
}

function normalizeImages(node) {
    if (!node?.inputs || app?.configuringGraph) return;
    const want = targetCount(node);
    ensureImages(node, want);
    dropTrailingFree(node, Math.max(MIN_IMAGES, want));
    node.setSize?.(node.computeSize?.() ?? node.size);
    node.setDirtyCanvas?.(true, true);
}

function initializeImages(node) {
    // 后端给的 9 个口先收起到 MIN_IMAGES，再按已保存的连线补回来
    dropTrailingFree(node, MIN_IMAGES);
    ensureImages(node, MIN_IMAGES);
}

function install(nodeType) {
    const prototype = nodeType?.prototype;
    if (!prototype || prototype.__qqQwenPeImagesInstalled) return;
    prototype.__qqQwenPeImagesInstalled = true;

    const originalCreated = prototype.onNodeCreated;
    prototype.onNodeCreated = function onNodeCreatedQQQwenPeImages() {
        const result = originalCreated?.apply(this, arguments);
        initializeImages(this);
        return result;
    };

    const originalConnectionsChange = prototype.onConnectionsChange;
    prototype.onConnectionsChange = function onConnectionsChangeQQQwenPeImages(type) {
        const result = originalConnectionsChange?.apply(this, arguments);
        const LiteGraph = globalThis.LiteGraph;
        if (app?.configuringGraph || type !== (LiteGraph?.INPUT ?? 1)) return result;
        queueMicrotask(() => {
            if (this.graph) normalizeImages(this);
        });
        return result;
    };

    const originalConfigure = prototype.onConfigure;
    prototype.onConfigure = function onConfigureQQQwenPeImages(info) {
        const result = originalConfigure?.apply(this, arguments);
        // 让保存时的口数先有落点，再交给 onAfterGraphConfigured 收敛
        const savedCount = Array.isArray(info?.inputs) ? info.inputs.length : 0;
        ensureImages(this, Math.max(MIN_IMAGES, savedCount));
        return result;
    };

    const originalAfterConfigured = prototype.onAfterGraphConfigured;
    prototype.onAfterGraphConfigured = function onAfterGraphConfiguredQQQwenPeImages() {
        const result = originalAfterConfigured?.apply(this, arguments);
        normalizeImages(this);
        return result;
    };
}

app.registerExtension({
    name: "QQ.QwenPeImages",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_TYPE) return;
        imageInputIsList = readDeclaredIsList(nodeData);
        install(nodeType);
    },
});
