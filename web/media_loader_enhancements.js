import { app } from "../../scripts/app.js";

const NODE_TYPE = "MiniMaxH3EasyMediaLoader";
const MEDIA_ACCEPT = [
    ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff",
    ".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac",
    ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v",
].join(",");

function installFolderButton(node) {
    const panel = node?.__h3MediaLoaderPanel;
    const toolbar = panel?.querySelector?.(".h3-media-loader-toolbar");
    if (!panel || !toolbar || toolbar.querySelector(".wysl-media-loader-folder")) return Boolean(toolbar);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "h3-media-icon-button wysl-media-loader-folder";
    button.textContent = "⇱";
    button.title = "选择文件夹并加入全部媒体";
    button.setAttribute("aria-label", button.title);
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.accept = MEDIA_ACCEPT;
        // Chromium exposes folder selection through this non-standard property.
        input.webkitdirectory = true;
        input.directory = true;
        input.addEventListener("change", () => {
            const files = Array.from(input.files || []).filter((file) => file?.name);
            if (files.length && typeof node.pasteFiles === "function") {
                Promise.resolve(node.pasteFiles(files)).catch((error) => {
                    console.error("Wysl media folder upload failed", error);
                });
            }
            input.remove();
        }, { once: true });
        input.addEventListener("cancel", () => input.remove(), { once: true });
        document.body.append(input);
        input.click();
    });
    toolbar.insertBefore(button, toolbar.firstChild);
    return true;
}

function installMixedDrop(node) {
    const panel = node?.__h3MediaLoaderPanel;
    if (!panel || panel.__wyslMixedMediaDropInstalled) return;
    if (typeof node.pasteFiles !== "function") return;
    panel.__wyslMixedMediaDropInstalled = true;
    panel.addEventListener("drop", (event) => {
        const files = Array.from(event.dataTransfer?.files || []).filter((file) => file?.name);
        if (!files.length) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        Promise.resolve(node.pasteFiles(files)).catch((error) => {
            console.error("Wysl mixed media drop failed", error);
        });
    }, true);
}

function setup(node, retries = 0) {
    if (!node || node.__wyslMediaLoaderEnhancementInstalled) return;
    const panelReady = installFolderButton(node);
    installMixedDrop(node);
    if (!panelReady && retries < 30) {
        setTimeout(() => setup(node, retries + 1), 100);
        return;
    }
    node.__wyslMediaLoaderEnhancementInstalled = true;
}

app.registerExtension({
    name: "QQ.MediaLoaderEnhancements",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_TYPE) return;
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function onNodeCreatedQQMediaLoaderEnhancements() {
            const result = originalCreated?.apply(this, arguments);
            setup(this);
            return result;
        };
        const originalAdded = nodeType.prototype.onAdded;
        nodeType.prototype.onAdded = function onAddedQQMediaLoaderEnhancements() {
            const result = originalAdded?.apply(this, arguments);
            setup(this);
            return result;
        };
        const originalConfigured = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function onConfigureQQMediaLoaderEnhancements() {
            const result = originalConfigured?.apply(this, arguments);
            setup(this);
            return result;
        };
    },
});
