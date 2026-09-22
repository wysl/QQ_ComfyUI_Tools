import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_TYPE = "WyslMediaLoader";
const STATE_WIDGET = "media_state";
const THUMB_TILE = 128;
// 128px webp is already 2x a 56px tile at devicePixelRatio 2, and requesting a
// larger tier for every row of a big folder would stall the picker.
const MIN_PANEL_WIDTH = 275;
const MIN_PANEL_HEIGHT = 155;
const MAX_PANEL_HEIGHT = 460;
const FALLBACK_CHROME_HEIGHT = 30;
const PANEL_PADDING = 7;
const PANEL_GAP = 6;
const GROUP_GAP = 4;
const MODAL_RENDER_CHUNK = 60;
const AUTOFIT_RETRIES = 3;
const MODAL_WATCH_INTERVAL = 400;
const HOVER_PREVIEW_SIZE = 384;
// The old popup was 2x the tile. Make it another half larger while retaining
// the same 384px source tier so opening a large folder remains inexpensive.
const HOVER_PREVIEW_SCALE = 3;
const HOVER_PREVIEW_CLOSE_DELAY = 180;
const GROUPS = [
    { key: "images", type: "image", label: "图片" },
    { key: "audios", type: "audio", label: "音频" },
    { key: "videos", type: "video", label: "视频" },
];
const OPEN_MODALS = new Map();
// The frontend layout engine calls onResize for widget-driven size changes too,
// so only a resize that happens while a pointer is held counts as user intent.

let pointerHeld = false;

function installPointerTracking() {
    if (installPointerTracking.installed) return;
    installPointerTracking.installed = true;
    document.addEventListener("pointerdown", () => { pointerHeld = true; }, true);
    document.addEventListener("pointerup", () => { pointerHeld = false; }, true);
    document.addEventListener("pointercancel", () => { pointerHeld = false; }, true);
}

function widget(node, name) {
    return (node?.widgets || []).find((item) => item?.name === name) || null;
}

function emptyState() {
    return { images: [], audios: [], videos: [] };
}

function normalizePath(value) {
    return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").split("/")
        .filter((part) => part && part !== "." && part !== "..").join("/");
}

function splitPath(path) {
    const normalized = normalizePath(path);
    const slash = normalized.lastIndexOf("/");
    return slash < 0
        ? { filename: normalized, subfolder: "" }
        : { filename: normalized.slice(slash + 1), subfolder: normalized.slice(0, slash) };
}

function readState(node) {
    const raw = widget(node, STATE_WIDGET)?.value;
    try {
        const parsed = typeof raw === "string" ? JSON.parse(raw || "{}") : raw;
        const state = emptyState();
        for (const group of GROUPS) {
            const values = Array.isArray(parsed?.[group.key]) ? parsed[group.key] : [];
            state[group.key] = [...new Set(values.map((entry) => normalizePath(
                typeof entry === "string" ? entry : entry?.filename,
            )).filter(Boolean))];
        }
        return state;
    } catch (error) {
        // A broken saved workflow re-parses on every render; say it once.
        if (!node?.__wyslMediaLoaderStateWarned) {
            node.__wyslMediaLoaderStateWarned = true;
            console.warn("Wysl media loader: 无法解析 media_state", error);
        }
        return emptyState();
    }
}

function writeState(node, state) {
    const normalized = emptyState();
    for (const group of GROUPS) normalized[group.key] = [...new Set(
        (state[group.key] || []).map(normalizePath).filter(Boolean),
    )];
    const value = JSON.stringify(normalized);
    const stateWidget = widget(node, STATE_WIDGET);
    if (stateWidget) {
        stateWidget.value = value;
        if (stateWidget._state) stateWidget._state.value = value;
    }
    node.graph?.setDirtyCanvas?.(true, true);
    node.graph?.change?.();
}

function extension(path) {
    const name = String(path || "").toLowerCase();
    return name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
}

function typeForFile(file) {
    const mime = String(file?.type || "").toLowerCase();
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("video/")) return "video";
    const ext = extension(file?.name);
    if ([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff", ".avif", ".heic"].includes(ext)) return "image";
    if ([".wav", ".mp3", ".flac", ".ogg", ".oga", ".m4a", ".aac", ".opus", ".wma"].includes(ext)) return "audio";
    if ([".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v", ".mpeg", ".mpg", ".wmv", ".flv"].includes(ext)) return "video";
    return "";
}

function mediaUrl(path) {
    // /view resolves `filename` against the input root after taking its
    // basename, so a nested file must travel through `subfolder`.
    const { filename, subfolder } = splitPath(path);
    const params = new URLSearchParams({ filename, type: "input" });
    if (subfolder) params.set("subfolder", subfolder);
    return `/view?${params.toString()}`;
}

function thumbnailUrl(path, size) {
    const params = new URLSearchParams({ filename: normalizePath(path), size: String(size) });
    return `/wysl/media-loader/thumbnail?${params.toString()}`;
}

function closeHoverPreview(node) {
    if (node?.__wyslMediaLoaderHoverPreviewCloseTimer) {
        clearTimeout(node.__wyslMediaLoaderHoverPreviewCloseTimer);
        node.__wyslMediaLoaderHoverPreviewCloseTimer = null;
    }
    const preview = node?.__wyslMediaLoaderHoverPreview;
    if (!preview) return;
    preview.remove();
    node.__wyslMediaLoaderHoverPreview = null;
}

function cancelHoverPreviewClose(node) {
    if (!node?.__wyslMediaLoaderHoverPreviewCloseTimer) return;
    clearTimeout(node.__wyslMediaLoaderHoverPreviewCloseTimer);
    node.__wyslMediaLoaderHoverPreviewCloseTimer = null;
}

function scheduleHoverPreviewClose(node, preview) {
    if (!node || node.__wyslMediaLoaderHoverPreview !== preview) return;
    cancelHoverPreviewClose(node);
    // The small delay bridges the few pixels between the source tile and the
    // popup. Once the pointer is over either surface, the timer is cancelled.
    node.__wyslMediaLoaderHoverPreviewCloseTimer = setTimeout(() => {
        node.__wyslMediaLoaderHoverPreviewCloseTimer = null;
        if (node.__wyslMediaLoaderHoverPreview !== preview) return;
        const anchor = preview.__wyslMediaLoaderHoverAnchor;
        if (anchor?.matches?.(":hover") || preview.matches?.(":hover")) return;
        closeHoverPreview(node);
    }, HOVER_PREVIEW_CLOSE_DELAY);
}

function keepHoverPreviewOpen(node, preview) {
    if (node?.__wyslMediaLoaderHoverPreview === preview) cancelHoverPreviewClose(node);
}

function positionHoverPreview(preview, anchor) {
    if (!preview?.isConnected || !anchor?.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const width = preview.offsetWidth || HOVER_PREVIEW_SIZE;
    const height = preview.offsetHeight || HOVER_PREVIEW_SIZE;
    const margin = 8;
    let left = rect.left + rect.width / 2;
    let top = rect.top - margin;
    let placement = "above";
    if (top - height < margin) {
        top = rect.bottom + margin;
        placement = "below";
    }
    left = Math.max(margin + width / 2, Math.min(window.innerWidth - margin - width / 2, left));
    preview.dataset.placement = placement;
    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
}

function attachImageHoverPreview(node, anchor, path) {
    if (!node || !anchor || !path || anchor.__wyslHoverPreviewAttached) return;
    anchor.__wyslHoverPreviewAttached = true;
    const show = () => {
        const current = node.__wyslMediaLoaderHoverPreview;
        if (current?.__wyslMediaLoaderHoverAnchor === anchor) {
            keepHoverPreviewOpen(node, current);
            positionHoverPreview(current, anchor);
            return;
        }
        closeHoverPreview(node);
        // A native link lets the browser show the original input image using
        // its normal zoom, save and new-tab behavior.
        const preview = document.createElement("a");
        preview.className = "wysl-media-hover-preview";
        preview.href = mediaUrl(path);
        preview.target = "_blank";
        preview.rel = "noopener noreferrer";
        preview.title = "点击查看原图";
        preview.setAttribute("aria-label", `查看原图：${cardTitle(path)}`);
        preview.__wyslMediaLoaderHoverAnchor = anchor;
        const image = document.createElement("img");
        image.alt = "";
        image.decoding = "async";
        image.src = thumbnailUrl(path, HOVER_PREVIEW_SIZE);
        image.addEventListener("error", () => {
            if (node.__wyslMediaLoaderHoverPreview === preview) closeHoverPreview(node);
        }, { once: true });
        preview.append(image);
        const rect = anchor.getBoundingClientRect();
        preview.style.width = `${Math.max(72, Math.round(rect.width * HOVER_PREVIEW_SCALE))}px`;
        preview.style.height = `${Math.max(72, Math.round(rect.height * HOVER_PREVIEW_SCALE))}px`;
        preview.addEventListener("pointerenter", () => keepHoverPreviewOpen(node, preview));
        preview.addEventListener("pointerleave", () => scheduleHoverPreviewClose(node, preview));
        // Do not let the Comfy canvas consume clicks inside the floating view;
        // stopping propagation leaves the anchor's normal navigation intact.
        preview.addEventListener("pointerdown", (event) => event.stopPropagation());
        preview.addEventListener("click", (event) => event.stopPropagation());
        document.body.append(preview);
        node.__wyslMediaLoaderHoverPreview = preview;
        positionHoverPreview(preview, anchor);
        requestAnimationFrame(() => preview.classList.add("is-visible"));
    };
    anchor.addEventListener("pointerenter", show);
    anchor.addEventListener("pointerleave", () => {
        const preview = node.__wyslMediaLoaderHoverPreview;
        if (preview?.__wyslMediaLoaderHoverAnchor === anchor) {
            scheduleHoverPreviewClose(node, preview);
        }
    });
}

function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes <= 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let scaled = bytes / 1024;
    let unit = 0;
    while (scaled >= 1024 && unit < units.length - 1) {
        scaled /= 1024;
        unit += 1;
    }
    return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(1)} ${units[unit]}`;
}

async function listFolder(folder) {
    const params = new URLSearchParams({ folder: String(folder || "") });
    const response = await api.fetchApi(`/wysl/media-loader/list?${params.toString()}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    return data;
}

