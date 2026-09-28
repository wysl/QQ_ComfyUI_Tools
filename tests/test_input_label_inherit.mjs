/**
 * Regression tests for input label inheritance (web/input_label_inherit.js).
 * 运行：node tests/test_input_label_inherit.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "web", "input_label_inherit.js"), "utf8");

const cut = src.indexOf("function currentGraph");
const pure = src
  .slice(0, cut)
  .replace(/^import .*$/m, "")
  .replace(/^const (TAG|TARGET_INPUT_NAMES|GENERIC_OUTPUT_NAMES) = .*$/gm, "");

const factory = new Function(`
  const app = null;
  const TAG = "[QQ-标签继承]";
  const TARGET_INPUT_NAMES = ["模式", "启用", "规则"];
  const GENERIC_OUTPUT_NAMES = ["", "*", "值", "output", "OUTPUT", "Output", "result", "RESULT"];
  ${pure}
  return { graphLinks, isTargetInput, desiredLabel, syncLabels };
`);
const api = factory();

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log("  ok   " + name); }
  else { fail += 1; console.log("  FAIL " + name); }
}

function makeGraph(links) {
  const nodes = [];
  const graph = {
    _nodes: nodes,
    links,
    getNodeById(id) { return nodes.find((n) => n.id === id) || null; },
    setDirtyCanvas() {},
  };
  return { graph, nodes };
}

function makeNode(id, type, inputs, outputs, title) {
  return { id, type, title: title || type, inputs, outputs };
}

console.log("== 1. 来源名字解析 ==");
{
  check("自定义输出名优先", api.desiredLabel({ title: "QQ-多值输入" }, { name: "我希望显示的" }) === "我希望显示的");
  check("label 优先于 name", api.desiredLabel({ title: "T" }, { name: "x", label: "y" }) === "y");
  check("泛称退化为源节点标题", api.desiredLabel({ title: "QQ-多值输入" }, { name: "值" }) === "QQ-多值输入");
  check("空名退化为源节点标题", api.desiredLabel({ title: "Some Node" }, { name: "*" }) === "Some Node");
}

console.log("== 2. 白名单精确匹配 ==");
check("模式命中", api.isTargetInput({ name: "模式" }) === true);
check("启用命中", api.isTargetInput({ name: "启用" }) === true);
check("规则命中", api.isTargetInput({ name: "规则" }) === true);
check("启用接线不命中", api.isTargetInput({ name: "启用接线" }) === false);
check("模式 2 不命中", api.isTargetInput({ name: "模式 2" }) === false);

console.log("== 3. 连线后继承标签 ==");
{
  const { graph, nodes } = makeGraph({
    1: { id: 1, origin_id: 10, origin_slot: 0, target_id: 20, target_slot: 1 },
  });
  nodes.push(makeNode(10, "QQ-多值输入", [], [{ name: "我希望显示的" }]));
  nodes.push(makeNode(20, "QQ-魔术贴", [{ name: "状态" }, { name: "模式" }], []));
  api.syncLabels(graph);
  check("模式口显示来源自定义名", graph._nodes[1].inputs[1].label === "我希望显示的");
  check("非白名单口不动", graph._nodes[1].inputs[0].label === undefined);
  check("接管标记已写", graph._nodes[1].inputs[1].__qqLabelOwned === true);
}

console.log("== 4. 泛称输出用源节点标题 ==");
{
  const { graph, nodes } = makeGraph({
    1: { id: 1, origin_id: 10, origin_slot: 0, target_id: 20, target_slot: 0 },
  });
  nodes.push(makeNode(10, "SomeSwitch", [], [{ name: "值" }], "我的开关"));
  nodes.push(makeNode(20, "QQGetNode", [{ name: "启用" }], []));
  api.syncLabels(graph);
  check("显示源节点标题", graph._nodes[1].inputs[0].label === "我的开关");
}

console.log("== 5. 手动 label 不被覆盖 ==");
{
  const { graph, nodes } = makeGraph({
    1: { id: 1, origin_id: 10, origin_slot: 0, target_id: 20, target_slot: 0 },
  });
  nodes.push(makeNode(10, "QQ-多值输入", [], [{ name: "自定义" }]));
  nodes.push(makeNode(20, "X", [{ name: "启用", label: "我手动的" }], []));
  api.syncLabels(graph);
  check("保留手动 label", graph._nodes[1].inputs[0].label === "我手动的");
  check("不写接管标记", graph._nodes[1].inputs[0].__qqLabelOwned === undefined);
}

console.log("== 6. 断线还原 ==");
{
  const links = { 1: { id: 1, origin_id: 10, origin_slot: 0, target_id: 20, target_slot: 0 } };
  const { graph, nodes } = makeGraph(links);
  nodes.push(makeNode(10, "QQ-多值输入", [], [{ name: "自定义" }]));
  nodes.push(makeNode(20, "X", [{ name: "启用" }], []));
  api.syncLabels(graph);
  check("先继承", graph._nodes[1].inputs[0].label === "自定义");
  delete links[1];
  api.syncLabels(graph);
  check("断线后还原为 undefined", graph._nodes[1].inputs[0].label === undefined);
  check("标记清除", graph._nodes[1].inputs[0].__qqLabelOwned === undefined);
}

console.log("");
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
