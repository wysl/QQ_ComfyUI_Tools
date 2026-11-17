/**
 * QQ-LUT/曲线 前端纯函数测试。运行：node tests/test_lut_grading.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
let src = readFileSync(join(here, "..", "web", "lut_grading.js"), "utf8");
src = src.replace(/^import .*$/gm, "");
src = src.slice(0, src.indexOf("app.registerExtension"));
const factory = new Function(src + "\nreturn { parsePoints };");
const { parsePoints } = factory();

let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log("  ok   " + name); }
    else { fail++; console.log("  FAIL " + name); }
}

check("正常解析", JSON.stringify(parsePoints("[[0,0],[0.5,0.6],[1,1]]")) === JSON.stringify([[0, 0], [0.5, 0.6], [1, 1]]));
check("损坏回退单位曲线", JSON.stringify(parsePoints("{bad")) === JSON.stringify([[0, 0], [1, 1]]));
check("空回退", JSON.stringify(parsePoints("")) === JSON.stringify([[0, 0], [1, 1]]));
check("单点回退", JSON.stringify(parsePoints("[[0,0]]")) === JSON.stringify([[0, 0], [1, 1]]));

console.log(fail === 0 ? "LUT/curve frontend tests passed." : `${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