async function uploadOne(file, subfolder = "") {
    const form = new FormData();
    form.append("image", file, String(file?.name || "wysl-media"));
    form.append("type", "input");
    const target = normalizePath(subfolder);
    if (target) form.append("subfolder", target);
    const response = await api.fetchApi("/upload/image", { method: "POST", body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    const name = String(data?.name || data?.filename || "").trim();
    if (!name) throw new Error("上传接口没有返回文件名");
    const returned = String(data?.subfolder || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    return returned ? `${returned}/${name}` : name;
}

function relativeFolder(file) {
    // webkitRelativePath keeps the picked root folder, which stays outside input.
    const relative = String(file?.webkitRelativePath || "").replaceAll("\\", "/");
    const slash = relative.lastIndexOf("/");
    if (slash <= 0) return "";
    return normalizePath(relative.slice(0, slash).split("/").slice(1).join("/"));
}

function hideWidget(node) {
    const stateWidget = widget(node, STATE_WIDGET);
    if (!stateWidget) return;
    stateWidget.hidden = true;
    stateWidget.type = "hidden";
    stateWidget.computeSize = () => [0, -4];
    stateWidget.options ||= {};
    stateWidget.options.hidden = true;
}

function makeButton(text, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = text;
    button.addEventListener("click", handler);
    return button;
}

function fileTypeIcon(type) {
    const icon = document.createElement("span");
    icon.className = `wysl-media-file-icon is-${type}`;
    icon.textContent = type === "image" ? "IMG" : type === "video" ? "VID" : "AUD";
    return icon;
}

function audioWave() {
    const wave = document.createElement("span");
    wave.className = "wysl-media-audio-wave";
    for (const height of [35, 65, 92, 52, 78, 42, 70]) {
        const bar = document.createElement("i");
        bar.style.setProperty("--bar-height", `${height}%`);
        wave.append(bar);
    }
    return wave;
}

function filePreview(path, type, size = THUMB_TILE) {
    const preview = document.createElement("div");
    preview.className = `wysl-media-thumb is-${type}`;
    if (type !== "image" && type !== "video") {
        preview.append(audioWave());
        return preview;
    }
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    // Videos and formats the browser cannot decode (tiff/heic) still need a
    // picture, so the backend renders a webp poster for every tile.
    let fellBack = false;
    image.addEventListener("error", () => {
        if (!fellBack && type === "image") {
            fellBack = true;
            image.src = mediaUrl(path);
            return;
        }
        image.remove();
        if (!preview.querySelector(".wysl-media-file-icon")) preview.append(fileTypeIcon(type));
    });
    image.src = thumbnailUrl(path, size);
    preview.append(image);
    if (type === "video") {
        const play = document.createElement("span");
        play.className = "wysl-media-video-mark";
        play.textContent = "▶";
        preview.append(play);
    }
    return preview;
}

function selectedCount(state) {
    return GROUPS.reduce((count, group) => count + state[group.key].length, 0);
}

function cardTitle(path) {
    return path.split(/[\\/]/).pop() || path;
}

function measurePanelHeight(node) {
    const panel = node?.__wyslMediaLoaderPanel;
    if (!panel?.isConnected) return MIN_PANEL_HEIGHT;
    const toolbar = panel.querySelector(".wysl-media-toolbar");
    const status = panel.querySelector(".wysl-media-status");
    const groups = panel.querySelector(".wysl-media-groups");
    let content = 0;
    let visible = 0;
    for (const section of groups?.children || []) {
        // offsetHeight is layout pixels. getBoundingClientRect() would report
        // the canvas zoom factor folded in, since DOM widgets are transformed.
        content += section.offsetHeight || 0;
        visible += 1;
    }
    content += Math.max(0, visible - 1) * GROUP_GAP;
    const total = (toolbar?.offsetHeight || 25)
        + (status?.offsetHeight || 22)
        + content
        + PANEL_GAP * 2
        + PANEL_PADDING * 2;
    return Math.max(MIN_PANEL_HEIGHT, Math.min(MAX_PANEL_HEIGHT, Math.ceil(total)));
}

function updateMinSize(node) {
    node.resizable = true;
    if (!Array.isArray(node.size)) return;
    const panelHeight = node.__wyslMediaLoaderHeight || MIN_PANEL_HEIGHT;
    const targetHeight = Math.max(MIN_PANEL_HEIGHT, panelHeight + FALLBACK_CHROME_HEIGHT);
    const width = Math.max(MIN_PANEL_WIDTH, Number(node.size?.[0]) || MIN_PANEL_WIDTH);
    const currentHeight = Number(node.size?.[1]) || 0;
    // While the user has not dragged the node edge, the panel follows its
    // content both ways. After a manual resize their choice wins and only a
    // too-small node is pushed back up.
    const autoFit = !node.__wyslMediaLoaderUserResized && !node.__wyslMediaLoaderAutoFitFrozen;
    const widthTooSmall = node.size[0] < width - 1;
    const heightOff = autoFit
        ? Math.abs(currentHeight - targetHeight) > 1
        : currentHeight < targetHeight - 1;
    if (!widthTooSmall && !heightOff) return;
    node.__wyslMediaLoaderLayoutBusy = true;
    try {
        node.setSize?.([
            Math.max(node.size[0], width),
            autoFit ? targetHeight : Math.max(currentHeight, targetHeight),
        ]);
    } finally {
        node.__wyslMediaLoaderLayoutBusy = false;
    }
    if (!autoFit) return;
    // Another layout rule can clamp the height we just asked for. Retry a few
    // times, then stop fighting it instead of looping forever.
    const applied = Number(node.size?.[1]) || 0;
    if (Math.abs(applied - targetHeight) <= 1) {
        node.__wyslMediaLoaderAutoFitTries = 0;
        return;
    }
    node.__wyslMediaLoaderAutoFitTries = (node.__wyslMediaLoaderAutoFitTries || 0) + 1;
    if (node.__wyslMediaLoaderAutoFitTries >= AUTOFIT_RETRIES) {
        node.__wyslMediaLoaderAutoFitFrozen = true;
        node.__wyslMediaLoaderAutoFitTries = 0;
    }
}

function updatePanelHeight(node) {
    const domWidget = node?.__wyslMediaLoaderWidget;
    if (!domWidget || node.__wyslMediaLoaderLayoutBusy) return;
    const next = measurePanelHeight(node);
    if (node.__wyslMediaLoaderHeight !== next) {
        node.__wyslMediaLoaderHeight = next;
        // The panel grows and shrinks with its content instead of keeping one
        // fixed height that either clips thumbnails or wastes canvas space.
        domWidget.computeLayoutSize = () => ({ minHeight: next, maxHeight: undefined, minWidth: MIN_PANEL_WIDTH });
        domWidget.options ||= {};
        domWidget.options.getMinHeight = () => next;
        delete domWidget.options.getMaxHeight;
        delete domWidget.options.getHeight;
        node._widgetSlotsDirty = true;
        node.setDirtyCanvas?.(true, true);
        node.graph?.setDirtyCanvas?.(true, true);
    }
    updateMinSize(node);
}

function honorRestoredSize(node) {
    if (!Array.isArray(node.size) || node.__wyslMediaLoaderUserResized) return;
    const panelHeight = node.__wyslMediaLoaderHeight || MIN_PANEL_HEIGHT;
    const targetHeight = Math.max(MIN_PANEL_HEIGHT, panelHeight + FALLBACK_CHROME_HEIGHT);
    // A workflow saved with a taller box was arranged by hand, so keep that
    // size instead of snapping it back to the auto-fit height on every load.
    if (node.size[1] > targetHeight + 1) node.__wyslMediaLoaderUserResized = true;
}

function scheduleRender(node) {
    if (!node || node.__wyslMediaLoaderRenderQueued) return;
    node.__wyslMediaLoaderRenderQueued = true;
    requestAnimationFrame(() => {
        node.__wyslMediaLoaderRenderQueued = false;
        render(node);
    });
}

function renderStatus(node) {
    const status = node?.__wyslMediaLoaderPanel?.querySelector(".wysl-media-status");
    if (!status) return;
    const upload = node.__wyslMediaLoaderUpload;
    const stored = node.__wyslMediaLoaderStatus;
    const text = stored?.text
        || (upload ? `正在上传并分类 ${upload.done}/${upload.total}…` : "拖入图片、音频或视频，会自动分类");
    status.textContent = text;
    status.title = text;
    status.classList.toggle("is-error", Boolean(stored?.isError));
}

function setStatus(node, text, isError = false, ttl = 0) {
    if (!node) return;
    if (node.__wyslMediaLoaderStatusTimer) {
        clearTimeout(node.__wyslMediaLoaderStatusTimer);
        node.__wyslMediaLoaderStatusTimer = null;
    }
    node.__wyslMediaLoaderStatus = text ? { text: String(text), isError: Boolean(isError) } : null;
    if (text && ttl > 0) {
        node.__wyslMediaLoaderStatusTimer = setTimeout(() => {
            node.__wyslMediaLoaderStatusTimer = null;
            setStatus(node, "");
        }, ttl);
    }
    renderStatus(node);
}

function setModalStatus(node, text, isError = false) {
    const status = node?.__wyslMediaLoaderModal?.querySelector(".wysl-media-modal-status");
    if (!status) return;
    status.textContent = String(text || "");
    status.title = String(text || "");
    status.classList.toggle("is-error", Boolean(isError));
}

function clearPanelDropTarget(node) {
    node?.__wyslMediaLoaderPanel?.classList.remove("is-drop-target");
}

function reorder(node, group, from, target, before) {
    if (!Number.isInteger(from) || !Number.isInteger(target) || from === target) return;
    const next = readState(node);
    const values = next[group.key];
    if (from < 0 || from >= values.length || target < 0 || target >= values.length) return;
    const [moved] = values.splice(from, 1);
    let insertAt = target + (from < target ? -1 : 0) + (before ? 0 : 1);
    insertAt = Math.max(0, Math.min(values.length, insertAt));
    values.splice(insertAt, 0, moved);
    writeState(node, next);
    render(node);
}

function createSelectedCard(node, group, path, index) {
    const card = document.createElement("div");
    card.className = `wysl-media-card is-${group.type}`;
    card.draggable = true;
    card.dataset.path = path;
    card.dataset.index = String(index);
    card.title = `${index + 1}. ${cardTitle(path)}（序号按类别单独计数）`;
    card.append(filePreview(path, group.type, THUMB_TILE));
    if (group.type === "image") attachImageHoverPreview(node, card, path);

    const order = document.createElement("span");
    order.className = "wysl-media-order";
    order.textContent = String(index + 1);
    card.append(order);

    const remove = makeButton("×", "wysl-media-remove", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const next = readState(node);
        const at = next[group.key].indexOf(path);
        if (at >= 0) next[group.key].splice(at, 1);
        writeState(node, next);
        render(node);
    });
    remove.title = "移除";
    remove.setAttribute("aria-label", `移除 ${cardTitle(path)}`);
    card.append(remove);

    card.addEventListener("dragstart", (event) => {
        node.__wyslMediaLoaderDrag = { group, card };
        clearPanelDropTarget(node);
        card.classList.add("is-dragging");
        event.dataTransfer?.setData("text/plain", path);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend", () => {
        card.classList.remove("is-dragging");
        node.__wyslMediaLoaderDrag = null;
        clearPanelDropTarget(node);
        node.__wyslMediaLoaderPanel?.querySelectorAll(".is-reorder-target")
            .forEach((item) => item.classList.remove("is-reorder-target"));
    });
    card.addEventListener("dragover", (event) => {
        const drag = node.__wyslMediaLoaderDrag;
        if (!drag || drag.group.type !== group.type || drag.card === card) return;
        event.preventDefault();
        event.stopPropagation();
        card.classList.add("is-reorder-target");
    });
    card.addEventListener("dragleave", () => card.classList.remove("is-reorder-target"));
    card.addEventListener("drop", (event) => {
        const drag = node.__wyslMediaLoaderDrag;
        if (!drag || drag.group.type !== group.type) return;
        event.preventDefault();
        event.stopPropagation();
        clearPanelDropTarget(node);
        card.classList.remove("is-reorder-target");
        const rect = card.getBoundingClientRect();
        reorder(
            node,
            group,
            Number(drag.card.dataset.index),
            Number(card.dataset.index),
            event.clientX < rect.left + rect.width / 2,
        );
    });
    return card;
}

function createGroupSection(group) {
    const section = document.createElement("section");
    section.className = `wysl-media-group is-${group.type}`;
    const header = document.createElement("div");
    header.className = "wysl-media-group-header";
    const name = document.createElement("span");
    name.textContent = group.label;
    const count = document.createElement("span");
    count.className = "wysl-media-group-count";
    count.textContent = "0";
    header.append(name, count);
    const list = document.createElement("div");
    list.className = "wysl-media-card-list";
    const empty = document.createElement("span");
    empty.className = "wysl-media-group-empty";
    empty.textContent = "未选择";
    list.append(empty);
    section.append(header, list);
    section.__wyslEmpty = empty;
    return section;
}

function renderGroup(node, group, values) {
    const section = node.__wyslMediaLoaderPanel?.querySelector(`.wysl-media-group.is-${group.type}`);
    if (!section) return;
    section.querySelector(".wysl-media-group-count").textContent = String(values.length);
    const list = section.querySelector(".wysl-media-card-list");
    const wanted = new Set(values);
    const cards = new Map();
    for (const child of Array.from(list.children)) {
        const path = child.dataset?.path;
        if (!path) continue;
        if (cards.has(path)) {
            child.remove();
            continue;
        }
        cards.set(path, child);
    }
    for (const [path, card] of cards) {
        if (!wanted.has(path)) {
            card.remove();
            cards.delete(path);
        }
    }
    values.forEach((path, index) => {
        let card = cards.get(path);
        if (!card) {
            card = createSelectedCard(node, group, path, index);
            cards.set(path, card);
        }
        card.dataset.index = String(index);
        card.title = `${index + 1}. ${cardTitle(path)}（序号按类别单独计数）`;
        const order = card.querySelector(".wysl-media-order");
        if (order) order.textContent = String(index + 1);
        // Re-appending moves the existing element, so already decoded
        // thumbnails are reused instead of rebuilt on every state change.
        list.append(card);
    });
    const empty = section.__wyslEmpty;
    if (empty) {
        if (values.length) empty.remove();
        else list.append(empty);
    }
}

function render(node) {
    const panel = node?.__wyslMediaLoaderPanel;
    if (!panel) return;
    const state = readState(node);
    panel.querySelector(".wysl-media-count").textContent = `${selectedCount(state)} 个已选`;
    const groups = panel.querySelector(".wysl-media-groups");
    // Tiles wrap instead of scrolling sideways, so the only scroll box is the
    // group stack; keep its offset while the selection changes underneath it.
    const scrollTop = groups?.scrollTop || 0;
    for (const group of GROUPS) {
        renderGroup(node, group, state[group.key]);
        const section = panel.querySelector(`.wysl-media-group.is-${group.type}`);
        if (section) {
            // Keep the image category visible as the primary drop target. Audio
            // and video categories appear only after that media type is chosen,
            // and their visibility is reconstructed from the saved state.
            section.hidden = group.type !== "image" && state[group.key].length === 0;
        }
    }
    if (groups) groups.scrollTop = scrollTop;
    panel.classList.toggle("is-empty", selectedCount(state) === 0);
    renderStatus(node);
    updatePanelHeight(node);
}

function modalMessage(text, isError = false) {
    const message = document.createElement("div");
    message.className = isError ? "wysl-media-modal-empty is-error" : "wysl-media-modal-empty";
    message.textContent = text;
    return message;
}

function renderListChunked(container, items, create, token, onDone) {
    let index = 0;
    const step = () => {
        if (token.cancelled || !container.isConnected) return;
        const fragment = document.createDocumentFragment();
        const end = Math.min(items.length, index + MODAL_RENDER_CHUNK);
        for (; index < end; index += 1) fragment.append(create(items[index]));
        container.append(fragment);
        if (index < items.length) {
            requestAnimationFrame(step);
            return;
        }
        onDone?.();
    };
    step();
}

function syncModalChecks(node) {
    const modal = node?.__wyslMediaLoaderModal;
    if (!modal?.isConnected) return;
    const state = readState(node);
    const selected = new Map(GROUPS.map((group) => [group.key, new Set(state[group.key])]));
    for (const row of modal.querySelectorAll(".wysl-media-file-row")) {
        const group = GROUPS.find((item) => item.key === row.dataset.group);
        const box = row.querySelector("input[type=checkbox]");
        if (!group || !box) continue;
        const checked = selected.get(group.key)?.has(row.dataset.path) ?? false;
        box.checked = checked;
        row.classList.toggle("is-checked", checked);
    }
}

function createFileRow(node, group, item, state) {
    const row = document.createElement("label");
    row.className = "wysl-media-file-row";
    row.dataset.path = item.path;
    row.dataset.group = group.key;
    const checked = state[group.key].includes(item.path);
    row.classList.toggle("is-checked", checked);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = checked;
    checkbox.addEventListener("change", () => {
        const next = readState(node);
        const values = next[group.key];
        const index = values.indexOf(item.path);
        if (checkbox.checked && index < 0) values.push(item.path);
        if (!checkbox.checked && index >= 0) values.splice(index, 1);
        writeState(node, next);
        row.classList.toggle("is-checked", checkbox.checked);
        scheduleRender(node);
    });

    const thumb = document.createElement("span");
    thumb.className = "wysl-media-file-thumb";
    thumb.append(filePreview(item.path, group.type, THUMB_TILE));
    if (group.type === "image") attachImageHoverPreview(node, thumb, item.path);

    const meta = document.createElement("span");
    meta.className = "wysl-media-file-meta";
    const name = document.createElement("span");
    name.className = "wysl-media-file-name";
    name.textContent = item.name;
    name.title = `input/${item.path}`;
    const size = document.createElement("span");
    size.className = "wysl-media-file-size";
    size.textContent = formatBytes(item.size);
    meta.append(name, size);

    row.append(checkbox, thumb, meta);
    return row;
}

function refreshModal(node, modal) {
    if (!modal?.isConnected) return;
    if (modal.__wyslRenderToken) modal.__wyslRenderToken.cancelled = true;
    const token = { cancelled: false };
    modal.__wyslRenderToken = token;

    const data = node.__wyslMediaLoaderFolderData || { folder: "", parent: "", directories: [], files: [] };
    const state = readState(node);
    const body = modal.querySelector(".wysl-media-modal-body");
    const path = modal.querySelector(".wysl-media-modal-path");
    const selectAll = modal.querySelector(".wysl-media-modal-select-all");
    const up = modal.querySelector(".wysl-media-modal-up");
    if (!body || !path) return;

    path.textContent = `input/${data.folder || ""}`;
    path.title = path.textContent;
    if (up) up.disabled = !data.folder;
    body.replaceChildren();
    body.scrollTop = 0;

    const files = data.files || [];
    if (selectAll) selectAll.disabled = !files.length;
    if (node.__wyslMediaLoaderFolderLoading) {
        body.append(modalMessage("正在读取当前目录…"));
        return;
    }
    if (data.error) {
        body.append(modalMessage(data.error, true));
        return;
    }
    if (data.directories?.length) {
        const folders = document.createElement("div");
        folders.className = "wysl-media-modal-folders";
        for (const directory of data.directories) {
            const button = makeButton(`📁 ${directory.name}`, "wysl-media-folder-chip", () => loadFolder(node, directory.path));
            button.title = `input/${directory.path}`;
            folders.append(button);
        }
        body.append(folders);
    }
    if (!files.length) {
        body.append(modalMessage("当前目录没有可用媒体文件"));
        return;
    }
    for (const group of GROUPS) {
        const groupFiles = files.filter((item) => item.type === group.type);
        if (!groupFiles.length) continue;
        const heading = document.createElement("div");
        heading.className = "wysl-media-modal-group-title";
        heading.textContent = `${group.label}（${groupFiles.length}）`;
        const list = document.createElement("div");
        list.className = "wysl-media-file-list";
        body.append(heading, list);
        // Rows are built from the snapshot taken above, so a selection made
        // while a long list is still rendering is reconciled at the end.
        renderListChunked(
            list,
            groupFiles,
            (item) => createFileRow(node, group, item, state),
            token,
            () => syncModalChecks(node),
        );
    }
}

async function loadFolder(node, folder = "") {
    node.__wyslMediaLoaderFolder = normalizePath(folder);
    node.__wyslMediaLoaderFolderLoading = true;
    refreshModal(node, node.__wyslMediaLoaderModal);
    try {
        node.__wyslMediaLoaderFolderData = await listFolder(node.__wyslMediaLoaderFolder);
    } catch (error) {
        node.__wyslMediaLoaderFolderData = {
            error: error?.message || String(error),
            folder: node.__wyslMediaLoaderFolder,
            directories: [],
            files: [],
        };
    } finally {
        node.__wyslMediaLoaderFolderLoading = false;
        refreshModal(node, node.__wyslMediaLoaderModal);
    }
}

function selectCurrentFolder(node) {
    const data = node.__wyslMediaLoaderFolderData || {};
    const state = readState(node);
    for (const item of data.files || []) {
        const group = GROUPS.find((entry) => entry.type === item.type);
        if (group && !state[group.key].includes(item.path)) state[group.key].push(item.path);
    }
    writeState(node, state);
    render(node);
    syncModalChecks(node);
}

async function addDroppedFiles(node, files) {
    const list = Array.from(files || []).filter((file) => typeForFile(file));
    if (!list.length) return [];
    const state = readState(node);
    const errors = [];
    let done = 0;
    node.__wyslMediaLoaderUpload = { done: 0, total: list.length };
    renderStatus(node);
    for (const file of list) {
        const group = GROUPS.find((item) => item.type === typeForFile(file));
        if (group) {
            try {
                const path = await uploadOne(file, relativeFolder(file));
                if (!state[group.key].includes(path)) state[group.key].push(path);
                writeState(node, state);
                scheduleRender(node);
            } catch (error) {
                errors.push(`${file.name}: ${error?.message || error}`);
            }
        }
        done += 1;
        node.__wyslMediaLoaderUpload = { done, total: list.length };
        renderStatus(node);
    }
    node.__wyslMediaLoaderUpload = null;
    renderStatus(node);
    if (errors.length) {
        setStatus(node, `上传失败 ${errors.length} 项：${errors[0]}`, true, 8000);
        setModalStatus(node, `上传失败 ${errors.length} 项：${errors[0]}`, true);
    } else {
        setStatus(node, "");
        setModalStatus(node, `已导入 ${list.length} 个文件`);
    }
    render(node);
    syncModalChecks(node);
    return errors;
}

function modalBelongsToGraph(node) {
    const graph = app.graph;
    if (!graph) return true;
    if (node.graph && node.graph !== graph) return false;
    const found = typeof graph.getNodeById === "function" ? graph.getNodeById(node.id) : null;
    if (found !== null && found !== undefined) return found === node;
    return Array.isArray(graph._nodes) ? graph._nodes.includes(node) : true;
}

function registerModalCleanup() {
    if (registerModalCleanup.installed) return;
    registerModalCleanup.installed = true;
    // Clearing or replacing the graph does not always call onRemoved, so a
    // dialog left behind would float above an unrelated canvas.
    const closeStale = () => {
        for (const [node, modal] of Array.from(OPEN_MODALS)) {
            if (!modal.isConnected || !modalBelongsToGraph(node)) closeModal(node, false);
        }
    };
    api.addEventListener("graphCleared", closeStale);
    globalThis.addEventListener("beforeunload", () => {
        for (const [node, modal] of Array.from(OPEN_MODALS)) closeModal(node, false);
    });
}

function watchModal(node, modal) {
    // Polling the graph is cheaper and safer than reacting to change events,
    // which also fire while the dialog itself edits the node state.
    modal.__wyslWatchTimer = setInterval(() => {
        if (node.__wyslMediaLoaderModal !== modal || !modal.isConnected) {
            clearInterval(modal.__wyslWatchTimer);
            modal.__wyslWatchTimer = null;
            return;
        }
        if (!modalBelongsToGraph(node)) closeModal(node, false);
    }, MODAL_WATCH_INTERVAL);
}

function trapFocus(modal, event) {
    if (event.key !== "Tab") return;
    const focusable = modal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (!modal.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
    }
    if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
    }
}

function pickFolderInto(node) {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "image/*,audio/*,video/*";
    input.webkitdirectory = true;
    input.addEventListener("change", () => {
        const files = Array.from(input.files || []).filter((file) => typeForFile(file));
        if (files.length) {
            setModalStatus(node, `正在导入文件夹，共 ${files.length} 个文件…`);
            addDroppedFiles(node, files).catch((error) => {
                console.error("Wysl folder import failed", error);
                setModalStatus(node, `导入失败：${error?.message || error}`, true);
            });
        }
        input.remove();
    }, { once: true });
    input.addEventListener("cancel", () => input.remove(), { once: true });
    document.body.append(input);
    input.click();
}

function openModal(node) {
    registerModalCleanup();
    if (node.__wyslMediaLoaderModal?.isConnected) {
        refreshModal(node, node.__wyslMediaLoaderModal);
        syncModalChecks(node);
        return;
    }
    node.__wyslMediaLoaderModalReturnFocus = document.activeElement;

    const modal = document.createElement("div");
    modal.className = "wysl-media-modal-overlay";
    const dialog = document.createElement("div");
    dialog.className = "wysl-media-modal";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "添加媒体");

    const header = document.createElement("div");
    header.className = "wysl-media-modal-header";
    const title = document.createElement("strong");
    title.textContent = "添加媒体";
    const close = makeButton("×", "wysl-media-modal-close", () => closeModal(node));
    close.title = "关闭";
    close.setAttribute("aria-label", "关闭");
    header.append(title, close);

    const controls = document.createElement("div");
    controls.className = "wysl-media-modal-controls";
    const path = document.createElement("span");
    path.className = "wysl-media-modal-path";
    const choose = makeButton("选择文件夹", "wysl-media-modal-folder", () => pickFolderInto(node));
    const up = makeButton("上级", "wysl-media-modal-up", () => loadFolder(node, node.__wyslMediaLoaderFolderData?.parent || ""));
    const root = makeButton("input 根目录", "wysl-media-modal-root", () => loadFolder(node, ""));
    const selectAll = makeButton("当前目录全选", "wysl-media-modal-select-all", () => selectCurrentFolder(node));
    controls.append(path, root, up, choose, selectAll);

    const body = document.createElement("div");
    body.className = "wysl-media-modal-body";

    const footer = document.createElement("div");
    footer.className = "wysl-media-modal-footer";
    const footerStatus = document.createElement("span");
    footerStatus.className = "wysl-media-modal-status";
    footer.append(footerStatus, makeButton("完成", "wysl-media-modal-done", () => closeModal(node)));

    dialog.append(header, controls, body, footer);
    modal.append(dialog);
    modal.addEventListener("pointerdown", (event) => {
        if (event.target === modal) closeModal(node);
    });
    modal.addEventListener("keydown", (event) => trapFocus(dialog, event));

    const onKeydown = (event) => {
        if (event.key === "Escape" && node.__wyslMediaLoaderModal === modal) {
            event.stopPropagation();
            closeModal(node);
        }
    };
    document.addEventListener("keydown", onKeydown, true);
    modal.__wyslEscapeHandler = onKeydown;

    document.body.append(modal);
    node.__wyslMediaLoaderModal = modal;
    OPEN_MODALS.set(node, modal);
    refreshModal(node, modal);
    watchModal(node, modal);
    close.focus();
    if (!node.__wyslMediaLoaderFolderData) loadFolder(node, "");
}

