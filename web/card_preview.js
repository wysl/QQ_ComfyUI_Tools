import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { createCardSurface, injectCardCSS, CARD_MEDIA_HEIGHT } from "./card_render.js";

// QQ-卡面：富媒体结果卡片输出节点（卡面模式的渲染构件）。
// 接 图像/视频/音频/media_bundle，生成中实时预览，完成后只显示结果媒体。
const NODE_TYPE = "QQCardPreview";

function setupCard(node) {
    if (node.__qqCardSetup) return;
    node.__qqCardSetup = true;
    const surface = createCardSurface(node, { emptyText: "接 图像 / 视频 / 音频\n运行后在此呈现结果" });

    const originalExecuted = node.onExecuted;
    node.onExecuted = function (output) {
        const result = originalExecuted?.apply(this, arguments);
        surface.exitRunning();
        surface.renderResult(output || {});
        node.setDirtyCanvas?.(true, true);
        return result;
    };
    const onExecuting = (event) => {
        const id = event?.detail?.node;
        if (id != null && String(id) === String(node.id)) surface.enterRunning();
    };
    const onStart = () => surface.enterRunning();
    const onEnd = () => {
        surface.exitRunning();
        const saved = node.properties.qq_card_ui;
        if (saved && (saved.images?.length || saved.videos?.length || saved.audio?.length)) surface.renderResult(saved);
        else surface.showEmpty();
    };
    api.addEventListener("executing", onExecuting);
    api.addEventListener("execution_start", onStart);
    api.addEventListener("execution_success", onEnd);
    api.addEventListener("execution_error", onEnd);
    api.addEventListener("execution_interrupted", onEnd);

    const originalRemoved = node.onRemoved;
    node.onRemoved = function () {
        surface.destroy();
        api.removeEventListener?.("executing", onExecuting);
        api.removeEventListener?.("execution_start", onStart);
        api.removeEventListener?.("execution_success", onEnd);
        api.removeEventListener?.("execution_error", onEnd);
        api.removeEventListener?.("execution_interrupted", onEnd);
        return originalRemoved?.apply(this, arguments);
    };

    node.addDOMWidget("qq_card", "qq_card", surface.root, {
        serialize: false, hideOnZoom: false, margin: 4, getMinHeight: () => CARD_MEDIA_HEIGHT + 40,
    });
    node.resizable = true;
}

app.registerExtension({
    name: "QQ.CardPreview",
    setup() { injectCardCSS(); },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_TYPE) return;
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            setupCard(this);
            return result;
        };
        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = originalConfigure?.apply(this, arguments);
            setupCard(this);
            return result;
        };
    },
});
