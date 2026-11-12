import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// QQ-图像对比 的前端。
//
// 原版 rgthree Image Comparer 用 LiteGraph 画布控件（addCustomWidget + draw）绘制，
// 这种控件在 ComfyUI「Nodes 2.0」（Vue 渲染）里不显示。这里改用 addDOMWidget（HTML），
// 它在 1.0 / 2.0 两种渲染下都工作。预览逻辑保持一致：
//   滑动（Slide）：鼠标在画面上左右移动，B 图随光标揭开，露出下面的 A 图；
//   点击（Click）：点按在 A / B 间切换；
//   两侧任一是多张时，顶部出现 A1/A2/B1/B2 标签，点选要对比的两张。
//
// 预览图来自执行结果（a_images / b_images），元数据存进 node.properties，
// 重新打开工作流时能恢复上一次的画面（临时文件还在的话）。

const NODE_TYPE = "QQImageComparer";
const MIN_HEIGHT = 160;
const MIN_WIDTH = 220;
const MODE_SLIDE = "Slide";
const MODE_CLICK = "Click";

const CSS = `
.qq-compare{box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:4px;
  padding:4px;background:var(--comfy-menu-bg,#1e2128);color:var(--input-text,#e6e8ee);
  border-radius:6px;overflow:hidden;font:12px/1.35 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.qq-compare *{box-sizing:border-box}
.qq-compare-bar{flex:0 0 auto;display:flex;align-items:center;gap:6px}
.qq-compare-mode{flex:0 0 auto;height:22px;padding:0 9px;border-radius:4px;
  border:1px solid var(--border-color,#39404d);background:var(--comfy-input-bg,#12141a);
  color:inherit;font:inherit;cursor:pointer}
.qq-compare-mode:hover{border-color:#4f8cff;color:#8fb9d9}
.qq-compare-labels{flex:1 1 auto;display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end;min-width:0}
.qq-compare-label{height:20px;padding:0 7px;border-radius:4px;border:1px solid var(--border-color,#39404d);
  background:var(--comfy-input-bg,#12141a);color:var(--descrip-text,#96a0b0);font:inherit;cursor:pointer}
.qq-compare-label:hover{border-color:#4f8cff}
.qq-compare-label[data-on="1"]{border-color:#4f8cff;color:#8fb9d9;background:rgba(79,140,255,.14)}
.qq-compare-stage{position:relative;flex:1 1 auto;min-height:0;overflow:hidden;border-radius:4px;
  background:var(--comfy-input-bg,#12141a)}
.qq-compare-stage[data-mode="Slide"]{cursor:ew-resize}
.qq-compare-stage[data-mode="Click"]{cursor:pointer}
.qq-compare-stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;
  user-select:none;-webkit-user-drag:none;pointer-events:none}
.qq-compare-divider{position:absolute;top:0;bottom:0;width:2px;background:#fff;
  box-shadow:0 0 5px rgba(0,0,0,.7);pointer-events:none;transform:translateX(-1px);display:none}
.qq-compare-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  text-align:center;color:var(--descrip-text,#96a0b0);padding:10px;line-height:1.6}
`;

function injectCSS() {
    if (document.getElementById("qq-compare-css")) return;
    const style = document.createElement("style");
    style.id = "qq-compare-css";
    style.textContent = CSS;
    document.head.append(style);
}

function imageDataToUrl(data) {
    return api.apiURL(
        `/view?filename=${encodeURIComponent(data.filename)}&type=${data.type}`
        + `&subfolder=${data.subfolder || ""}${app.getPreviewFormatParam()}${app.getRandParam()}`,
    );
}

/** 把执行结果整理成带 A/B 名字的预览图列表（命名规则与原版一致）。 */
export function buildComparerImages(output) {
    const aImages = output?.a_images || [];
    const bImages = output?.b_images || [];
    const multiple = aImages.length + bImages.length > 2;
    const images = [];
    aImages.forEach((data, index) => {
        images.push({
            name: aImages.length > 1 || multiple ? `A${index + 1}` : "A",
            side: "A", url: imageDataToUrl(data),
        });
    });
    bImages.forEach((data, index) => {
        images.push({
            name: bImages.length > 1 || multiple ? `B${index + 1}` : "B",
            side: "B", url: imageDataToUrl(data),
        });
    });
    return images;
}

/** 默认对比哪两张：两侧都有取各自第一张；只有一侧且是多张时取前两张。 */
export function defaultSelection(images) {
    const a = images.map((img, i) => ({ img, i })).filter((x) => x.img.side === "A");
    const b = images.map((img, i) => ({ img, i })).filter((x) => x.img.side === "B");
    if (a.length && b.length) return [a[0].i, b[0].i];
    if (a.length >= 2) return [a[0].i, a[1].i];
    if (b.length >= 2) return [b[0].i, b[1].i];
    return [0, 0];
}