function closeModal(node, restoreFocus = true) {
    const modal = node?.__wyslMediaLoaderModal;
    node.__wyslMediaLoaderModal = null;
    OPEN_MODALS.delete(node);
    if (!modal) return;
    if (modal.__wyslWatchTimer) clearInterval(modal.__wyslWatchTimer);
    modal.__wyslWatchTimer = null;
    if (modal.__wyslRenderToken) modal.__wyslRenderToken.cancelled = true;
    if (modal.__wyslEscapeHandler) document.removeEventListener("keydown", modal.__wyslEscapeHandler, true);
    modal.remove();
    if (restoreFocus && node.__wyslMediaLoaderModalReturnFocus?.isConnected) {
        node.__wyslMediaLoaderModalReturnFocus.focus?.();
    }
    node.__wyslMediaLoaderModalReturnFocus = null;
}

function scrollableAncestor(panel, target, deltaX, deltaY) {
    let current = target instanceof Element ? target : null;
    while (current && current !== panel) {
        const style = globalThis.getComputedStyle(current);
        const vertical = style.overflowY === "auto" || style.overflowY === "scroll";
        const horizontal = style.overflowX === "auto" || style.overflowX === "scroll";
        if (vertical && deltaY) {
            const max = current.scrollHeight - current.clientHeight;
            if (max > 1 && ((deltaY < 0 && current.scrollTop > 0) || (deltaY > 0 && current.scrollTop < max))) return current;
        }
        if (horizontal && deltaX) {
            const max = current.scrollWidth - current.clientWidth;
            if (max > 1 && ((deltaX < 0 && current.scrollLeft > 0) || (deltaX > 0 && current.scrollLeft < max))) return current;
        }
        current = current.parentElement;
    }
    return null;
}

