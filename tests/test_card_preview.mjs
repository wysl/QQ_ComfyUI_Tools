/**
 * QQ-卡面 共享渲染纯函数测试（card_render.js）。运行：node tests/test_card_preview.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
let src = readFileSync(join(here, "..", "web", "card_render.js"), "utf8");
src = src.replace(/^import .*$/gm, "");
src = src.replace(/^export function /gm, "function ");
src = src.replace(/^export const /gm, "const ");
const factory = new Function(src + "\nreturn { viewUrl, progressRatio };");
const { viewUrl, progressRatio } = factory();

let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log("  ok   " + name); }
    else { fail++; console.log("  FAIL " + name); }
}

check("viewUrl 拼接", viewUrl({ filename: "a.png", subfolder: "", type: "temp" }) === "/view?filename=a.png&subfolder=&type=temp");
check("viewUrl 默认 type", viewUrl({ filename: "b.mp4" }).includes("type=temp"));
check("progress 经典消息", progressRatio({ value: 10, max: 20 }) === 0.5);
check("progress max<=1 忽略", progressRatio({ value: 1, max: 1 }) === null);
check("progress_state 取运行节点", progressRatio({ nodes: { a: { state: "running", value: 5, max: 10 } } }) === 0.5);
check("progress_state 非运行忽略", progressRatio({ nodes: { a: { state: "pending", value: 5, max: 10 } } }) === null);
check("progress 夹取", progressRatio({ value: 99, max: 20 }) === 1);

console.log(fail === 0 ? "Card render frontend tests passed." : `${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
