import { app } from "../../../scripts/app.js";

const NODE_TYPES = new Set([
    "QQLightroomLight",
    "QQLightroomColor",
    "QQLightroomDetail",
    "QQLightroomHSLWarm",
    "QQLightroomHSLCool",
    "QQLightroomGrain",
]);

const HSL_ZONES = [
    ["red", 0], ["orange", 30], ["yellow", 60], ["green", 120],
    ["aqua", 180], ["blue", 210], ["purple", 270], ["magenta", 330],
];

const LABELS = {
    temperature: "色温", tint: "色调", exposure: "曝光度", contrast: "对比度",
    highlights: "高光", shadows: "阴影", whites: "白色色阶", blacks: "黑色色阶",
    texture: "纹理", clarity: "清晰度", dehaze: "去朦胧", vibrance: "鲜艳度", saturation: "饱和度",
    amount: "数量", size: "大小", roughness: "粗糙度", seed: "随机种子",
    red: "红色", orange: "橙色", yellow: "黄色", green: "绿色",
    aqua: "青色", blue: "蓝色", purple: "紫色", magenta: "洋红",
};

const HSL_LABELS = { hue: "色相", saturation: "饱和度", lightness: "明亮度" };

function controlLabel(name) {
    const match = String(name).match(/^([a-z]+)_(hue|saturation|lightness)$/);
    return match ? `${LABELS[match[1]] || match[1]}${HSL_LABELS[match[2]]}` : LABELS[name] || name;
}

function localize(node) {
    for (const item of node?.widgets || []) {
        if (item?.name) item.label = controlLabel(item.name);
    }
    for (const item of node?.inputs || []) {
        if (item.name === "image") item.label = "图像";
        if (item.name === "video") item.label = "视频";
        if (item.name === "media") item.label = "图像或视频";
    }
}

function hslColor(hue, saturation = 82, lightness = 54) {
    return `hsl(${(hue + 360) % 360} ${saturation}% ${lightness}%)`;
}

function gradientFor(context, name, x, width) {
    const gradient = context.createLinearGradient(x, 0, x + width, 0);
    if (name === "temperature") {
        gradient.addColorStop(0, "#4f8fd0");
        gradient.addColorStop(0.5, "#a2a5a8");
        gradient.addColorStop(1, "#e7ae5b");
        return gradient;
    }
    if (name === "tint") {
        gradient.addColorStop(0, "#6aa56c");
        gradient.addColorStop(0.5, "#9fa3a6");
        gradient.addColorStop(1, "#d277b2");
        return gradient;
    }
    if (["saturation", "vibrance"].includes(name)) {
        gradient.addColorStop(0, "#787c82");
        gradient.addColorStop(0.5, "#afb1b3");
        gradient.addColorStop(1, "#d85d78");
        return gradient;
    }
    if (["exposure", "highlights", "whites", "lightness"].includes(name)) {
        gradient.addColorStop(0, "#25272b");
        gradient.addColorStop(0.5, "#92969b");
        gradient.addColorStop(1, "#f1f2f3");
        return gradient;
    }
    if (["shadows", "blacks"].includes(name)) {
        gradient.addColorStop(0, "#101216");
        gradient.addColorStop(0.5, "#737980");
        gradient.addColorStop(1, "#d8dade");
        return gradient;
    }

    const match = String(name).match(/^([a-z]+)_(hue|saturation|lightness)$/);
    if (match) {
        const zone = HSL_ZONES.find(([key]) => key === match[1]);
        const center = zone?.[1] ?? 0;
        if (match[2] === "hue") {
            gradient.addColorStop(0, hslColor(center - 42));
            gradient.addColorStop(0.5, hslColor(center));
            gradient.addColorStop(1, hslColor(center + 42));
        } else if (match[2] === "saturation") {
            gradient.addColorStop(0, "#777b81");
            gradient.addColorStop(0.5, hslColor(center, 48));
            gradient.addColorStop(1, hslColor(center, 96));
        } else {
            gradient.addColorStop(0, "#111318");
            gradient.addColorStop(0.5, hslColor(center, 82, 54));
            gradient.addColorStop(1, "#f1f2f3");
        }
        return gradient;
    }

    gradient.addColorStop(0, "#363a40");
    gradient.addColorStop(0.5, "#92969c");
    gradient.addColorStop(1, "#d7dade");
    return gradient;
}

