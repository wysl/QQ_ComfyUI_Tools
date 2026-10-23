/**
 * Pure helpers of the phone page's live progress and result actions
 * (web/mobile.html).
 *
 * 覆盖：
 *   1. progressRatio：越界钳位、max<=0 不除零
 *   2. stepStatusText：步数、用时、剩余时间的线性外推
 *   3. mediaKindOf：按扩展名判媒体类型（与后端表一致）
 *   4. isHeic：扩展名/MIME 两种来源都要认
 *
 * 运行：node tests/test_mobile_progress.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "web", "mobile.html"), "utf8");

function slice(startMarker, endMarker) {
    const start = src.indexOf(startMarker);
    const end = src.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, `无法切出 ${startMarker}`);
    return src.slice(start, end);
}

const progress = new Function(`
    ${slice("function progressRatio(", "function stepStatusText(")}
    ${slice("function stepStatusText(", "function handleBinaryFrame(")}
    return { progressRatio, stepStatusText };
`)();

const kinds = new Function(`
    ${slice("function mediaKindOf(", "async function shareEntry(")}
    ${slice("function isHeic(", "function decodeImageViaElement(")}
    return { mediaKindOf, isHeic };
`)();

// -- 1. progressRatio -------------------------------------------------------
assert.equal(progress.progressRatio(0, 0), 0);
assert.equal(progress.progressRatio(5, 10), 0.5);
assert.equal(progress.progressRatio(-3, 10), 0);
assert.equal(progress.progressRatio(20, 10), 1);
console.log("ok   progressRatio 钳位与除零");

// -- 2. stepStatusText ------------------------------------------------------
const t0 = 1_700_000_000_000;
const text = progress.stepStatusText(3, 20, t0, t0 + 30_000);
assert.match(text, /第 3\/20 步/);
assert.match(text, /已用 30 秒/);
// 10 秒/步 × 剩 17 步 = 170 秒
assert.match(text, /约剩 170 秒/);
// 第一步带着加载开销，不做剩余估算；两步起才有
assert.doesNotMatch(progress.stepStatusText(1, 20, t0, t0 + 10_000), /约剩/);
assert.match(progress.stepStatusText(2, 20, t0, t0 + 20_000), /约剩 180 秒/);
assert.doesNotMatch(progress.stepStatusText(0, 20, t0, t0 + 100), /约剩/);
console.log("ok   stepStatusText 步数/用时/剩余");

// -- 3. mediaKindOf ---------------------------------------------------------
assert.equal(kinds.mediaKindOf("a.png"), "image");
assert.equal(kinds.mediaKindOf("sub/b.JPEG"), "image");
assert.equal(kinds.mediaKindOf("clip.mp4"), "video");
assert.equal(kinds.mediaKindOf("clip.MOV"), "video");
assert.equal(kinds.mediaKindOf("voice.flac"), "audio");
assert.equal(kinds.mediaKindOf("noext"), "image");
console.log("ok   mediaKindOf 扩展名判定");

// -- 4. isHeic --------------------------------------------------------------
assert.equal(kinds.isHeic({ name: "IMG_0001.HEIC", type: "" }), true);
assert.equal(kinds.isHeic({ name: "x.heif", type: "image/heic" }), true);
assert.equal(kinds.isHeic({ name: "a.png", type: "image/heic" }), true);
assert.equal(kinds.isHeic({ name: "a.png", type: "image/png" }), false);
assert.equal(kinds.isHeic({ name: "a.txt", type: "text/plain" }), false);
console.log("ok   isHeic 扩展名与 MIME");

// -- 5. 接线：提交带 client_id、握手在前、上传走转码 --------------------------
assert.ok(src.includes("body: JSON.stringify({ workflow: state.workflow, values, client_id: socketClientId() })"),
    "提交必须带上 client_id，否则事件对不上");
assert.ok(src.includes('type: "feature_flags"'),
    "握手不发就收不到预览帧");
assert.ok(src.includes('else if (message?.type === "progress") handleProgressMessage(message.data);'),
    "老协议的 progress 消息也要接，只有 progress_state 不够稳");
assert.ok(src.includes("const ready = await prepareUpload(file);"),
    "上传必须经过 prepareUpload");
assert.ok(src.includes('canvas.toBlob(resolve, "image/jpeg", 0.92)'),
    "HEIC 要转成 JPEG 再上传");
assert.ok(src.includes("这台设备解不开 HEIC"),
    "解不开时要退回原文件并提示，不能静默失败");
assert.ok(src.includes('await fetchJson(`/qq_mobile/media?${params.toString()}`, { method: "DELETE" })'),
    "删除走 DELETE /qq_mobile/media");
console.log("ok   接线断言");

console.log("手机端进度/结果操作纯函数测试通过");
