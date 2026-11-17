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
        `.lg-node[data-node-id="${node.id}"] .grid-cols-subgrid.justify-between:not(:has(.qq-card)){display:none!important}` +
        `.lg-node[data-node-id="${node.id}"] :has(> [data-testid="node-title"]){display:none!important}` +
        `.lg-node[data-node-id="${node.id}"] :has(> [data-testid="subgraph-enter-button"]){display:none!important}` +
        `.lg-node[data-node-id="${node.id}"] .h-5.w-full.px-2{display:none!important}`;
    document.head.append(style);
}

function unhideNativePreview(node) {
    document.getElementById(`qq-card-hide-${node.id}`)?.remove();
    document.getElementById("qq-card-menu-css")?.remove();
}

function injectMenuCSS() {
    if (document.getElementById("qq-card-menu-css")) return;
    const style = document.createElement("style");
    style.id = "qq-card-menu-css";
    style.textContent =
        ".qq-card-menu{position:fixed;z-index:11500;min-width:150px;display:flex;flex-direction:column;padding:4px;border-radius:8px;border:1px solid var(--border-color,#4b545b);background:var(--comfy-menu-bg,#1a1d23);box-shadow:0 4px 16px rgba(0,0,0,.5)}" +
        ".qq-card-menu button{height:28px;text-align:left;padding:0 10px;border:0;border-radius:5px;background:transparent;color:var(--input-text,#e6e8ee);cursor:pointer;font:12px/1 system-ui,'Microsoft YaHei',sans-serif}" +
        ".qq-card-menu button:hover{background:var(--primary,#4f8cff);color:#fff}" +
        ".qq-card-selbtn{position:fixed;z-index:11450;transform:translateX(-50%);height:30px;padding:0 14px;border:0;border-radius:8px;background:var(--primary,#4f8cff);color:#fff;cursor:pointer;font:600 12px/1 system-ui,'Microsoft YaHei',sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35)}" +
        ".qq-card-selbtn:hover{filter:brightness(1.1)}";
    document.head.append(style);
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
    const surface = createCardSurface(node, { plate: true, onRun: () => app.queuePrompt(0, 1) });
    clearNativePreview(node);
    hideNativePreview(node);
    hideInputWidgets(node);
    if (!node.__qqCardSized) { node.__qqCardSized = true; node.size = [280, 360]; }
    setupCardMenus(node, surface);

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
    const onEnd = async () => {
        surface.exitRunning();
        // 兜底：运行成功后直接从 history 取本卡面（宿主:内部）的输出渲染，
        // 不依赖 executed 事件的 id 格式，确保结果一定呈现。
        try {
            const hist = await (await fetch("/history?max_items=1")).json();
            const outputs = Object.values(hist)[0]?.outputs || {};
            const ui = collectHostUi(outputs);
            if (ui.images.length || ui.videos.length || ui.audio.length) { surface.renderResult(ui); return; }
        } catch { /* 忽略 */ }
        const saved = node.properties.qq_card_ui;
        if (saved && (saved.images?.length || saved.videos?.length || saved.audio?.length)) surface.renderResult(saved);
    };

    // 生成期间的有界兜底：按当前 prompt_id 轮询 history（仅 running 时，非空闲轮询），
    // 防止完成事件未送达导致卡面停在「渲染中」。
    let currentPromptId = null;
    let runWatch = null;
    function collectHostUi(outputs) {
        const ui = { images: [], videos: [], audio: [] };
        for (const [key, value] of Object.entries(outputs || {})) {
            if (key === String(node.id) || key.startsWith(`${node.id}:`)) {
                ui.images.push(...(value.images || []));
                ui.videos.push(...(value.videos || []));
                ui.audio.push(...(value.audio || []));
            }
        }
        return ui;
    }
    function stopRunWatch() { if (runWatch) { clearInterval(runWatch); runWatch = null; } }
    function startRunWatch() {
        if (runWatch) return;
        let tries = 0;
        runWatch = setInterval(async () => {
            if (++tries > 80) { stopRunWatch(); return; } // ~2min 上限
            try {
                const hist = await (await fetch("/history?max_items=4")).json();
                for (const h of Object.values(hist)) {
                    const pid = h?.status?.prompt_id || (Array.isArray(h?.prompt) ? h.prompt[1] : null);
                    if (currentPromptId && pid !== currentPromptId) continue;
                    const ui = collectHostUi(h?.outputs);
                    if (ui.images.length || ui.videos.length || ui.audio.length) {
                        stopRunWatch();
                        surface.exitRunning();
                        surface.renderResult(ui);
                        return;
                    }
                }
            } catch { /* 忽略 */ }
        }, 1500);
    }
    const onStartWatch = (e) => { currentPromptId = e?.detail?.prompt_id || currentPromptId; surface.enterRunning(); startRunWatch(); };
    const onExecutingWatch = (e) => { if (e?.detail?.node != null) { surface.enterRunning(); startRunWatch(); } };
    const onEndWatch = () => stopRunWatch();
    api.addEventListener("executed", onExecuted);
    api.addEventListener("executing", onExecutingWatch);
    api.addEventListener("execution_start", onStartWatch);
    api.addEventListener("execution_success", onEnd);
    api.addEventListener("execution_error", onEnd);
    api.addEventListener("execution_interrupted", onEnd);
    api.addEventListener("execution_success", onEndWatch);
    api.addEventListener("execution_error", onEndWatch);
    api.addEventListener("execution_interrupted", onEndWatch);

    const originalRemoved = node.onRemoved;
    node.onRemoved = function () {
        surface.destroy();
        stopRunWatch();
        unhideNativePreview(node);
        api.removeEventListener?.("executed", onExecuted);
        api.removeEventListener?.("executing", onExecutingWatch);
        api.removeEventListener?.("execution_start", onStartWatch);
        api.removeEventListener?.("execution_success", onEnd);
        api.removeEventListener?.("execution_error", onEnd);
        api.removeEventListener?.("execution_interrupted", onEnd);
        api.removeEventListener?.("execution_success", onEndWatch);
        api.removeEventListener?.("execution_error", onEndWatch);
        api.removeEventListener?.("execution_interrupted", onEndWatch);
        return originalRemoved?.apply(this, arguments);
    };

    node.addDOMWidget("qq_card_mode", "qq_card_mode", surface.root, {
        serialize: false, hideOnZoom: false, margin: 0,
        getMinHeight: () => Math.max(140, (node.size?.[1] || 360) - 10),
    });
    node.resizable = true;
    node.__qqCardSurface = surface;
}

