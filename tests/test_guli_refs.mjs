/**
 * 共享的参考图选择层：纯数据部分。
 *
 * 覆盖：令牌拆分/合并、摘要文本、分类与关键词过滤、多视角拆格。
 *
 * 运行：node tests/test_guli_refs.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "web", "guli_refs.js"), "utf8");

// 只取不碰 DOM / api 的纯函数部分
const cut = src.indexOf("export function thumbURL");
const pure = src
    .slice(0, cut)
    .replace(/^import .*$/gm, "")
    .replace(/^export /gm, "");

const factory = new Function(`
  ${pure}
  return {
    SEP, ANGLE_SEP, CAT_ALL, UNUSED, LANES,
    parseTokens, tokenLabel, tokenAngle, tokenOf, summarize,
    angleLabel, filterItems, refTiles,
  };
`);
const api = factory();

let pass = 0;
let fail = 0;
function check(name, cond) {
    if (cond) { pass += 1; console.log("  ok   " + name); }
    else { fail += 1; console.log("  FAIL " + name); }
}

console.log("== 1. 令牌 ==");
{
  check("拆分并去空去重", JSON.stringify(api.parseTokens("甲|乙|甲| |未使用")) === JSON.stringify(["甲", "乙"]));
  check("空串得到空数组", api.parseTokens("").length === 0);
  check("条目名", api.tokenLabel("站姿/A::side") === "站姿/A");
  check("视角", api.tokenAngle("站姿/A::side") === "side");
  check("没有视角时为空", api.tokenAngle("站姿/A") === "");
  check("拼令牌带视角", api.tokenOf({ label: "A" }, "side") === "A::side");
  check("拼令牌不带视角", api.tokenOf({ label: "A" }, "") === "A");
}

console.log("== 2. 摘要 ==");
{
  check("空选择显示未使用", api.summarize([]) === "未使用");
  check("单张", api.summarize(["A::front"]) === "1 张：A");
  check("多张用顿号并省略", api.summarize(["A", "B", "C"]) === "3 张：A、B…");
  check("视角从摘要里去掉", api.summarize(["A::side"]) === "1 张：A");
}

console.log("== 3. 过滤 ==");
{
  const data = {
    angles: [{ key: "front", label: "正面" }],
    items: [
      { label: "根一", cat: "" },
      { label: "站姿/甲", cat: "站姿" },
      { label: "站姿/乙", cat: "站姿" },
    ],
  };
  check("/ 表示全部", api.filterItems(data, api.CAT_ALL, "").length === 3);
  check("按子目录过滤", api.filterItems(data, "站姿", "").length === 2);
  check("关键词过滤", api.filterItems(data, api.CAT_ALL, "甲").length === 1);
  check("分类和关键词叠加", api.filterItems(data, "站姿", "乙").length === 1);
}

console.log("== 4. 拼格子 ==");
{
  const data = {
    angles: [{ key: "front", label: "正面" }, { key: "side", label: "侧面" }],
    items: [
      { label: "A", angles: { front: { img: "A_front.png" }, side: { img: "A_side.png" } } },
      { label: "站姿/B", angles: { front: { img: "B_front.png" } } },
      { label: "空条目", angles: {} },
    ],
  };
  const tiles = api.refTiles(data);
  check("多视角拆成两格 + 单视角一格", tiles.length === 3);
  check("多视角令牌带视角", tiles[0].token === "A::front" && tiles[1].token === "A::side");
  check("说明带视角名", tiles[1].caption === "A · 侧面");
  check("单视角用条目名", tiles[2].token === "站姿/B");
  check("说明只留叶子名", tiles[2].caption === "B");
  check("没有图的条目被跳过", tiles.some((tile) => tile.token === "空条目") === false);
}

console.log("");
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