function setup(node) {
    if (!node || node.__qqCompareSetup) return;
    node.__qqCompareSetup = true;
    injectCSS();

    node.properties ||= {};
    if (!node.properties.comparer_mode) node.properties.comparer_mode = MODE_SLIDE;

    const state = {
        images: [], aSlot: 0, bSlot: 0,
        over: false, pct: 50, clickShowB: false,
    };
    node.__qqCompare = state;

    const root = document.createElement("div");
    root.className = "qq-compare";

    const bar = document.createElement("div");
    bar.className = "qq-compare-bar";
    const modeBtn = document.createElement("button");
    modeBtn.type = "button";
    modeBtn.className = "qq-compare-mode";
    const labels = document.createElement("div");
    labels.className = "qq-compare-labels";
    bar.append(modeBtn, labels);

    const stage = document.createElement("div");
    stage.className = "qq-compare-stage";
    const imgA = document.createElement("img");
    imgA.alt = "A";
    const imgB = document.createElement("img");
    imgB.alt = "B";
    const divider = document.createElement("div");
    divider.className = "qq-compare-divider";
    const empty = document.createElement("div");
    empty.className = "qq-compare-empty";
    empty.textContent = "运行后在此对比两张图\n接 image_a / image_b";
    stage.append(imgA, imgB, divider, empty);

    root.append(bar, stage);

    const widget = node.addDOMWidget("qq_compare", "qq_compare", root, {
        serialize: false,
        hideOnZoom: false,
        margin: 4,
        getMinHeight: () => MIN_HEIGHT,
    });
    if (widget) {
        widget.serialize = false;
        widget.computeLayoutSize = () => ({
            minHeight: MIN_HEIGHT, maxHeight: undefined, minWidth: MIN_WIDTH,
        });
    }
    if ((Number(node.size?.[0]) || 0) < MIN_WIDTH) {
        node.setSize?.([Math.max(MIN_WIDTH, 320), Math.max(MIN_HEIGHT + 60, 320)]);
    }

    function mode() {
        return node.properties.comparer_mode === MODE_CLICK ? MODE_CLICK : MODE_SLIDE;
    }

    function applyView() {
        const current = mode();
        stage.dataset.mode = current;
        modeBtn.textContent = current === MODE_CLICK ? "对比：点击" : "对比：滑动";
        modeBtn.title = current === MODE_CLICK
            ? "点击模式：点按画面在 A / B 间切换（点我切到滑动）"
            : "滑动模式：鼠标左右移动揭开 B 图（点我切到点击）";
        const hasImages = state.images.length > 0;
        empty.style.display = hasImages ? "none" : "flex";
        if (!hasImages) {
            imgA.removeAttribute("src");
            imgB.removeAttribute("src");
            divider.style.display = "none";
            return;
        }
        if (current === MODE_CLICK) {
            imgB.style.clipPath = state.clickShowB ? "inset(0 0 0 0)" : "inset(0 100% 0 0)";
            divider.style.display = "none";
        } else if (state.over) {
            imgB.style.clipPath = `inset(0 ${100 - state.pct}% 0 0)`;
            divider.style.left = `${state.pct}%`;
            divider.style.display = "block";
        } else {
            imgB.style.clipPath = "inset(0 100% 0 0)";
            divider.style.display = "none";
        }
    }

    function loadSelection() {
        const a = state.images[state.aSlot];
        const b = state.images[state.bSlot];
        if (a && imgA.dataset.url !== a.url) { imgA.src = a.url; imgA.dataset.url = a.url; }
        if (b && imgB.dataset.url !== b.url) { imgB.src = b.url; imgB.dataset.url = b.url; }
    }

    function renderLabels() {
        labels.replaceChildren();
        if (state.images.length <= 2) return;
        state.images.forEach((img, index) => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "qq-compare-label";
            chip.textContent = img.name;
            chip.title = img.url;
            const on = index === state.aSlot || index === state.bSlot;
            chip.dataset.on = on ? "1" : "0";
            chip.addEventListener("click", (event) => {
                event.stopPropagation();
                if (img.name.startsWith("A")) state.aSlot = index;
                else state.bSlot = index;
                loadSelection();
                renderLabels();
                applyView();
                node.setDirtyCanvas?.(true, true);
            });
            labels.append(chip);
        });
    }

    function render() {
        loadSelection();
        renderLabels();
        applyView();
    }
    node.__qqCompareRender = render;

    function setImages(images, keepSelection) {
        state.images = images;
        if (!keepSelection || state.aSlot >= images.length || state.bSlot >= images.length) {
            [state.aSlot, state.bSlot] = defaultSelection(images);
        }
        state.clickShowB = false;
        render();
    }

    modeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        node.properties.comparer_mode = mode() === MODE_CLICK ? MODE_SLIDE : MODE_CLICK;
        state.clickShowB = false;
        applyView();
        node.setDirtyCanvas?.(true, true);
    });

    function updateSlide(event) {
        const rect = stage.getBoundingClientRect();
        if (!rect.width) return;
        state.pct = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
        applyView();
    }
    stage.addEventListener("pointerenter", (event) => {
        state.over = true;
        if (mode() === MODE_SLIDE) updateSlide(event);
    });
    stage.addEventListener("pointermove", (event) => {
        if (mode() === MODE_SLIDE) { state.over = true; updateSlide(event); }
    });
    stage.addEventListener("pointerleave", () => {
        state.over = false;
        applyView();
    });
    stage.addEventListener("click", (event) => {
        if (mode() !== MODE_CLICK) return;
        event.stopPropagation();
        state.clickShowB = !state.clickShowB;
        applyView();
    });

    // 执行结果 → 预览图
    const originalExecuted = node.onExecuted;
    node.onExecuted = function onExecutedComparer(output) {
        originalExecuted?.apply(this, arguments);
        const images = buildComparerImages(output);
        node.properties.qq_compare_images = images.map(({ name, side, url }) => ({ name, side, url }));
        setImages(images, false);
        node.setDirtyCanvas?.(true, true);
    };

    // 读档恢复上一次画面
    const saved = node.properties.qq_compare_images;
    if (Array.isArray(saved) && saved.length) {
        setImages(saved, false);
    } else {
        render();
    }
}

app.registerExtension({
    name: "QQ.ImageComparer",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_TYPE) return;
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function onNodeCreatedComparer() {
            const result = originalCreated?.apply(this, arguments);
            setup(this);
            return result;
        };
        const originalConfigured = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function onConfigureComparer() {
            const result = originalConfigured?.apply(this, arguments);
            setup(this);
            this.__qqCompareRender?.();
            return result;
        };
    },
});
