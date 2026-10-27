/**
 * Behaviour tests for QQ-条件收集 (web/route_collect.js).
 *
 * 覆盖：
 *   1. 输入口数量：最少 2 个，接满就加，尾部空闲收回，已连线的永不收回
 *   2. 新输入口必须标记 lazy（否则惰性失效，全部分支都会被求值）
 *   3. 选择框内容来自输入口名称
 *   4. 与 QQ-条件分发 双向对齐，且不互相触发死循环
 *
 * 运行：node tests/test_route_collect.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "web", "route_collect.js"), "utf8");

const cut = src.indexOf("function refreshDispatchConsumers(node)");
const pure = src
  .slice(0, cut)
  .replace(/^import .*$/gm, "")
  .replace(/^export /gm, "")
  .replace(/^const (NODE_TYPE|DISPATCH_TYPE|SELECT_WIDGET|MIN_INPUTS|MAX_INPUTS|SYNC_GUARD) = .*$/gm, "");

const factory = new Function(`
  const NODE_TYPE = "QQRouteCollect";
  const DISPATCH_TYPE = "QQRouteDispatch";
  const SELECT_WIDGET = "select";
  const MIN_INPUTS = 2;
  const MAX_INPUTS = 8;
  const SYNC_GUARD = "__qqRouteSyncing";
  ${pure}
  return {
    defaultInputName, inputNames, targetInputCount, ensureInputs, pruneInputs,
    selectedIndex, remapValue, selectWidget, syncSelectWidget, linkedDispatch,
    syncFromDispatch, syncToDispatch, applySelectVisibility, isSelectShown,
  };
`);
const api = factory();

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log("  ok   " + name); }
  else { fail += 1; console.log("  FAIL " + name); }
}

function makeInput(name, label, link = null) {
  return { name, label, link, type: "*", lazy: true };
}

function makeNode(inputs, selectValue = "") {
  return {
    type: "QQRouteCollect",
    inputs,
    widgets: [{ name: "select", value: selectValue, options: { values: [] } }],
    addInput(name, type) {
      this.inputs.push({ name, type, link: null, lazy: false });
    },
    removeInput(index) {
      this.inputs.splice(index, 1);
    },
    setDirtyCanvas() {},
  };
}

console.log("== 1. 默认口名与取值 ==");
check("第 1 个口叫 输入1", api.defaultInputName(0) === "输入1");
{
  const node = makeNode([makeInput("输入1", "输入1"), makeInput("输入2", "增强器B")]);
  check("名称取 label", JSON.stringify(api.inputNames(node)) === JSON.stringify(["输入1", "增强器B"]));
  node.inputs[0].label = "";
  node.inputs[0].name = "自定义";
  check("label 空时退回 name", api.inputNames(node)[0] === "自定义");
}

console.log("== 2. 输入口数量 ==");
{
  const node = makeNode([makeInput("输入1", "输入1", 3), makeInput("输入2", "输入2")]);
  check("接满最后一个口前保持 2 个", api.targetInputCount(node) === 2);
  node.inputs[1].link = 4;
  check("接满最后一个口后目标为 3", api.targetInputCount(node) === 3);
  api.ensureInputs(node, api.targetInputCount(node));
  check("补到 3 个口", node.inputs.length === 3);
  check("新口叫 输入3", node.inputs[2].name === "输入3");
  check("新口必须标 lazy", node.inputs[2].lazy === true);
  check("新口 label 也是 输入3", node.inputs[2].label === "输入3");
}
{
  const node = makeNode([makeInput("输入1", "输入1")]);
  check("全空时至少 2 个口", api.targetInputCount(node) === 2);
  api.ensureInputs(node, 20);
  check("上限 8 个口", node.inputs.length === 8);
  check("所有补出来的口都是 lazy", node.inputs.every((item) => item.lazy === true));
}
{
  const node = makeNode([
    makeInput("输入1", "输入1", 1),
    makeInput("输入2", "输入2"),
    makeInput("输入3", "输入3"),
  ]);
  api.pruneInputs(node, 2);
  check("尾部空闲口被收回", node.inputs.length === 2);
}
{
  const node = makeNode([makeInput("输入1", "输入1"), makeInput("输入2", "输入2", 9)]);
  api.pruneInputs(node, 1);
  check("已连线的口绝不回收", node.inputs.length === 2);
}

console.log("== 3. 选择框内容 ==");
{
  const node = makeNode([makeInput("输入1", "增强器A"), makeInput("输入2", "增强器B")], "输入1");
  const names = api.syncSelectWidget(node);
  check("下拉项是输入口名称", JSON.stringify(names) === JSON.stringify(["增强器A", "增强器B"]));
  check("values 同步", JSON.stringify(node.widgets[0].options.values) === JSON.stringify(names));
  check("已有值保留", node.widgets[0].value === "增强器A");
}
{
  const node = makeNode([makeInput("输入1", "输入1"), makeInput("输入2", "输入2")], "2");
  api.syncSelectWidget(node, ["输入1", "输入2"]);
  check("数字写法映射到同名口", node.widgets[0].value === "输入2");
}
{
  const node = makeNode([makeInput("输入1", "输入1"), makeInput("输入2", "输入2")], "老名字");
  api.syncSelectWidget(node, ["输入1", "输入2"]);
  check("对不上时退回第一个", node.widgets[0].value === "输入1");
}
{
  const before = ["输入1", "输入2"];
  const after = ["增强器A", "增强器B"];
  check("改名后按位置换过去", api.remapValue("输入2", after, before) === "增强器B");
  check("已经是对的就不动", api.remapValue("增强器A", after, before) === "增强器A");
  check("空列表返回空串", api.remapValue("x", [], []) === "");
}

console.log("== 4. 与分发节点对齐 ==");
{
  const dispatch = {
    type: "QQRouteDispatch",
    outputs: [{ name: "输出1", label: "输出1", links: [] },
              { name: "输出2", label: "输出2", links: [] }],
    widgets: [{ name: "select", value: "输出2", options: { values: [] } }],
    setDirtyCanvas() {},
  };
  const node = makeNode([makeInput("输入1", "输入1"), makeInput("输入2", "输入2")], "输入1");
  const graph = {
    getLink: (id) => (id === 7 ? { origin_id: 5 } : null),
    getNodeById: (id) => (id === 5 ? dispatch : null),
  };
  node.graph = graph;
  node.inputs[0].link = 7;
  check("能找到上游分发节点", api.linkedDispatch(node) === dispatch);

  // 默认是自动跟随：值留空，由后端沿连线回溯分发节点
  check("默认不带手动选择", api.isSelectShown(node) === false);
  check("自动跟随时清空值", api.syncFromDispatch(node) === true);
  check("值变成空串", node.widgets[0].value === "");
  check("自动跟随时不反向推送", api.syncToDispatch(node) === false);

  // 打开手动选择后才有双向同步
  node.properties = { qq_collect_show_select: true };
  node.widgets[0].value = "输入1";
  check("手动模式：对齐到分发", api.syncFromDispatch(node) === true);
  check("手动模式：值变成 输入2", node.widgets[0].value === "输入2");
  node.widgets[0].value = "输入1";
  check("手动模式：推回分发", api.syncToDispatch(node) === true);
  check("手动模式：分发的值变成 输出1", dispatch.widgets[0].value === "输出1");
}
{
  const node = makeNode([makeInput("输入1", "输入1")], "输入1");
  node.graph = { getLink: () => null, getNodeById: () => null };
  check("没有上游分发时返回 null", api.linkedDispatch(node) === null);
  check("没上游时同步返回 false", api.syncFromDispatch(node) === false);
}
{
  // 防回环：正在同步时不应再反向触发
  const dispatch = {
    type: "QQRouteDispatch",
    outputs: [{ name: "输出1", label: "输出1", links: [] }],
    widgets: [{ name: "select", value: "输出1", options: { values: [] } }],
    setDirtyCanvas() {},
  };
  const node = makeNode([makeInput("输入1", "输入1")], "输入1");
  node.graph = { getLink: () => ({ origin_id: 5 }), getNodeById: () => dispatch };
  node.inputs[0].link = 1;
  node.__qqRouteSyncing = true;
  check("同步中不反向触发", api.syncToDispatch(node) === false);
  node.__qqRouteSyncing = false;
}

console.log("== 5. 缺 select 控件时安全 ==");
{
  const node = { inputs: [makeInput("输入1", "输入1")], widgets: [] };
  check("没有 select 返回 null", api.selectWidget(node) === null);
  check("同步返回数组不抛异常", Array.isArray(api.syncSelectWidget(node)));
}

console.log("");
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
