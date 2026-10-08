import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// QQ-图片包加载
// 面板中每个压缩包只占一个“抓牌”格子；包内图片按完整相对路径自然排序。
// 执行成功后由前端读取后端 ui.qq_image_package 元数据并自动排下一张。

const NODE_TYPE = "QQImagePackageLoader";
const STATE_WIDGET = "package_state";
const INDEX_WIDGET = "当前序号";
const AUTO_WIDGET = "自动下一张";
const FILE_INPUT = "file_path";
const MIN_PANEL_WIDTH = 300;
const MIN_PANEL_HEIGHT = 100;
const MAX_PANEL_HEIGHT = 470;
const THUMB_EDGE = 256;
const CARD_WIDTH = 100;
const CARD_GAP = 48;
const LIST_INLINE_PADDING = 18;
const FAN_SPREAD = 40;

function widget(node, name) {
    return (node?.widgets || []).find((entry) => entry && entry.name === name) || null;
}

function normalizePath(value) {
    return String(value || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

function encodeReference(reference) {
    return encodeURIComponent(String(reference || ""));
}

function thumbnailUrl(reference, index = 0) {
    const suffix = index > 0 ? `&index=${index}` : "";
    return `/qq_image_packages/thumbnail?reference=${encodeReference(reference)}&size=${THUMB_EDGE}${suffix}`;
}

function parseState(node) {
    try {
        const parsed = JSON.parse(String(widget(node, STATE_WIDGET)?.value || "{\"sources\":[]}"));
        const sources = Array.isArray(parsed?.sources) ? parsed.sources.map(normalizePath).filter(Boolean) : [];
        return { sources: [...new Set(sources)] };
    } catch {
        return { sources: [] };
    }
}

function writeState(node, state) {
    cancelContinuation();
    const target = widget(node, STATE_WIDGET);
    if (target) target.value = JSON.stringify({ sources: state.sources });
    const index = widget(node, INDEX_WIDGET);
    if (index) index.value = 1;
    renderPanel(node);
}

function acceptedFile(file) {
    const name = String(file?.name || "").toLowerCase();
    return name.endsWith(".zip") || name.endsWith(".cbz") || name.endsWith(".tar")
        || name.endsWith(".tar.gz") || name.endsWith(".tgz") || name.endsWith(".gz")
        || /\.(png|jpe?g|webp|bmp|gif|tiff?|avif)$/.test(name);
}

async function uploadOne(file) {
    // A raw body streams to the plugin endpoint and avoids ComfyUI's global
    // multipart /upload/image limit (100 MB by default).
    const filename = encodeURIComponent(String(file?.name || "package"));
    const response = await api.fetchApi(`/qq_image_packages/upload?filename=${filename}`, {
        method: "POST",
        headers: {"Content-Type": file?.type || "application/octet-stream"},
        body: file,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    const reference = String(data?.reference || "").trim();
    if (!reference) throw new Error("上传接口没有返回图片包路径");
    return normalizePath(reference);
}

function makeFan(source, layer, index) {
    const fan = document.createElement("div");
    fan.className = `qqpkg-fan qqpkg-fan-${layer}`;
    const fanImage = document.createElement("img");
    fanImage.alt = "";
    fanImage.loading = "lazy";
    fanImage.decoding = "async";
    fanImage.draggable = false;
    fanImage.addEventListener("error", () => fanImage.remove());
    fanImage.src = thumbnailUrl(source, index);
    fan.append(fanImage);
    return fan;
}

function status(node) {
    return node?.__qqPackagePanel?.querySelector(".qqpkg-status");
}

function setStatus(node, text, isError = false, ttl = 5000) {
    const target = status(node);
    if (!target) return;
    target.textContent = String(text || "");
    target.title = target.textContent;
    target.classList.toggle("is-error", Boolean(isError));
    if (node.__qqPackageStatusTimer) clearTimeout(node.__qqPackageStatusTimer);
    if (ttl > 0) {
        node.__qqPackageStatusTimer = setTimeout(() => {
            if (status(node)) status(node).textContent = "";
        }, ttl);
    }
}

function makeButton(text, className, handler, title) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = text;
    if (title) button.title = title;
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        handler(event);
    });
    return button;
}

function sourceName(reference) {
    const text = normalizePath(reference);
    return text.slice(Math.max(0, text.lastIndexOf("/") + 1)) || text;
}

function updateIndexLimit(node) {
    fitNodeHeight(node);
    const state = parseState(node);
    const cards = node.__qqPackageCards || new Map();
    let total = 0;
    let loading = false;
    for (const source of state.sources) {
        const card = cards.get(source);
        total += Number(card?.count || 0);
        if (card?.classList?.contains("is-loading")) loading = true;
    }
    node.__qqPackageTotal = total;
    const index = widget(node, INDEX_WIDGET);
    if (index) {
        index.options ||= {};
        index.options.max = fileInputLinked(node) ? 20000 : Math.max(1, total);
    }
    const counter = node.__qqPackagePanel?.querySelector(".qqpkg-count");
    if (counter) counter.textContent = `${state.sources.length} 个来源 / ${loading ? "读取中…" : `${total} 张`}`;
    updateListScroll(node);
}

async function refreshCardInfo(node, source, card) {
    card.__count = card.__count || 0;
    try {
        const response = await api.fetchApi(`/qq_image_packages/info?reference=${encodeReference(source)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
        card.count = Number(data.count) || 0;
        card.dataset.kind = String(data.kind || "unknown");
        const badge = card.querySelector(".qqpkg-card-badge");
        if (badge) badge.textContent = data.kind === "archive" ? "PACK" : "IMG";
        updateCountBadge(card);
        const name = card.querySelector(".qqpkg-card-name");
        if (name) {
            name.textContent = String(data.name || sourceName(source));
            name.title = normalizePath(source);
        }
        const fan2 = card.querySelector(".qqpkg-fan-2");
        if (fan2) fan2.style.display = card.count >= 2 ? "" : "none";
        const fan3 = card.querySelector(".qqpkg-fan-3");
        if (fan3) fan3.style.display = card.count >= 3 ? "" : "none";
        card.classList.remove("is-loading");
        if (node.__qqPackageCards) node.__qqPackageCards.set(source, card);
        updateIndexLimit(node);
    } catch (error) {
        card.classList.add("is-error");
        const count = card.querySelector(".qqpkg-card-count");
        if (count) count.textContent = "读取失败";
        setStatus(node, `${sourceName(source)}：${error?.message || error}`, true, 9000);
    }
}

function createCard(node, source, order) {
    const card = document.createElement("div");
    card.className = "qqpkg-card is-loading";
    card.dataset.reference = normalizePath(source);
    card.draggable = true;

    const fan3 = makeFan(source, 3, 2);
    const fan2 = makeFan(source, 2, 1);
    const preview = document.createElement("div");
    preview.className = "qqpkg-card-preview";
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.draggable = false;
    image.addEventListener("error", () => {
        image.remove();
        preview.textContent = "PKG";
    });
    image.src = thumbnailUrl(source);
    preview.append(image);

    const badge = document.createElement("span");
    badge.className = "qqpkg-card-badge";
    badge.textContent = "…";
    const count = document.createElement("span");
    count.className = "qqpkg-card-count";
    count.textContent = "读取中";
    const orderEl = document.createElement("span");
    orderEl.className = "qqpkg-card-order";
    orderEl.textContent = String(order);

    const name = document.createElement("div");
    name.className = "qqpkg-card-name";
    name.textContent = sourceName(source);
    name.title = normalizePath(source);
    const actions = document.createElement("div");
    actions.className = "qqpkg-card-actions";
    actions.append(
        makeButton("×", "qqpkg-mini is-remove", () => {
            const state = parseState(node);
            state.sources = state.sources.filter((item) => item !== card.dataset.reference);
            writeState(node, state);
        }, "移除"),
    );

    card.append(fan3, fan2, preview, badge, count, orderEl, name, actions);
    card.addEventListener("dragstart", (event) => {
        node.__qqPackageDragSource = card.dataset.reference;
        card.classList.add("is-dragging");
        event.dataTransfer?.setData("text/plain", card.dataset.reference);
    });
    card.addEventListener("dragend", () => {
        card.classList.remove("is-dragging");
        delete node.__qqPackageDragSource;
    });
    card.addEventListener("dragover", (event) => event.preventDefault());
    card.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const source = node.__qqPackageDragSource || event.dataTransfer?.getData("text/plain");
        if (!source || source === card.dataset.reference) return;
        const state = parseState(node);
        const from = state.sources.indexOf(source);
        const to = state.sources.indexOf(card.dataset.reference);
        if (from < 0 || to < 0) return;
        state.sources.splice(to, 0, state.sources.splice(from, 1)[0]);
        writeState(node, state);
    });
    card.addEventListener("wheel", (event) => {
        event.preventDefault();
        event.stopPropagation();
        browseCard(node, card, event.deltaY > 0 ? 1 : -1);
    }, { passive: false });
    card.addEventListener("mouseleave", () => {
        if (Number(card.__browse || 0) === 0) return;
        card.__browse = 0;
        const img = card.querySelector(".qqpkg-card-preview img");
        if (img) img.src = thumbnailUrl(card.dataset.reference, 0);
        updateCountBadge(card);
    });
    refreshCardInfo(node, card.dataset.reference, card);
    return card;
}

function countLabel(card) {
    const total = Number(card.count || 0);
    if (!total) return card.classList.contains("is-error") ? "读取失败" : "读取中";
    if (card.dataset.kind !== "archive") return "1 张";
    const browse = Number(card.__browse || 0);
    return browse ? `${browse + 1}/${total}` : `${total} 张`;
}

function updateCountBadge(card) {
    const count = card.querySelector(".qqpkg-card-count");
    if (count) count.textContent = countLabel(card);
}

// 切牌特效：把当前牌面 clone 一份甩出去，同时换上目标图。
function browseCard(node, card, delta) {
    const total = Number(card.count || 0);
    if (total < 2) return;
    const current = Number(card.__browse || 0);
    const next = (current + delta + total) % total;
    if (next === current) return;
    const preview = card.querySelector(".qqpkg-card-preview");
    const img = preview?.querySelector("img");
    if (!preview || !img) return;
    const clone = img.cloneNode(false);
    clone.className = "qqpkg-cut";
    clone.addEventListener("animationend", () => clone.remove());
    preview.append(clone);
    card.__browse = next;
    img.src = thumbnailUrl(card.dataset.reference, next);
    updateCountBadge(card);
}

function fileInputLinked(node) {
    return Boolean(node?.inputs?.some((input) => input.name === FILE_INPUT && input.link != null));
}

// Rotated fan layers stick out of a card by a few dozen pixels. Only clip
// (and scroll) when the row really exceeds the panel; otherwise keep the
// overflow visible so the first/last card fans are not cut at node edges.
function updateListScroll(node) {
    const list = node.__qqPackagePanel?.querySelector(".qqpkg-list");
    if (!list) return;
    const count = parseState(node).sources.length;
    const available = (list.parentElement?.clientWidth || 0) - LIST_INLINE_PADDING * 2;
    const needed = count > 0 ? count * CARD_WIDTH + (count - 1) * CARD_GAP : 0;
    list.classList.toggle("is-scroll", needed > available);
}

function renderPanel(node) {
    const panel = node.__qqPackagePanel;
    if (!panel) return;
    const state = parseState(node);
    const list = panel.querySelector(".qqpkg-list");
    if (!list) return;
    updateListScroll(node);
    list.replaceChildren();
    const oldCards = node.__qqPackageCards || new Map();
    node.__qqPackageCards = new Map();
    state.sources.forEach((source, index) => {
        const card = oldCards.get(source) || createCard(node, source, index + 1);
        card.querySelector(".qqpkg-card-order").textContent = String(index + 1);
        node.__qqPackageCards.set(source, card);
        list.append(card);
    });
    if (!state.sources.length) {
        const empty = document.createElement("div");
        empty.className = "qqpkg-empty";
        empty.textContent = "未选择图片包";
        list.append(empty);
    }
    const linked = panel.querySelector(".qqpkg-linked");
    if (linked) linked.hidden = !fileInputLinked(node);
    updateIndexLimit(node);
}

function panelHtml() {
    const panel = document.createElement("div");
    panel.className = "qqpkg-panel";

    const toolbar = document.createElement("div");
    toolbar.className = "qqpkg-toolbar";
    const title = document.createElement("span");
    title.className = "qqpkg-title";
    title.textContent = "图片包";
    const count = document.createElement("span");
    count.className = "qqpkg-count";
    count.textContent = "0 个来源";
    toolbar.append(
        title,
        count,
        makeButton("上传", "qqpkg-button", () => {
            const input = document.createElement("input");
            input.type = "file";
            input.multiple = true;
            input.accept = ".png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff,.avif,.zip,.cbz,.tar,.gz,.tgz";
            input.addEventListener("change", () => addDroppedFiles(panel.__node, input.files));
            input.click();
        }),
    );

    const linked = document.createElement("div");
    linked.className = "qqpkg-linked";
    linked.hidden = true;
    linked.textContent = "file_path 已接入：执行时优先使用输入路径";

    const list = document.createElement("div");
    list.className = "qqpkg-list";
    const empty = document.createElement("div");
    empty.className = "qqpkg-empty";
    empty.textContent = "未选择图片包";
    list.append(empty);

    const statusLine = document.createElement("div");
    statusLine.className = "qqpkg-status";
    panel.append(toolbar, statusLine, linked, list);
    panel.__node = null;
    return panel;
}

function installStyles() {
    if (document.getElementById("qq-image-package-styles")) return;
    const style = document.createElement("style");
    style.id = "qq-image-package-styles";
    style.textContent = `
.qqpkg-panel{display:flex;flex-direction:column;gap:7px;min-height:${MIN_PANEL_HEIGHT}px;font-size:12px;font-family:inherit;color:#e8e8e8}
.qqpkg-toolbar{display:flex;align-items:center;gap:6px}.qqpkg-title{font-weight:700}.qqpkg-count{opacity:.75;margin-right:auto}
.qqpkg-button,.qqpkg-mini{border:1px solid #4a4a4a;border-radius:5px;background:#2c2c32;color:#eee;cursor:pointer}
.qqpkg-button{padding:3px 8px}.qqpkg-mini{width:20px;height:19px;line-height:1}.qqpkg-button:hover,.qqpkg-mini:hover{background:#3b3b44}.qqpkg-mini.is-remove:hover{background:#642}
.qqpkg-linked{border:1px solid #4b6b55;border-radius:5px;background:#223128;padding:4px 7px;color:#b8e2bd}
.qqpkg-list{display:flex;flex-wrap:nowrap;justify-content:flex-start;align-content:start;gap:12px ${CARD_GAP}px;overflow:visible;box-sizing:border-box;max-height:${MAX_PANEL_HEIGHT - 82}px;min-height:52px;padding:14px ${LIST_INLINE_PADDING}px 29px}.qqpkg-list.is-scroll{overflow-x:auto;overflow-y:hidden;padding-left:${FAN_SPREAD}px;padding-right:${FAN_SPREAD}px}
.qqpkg-card{position:relative;isolation:isolate;box-sizing:border-box;width:100px;flex:0 0 100px;border:1px solid #484850;border-radius:8px;background:#25252b;padding:4px;cursor:grab}.qqpkg-card.is-dragging{opacity:.45}.qqpkg-card.is-error{border-color:#7a3b3b}
.qqpkg-card[data-kind="archive"]{border-color:#64806b}
.qqpkg-fan{position:absolute;inset:0;border:1px solid #5d7862;border-radius:9px;background:linear-gradient(165deg,#2c362e 0%,#202823 60%,#1a211c 100%);box-shadow:0 1px 3px #0009;overflow:hidden;transform-origin:50% 100%;pointer-events:none}
.qqpkg-fan img{width:100%;height:100%;object-fit:cover;display:block}
.qqpkg-fan-2{z-index:-1;transform:rotate(-6deg)}
.qqpkg-fan-3{z-index:-2;transform:rotate(-11deg)}
.qqpkg-card-preview{position:relative;aspect-ratio:3/4;border-radius:5px;background:#17171b;overflow:hidden;display:flex;align-items:center;justify-content:center;color:#888;font-weight:700}
.qqpkg-card-preview img{width:100%;height:100%;object-fit:cover;display:block}
.qqpkg-card-badge{position:absolute;top:8px;left:8px;border-radius:4px;background:#173b21;color:#9be26f;padding:1px 3px;font-size:9px;font-weight:700}
.qqpkg-card-count{position:absolute;top:8px;right:8px;z-index:2;border-radius:4px;background:#25252bd9;padding:1px 3px;font-size:9px}
.qqpkg-card-order{position:absolute;bottom:6px;left:6px;z-index:2;min-width:15px;text-align:center;border-radius:50%;background:#12a46b;color:#04120c;font-size:10px;font-weight:700}
.qqpkg-card-name{position:absolute;left:30px;right:70px;bottom:6px;z-index:2;font-size:10px;font-weight:600;color:#fff;text-shadow:0 1px 2px #000c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0;transition:opacity .15s;pointer-events:none}.qqpkg-card:hover .qqpkg-card-name{opacity:1}
.qqpkg-card-actions{position:absolute;bottom:5px;right:5px;z-index:3;display:flex;gap:2px;opacity:0;transition:.15s}
.qqpkg-card-actions .qqpkg-mini{background:#0000008c;color:#fff;border-color:#ffffff33}.qqpkg-card:hover .qqpkg-card-actions{opacity:1}
.qqpkg-empty{width:100%;display:flex;align-items:center;justify-content:center;min-height:50px;border:1px dashed #46464e;border-radius:8px;color:#8a8a92}
.qqpkg-list{scrollbar-width:thin;scrollbar-color:#777a transparent}.qqpkg-list::-webkit-scrollbar{height:7px}.qqpkg-list::-webkit-scrollbar-track{background:transparent}.qqpkg-list::-webkit-scrollbar-thumb{border-radius:7px;background:#777a}.qqpkg-list::-webkit-scrollbar-thumb:hover{background:#aaa}
.qqpkg-status{min-height:14px;font-size:11px;color:#9a9aa2}.qqpkg-status.is-error{color:#ff8b8b}
.qqpkg-cut{position:absolute;inset:0;z-index:3;width:100%;height:100%;object-fit:cover;border-radius:5px;transform-origin:50% 100%;pointer-events:none;animation:qqpkg-cut .26s ease-in forwards}
@keyframes qqpkg-cut{from{transform:rotate(0deg) translate(0,0);opacity:1}to{transform:rotate(-16deg) translate(-80%,4%);opacity:0}}
`;
    document.head.append(style);
}

async function addDroppedFiles(node, files) {
    const list = Array.from(files || []).filter(acceptedFile);
    if (!list.length) {
        setStatus(node, "只支持图片和 zip/cbz/tar/gz/tgz", true);
        return;
    }
    for (const file of list) {
        try {
            const reference = await uploadOne(file);
            if (node.__qqPackageRemoved) return;
            const state = parseState(node);
            if (!state.sources.includes(reference)) state.sources.push(reference);
            writeState(node, state);
        } catch (error) {
            setStatus(node, `${file.name}: ${error?.message || error}`, true, 9000);
        }
    }
}

function fitNodeHeight(node) {
    try {
    const panel = node.__qqPackagePanel;
    const container = panel?.parentElement;
    if (!panel || !container || typeof node.setSize !== "function") return;
    const sourceCount = parseState(node).sources.length;
    // Measure the live panel instead of guessing box-model math; the fixed
    // height is restored below once the real content height is known.
    panel.style.height = "auto";
    const measured = Math.max(panel.scrollHeight || 0, panel.offsetHeight || 0);
    const panelHeight = measured
        ? Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, measured))
        : (sourceCount ? 225 : MIN_PANEL_HEIGHT);
    if (!measured && typeof requestAnimationFrame === "function"
        && (node.__qqPackageFitRetries = (node.__qqPackageFitRetries || 0) + 1) <= 3) {
        requestAnimationFrame(() => fitNodeHeight(node));
    }
    const widthForSources = sourceCount > 1
        ? 36 + sourceCount * 100 + (sourceCount - 1) * 48
        : MIN_PANEL_WIDTH;
    const width = Math.max(node.size[0], MIN_PANEL_WIDTH, widthForSources);
    node.__qqPackagePanelHeight = panelHeight;
    container.style.height = `${panelHeight}px`;
    panel.style.height = `${panelHeight}px`;
    node.__qqPackageWidget?.computeLayoutSize && (node.__qqPackageWidget.computeLayoutSize = () => ({
        minHeight: panelHeight,
        maxHeight: undefined,
        minWidth: MIN_PANEL_WIDTH,
    }));
    node.__qqPackageWidget?.options && (node.__qqPackageWidget.options.getMinHeight = () => panelHeight);
    const computed = typeof node.computeSize === "function" ? node.computeSize([width, node.size[1]]) : null;
    const height = Math.max(MIN_PANEL_HEIGHT, Number(computed?.[1]) || panelHeight);
    const computedWidth = Math.max(width, Number(computed?.[0]) || 0);
    if (Math.abs(node.size[1] - height) > 1 || Math.abs(node.size[0] - computedWidth) > 1) {
        node.setSize([computedWidth, height]);
    }
    node.setDirtyCanvas?.(true, true);
    } catch {
        // Sizing is best effort; never break panel updates.
    }
}

function installPanel(node) {
    if (!node || node.__qqPackageSetup || typeof node.addDOMWidget !== "function") return;
    node.__qqPackageSetup = true;
    installStyles();
    const stateWidget = widget(node, STATE_WIDGET);
    if (stateWidget) {
        stateWidget.type = "hidden";
        stateWidget.hidden = true;
        stateWidget.computeSize = () => [0, -4];
    }
    const panel = panelHtml();
    panel.__node = node;
    node.__qqPackagePanel = panel;
    panel.addEventListener("dragover", (event) => {
        event.preventDefault();
        panel.classList.add("is-drop-target");
    });
    panel.addEventListener("dragleave", () => panel.classList.remove("is-drop-target"));
    panel.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        panel.classList.remove("is-drop-target");
        // Dropping one of our own cards on the panel background is a reorder
        // gesture, not a file upload.
        const dragged = normalizePath(event.dataTransfer?.getData("text/plain"));
        if (dragged && parseState(node).sources.includes(dragged)) return;
        addDroppedFiles(node, event.dataTransfer?.files || []);
    });
    const panelWidget = node.addDOMWidget("图片包面板", "qqpkg", panel, {
        serialize: false,
        getValue: () => String(widget(node, STATE_WIDGET)?.value || "{\"sources\":[]}"),
        setValue: (value) => {
            const target = widget(node, STATE_WIDGET);
            if (target && typeof value === "string") target.value = value;
            renderPanel(node);
        },
        getMinHeight: () => MIN_PANEL_HEIGHT,
        afterResize: () => {
            node.size = [Math.max(node.size[0], MIN_PANEL_WIDTH), node.size[1]];
        },
    });
    panelWidget.serialize = false;
    node.__qqPackageWidget = panelWidget;
    panelWidget.computeLayoutSize = () => ({
        minHeight: node.__qqPackagePanelHeight || MIN_PANEL_HEIGHT,
        maxHeight: undefined,
        minWidth: MIN_PANEL_WIDTH,
    });
    panelWidget.options.getMinHeight = () => node.__qqPackagePanelHeight || MIN_PANEL_HEIGHT;
    panelWidget.computeSize = (rawWidth) => {
        const width = Number.isFinite(Number(rawWidth)) && Number(rawWidth) > 0 ? Number(rawWidth) : MIN_PANEL_WIDTH;
        // The card strip is one horizontal scrolling row, so the height only
        // follows the measured panel and never grows with the width.
        return [width, node.__qqPackagePanelHeight || MIN_PANEL_HEIGHT];
    };
    renderPanel(node);
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => fitNodeHeight(node));
}

// ---------------- automatic next-image scheduling ----------------

function packageNodes() {
    return (app.graph?._nodes || []).filter((node) => node?.type === NODE_TYPE || node?.comfyClass === NODE_TYPE);
}

const executedPackages = new Map();
const queuedPackages = new Map();
const earlySuccesses = new Map();
const pendingSubmissions = new Set();
let continuationTimer = null;
let continuationGeneration = 0;

function cancelContinuation() {
    continuationGeneration++;
    clearTimeout(continuationTimer);
    continuationTimer = null;
}

function nodeSnapshot(node) {
    return JSON.stringify({
        state: widget(node, STATE_WIDGET)?.value,
        index: Number(widget(node, INDEX_WIDGET)?.value),
        link: node.inputs?.find((input) => input.name === FILE_INPUT)?.link ?? null,
    });
}

function currentNode(record, info) {
    const node = app.graph?.getNodeById?.(info.nodeId);
    const snapshot = record?.nodes.get(String(info.nodeId));
    if (record?.graph !== app.graph || !snapshot || !node || node.__qqPackageRemoved
        || Number(node.mode || 0) !== 0 || nodeSnapshot(node) !== snapshot
        || Number(widget(node, INDEX_WIDGET)?.value) !== Number(info.index)) return null;
    return node;
}

function installAutoQueue() {
    if (globalThis.__qqImagePackageAutoQueue) return;
    globalThis.__qqImagePackageAutoQueue = true;

    // Capture only this browser's submitted graph and exact nodes/cursors.
    const originalQueue = api.queuePrompt;
    api.queuePrompt = async function qqPackageQueue(number, prompt, ...rest) {
        cancelContinuation();
        const graph = app.graph;
        const generation = continuationGeneration;
        const nodes = new Map();
        for (const node of packageNodes()) {
            if (prompt?.output?.[String(node.id)]?.class_type === NODE_TYPE) {
                nodes.set(String(node.id), nodeSnapshot(node));
            }
        }
        const submission = { graph, nodes, generation };
        if (nodes.size) pendingSubmissions.add(submission);
        try {
            const response = await originalQueue.call(this, number, prompt, ...rest);
            const promptId = String(response.prompt_id);
            if (nodes.size && generation === continuationGeneration) {
                queuedPackages.set(promptId, submission);
                while (queuedPackages.size > 50) queuedPackages.delete(queuedPackages.keys().next().value);
                // A small workflow can finish before the HTTP submission resolves.
                if (earlySuccesses.get(promptId) === generation) finishPackagePrompt(promptId);
            }
            return response;
        } finally {
            pendingSubmissions.delete(submission);
            if (!pendingSubmissions.size) earlySuccesses.clear();
        }
    };

    api.addEventListener("executed", (event) => {
        const metadata = event?.detail?.output?.qq_image_package;
        const infos = Array.isArray(metadata) ? metadata : metadata ? [metadata] : [];
        if (!infos.length) return;
        const promptId = String(event?.detail?.prompt_id || "");
        if (!executedPackages.has(promptId)) executedPackages.set(promptId, []);
        for (const info of infos) {
            if (!info || typeof info !== "object") continue;
            executedPackages.get(promptId).push({
                ...info,
                nodeId: String(info.node_id ?? event?.detail?.node ?? ""),
            });
            const node = app.graph?.getNodeById?.(info.node_id ?? event?.detail?.node);
            if (node && queuedPackages.has(promptId)) {
                setStatus(node, `处理中 ${info.index}/${info.total} · ${info.current}`, false, 0);
            }
        }
        if (executedPackages.size > 30) {
            const oldest = executedPackages.keys().next().value;
            executedPackages.delete(oldest);
        }
    });

    function finishPackagePrompt(promptId) {
        const infos = executedPackages.get(promptId) || [];
        const record = queuedPackages.get(promptId);
        if (!record && infos.length && [...pendingSubmissions].some(
            (submission) => submission.generation === continuationGeneration)) {
            earlySuccesses.set(promptId, continuationGeneration);
            while (earlySuccesses.size > 50) earlySuccesses.delete(earlySuccesses.keys().next().value);
            return;
        }
        earlySuccesses.delete(promptId);
        executedPackages.delete(promptId);
        queuedPackages.delete(promptId);
        if (!infos.length || !record || record.generation !== continuationGeneration) return;
        const active = [];
        const seen = new Set();
        let finished = false;
        for (const info of infos) {
            if (seen.has(info.nodeId)) continue;
            seen.add(info.nodeId);
            const node = currentNode(record, info);
            if (!node) continue;
            setStatus(node, `已完成 ${info.index}/${info.total} · ${info.current}`, false, 0);
            if (!widget(node, AUTO_WIDGET)?.value || !info.auto) continue;
            if (Number(info.index) >= Number(info.total)) {
                finished = true;
            }
            active.push({ node, info, next: Number(info.index) >= Number(info.total) ? 1 : Number(info.index) + 1 });
        }
        if (finished || !active.length) return;
        const generation = continuationGeneration;
        continuationTimer = setTimeout(async () => {
            continuationTimer = null;
            try {
                // Do not stack work behind manual queues or another running prompt.
                const response = await api.fetchApi("/queue");
                if (!response.ok) throw new Error("无法读取队列状态");
                const queue = await response.json();
                if (generation !== continuationGeneration) return;
                if ((queue.queue_pending || []).length || (queue.queue_running || []).some(
                    (item) => String(item[1]) !== promptId)) {
                    active.forEach(({node}) => setStatus(node, "已有其他排队任务，自动下一张已停止", false, 0));
                    return;
                }
                if (active.some(({node, info}) => !currentNode(record, info)
                    || !widget(node, AUTO_WIDGET)?.value)) return;
                for (const item of active) {
                    if (Number(item.info.index) >= Number(item.info.total)) return;
                }
                for (const {node, next} of active) {
                    widget(node, INDEX_WIDGET).value = next;
                    node.setDirtyCanvas?.(true, true);
                    setStatus(node, `准备处理第 ${next} 张`, false, 0);
                }
                const queued = await app.queuePrompt(0, 1);
                if (queued === false) active.forEach(({node}) => setStatus(node, "自动排队未成功，请手动运行", true, 0));
            } catch (error) {
                active.forEach(({node}) => setStatus(node, `自动排队失败：${error?.message || error}`, true, 0));
            }
        }, 180);
    }
    api.addEventListener("execution_success", (event) => {
        finishPackagePrompt(String(event?.detail?.prompt_id || ""));
    });

    for (const name of ["execution_interrupted", "execution_error"]) {
        api.addEventListener(name, (event) => {
            const promptId = String(event?.detail?.prompt_id || "");
            if (queuedPackages.has(promptId) || !promptId) cancelContinuation();
            queuedPackages.delete(promptId);
            executedPackages.delete(promptId);
            earlySuccesses.delete(promptId);
        });
    }
    api.addEventListener("graphCleared", () => {
        cancelContinuation();
        queuedPackages.clear();
        executedPackages.clear();
        earlySuccesses.clear();
    });
}

function disposePanel(node) {
    cancelContinuation();
    node.__qqPackageRemoved = true;
    clearTimeout(node.__qqPackageStatusTimer);
    node.__qqPackagePanel?.remove();
    node.__qqPackageCards?.clear();
}

app.registerExtension({
    name: "QQ.ImagePackageLoader",
    beforeConfigureGraph() {
        cancelContinuation();
        queuedPackages.clear();
        executedPackages.clear();
        earlySuccesses.clear();
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_TYPE) return;
        const originalRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function onRemovedPackage() {
            disposePanel(this);
            return originalRemoved?.apply(this, arguments);
        };
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function onNodeCreatedImagePackage() {
            const result = originalCreated?.apply(this, arguments);
            installPanel(this);
            return result;
        };
        const originalConfigured = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function onConfigureImagePackage() {
            const result = originalConfigured?.apply(this, arguments);
            installPanel(this);
            renderPanel(this);
            fitNodeHeight(this);
            return result;
        };
        const originalConnections = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function onConnectionsChangeImagePackage() {
            const result = originalConnections?.apply(this, arguments);
            renderPanel(this);
            return result;
        };
    },
    setup() {
        installStyles();
        installAutoQueue();
    },
});