function formatValue(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || Math.abs(number) < 1e-8) return "0";
    if (Number.isInteger(number)) return String(number);
    return number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function controlValueRatio(widget) {
    const min = Number(widget?.options?.min ?? -100);
    const max = Number(widget?.options?.max ?? 100);
    const value = Number(widget?.value ?? 0);
    return {
        min,
        max,
        value: Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0)),
    };
}

function drawTriangle(context, x, y, size, color) {
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(x - size, y - size * 0.65);
    context.lineTo(x + size, y - size * 0.65);
    context.lineTo(x, y + size * 0.65);
    context.closePath();
    context.fill();
}

function maxLabelWidth(context, node) {
    const labels = (node?.widgets || [])
        .filter((item) => item?.options?.min != null && item?.options?.max != null)
        .map((item) => controlLabel(item.name));
    if (!labels.length) return 42;
    context.save();
    context.font = "12px Arial, sans-serif";
    const width = Math.max(...labels.map((label) => context.measureText(label).width));
    context.restore();
    return Math.min(82, Math.max(42, width));
}

/**
 * Lightroom-like number widget. ComfyUI still handles onClick/onDrag and
 * serialization; only the visual layer is replaced so native arrows and the
 * capsule background do not appear.
 */
function drawLightroomWidget(context, node, width, y, height, lowQuality) {
    const widget = this;
    const rowHeight = Math.max(20, Number(height) || 26);
    const label = controlLabel(widget?.name);
    const valueText = formatValue(widget?.value);
    const labelX = 18;
    const trackStart = labelX + maxLabelWidth(context, node) + 10;
    const valueX = Math.max(trackStart + 48, width - 16);
    const trackEnd = Math.max(trackStart + 34, valueX - 29);
    const trackWidth = trackEnd - trackStart;
    const trackY = y + rowHeight * 0.58;
    const textColor = widget?.computedDisabled ? "rgba(190, 194, 199, 0.42)" : "#d3d6da";
    const mutedColor = widget?.computedDisabled ? "rgba(150, 154, 160, 0.28)" : "#9ea3aa";
    const { min, max, value } = controlValueRatio(widget);
    const ratio = (value - min) / Math.max(1e-6, max - min);
    const centerX = trackStart + trackWidth * 0.5;
    const valueXOnTrack = trackStart + trackWidth * ratio;

    context.save();
    context.font = "12px Arial, sans-serif";
    context.textBaseline = "middle";
    context.fillStyle = textColor;
    context.textAlign = "left";
    context.fillText(label, labelX, y + rowHeight * 0.48);

    context.lineCap = "round";
    context.lineWidth = lowQuality ? 1 : 2;
    context.strokeStyle = gradientFor(context, widget?.name, trackStart, trackWidth);
    context.beginPath();
    context.moveTo(trackStart, trackY);
    context.lineTo(trackEnd, trackY);
    context.stroke();

    // Zero is always the visual midpoint for Lightroom controls.
    context.strokeStyle = mutedColor;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(centerX, trackY - 3);
    context.lineTo(centerX, trackY + 3);
    context.stroke();

    // The triangle follows the current value; at zero it sits over the center tick.
    drawTriangle(context, valueXOnTrack, trackY, 4.2, widget?.computedDisabled ? "rgba(212, 215, 218, 0.45)" : "#d4d7da");

    context.fillStyle = textColor;
    context.textAlign = "right";
    context.fillText(valueText, valueX, y + rowHeight * 0.48);
    context.restore();
}

function styleWidgets(node) {
    for (const widget of node?.widgets || []) {
        if (!widget?.name || widget?.options?.min == null || widget?.options?.max == null) continue;
        // Seed is a reproducibility control, not a Lightroom adjustment.
        if (widget.name === "seed") {
            widget.label = controlLabel(widget.name);
            continue;
        }
        widget.draw = drawLightroomWidget;
        widget.label = controlLabel(widget.name);
    }
}

app.registerExtension({
    name: "QQ.LightroomSliders",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!NODE_TYPES.has(nodeData?.name)) return;

        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function onWyslLightroomCreated() {
            const result = originalCreated?.apply(this, arguments);
            localize(this);
            styleWidgets(this);
            return result;
        };

        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function onWyslLightroomConfigured() {
            const result = originalConfigure?.apply(this, arguments);
            localize(this);
            styleWidgets(this);
            return result;
        };
    },
});