// ── 选区浮动「卡面模式」按钮：不依赖前端菜单集成，选区出现即显示 ──
let selBtn = null;
function updateSelectionButton() {
    const nodes = selectedNodes();
    const toolbox = document.querySelector('[data-testid="selection-toolbox"]');
    if (!nodes.length || !toolbox) { selBtn?.remove(); selBtn = null; return; }
    if (!selBtn) {
        selBtn = document.createElement("button");
        selBtn.className = "qq-card-selbtn";
        selBtn.textContent = "卡面模式";
        selBtn.addEventListener("click", (e) => { e.stopPropagation(); convertSelectionToCard(); });
        document.body.append(selBtn);
    }
    // 贴着原生选区工具栏右侧，保证可见
    const r = toolbox.getBoundingClientRect();
    selBtn.style.left = `${r.right + 8}px`;
    selBtn.style.top = `${r.top + (r.height - 30) / 2}px`;
    selBtn.style.transform = "none";
}

function installSelectionButton() {
    const el = document.querySelector("#vue-app") || document.querySelector("[data-v-app]");
    const pinia = el?.__vue_app__?.config?.globalProperties?.$pinia;
    if (pinia && !pinia.__qqSelBtn) {
        pinia.__qqSelBtn = true;
        for (const name of ["canvas", "selection"]) {
            const store = pinia._s.get(name);
            store?.$subscribe?.(() => updateSelectionButton());
        }
    }
    const canvas = app.canvas;
    if (canvas && !canvas.__qqSelBtnHooked) {
        canvas.__qqSelBtnHooked = true;
        const orig = canvas.onSelectionChange;
        canvas.onSelectionChange = function () {
            const r = orig?.apply(this, arguments);
            updateSelectionButton();
            return r;
        };
    }
    // 工具栏出现/消失时同步按钮（Vue 重渲染兜底）
    if (!window.__qqSelBtnObs) {
        window.__qqSelBtnObs = true;
        let raf = 0;
        const obs = new MutationObserver(() => {
            if (raf) return;
            raf = requestAnimationFrame(() => { raf = 0; updateSelectionButton(); });
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }
    updateSelectionButton();
}

// ── 菜单：右键原生上下文 + 双击自定义选项（卡面无文字按钮，操作只走菜单） ──
function cardMenuItems(node, surface) {
    return [
        { label: "运行", action: () => app.queuePrompt(0, 1) },
        {
            label: node.properties?.qqPinned ? "解除固定媒体" : "固定媒体信息",
            action: () => togglePin(node, surface),
        },
        { label: "进入子图编辑", action: () => enterSubgraph(node) },
        { label: "取消卡面模式", action: () => unpackCard(node) },
    ];
}

function showCardMenu(node, surface, clientX, clientY) {
    if (node.properties?.qqLocked) return; // 锁定为媒体源时禁止操作
    document.querySelector(".qq-card-menu")?.remove();
    const menu = document.createElement("div");
    menu.className = "qq-card-menu";
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    for (const item of cardMenuItems(node, surface)) {
        const button = document.createElement("button");
        button.textContent = item.label;
        button.addEventListener("click", (e) => {
            e.stopPropagation();
            menu.remove();
            item.action();
        });
        menu.append(button);
    }
    const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("pointerdown", close); } };
    setTimeout(() => document.addEventListener("pointerdown", close), 0);
    document.body.append(menu);
}