const CSS_TEXT = `
.wysl-media-loader-panel{position:relative;box-sizing:border-box;width:100%;height:100%;min-height:0;display:flex;flex-direction:column;gap:${PANEL_GAP}px;padding:${PANEL_PADDING}px;border:1px solid var(--border-color,rgba(255,255,255,.1));border-radius:6px;background:var(--comfy-menu-bg,#24272b);color:var(--content-fg,#dfe4e8);font:12px/1.35 sans-serif;overflow:hidden}
.wysl-media-toolbar{display:flex;align-items:center;gap:5px;min-height:25px;flex:0 0 auto}
.wysl-media-title{font-weight:650;color:var(--fg-color,#f1f3f5);margin-right:2px}
.wysl-media-count{color:var(--content-fg,#8c969f);opacity:.72;font-size:10px;margin-right:auto}
.wysl-media-toolbar button,.wysl-media-modal button{border:1px solid var(--border-color,rgba(255,255,255,.14));border-radius:4px;background:var(--comfy-input-bg,#343a40);color:var(--fg-color,#e9edf0);padding:4px 8px;cursor:pointer;font:inherit}
.wysl-media-toolbar button:hover:not(:disabled),.wysl-media-modal button:hover:not(:disabled){background:var(--comfy-menu-hover-bg,#46505a);border-color:var(--border-color,rgba(255,255,255,.26))}
.wysl-media-toolbar button:focus-visible,.wysl-media-modal button:focus-visible,.wysl-media-file-row:focus-within{outline:2px solid var(--p-primary-color,#4b86b4);outline-offset:1px}
.wysl-media-toolbar button:disabled,.wysl-media-modal button:disabled{opacity:.45;cursor:not-allowed}
.wysl-media-clear{color:var(--error-color,#d7afb0)}
.wysl-media-groups{display:flex;flex:1 1 auto;flex-direction:column;gap:${GROUP_GAP}px;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin}
.wysl-media-group{min-width:0;flex:0 0 auto;padding-top:5px;border-top:1px solid var(--border-color,rgba(255,255,255,.09))}
.wysl-media-group:first-child{padding-top:0;border-top:0}
.wysl-media-group-header{display:flex;align-items:center;gap:5px;margin-bottom:4px;color:var(--fg-color,#cbd2d7);font-size:10px;font-weight:650}
.wysl-media-group-count{color:var(--content-fg,#89949d);opacity:.75;font-variant-numeric:tabular-nums}
.wysl-media-card-list{display:grid;grid-template-columns:repeat(auto-fill,56px);grid-auto-rows:56px;gap:6px;align-content:start;min-height:56px;padding:1px}
.wysl-media-group-empty{color:var(--content-fg,#737e87);opacity:.8;font-size:10px;padding:2px 0 0 3px;grid-column:1/-1}
.wysl-media-card{position:relative;width:56px;height:56px;border:1px solid var(--border-color,#444b50);border-radius:5px;background:var(--comfy-input-bg,#16191c);cursor:grab;transition:border-color .12s,opacity .12s,transform .12s}
.wysl-media-card:hover,.wysl-media-card.is-reorder-target{border-color:var(--p-primary-color,#85a8c4)}
.wysl-media-card.is-dragging{opacity:.35;transform:scale(.95)}
.wysl-media-card:active{cursor:grabbing}
.wysl-media-thumb{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:4px;background:var(--comfy-input-bg,#151719)}
.wysl-media-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.wysl-media-hover-preview{position:fixed;z-index:11000;box-sizing:border-box;transform:translate(-50%,-100%) scale(.86);transform-origin:50% 100%;opacity:0;pointer-events:auto;cursor:zoom-in;text-decoration:none;padding:3px;border:1px solid var(--p-primary-color,#85a8c4);border-radius:7px;background:var(--comfy-menu-bg,#25292d);box-shadow:0 10px 28px rgba(0,0,0,.62);transition:opacity .14s ease,transform .16s cubic-bezier(.2,.75,.25,1)}
.wysl-media-hover-preview[data-placement="below"]{transform-origin:50% 0;transform:translate(-50%,0) scale(.86)}
.wysl-media-hover-preview.is-visible{opacity:1;transform:translate(-50%,-100%) scale(1)}
.wysl-media-hover-preview[data-placement="below"].is-visible{transform:translate(-50%,0) scale(1)}
.wysl-media-hover-preview:hover,.wysl-media-hover-preview:focus-visible{border-color:var(--p-primary-color,#a9ccef);box-shadow:0 12px 32px rgba(0,0,0,.72),0 0 0 1px color-mix(in srgb,var(--p-primary-color,#85a8c4) 45%,transparent)}
.wysl-media-hover-preview:focus-visible{outline:2px solid var(--p-primary-color,#85a8c4);outline-offset:2px}
.wysl-media-hover-preview img{display:block;width:100%;height:100%;object-fit:contain;border-radius:4px;background:#111;pointer-events:none}
.wysl-media-thumb.is-audio{background:var(--comfy-input-bg,#142a27)}
.wysl-media-audio-wave{display:flex;align-items:center;justify-content:center;gap:3px;width:75%;height:55%}
.wysl-media-audio-wave i{display:block;width:3px;height:var(--bar-height);border-radius:2px;background:var(--success-color,#46c5b1)}
.wysl-media-video-mark{position:absolute;left:4px;bottom:4px;display:grid;place-items:center;width:15px;height:15px;border-radius:50%;background:rgba(0,0,0,.72);color:#fff;font-size:8px;pointer-events:none}
.wysl-media-order{position:absolute;left:3px;top:3px;z-index:2;min-width:12px;padding:1px 3px;border-radius:3px;background:rgba(0,0,0,.74);color:#fff;text-align:center;font-size:9px;line-height:1.2;font-variant-numeric:tabular-nums;pointer-events:none}
.wysl-media-remove{position:absolute!important;right:3px;top:3px;z-index:4;width:17px;height:17px;padding:0!important;border:1px solid rgba(0,0,0,.4)!important;border-radius:50%!important;background:rgba(62,72,80,.88)!important;color:#fff!important;display:grid;place-items:center;font-size:14px!important;line-height:1;opacity:.6;transition:opacity .12s,transform .12s}
.wysl-media-card:hover .wysl-media-remove,.wysl-media-card:focus-within .wysl-media-remove,.wysl-media-remove:focus-visible{opacity:1}
.wysl-media-remove:hover{background:#9b4d4d!important}
.wysl-media-status{flex:0 0 auto;padding:4px 5px;border:1px dashed var(--border-color,rgba(142,171,194,.32));border-radius:4px;color:var(--content-fg,#94a6b3);font-size:10px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wysl-media-status.is-error{border-color:var(--error-color,#9b4d4d);color:var(--error-color,#d7afb0)}
.wysl-media-loader-panel.is-empty .wysl-media-status{border-color:var(--border-color,rgba(255,255,255,.12));opacity:.8}
.wysl-media-loader-panel.is-drop-target{border-color:var(--p-primary-color,#86abc7);box-shadow:inset 0 0 0 1px rgba(134,171,199,.28)}
.wysl-media-loader-panel.is-drop-target::after{content:"释放以自动分类";position:absolute;inset:7px;z-index:10;display:flex;align-items:center;justify-content:center;border:1px dashed rgba(159,195,222,.7);border-radius:5px;background:rgba(28,35,40,.92);color:#d8e7f1;font-size:12px;font-weight:650;pointer-events:none}
.wysl-media-modal-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.58)}
.wysl-media-modal{display:flex;flex-direction:column;width:min(760px,calc(100vw - 40px));max-height:min(680px,calc(100vh - 40px));border:1px solid var(--border-color,#4b545b);border-radius:7px;background:var(--comfy-menu-bg,#25292d);box-shadow:0 18px 55px rgba(0,0,0,.5);color:var(--fg-color,#e3e7ea);font:12px/1.35 sans-serif}
.wysl-media-modal-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border-color,rgba(255,255,255,.1))}
.wysl-media-modal-header strong{font-size:13px}
.wysl-media-modal-close{width:24px;height:24px;padding:0!important;font-size:18px!important;line-height:1}
.wysl-media-modal-controls{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:8px 10px;border-bottom:1px solid var(--border-color,rgba(255,255,255,.08))}
.wysl-media-modal-path{min-width:120px;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--content-fg,#aebbc4)}
.wysl-media-modal-controls button{flex:0 0 auto;font-size:11px}
.wysl-media-modal-body{min-height:100px;overflow:auto;padding:10px}
.wysl-media-modal-folders{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:9px}
.wysl-media-folder-chip{font-size:11px!important}
.wysl-media-modal-group-title{margin:9px 0 4px;color:var(--content-fg,#9eb7c9);font-size:11px;font-weight:650}
.wysl-media-file-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:4px 8px}
.wysl-media-file-row{display:flex;align-items:center;min-width:0;gap:7px;padding:3px 4px;border:1px solid transparent;border-radius:4px;cursor:pointer}
.wysl-media-file-row:hover{background:var(--comfy-menu-hover-bg,rgba(255,255,255,.07))}
.wysl-media-file-row.is-checked{border-color:var(--p-primary-color,rgba(116,169,207,.55));background:rgba(116,169,207,.12)}
.wysl-media-file-row input{margin:0;flex:0 0 auto;accent-color:var(--p-primary-color,#74a9cf)}
.wysl-media-file-thumb{position:relative;flex:0 0 42px;width:42px;height:42px;border:1px solid var(--border-color,#444b50);border-radius:4px;overflow:hidden;background:var(--comfy-input-bg,#16191c)}
.wysl-media-file-meta{display:flex;flex-direction:column;min-width:0;gap:1px}
.wysl-media-file-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wysl-media-file-size{color:var(--content-fg,#89949d);font-size:10px;opacity:.8;font-variant-numeric:tabular-nums}
.wysl-media-file-icon{display:grid;place-items:center;width:100%;height:100%;border-radius:3px;background:#344451;color:#bed2df;font-size:8px;font-weight:700;letter-spacing:.03em}
.wysl-media-file-icon.is-audio{background:#294d48;color:#8ee3d4}
.wysl-media-file-icon.is-video{background:#493f51;color:#d1bfe1}
.wysl-media-modal-empty{padding:28px 8px;color:var(--content-fg,#818b93);text-align:center}
.wysl-media-modal-empty.is-error{color:var(--error-color,#d39b9b)}
.wysl-media-modal-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:8px 10px;border-top:1px solid var(--border-color,rgba(255,255,255,.1))}
.wysl-media-modal-status{min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--content-fg,#aebbc4);font-size:11px}
.wysl-media-modal-status.is-error{color:var(--error-color,#d39b9b)}
.wysl-media-modal-done{background:var(--p-primary-color,#3f657f)!important}
`;

