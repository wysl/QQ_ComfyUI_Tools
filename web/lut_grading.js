import { app } from "../../scripts/app.js";

// QQ-LUT调色 / QQ-曲线调色 的前端。
//   LUT：标准 combo+滑条（2.0 原生），右键「刷新列表/上传 .cube」。
//   曲线：DOM canvas 编辑器——拖动控制点、双击添加、右键删除，写回隐藏的「曲线JSON」。
// 事件驱动（pointer / 控件回调），无定时器。

const LUT_TYPE = "QQLutGrading";
const CURVES_TYPE = "QQCurvesGrading";
const CURVE_WIDGET = "曲线JSON";
const CURVE_HEIGHT = 170;

const CSS = `
.qq-curve{padding:4px;font:12px/1.35 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.qq-curve canvas{display:block;width:100%;height:${CURVE_HEIGHT}px;border-radius:6px;border:1px solid var(--border-color,#4b545b);background:var(--comfy-input-bg,#12141a);cursor:crosshair;touch-action:none}
.qq-curve-hint{margin-top:3px;color:var(--descrip-text,#96a0b0);font-size:11px}
`;

function injectCSS() {
    if (document.getElementById("qq-lut-css")) return;
    const style = document.createElement("style");
    style.id = "qq-lut-css";
    style.textContent = CSS;
    document.head.append(style);
}

function widget(node, name) {
    return (node?.widgets || []).find((w) => w?.name === name) || null;
}

// ── LUT：刷新 / 上传 ─────────────────────────────────────────
function refreshLutCombo(node) {
    fetch("/qq_luts/list").then((r) => r.json()).then((data) => {
        const w = widget(node, "lut");
        if (!w || !Array.isArray(data?.luts)) return;
        w.options ||= {};
        w.options.values = data.luts;
        if (!data.luts.includes(w.value)) w.value = data.luts[0];
        node.setDirtyCanvas?.(true, true);
    }).catch(() => {});
}

function uploadLut(node) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".cube";
    input.addEventListener("change", async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) return;
        const form = new FormData();
        form.append("file", file);
        try {
            const res = await fetch("/qq_luts/upload", { method: "POST", body: form });
            const data = await res.json();
            if (data?.ok) {
                refreshLutCombo(node);
                const w = widget(node, "lut");
                if (w) w.value = data.name;
            }
        } catch { /* 忽略 */ }
    });
    input.addEventListener("cancel", () => input.remove());
    document.body.append(input);
    input.click();
}

function setupLut(node) {
    if (node.__qqLutSetup) return;
    node.__qqLutSetup = true;
    const originalMenu = node.getExtraMenuOptions;
    node.getExtraMenuOptions = function (_, options) {
        const result = originalMenu?.apply(this, arguments);
        options.push(
            { content: "刷新 LUT 列表", callback: () => refreshLutCombo(this) },
            { content: "上传 .cube…", callback: () => uploadLut(this) },
        );
        return result ?? options;
    };
}

// ── 曲线编辑器 ───────────────────────────────────────────────
function parsePoints(raw) {
    try {
        const data = JSON.parse(String(raw || ""));
        if (Array.isArray(data) && data.length >= 2) {
            return data.map((p) => [Number(p[0]) || 0, Number(p[1]) || 0]);
        }
    } catch { /* 忽略 */ }
    return [[0, 0], [1, 1]];
}