function setupCardMenus(node, surface) {
    const originalMenu = node.getExtraMenuOptions;
    node.getExtraMenuOptions = function (_, options) {
        const result = originalMenu?.apply(this, arguments);
        if (!node.properties?.qqLocked) {
            for (const item of cardMenuItems(node, surface)) {
                options.push({ content: item.label, callback: item.action });
            }
        }
        return result ?? options;
    };
    const originalDblClick = node.onDblClick;
    node.onDblClick = function (e, pos, canvas) {
        if (node.properties?.qqLocked) return true;
        showCardMenu(node, surface, e?.clientX ?? 200, e?.clientY ?? 200);
        return true; // 阻止默认进入子图
    };
    // Vue 子图双击不经过 onDblClick，直接在卡面根元素拦截
    surface.root.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (node.properties?.qqLocked) return;
        showCardMenu(node, surface, e.clientX, e.clientY);
    }, true);
}

function enterSubgraph(node) {
    try {
        const el = document.querySelector("#vue-app") || document.querySelector("[data-v-app]");
        const nav = el?.__vue_app__?.config?.globalProperties?.$pinia?._s?.get("subgraphNavigation");
        if (nav?.enterSubgraph) { nav.enterSubgraph(node); return; }
    } catch { /* 忽略 */ }
    node.subgraph && app.canvas?.openSubgraph?.(node);
}

function unpackCard(node) {
    try {
        const el = document.querySelector("#vue-app") || document.querySelector("[data-v-app]");
        const cs = el?.__vue_app__?.config?.globalProperties?.$pinia?._s?.get("command");
        app.canvas?.selectItems?.([node]);
        cs?.execute?.("Comfy.Graph.UnpackSubgraph");
    } catch { /* 忽略 */ }
}

// ── 固定媒体信息：快照结果→注入加载器→暴露输出口；接上即锁定，断开恢复 ──
function pickMedia(ui) {
    if (ui?.videos?.length) return { kind: "video", item: ui.videos[0] };
    if (ui?.audio?.length) return { kind: "audio", item: ui.audio[0] };
    if (ui?.images?.length) return { kind: "image", item: ui.images[0] };
    return null;
}

