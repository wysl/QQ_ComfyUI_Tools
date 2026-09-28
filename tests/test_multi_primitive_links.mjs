/**
 * Regression tests for QQ-多值输入 link styling (web/multi_primitive_links.js).
 * 运行：node tests/test_multi_primitive_links.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "web", "multi_primitive_links.js"), "utf8");

const cut = src.indexOf("function currentState");
const pure = src
  .slice(0, cut)
  .replace(/^import .*$/m, "")
  .replace(/^const (NODE_TYPE|LEGACY_NODE_TYPE|TAG|GRASS_IDLE|GRASS_ACTIVE) = .*$/gm, "");

const factory = new Function(`
  const NODE_TYPE = "QQ-多值输入";
  const LEGACY_NODE_TYPE = "QQMultiPrimitive";
  const TAG = "[QQ-多值输入连线]";
  const GRASS_IDLE = "rgba(124, 199, 55, 0.05)";
  const GRASS_ACTIVE = "rgba(154, 230, 60, 0.9)";
  ${pure}
  return { graphLinks, isMultiSource, isActiveLink, styleFor, applyLinkStyles };
`);
const api = factory();

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log("  ok   " + name); }
  else { fail += 1; console.log("  FAIL " + name); }
}

function makeGraph(links, nodes) {
  return {
    links,
    getNodeById: (id) => nodes.find((n) => n.id === id) || null,
    setDirtyCanvas() {},
  };
}

const multi = { id: 1, type: "QQ-多值输入" };
const legacy = { id: 2, type: "QQMultiPrimitive" };
const other = { id: 3, type: "Foo" };
const consumer = { id: 4, type: "QQGroupBypassTag" };
const nodes = [multi, legacy, other, consumer];

console.log("== 1. 只认多值输入发出的线 ==");
const graph = makeGraph({ 10: { id: 10, origin_id: 1, origin_slot: 0, target_id: 4, target_slot: 0 },
                          11: { id: 11, origin_id: 3, origin_slot: 0, target_id: 4, target_slot: 1 } }, nodes);
check("多值输入来源命中", api.isMultiSource(graph, graph.links[10]) === true);
check("旧类名也命中", api.isMultiSource(makeGraph({}, [legacy]), { origin_id: 2 }) === true);
check("其它节点来源不命中", api.isMultiSource(graph, graph.links[11]) === false);

console.log("== 2. 激活判定 ==");
const link = graph.links[10];
check("选中源节点激活", api.isActiveLink(graph, link, new Set([1]), null) === true);
check("选中目标节点激活", api.isActiveLink(graph, link, new Set([4]), null) === true);
check("悬停源节点激活", api.isActiveLink(graph, link, new Set(), 1) === true);
check("无关选择不激活", api.isActiveLink(graph, link, new Set([9]), 9) === false);

console.log("== 3. 样式 ==");
check("平时 5% 草绿", api.styleFor(false).color === "rgba(124, 199, 55, 0.05)");
check("平时不流动", api.styleFor(false).flow === false);
check("激活 90% 亮草绿", api.styleFor(true).color === "rgba(154, 230, 60, 0.9)");
check("激活带流动高亮", api.styleFor(true).flow === true);

console.log("== 4. 应用到图 ==");
{
  const g = makeGraph({
    10: { id: 10, origin_id: 1, origin_slot: 0, target_id: 4, target_slot: 0 },
    11: { id: 11, origin_id: 3, origin_slot: 0, target_id: 4, target_slot: 1 },
  }, nodes);
  api.applyLinkStyles(g, new Set(), null);
  check("多值线平时 5%", g.links[10].color === "rgba(124, 199, 55, 0.05)");
  check("其它线不被改", g.links[11].color === undefined);
  api.applyLinkStyles(g, new Set([4]), null);
  check("选中后 90%", g.links[10].color === "rgba(154, 230, 60, 0.9)");
  check("选中后流动", g.links[10].flow === true);
  check("旧渲染器钩子数据已写", g.links[10].__qqStyle?.color === "rgba(154, 230, 60, 0.9)");
  check("其它线仍不被改", g.links[11].color === undefined);
  api.applyLinkStyles(g, new Set(), null);
  check("取消选中回到 5%", g.links[10].color === "rgba(124, 199, 55, 0.05)");
  check("钩子数据同步回到 5%", g.links[10].__qqStyle?.color === "rgba(124, 199, 55, 0.05)");
  check("只改渲染属性，不动拓扑", g.links[10].origin_id === 1 && g.links[10].target_id === 4);
}

console.log("");
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
