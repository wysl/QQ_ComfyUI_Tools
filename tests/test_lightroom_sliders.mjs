/**
 * Lightroom 滑条绘制主题色回归：文字/三角必须取 LiteGraph.WIDGET_TEXT_COLOR，
 * 不能硬编码浅色（再生纸等浅色主题下会看不清）。
 * 运行：node tests/test_lightroom_sliders.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
let src = readFileSync(join(here, "..", "web", "lightroom_sliders.js"), "utf8");
src = src.replace(/^import .*$/gm, "");
src = src.slice(0, src.indexOf("app.registerExtension"));
const factory = new Function(src + "\nreturn { drawLightroomWidget };");
const api = factory();

function makeCtx() {
    const fills = [];
    const ctx = {
        _fillStyle: "",
        set fillStyle(v) { this._fillStyle = v; fills.push(v); },
        get fillStyle() { return this._fillStyle; },
        strokeStyle: "", font: "", textBaseline: "", textAlign: "", lineCap: "", lineWidth: 1, globalAlpha: 1,
        save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
        stroke() {}, fill() {}, fillText() {},
        measureText: () => ({ width: 30 }),
        createLinearGradient: () => ({ addColorStop() {} }),
    };
    return { ctx, fills };
}

const widget = { name: "exposure", value: 0, options: { min: -100, max: 100 }, computedDisabled: false };
const node = { widgets: [widget] };
let fail = 0;

function run(theme, expected, label) {
    globalThis.LiteGraph = theme;
    const { ctx, fills } = makeCtx();
    api.drawLightroomWidget.call(widget, ctx, node, 220, 0, 26, false);
    const ok = fills.includes(expected);
    console.log((ok ? "  ok   " : "  FAIL ") + label);
    if (!ok) fail += 1;
}

run({ WIDGET_TEXT_COLOR: "#33302a", WIDGET_SECONDARY_TEXT_COLOR: "#6b675e" }, "#33302a",
    "浅色主题（再生纸）文字用主题深色");
run({ WIDGET_TEXT_COLOR: "#d3d6da", WIDGET_SECONDARY_TEXT_COLOR: "#9ea3aa" }, "#d3d6da",
    "深色主题文字用主题浅色");

// 禁用态用整体透明度，不再硬编码 rgba 浅色
globalThis.LiteGraph = { WIDGET_TEXT_COLOR: "#33302a", WIDGET_SECONDARY_TEXT_COLOR: "#6b675e" };
{
    const { ctx } = makeCtx();
    api.drawLightroomWidget.call({ ...widget, computedDisabled: true }, ctx, node, 220, 0, 26, false);
    const ok = ctx.globalAlpha < 1;
    console.log((ok ? "  ok   " : "  FAIL ") + "禁用态以降低透明度表达");
    if (!ok) fail += 1;
}

console.log(fail === 0 ? "Lightroom theme-aware text tests passed." : `${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