async function togglePin(node, surface) {
    if (node.properties?.qqPinned) { unpin(node); return; }
    const media = pickMedia(node.properties?.qq_card_ui);
    if (!media) { console.warn("[QQ-卡面] 先运行得到结果，再固定媒体"); return; }
    let data;
    try {
        const res = await fetch("/qq_card/pin", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(media.item),
        });
        data = await res.json();
    } catch { return; }
    if (!data?.name) return;

    const type = media.kind === "video" ? "VIDEO" : media.kind === "audio" ? "AUDIO" : "IMAGE";
    const loaderType = media.kind === "video" ? "LoadVideo" : media.kind === "audio" ? "LoadAudio" : "LoadImage";
    const inner = node.subgraph;
    if (!inner) return;
    inner.addOutput("固定媒体", type);
    const loader = LiteGraph.createNode(loaderType);
    loader.properties = { qqPinnedLoader: true };
    inner.add(loader);
    const wname = media.kind === "video" ? "video" : media.kind === "audio" ? "audio" : "image";
    const lw = (loader.widgets || []).find((x) => x.name === wname);
    if (lw) lw.value = data.name;
    await new Promise((r) => setTimeout(r, 300));
    const slot = (node.outputs || []).findIndex((o) => o.name === "固定媒体");
    // 子图虚拟输出口接线：outputNode.slots[i].connect(源输出slot, 源节点)
    const outNode = inner.outputNode;
    if (outNode && slot >= 0 && outNode.slots?.[slot]) {
        outNode.slots[slot].connect(loader.outputs[0], loader);
    }

    node.properties.qqPinned = { kind: media.kind, name: data.name, type };
    watchLock(node);
    node.setDirtyCanvas?.(true, true);
}

function unpin(node) {
    const inner = node.subgraph;
    if (inner) {
        for (const n of [...(inner._nodes || [])]) {
            if (n.properties?.qqPinnedLoader) inner.remove(n);
        }
        const slot = (node.outputs || []).findIndex((o) => o.name === "固定媒体");
        if (slot >= 0) node.removeOutput(slot);
    }
    delete node.properties.qqPinned;
    node.properties.qqLocked = false;
    node.setDirtyCanvas?.(true, true);
}

function updateLock(node) {
    if (!node.properties?.qqPinned) { node.properties.qqLocked = false; return; }
    const out = (node.outputs || []).find((o) => o.name === "固定媒体");
    node.properties.qqLocked = !!(out && out.links && out.links.length);
    node.setDirtyCanvas?.(true, true);
}

function watchLock(node) {
    if (node.__qqLockWatched) { updateLock(node); return; }
    node.__qqLockWatched = true;
    const orig = node.onConnectionsChange;
    node.onConnectionsChange = function () {
        const r = orig?.apply(this, arguments);
        updateLock(node);
        return r;
    };
    updateLock(node);
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
    setup() { injectCardCSS(); injectMenuCSS(); installSelectionButton(); setTimeout(installSelectionButton, 500); setTimeout(installSelectionButton, 1500); },
    commands: [
        {
            id: COMMAND_ID,
            label: "卡面模式",
            icon: "icon-[lucide--layout-panel-top]",
            function: convertSelectionToCard,
        },
    ],
    menuCommands: [
        { menuPath: ["Extensions"], commands: [COMMAND_ID] },
        { menuPath: ["Extensions", "QQ"], commands: [COMMAND_ID] },
    ],
    getSelectionToolboxCommands() {
        return selectedNodes().length ? [COMMAND_ID] : [];
    },
    // 右键菜单（选区/节点/画布）加入「卡面模式」，保证用户可见
    getNodeMenuItems() {
        return selectedNodes().length ? [{ content: "卡面模式", callback: convertSelectionToCard }] : [];
    },
    getCanvasMenuItems() {
        return selectedNodes().length ? [{ content: "卡面模式", callback: convertSelectionToCard }] : [];
    },
    // 读档恢复：子图节点带 qqCardMode 标记时重新附着卡面
    nodeCreated(node) {
        if (node?.properties?.qqCardMode) attachCard(node);
        else queueMicrotask(() => { if (node?.properties?.qqCardMode) attachCard(node); });
    },
});
