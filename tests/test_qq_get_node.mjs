/**
 * Regression tests for QQ-获取点 (web/qq_get_node.js).
 * 运行：node tests/test_qq_get_node.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "web", "qq_get_node.js"), "utf8");

const cut = src.indexOf("function install(nodeType)");
const pure = src
  .slice(0, cut)
  .replace(/^import .*$/m, "")
  .replace(/^const (NODE_TYPE|NODE_TITLE|SET_NODE_TYPE|TAG|NAME_WIDGET|ENABLE_WIDGET|ENABLE_INPUT) = .*$/gm, "");

const factory = new Function(`
  const app = null;
  const NODE_TYPE = "QQGetNode";
  const NODE_TITLE = "QQ-获取点";
  const SET_NODE_TYPE = "SetNode";
  const TAG = "[QQ-获取点]";
  const NAME_WIDGET = "名称";
  const ENABLE_WIDGET = "启用";
  const ENABLE_INPUT = "启用接线";
  ${pure}
  return {
    graphAncestors, readLink, findSetterNode, resolveSetterLink, setNames,
    isEnabled, setNameValue, nameWidget,
  };
`);
const api = factory();

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log("  ok   " + name); }
  else { fail += 1; console.log("  FAIL " + name); }
}

function makeSetter(name, linkId) {
  return { type: "SetNode", widgets: [{ value: name }], inputs: [{ link: linkId }] };
}

const links = { 42: { id: 42, origin_id: 7, origin_slot: 0 }, 9: { id: 9, origin_id: 8, origin_slot: 0 } };
const setter = makeSetter("latent", 42);
const emptySetter = makeSetter("empty", null);
const other = { type: "Foo", widgets: [] };
const graph = { _nodes: [setter, emptySetter, other], getLink: (id) => links[id] ?? null };

console.log("== 1. 按名字找设置点 ==");
check("找到同名设置点", api.findSetterNode(graph, "latent")?.node === setter);
check("找不到返回 null", api.findSetterNode(graph, "nope") === null);
check("空名字返回 null", api.findSetterNode(graph, "") === null);

console.log("== 2. 解析源连线 ==");
check("启用时返回设置点的输入连线", api.resolveSetterLink(graph, "latent", 0, true) === links[42]);
check("关闭时返回 null（消费者视为未连接）", api.resolveSetterLink(graph, "latent", 0, false) === null);
check("设置点没接线返回 null", api.resolveSetterLink(graph, "empty", 0, true) === null);
check("名字不存在返回 null", api.resolveSetterLink(graph, "nope", 0, true) === null);

console.log("== 3. 名称列表 ==");
check("列出所有设置点且去重", JSON.stringify(api.setNames(graph)) === JSON.stringify(["latent", "empty"]));
const parent = { _nodes: [makeSetter("outer", 9)], getLink: (id) => links[id] ?? null };
const child = { _nodes: [setter], parent, getLink: (id) => links[id] ?? null };
check("外层图的名字也在范围内", api.setNames(child).includes("outer"));
check("跨图也能解析", api.findSetterNode(child, "outer")?.graph === parent);

console.log("== 4. 开关读取 ==");
check("默认启用", api.isEnabled({ widgets: [{ name: "启用", value: true }] }) === true);
check("关闭识别", api.isEnabled({ widgets: [{ name: "启用", value: false }] }) === false);
check("没有开关widget视为启用", api.isEnabled({ widgets: [] }) === true);

console.log("== 5. 启用接线口：常量源静态可读 ==");
{
  const primitive = { id: 11, type: "PrimitiveNode", widgets: [{ value: false }] };
  const linkedGraph = {
    _nodes: [primitive],
    getNodeById: (id) => (id === 11 ? primitive : null),
    getLink: (id) => (id === 5 ? { id: 5, origin_id: 11, origin_slot: 0 } : null),
  };
  const node = {
    graph: linkedGraph,
    inputs: [{ name: "启用接线", link: 5 }],
    widgets: [{ name: "启用", value: true }],
  };
  check("接布尔常量 false 时关闭", api.isEnabled(node) === false);
  primitive.widgets[0].value = true;
  check("常量改 true 后启用", api.isEnabled(node) === true);
  const runtime = { id: 12, type: "SomeComputeNode", widgets: [] };
  const runtimeGraph = {
    _nodes: [runtime],
    getNodeById: (id) => (id === 12 ? runtime : null),
    getLink: (id) => (id === 6 ? { id: 6, origin_id: 12, origin_slot: 0 } : null),
  };
  check("非常量源回退到节点开关", api.isEnabled({
    graph: runtimeGraph,
    inputs: [{ name: "启用接线", link: 6 }],
    widgets: [{ name: "启用", value: true }],
  }) === true);
}

console.log("== 6. 名称写入（文本框 + 标题联动）==");
{
  const widget = { name: "名称", value: "" };
  const node = {
    type: "QQGetNode",
    widgets: [widget],
    graph,
    title: "QQ-获取点",
    setDirtyCanvas() {},
  };
  check("写入名称", api.setNameValue(node, "latent") === true);
  check("widget 值已更新", widget.value === "latent");
  check("标题带上名称", node.title === "QQ-获取点 latent");
  api.setNameValue(node, "");
  check("清空后标题还原", node.title === "QQ-获取点");
  check("没有名称widget时返回false", api.setNameValue({ widgets: [] }, "x") === false);
}

console.log("");
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