function installStyles() {
    if (document.getElementById("wysl-media-loader-style")) return;
    const style = document.createElement("style");
    style.id = "wysl-media-loader-style";
    style.textContent = CSS_TEXT;
    document.head.append(style);
}

function setup(node) {
    if (!node || node.__wyslMediaLoaderSetup || typeof node.addDOMWidget !== "function") return;
    node.__wyslMediaLoaderSetup = true;
    installPointerTracking();
    installStyles();
    hideWidget(node);

    const panel = document.createElement("div");
    panel.className = "wysl-media-loader-panel";
    panel.addEventListener("pointerdown", (event) => event.stopPropagation());
    panel.addEventListener("dragenter", (event) => {
        if (!event.dataTransfer?.items?.length) return;
        if (node.__wyslMediaLoaderDrag) return;
        event.preventDefault();
        event.stopPropagation();
        panel.classList.add("is-drop-target");
    });
    panel.addEventListener("dragover", (event) => {
        if (!event.dataTransfer?.items?.length) return;
        if (node.__wyslMediaLoaderDrag) return;
        event.preventDefault();
        event.stopPropagation();
        panel.classList.add("is-drop-target");
    });
    panel.addEventListener("dragleave", (event) => {
        if (node.__wyslMediaLoaderDrag) return;
        if (event.relatedTarget instanceof Node && panel.contains(event.relatedTarget)) return;
        panel.classList.remove("is-drop-target");
    });
    panel.addEventListener("drop", (event) => {
        if (node.__wyslMediaLoaderDrag) {
            clearPanelDropTarget(node);
            return;
        }
        const files = Array.from(event.dataTransfer?.files || []).filter((file) => typeForFile(file));
        if (!files.length) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        clearPanelDropTarget(node);
        addDroppedFiles(node, files).catch((error) => console.error("Wysl media drop failed", error));
    });

    const toolbar = document.createElement("div");
    toolbar.className = "wysl-media-toolbar";
    const title = document.createElement("span");
    title.className = "wysl-media-title";
    title.textContent = "媒体";
    const count = document.createElement("span");
    count.className = "wysl-media-count";
    const add = makeButton("添加媒体", "wysl-media-add", () => openModal(node));
    const clear = makeButton("清空", "wysl-media-clear", () => {
        writeState(node, emptyState());
        render(node);
    });
    toolbar.append(title, count, add, clear);

    const groups = document.createElement("div");
    groups.className = "wysl-media-groups";
    for (const group of GROUPS) groups.append(createGroupSection(group));

    const status = document.createElement("div");
    status.className = "wysl-media-status";
    panel.append(toolbar, groups, status);

    panel.addEventListener("wheel", (event) => {
        const deltaX = event.shiftKey ? event.deltaY : event.deltaX;
        // Lists that can still scroll keep their native scrolling; everything
        // else reaches the canvas so the panel never swallows zoom.
        if (scrollableAncestor(panel, event.target, deltaX, event.deltaY)) return;
        event.preventDefault();
        event.stopPropagation();
        app.canvas?.processMouseWheel?.(event);
    }, { passive: false, capture: true });

    node.__wyslMediaLoaderPanel = panel;
    node.__wyslMediaLoaderHeight = MIN_PANEL_HEIGHT;
    const domWidget = node.addDOMWidget("wysl_media_loader", "wysl_media_loader", panel, {
        serialize: false,
        getValue: () => String(widget(node, STATE_WIDGET)?.value || ""),
        setValue: (value) => {
            const stateWidget = widget(node, STATE_WIDGET);
            if (stateWidget) stateWidget.value = String(value || "");
            render(node);
        },
        getMinHeight: () => node.__wyslMediaLoaderHeight || MIN_PANEL_HEIGHT,
        afterResize: () => updatePanelHeight(node),
    });
    if (domWidget) {
        domWidget.serialize = false;
        domWidget.computeLayoutSize = () => ({
            minHeight: node.__wyslMediaLoaderHeight || MIN_PANEL_HEIGHT,
            maxHeight: undefined,
            minWidth: MIN_PANEL_WIDTH,
        });
    }
    node.__wyslMediaLoaderWidget = domWidget;

    if (typeof ResizeObserver === "function") {
        let frame = 0;
        const observer = new ResizeObserver(() => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                updatePanelHeight(node);
            });
        });
        observer.observe(panel);
        node.__wyslMediaLoaderResizeObserver = observer;
    }

    render(node);
    updateMinSize(node);
}

