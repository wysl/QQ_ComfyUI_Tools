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
const MIN_PANEL_HEIGHT = 170;
const MAX_PANEL_HEIGHT = 700;
const THUMB_EDGE = 256;

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
    const form = new FormData();
    form.append("image", file, String(file?.name || "package"));
    form.append("type", "input");
    form.append("subfolder", "qq_image_packages");
    const response = await api.fetchApi("/upload/image", { method: "POST", body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    const name = String(data?.name || data?.filename || "").trim();
    if (!name) throw new Error("上传接口没有返回文件名");
    const folder = String(data?.subfolder || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    return normalizePath(folder ? `${folder}/${name}` : name);
}

function makeFan(source, layer, index) {
    const fan = document.createElement("div");
    fan.className = `qqpkg-fan qqpkg-fan-${layer}`;
    const fanImage = document.createElement("img");
    fanImage.alt = "";
    fanImage.loading = "lazy";
    fanImage.decoding = "async";
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
    const state = parseState(node);
    const cards = node.__qqPackageCards || new Map();
    let total = 0;
    for (const source of state.sources) total += Number(cards.get(source)?.count || 0);
    node.__qqPackageTotal = total;
    const index = widget(node, INDEX_WIDGET);
    if (index) {
        index.options ||= {};
        index.options.max = fileInputLinked(node) ? 20000 : Math.max(1, total);
    }
    const counter = node.__qqPackagePanel?.querySelector(".qqpkg-count");
    if (counter) counter.textContent = `${state.sources.length} 个来源 / ${total || "?"} 张`;
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
        const count = card.querySelector(".qqpkg-card-count");
        if (count) count.textContent = data.kind === "archive" ? `${card.count} 张` : "1 张";
        const name = card.querySelector(".qqpkg-card-name");
        if (name) {
            name.textContent = String(data.name || sourceName(source));
            name.title = normalizePath(source);
        }
        const first = card.querySelector(".qqpkg-card-first");
        if (first) first.textContent = data.kind === "archive" ? `首图：${data.first || ""}` : "";
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

function moveSource(node, source, offset) {
    const state = parseState(node);
    const index = state.sources.indexOf(source);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= state.sources.length) return;
    state.sources.splice(target, 0, state.sources.splice(index, 1)[0]);
    writeState(node, state);
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

    const body = document.createElement("div");
    body.className = "qqpkg-card-body";
    const name = document.createElement("div");
    name.className = "qqpkg-card-name";
    name.textContent = sourceName(source);
    name.title = normalizePath(source);
    const first = document.createElement("div");
    first.className = "qqpkg-card-first";
    body.append(name, first);
    const actions = document.createElement("div");
    actions.className = "qqpkg-card-actions";
    actions.append(
        makeButton("↑", "qqpkg-mini", () => moveSource(node, card.dataset.reference, -1), "上移"),
        makeButton("↓", "qqpkg-mini", () => moveSource(node, card.dataset.reference, 1), "下移"),
        makeButton("×", "qqpkg-mini is-remove", () => {
            const state = parseState(node);
            state.sources = state.sources.filter((item) => item !== card.dataset.reference);
            writeState(node, state);
        }, "移除"),
    );

    card.append(fan3, fan2, preview, badge, count, orderEl, body, actions);
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
    refreshCardInfo(node, card.dataset.reference, card);
    return card;
}

function fileInputLinked(node) {
    return Boolean(node?.inputs?.some((input) => input.name === FILE_INPUT && input.link != null));
}

function renderPanel(node) {
    const panel = node.__qqPackagePanel;
    if (!panel) return;
    const state = parseState(node);
    const list = panel.querySelector(".qqpkg-list");
    if (!list) return;
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
        makeButton("选择", "qqpkg-button", (event) => {
            const node = event.target?.closest(".qqpkg-panel")?.__node;
            if (node) openModal(node);
        }),
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

    const statusEl = document.createElement("div");
    statusEl.className = "qqpkg-status";
    const controls = document.createElement("div");
    controls.className = "qqpkg-toolbar";
    controls.append(
        makeButton("停止自动", "qqpkg-button", () => {
            cancelContinuation();
            const node = panel.__node;
            const auto = widget(node, AUTO_WIDGET);
            if (auto) auto.value = false;
            node?.setDirtyCanvas?.(true, true);
            setStatus(node, "已停止自动排队；当前任务会继续完成", false, 0);
        }),
        makeButton("回到首张", "qqpkg-button", () => {
            cancelContinuation();
            const node = panel.__node;
            const index = widget(node, INDEX_WIDGET);
            if (index) index.value = 1;
            node?.setDirtyCanvas?.(true, true);
            setStatus(node, "已回到首张，点击运行开始", false, 0);
        }),
    );
    panel.append(toolbar, linked, list, controls, statusEl);
    panel.__node = null;
    return panel;
}

function installStyles() {
    if (document.getElementById("qq-image-package-styles")) return;
    const style = document.createElement("style");
    style.id = "qq-image-package-styles";
    style.textContent = `
.qqpkg-panel{display:flex;flex-direction:column;gap:7px;min-height:${MIN_PANEL_HEIGHT}px;font:12px inherit;color:#e8e8e8}
.qqpkg-toolbar{display:flex;align-items:center;gap:6px}.qqpkg-title{font-weight:700}.qqpkg-count{opacity:.75;margin-right:auto}
.qqpkg-button,.qqpkg-mini{border:1px solid #4a4a4a;border-radius:5px;background:#2c2c32;color:#eee;cursor:pointer}
.qqpkg-button{padding:4px 9px}.qqpkg-mini{width:20px;height:19px;line-height:1}.qqpkg-button:hover,.qqpkg-mini:hover{background:#3b3b44}.qqpkg-mini.is-remove:hover{background:#642}
.qqpkg-linked{border:1px solid #4b6b55;border-radius:5px;background:#223128;padding:4px 7px;color:#b8e2bd}
.qqpkg-list{display:grid;grid-template-columns:minmax(96px,116px);justify-content:center;gap:14px;overflow:auto;max-height:${MAX_PANEL_HEIGHT - 82}px;min-height:64px;padding:14px 8px 8px}
.qqpkg-card{position:relative;border:1px solid #484850;border-radius:8px;background:#25252b;padding:4px;cursor:grab}.qqpkg-card.is-dragging{opacity:.45}.qqpkg-card.is-error{border-color:#7a3b3b}
.qqpkg-card[data-kind="archive"]{border-color:#64806b}
.qqpkg-fan{position:absolute;inset:0;border:1px solid #5d7862;border-radius:9px;background:linear-gradient(165deg,#2c362e 0%,#202823 60%,#1a211c 100%);box-shadow:0 1px 3px #0009;overflow:hidden;transform-origin:50% 100%;pointer-events:none}
.qqpkg-fan img{width:100%;height:100%;object-fit:cover;display:block}
.qqpkg-fan-2{z-index:-1;transform:rotate(-10deg)}
.qqpkg-fan-3{z-index:-2;transform:rotate(-19deg)}
.qqpkg-card-preview{position:relative;aspect-ratio:3/4;border-radius:5px;background:#17171b;overflow:hidden;display:flex;align-items:center;justify-content:center;color:#888;font-weight:700}
.qqpkg-card-preview img{width:100%;height:100%;object-fit:cover;display:block}
.qqpkg-card-badge{position:absolute;top:8px;left:8px;border-radius:4px;background:#173b21;color:#9be26f;padding:1px 4px;font-size:10px;font-weight:700}
.qqpkg-card-count{position:absolute;top:8px;right:8px;border-radius:4px;background:#25252bd9;padding:1px 4px;font-size:10px}
.qqpkg-card-order{position:absolute;bottom:31px;right:8px;min-width:15px;text-align:center;border-radius:50%;background:#12a46b;color:#04120c;font-size:10px;font-weight:700}
.qqpkg-card-body{margin-top:4px;min-height:27px}.qqpkg-card-name{font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.qqpkg-card-first{opacity:.62;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qqpkg-card-actions{position:absolute;bottom:5px;right:5px;display:flex;gap:2px;opacity:.15;transition:.15s}.qqpkg-card:hover .qqpkg-card-actions{opacity:1}
.qqpkg-empty{grid-column:1/-1;display:flex;align-items:center;justify-content:center;min-height:92px;border:1px dashed #46464e;border-radius:8px;color:#8a8a92}
.qqpkg-status{min-height:14px;font-size:11px;color:#9a9aa2}.qqpkg-status.is-error{color:#ff8b8b}
.qqpkg-modal{position:fixed;inset:0;background:#000000c9;z-index:1000;display:flex;align-items:center;justify-content:center;padding:28px}
.qqpkg-dialog{width:min(1000px,92vw);height:min(720px,88vh);border:1px solid #4b4b55;border-radius:10px;background:#1b1b20;display:flex;flex-direction:column;color:#eee}
.qqpkg-modal-head{display:flex;gap:7px;align-items:center;padding:11px;border-bottom:1px solid #3a3a44}.qqpkg-modal-title{font-weight:700;margin-right:auto}
.qqpkg-modal-body{flex:1;overflow:auto;padding:11px;display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:9px;align-content:start}
.qqpkg-folder{border:1px solid #45454f;background:#24242b;color:#cfd5cf;padding:11px 7px;text-align:center;border-radius:8px;cursor:pointer}
.qqpkg-file{border:1px solid #45454f;background:#24242b;border-radius:8px;padding:6px;text-align:left;cursor:pointer}.qqpkg-file:hover{border-color:#67a575}
.qqpkg-file-preview{aspect-ratio:3/4;background:#161619;border-radius:5px;display:flex;align-items:center;justify-content:center;color:#8b8b93;overflow:hidden}.qqpkg-file-preview img{width:100%;height:100%;object-fit:cover}
.qqpkg-file-name{margin-top:5px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.qqpkg-file-size{opacity:.65;font-size:10px}
.qqpkg-modal-foot{padding:9px 11px;border-top:1px solid #3a3a44;display:flex;gap:7px;align-items:center}.qqpkg-modal-status{margin-right:auto;font-size:11px;color:#a5a5ad}
`;
    document.head.append(style);
}

async function loadFolder(node, source, folder) {
    const body = node.__qqPackageModal?.querySelector(".qqpkg-modal-body");
    const stateEl = node.__qqPackageModal?.querySelector(".qqpkg-modal-status");
    if (!body) return;
    body.replaceChildren();
    if (stateEl) stateEl.textContent = "读取中…";
    try {
        const query = new URLSearchParams({ source, folder });
        const response = await api.fetchApi(`/qq_image_packages/list?${query}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
        node.__qqPackageFolder = normalizePath(data.folder);
        node.__qqPackageSource = data.source;
        for (const item of data.folders) {
            const element = document.createElement("button");
            element.type = "button";
            element.className = "qqpkg-folder";
            element.textContent = `📁 ${item.name}`;
            element.addEventListener("click", () => loadFolder(node, source, item.path));
            body.append(element);
        }
        if (data.folder) {
            const up = document.createElement("button");
            up.type = "button";
            up.className = "qqpkg-folder";
            up.textContent = "⬅ 上一级";
            up.addEventListener("click", () => {
                const parent = normalizePath(node.__qqPackageFolder).split("/").slice(0, -1).join("/");
                loadFolder(node, source, parent);
            });
            body.prepend(up);
        }
        const state = parseState(node);
        for (const item of data.files) {
            const element = document.createElement("button");
            element.type = "button";
            element.className = "qqpkg-file";
            const preview = document.createElement("div");
            preview.className = "qqpkg-file-preview";
            if (item.kind === "image") {
                const img = document.createElement("img");
                img.loading = "lazy";
                img.src = thumbnailUrl(item.path);
                preview.append(img);
            } else {
                preview.textContent = item.name.toLowerCase().endsWith(".cbz") ? "CBZ" : "PACK";
            }
            const name = document.createElement("div");
            name.className = "qqpkg-file-name";
            name.textContent = item.name;
            const size = document.createElement("div");
            size.className = "qqpkg-file-size";
            size.textContent = `${(item.size / 1024 / 1024).toFixed(2)} MB`;
            element.append(preview, name, size);
            element.addEventListener("click", () => {
                const current = parseState(node);
                if (!current.sources.includes(item.path)) current.sources.push(item.path);
                writeState(node, current);
                if (stateEl) stateEl.textContent = `已添加：${item.name}`;
            });
            if (state.sources.includes(item.path)) element.classList.add("is-selected");
            body.append(element);
        }
        if (stateEl) stateEl.textContent = `${data.files.length} 个可用文件`;
    } catch (error) {
        if (stateEl) stateEl.textContent = String(error?.message || error);
    }
}

function openModal(node) {
    closeModal(node);
    const modal = document.createElement("div");
    modal.className = "qqpkg-modal";
    const dialog = document.createElement("div");
    dialog.className = "qqpkg-dialog";
    const head = document.createElement("div");
    head.className = "qqpkg-modal-head";
    const title = document.createElement("span");
    title.className = "qqpkg-modal-title";
    title.textContent = "选择图片 / 图片包";
    const inputButton = makeButton("Input", "qqpkg-button", () => loadFolder(node, "input", ""));
    const outputButton = makeButton("Output", "qqpkg-button", () => loadFolder(node, "output", ""));
    const close = makeButton("关闭", "qqpkg-button", () => closeModal(node));
    head.append(title, inputButton, outputButton, close);
    const body = document.createElement("div");
    body.className = "qqpkg-modal-body";
    const foot = document.createElement("div");
    foot.className = "qqpkg-modal-foot";
    const statusEl = document.createElement("span");
    statusEl.className = "qqpkg-modal-status";
    foot.append(statusEl, makeButton("完成", "qqpkg-button", () => closeModal(node)));
    dialog.append(head, body, foot);
    modal.append(dialog);
    modal.addEventListener("click", (event) => {
        if (event.target === modal) closeModal(node);
    });
    document.body.append(modal);
    node.__qqPackageModal = modal;
    loadFolder(node, "input", "");
}

function closeModal(node) {
    node?.__qqPackageModal?.remove?.();
    if (node) node.__qqPackageModal = null;
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
    panelWidget.computeSize = (width) => [width, Math.min(MAX_PANEL_HEIGHT,
        Math.min(MAX_PANEL_HEIGHT, parseState(node).sources.length
            ? 120 + parseState(node).sources.length * 215
            : MIN_PANEL_HEIGHT))];
    renderPanel(node);
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
    closeModal(node);
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
        for (const node of packageNodes()) closeModal(node);
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
