/**
 * QQ-Lora分组加载 面板的纯数据部分。
 *
 * 覆盖：分组 JSON 归一化、生效分组解析、强度的容错。
 *
 * 运行：node tests/test_lora_groups.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "web", "lora_groups.js"), "utf8");

const cut = src.indexOf("function readData(node)");
const pure = src
    .slice(0, cut)
    .replace(/^import .*$/gm, "")
    .replace(/^export /gm, "");

const factory = new Function(`
  const app = { graph: null };
  ${pure}
  return { normaliseData, activeGroup, emptyData, buildLoraTree, loraTreeRows };
`);
const api = factory();

let pass = 0;
let fail = 0;
function check(name, cond) {
    if (cond) { pass += 1; console.log("  ok   " + name); }
    else { fail += 1; console.log("  FAIL " + name); }
}

console.log("== 1. 归一化 ==");
{
  check("坏 JSON 退回空表", api.normaliseData("{oops").groups.length === 0);
  check("空值退回空表", api.normaliseData(null).groups.length === 0);
  check("非对象退回空表", api.normaliseData(42).groups.length === 0);
  const data = api.normaliseData(JSON.stringify({
    active: 1,
    groups: [
      { name: "写实", loras: [{ name: "a.safetensors", strength: 0.8 }] },
      { name: "二次元", loras: [] },
    ],
  }));
  check("分组名与顺序保留", JSON.stringify(data.groups.map((g) => g.name)) === JSON.stringify(["写实", "二次元"]));
  check("Lora 保留", data.groups[0].loras[0].name === "a.safetensors");
  check("强度保留", data.groups[0].loras[0].strength === 0.8);
  check("生效分组保留", data.active === 1);
}

console.log("== 2. 容错 ==");
{
  const data = api.normaliseData(JSON.stringify({
    active: 9,
    groups: [{ name: "  ", loras: [{ name: "", strength: 1 }, { name: "keep.safetensors" }] }, "junk"],
  }));
  check("空名字补默认名", data.groups[0].name === "分组 1");
  // 面板保留「还没填名字」的空行（后端执行时会跳过它）
  check("未命名的 Lora 行保留在面板数据里", data.groups[0].loras.length === 2);
  check("未命名行的名字是空串", data.groups[0].loras[0].name === "");
  check("缺强度默认 1", data.groups[0].loras[0].strength === 1);
  check("越界 active 收回到 0", data.active === 0);
  const clamped = api.normaliseData(JSON.stringify({
    groups: [{ name: "A", loras: [{ name: "x.safetensors", strength: 500 }, { name: "y.safetensors", strength: "NaN" }] }],
  }));
  check("强度上限 100", clamped.groups[0].loras[0].strength === 100);
  check("NaN 强度退回 1", clamped.groups[0].loras[1].strength === 1);
}

console.log("== 3. 生效分组 ==");
{
  const data = api.normaliseData(JSON.stringify({
    active: 1,
    groups: [{ name: "A", loras: [] }, { name: "B", loras: [] }],
  }));
  check("按 active 取", api.activeGroup(data).name === "B");
  check("空表返回 null", api.activeGroup(api.emptyData()) === null);
  const fallback = api.normaliseData(JSON.stringify({ active: 5, groups: [{ name: "A", loras: [] }] }));
  check("active 越界时取第一组", api.activeGroup(fallback).name === "A");
}

console.log("== 4. 下拉目录树 ==");
{
  const BS = String.fromCharCode(92);
  const names = [
    `MOSS${BS}KOOK-MOSS${BS}h3${BS}a.safetensors`,
    `MOSS${BS}KOOK-MOSS${BS}b.safetensors`,
    "MOSS/qwen2.1/c.safetensors",
    "root-only.safetensors",
  ];
  const tree = api.buildLoraTree(names);
  const collapsed = api.loraTreeRows(tree, new Set(), "");
  check("一级只显示目录和根文件", collapsed.map((r) => r.name).join("|") === "MOSS|root-only.safetensors");
  check("目录行标记为 dir", collapsed[0].kind === "dir" && collapsed[0].open === false);
  check("根文件深度 0", collapsed[1].kind === "file" && collapsed[1].depth === 0);

  const openMoss = api.loraTreeRows(tree, new Set(["MOSS"]), "");
  check(
    "展开 MOSS 显示子目录与文件",
    openMoss.map((r) => r.name).join("|") === "MOSS|KOOK-MOSS|qwen2.1|root-only.safetensors",
  );
  check("子项缩进一级", openMoss[1].depth === 1);

  const openBoth = api.loraTreeRows(tree, new Set(["MOSS", "MOSS/KOOK-MOSS"]), "");
  check(
    "再展开 KOOK-MOSS 显示深层文件",
    openBoth.map((r) => r.name).join("|")
      === "MOSS|KOOK-MOSS|h3|b.safetensors|qwen2.1|root-only.safetensors",
  );
  check("深层文件深度 2", openBoth[3].depth === 2);
  check("完整名字保留反斜杠", openBoth[3].full === `MOSS${BS}KOOK-MOSS${BS}b.safetensors`);

  const searched = api.loraTreeRows(tree, new Set(), "柔光");
  check("搜不到时为空", searched.length === 0);
  const hit = api.loraTreeRows(api.buildLoraTree([`h3${BS}h3-影视柔光.safetensors`]), new Set(), "柔光");
  check("搜索自动展开并保留匹配", hit.map((r) => r.name).join("|") === "h3|h3-影视柔光.safetensors");
  check("搜索命中的目录是展开态", hit[0].open === true);
  check("空名单不炸", api.loraTreeRows(api.buildLoraTree([]), new Set(), "").length === 0);
}

console.log("");
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