function teardown(node) {
    closeModal(node, false);
    closeHoverPreview(node);
    node.__wyslMediaLoaderResizeObserver?.disconnect?.();
    node.__wyslMediaLoaderResizeObserver = null;
    if (node.__wyslMediaLoaderStatusTimer) {
        clearTimeout(node.__wyslMediaLoaderStatusTimer);
        node.__wyslMediaLoaderStatusTimer = null;
    }
}

app.registerExtension({
    name: "Wysl.MediaLoader",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_TYPE) return;
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function onNodeCreatedWyslMediaLoader() {
            const result = originalCreated?.apply(this, arguments);
            setup(this);
            return result;
        };
        const originalAdded = nodeType.prototype.onAdded;
        nodeType.prototype.onAdded = function onAddedWyslMediaLoader() {
            const result = originalAdded?.apply(this, arguments);
            setup(this);
            return result;
        };
        const originalConfigured = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function onConfigureWyslMediaLoader() {
            const result = originalConfigured?.apply(this, arguments);
            // Must run before setup(): its first auto-fit pass would otherwise
            // shrink a box the user had arranged taller in the saved workflow.
            honorRestoredSize(this);
            setup(this);
            render(this);
            return result;
        };
        const originalRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function onRemovedWyslMediaLoader() {
            teardown(this);
            return originalRemoved?.apply(this, arguments);
        };
        const originalResized = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function onResizeWyslMediaLoader() {
            const result = originalResized?.apply(this, arguments);
            if (pointerHeld && !this.__wyslMediaLoaderLayoutBusy) this.__wyslMediaLoaderUserResized = true;
            return result;
        };
    },
});