function setupCurves(node) {
    if (node.__qqCurveSetup) return;
    node.__qqCurveSetup = true;
    const jsonWidget = widget(node, CURVE_WIDGET);
    if (jsonWidget) {
        jsonWidget.hidden = true;
        jsonWidget.options ||= {};
        jsonWidget.options.hidden = true;
        jsonWidget.computeSize = () => [0, -4];
    }

    const root = document.createElement("div");
    root.className = "qq-curve";
    const canvas = document.createElement("canvas");
    const hint = document.createElement("div");
    hint.className = "qq-curve-hint";
    hint.textContent = "拖动控制点 · 双击添加 · 右键删除";
    root.append(canvas, hint);

    let points = parsePoints(jsonWidget?.value);
    let dragIndex = -1;

    function commit() {
        points.sort((a, b) => a[0] - b[0]);
        if (jsonWidget) {
            jsonWidget.value = JSON.stringify(points.map((p) => [+p[0].toFixed(4), +p[1].toFixed(4)]));
            jsonWidget.callback?.(jsonWidget.value);
        }
        node.setDirtyCanvas?.(true, true);
        node.graph?.change?.();
    }

    function theme() {
        const cs = getComputedStyle(document.documentElement);
        return {
            grid: cs.getPropertyValue("--border-color").trim() || "#4b545b",
            text: cs.getPropertyValue("--input-text").trim() || "#e6e8ee",
            accent: cs.getPropertyValue("--primary").trim() || "#4f8cff",
        };
    }

    function draw() {
        const dpr = globalThis.devicePixelRatio || 1;
        const width = canvas.clientWidth || 240;
        const height = CURVE_HEIGHT;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const colors = theme();
        const pad = 8;
        const iw = width - pad * 2;
        const ih = height - pad * 2;
        const toX = (x) => pad + x * iw;
        const toY = (y) => pad + (1 - y) * ih;

        ctx.clearRect(0, 0, width, height);
        // 网格
        ctx.strokeStyle = colors.grid;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const gx = pad + (iw * i) / 4;
            const gy = pad + (ih * i) / 4;
            ctx.beginPath(); ctx.moveTo(gx, pad); ctx.lineTo(gx, pad + ih); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(pad, gy); ctx.lineTo(pad + iw, gy); ctx.stroke();
        }
        // 参考对角线
        ctx.globalAlpha = 0.6;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(toX(0), toY(0)); ctx.lineTo(toX(1), toY(1)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        // 曲线
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        points.forEach((p, i) => {
            const x = toX(p[0]), y = toY(p[1]);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        // 控制点
        points.forEach((p, i) => {
            ctx.beginPath();
            ctx.arc(toX(p[0]), toY(p[1]), i === dragIndex ? 6 : 4.5, 0, Math.PI * 2);
            ctx.fillStyle = colors.accent;
            ctx.fill();
            ctx.strokeStyle = colors.text;
            ctx.lineWidth = 1;
            ctx.stroke();
        });
    }

    function localPoint(event) {
        const rect = canvas.getBoundingClientRect();
        const pad = 8;
        const iw = rect.width - pad * 2;
        const ih = CURVE_HEIGHT - pad * 2;
        const x = Math.max(0, Math.min(1, (event.clientX - rect.left - pad) / iw));
        const y = Math.max(0, Math.min(1, 1 - (event.clientY - rect.top - pad) / ih));
        return [x, y];
    }

    function hitHandle(event) {
        const rect = canvas.getBoundingClientRect();
        const pad = 8;
        const iw = rect.width - pad * 2;
        const ih = CURVE_HEIGHT - pad * 2;
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        let best = -1, bestDist = 12;
        points.forEach((p, i) => {
            const dx = px - (pad + p[0] * iw);
            const dy = py - (pad + (1 - p[1]) * ih);
            const dist = Math.hypot(dx, dy);
            if (dist < bestDist) { bestDist = dist; best = i; }
        });
        return best;
    }

    canvas.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        if (event.button === 2) return;
        dragIndex = hitHandle(event);
        if (dragIndex >= 0) canvas.setPointerCapture(event.pointerId);
        draw();
    });
    canvas.addEventListener("pointermove", (event) => {
        if (dragIndex < 0) return;
        event.stopPropagation();
        const [x, y] = localPoint(event);
        const isEndpoint = dragIndex === 0 || dragIndex === points.length - 1;
        points[dragIndex] = [isEndpoint ? (dragIndex === 0 ? 0 : 1) : x, y];
        draw();
    });
    canvas.addEventListener("pointerup", (event) => {
        if (dragIndex < 0) return;
        event.stopPropagation();
        dragIndex = -1;
        commit();
        draw();
    });
    canvas.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        const [x, y] = localPoint(event);
        if (x <= 0.001 || x >= 0.999) return;
        points.push([x, y]);
        commit();
        draw();
    });
    canvas.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const index = hitHandle(event);
        if (index > 0 && index < points.length - 1) {
            points.splice(index, 1);
            commit();
            draw();
        }
    });
    canvas.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

    node.addDOMWidget("qq_curve_editor", "qq_curve", root, {
        serialize: false, hideOnZoom: false, margin: 4, getMinHeight: () => CURVE_HEIGHT + 24,
    });
    node.resizable = true;

    const originalResize = node.onResize;
    node.onResize = function () {
        const result = originalResize?.apply(this, arguments);
        draw();
        return result;
    };

    node.__qqCurveRedraw = draw;
    // 首帧与读档后各画一次
    requestAnimationFrame(draw);
    draw();
}

app.registerExtension({
    name: "QQ.LutGrading",
    setup() { injectCSS(); },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        const name = nodeData?.name;
        if (name !== LUT_TYPE && name !== CURVES_TYPE) return;
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            if (name === LUT_TYPE) setupLut(this);
            else setupCurves(this);
            return result;
        };
        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = originalConfigure?.apply(this, arguments);
            if (name === CURVES_TYPE) { setupCurves(this); this.__qqCurveRedraw?.(); }
            else setupLut(this);
            return result;
        };
    },
});
