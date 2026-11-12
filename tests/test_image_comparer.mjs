/**
 * QQ-图像对比 前端纯函数：预览图命名（A/B/A1/B1…）与默认对比选择。
 *
 * 运行：node tests/test_image_comparer.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "web", "image_comparer.js"), "utf8");

// 只取纯函数部分（setup 之前），去掉 import / export。
const cut = src.indexOf("function setup(node)");
const pure = src
    .slice(0, cut)
    .replace(/^import .*$/gm, "")
    .replace(/^export /gm, "");

const factory = new Function(`
  const app = { getPreviewFormatParam: () => "", getRandParam: () => "" };
  const api = { apiURL: (u) => u };
  ${pure}
  return { buildComparerImages, defaultSelection };
`);
const { buildComparerImages, defaultSelection } = factory();

let pass = 0;
let fail = 0;
function check(name, cond) {
    if (cond) { pass += 1; console.log("  ok   " + name); }
    else { fail += 1; console.log("  FAIL " + name); }
}
const img = (filename) => ({ filename, type: "temp", subfolder: "" });

console.log("== 1. 预览图命名 ==");
{
    const one = buildComparerImages({ a_images: [img("a.png")], b_images: [img("b.png")] });
    check("单 A 单 B 命名为 A / B", one.map((x) => x.name).join(",") === "A,B");
    check("携带 side 与 url", one[0].side === "A" && one[1].side === "B" && one[0].url.includes("a.png"));

    const many = buildComparerImages({
        a_images: [img("a1.png"), img("a2.png")],
        b_images: [img("b1.png"), img("b2.png")],
    });
    check("多张命名为 A1/A2/B1/B2", many.map((x) => x.name).join(",") === "A1,A2,B1,B2");

    const onlyA = buildComparerImages({ a_images: [img("a1.png"), img("a2.png")] });
    check("仅 A 批量也编号", onlyA.map((x) => x.name).join(",") === "A1,A2");

    const empty = buildComparerImages({});
    check("空结果返回空表", empty.length === 0);
}

console.log("== 2. 默认对比选择 ==");
{
    const ab = buildComparerImages({ a_images: [img("a.png")], b_images: [img("b.png")] });
    check("两侧都有取各自第一张", JSON.stringify(defaultSelection(ab)) === "[0,1]");

    const onlyA = buildComparerImages({ a_images: [img("a1.png"), img("a2.png"), img("a3.png")] });
    check("仅一侧多张取前两张", JSON.stringify(defaultSelection(onlyA)) === "[0,1]");

    const single = buildComparerImages({ a_images: [img("a.png")] });
    check("只有一张时自己比自己", JSON.stringify(defaultSelection(single)) === "[0,0]");

    check("空表退回 [0,0]", JSON.stringify(defaultSelection([])) === "[0,0]");
}

console.log(`通过 ${pass} / 失败 ${fail}`);
if (fail > 0) process.exit(1);
