/**
 * Behaviour tests for QQ-条件分发 (web/route_dispatch.js).
 *
 * 覆盖：
 *   1. 输出口数量：最少 2 个，接满就加一个，尾部空闲收回
 *   2. 选择框选项来自输出口名称（label 优先，其次 name）
 *   3. 输出口改名后，选择框里的旧名字跟着换成新名字
 *   4. 已连线的输出口永不回收
 *   5. 存档恢复时按保存的口数落位
 *
 * 运行：node tests/test_route_dispatch.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "web", "route_dispatch.js"), "utf8");

const cut = src.indexOf("function syncNode(node)");
const pure = src
  .slice(0, cut)
  .replace(/^import .*$/gm, "")
  .replace(/^export /gm, "")
  .replace(/^const (NODE_TYPE|SELECT_WIDGET|POLLING_WIDGET|MIN_OUTPUTS|MAX_OUTPUTS) = .*$/gm, "");

const factory = new Function(`
  const NODE_TYPE = "QQRouteDispatch";
  const SELECT_WIDGET = "select";
  const POLLING_WIDGET = "轮询输出";
  const MIN_OUTPUTS = 2;
  const MAX_OUTPUTS = 8;
  ${pure}
  return {
    defaultOutputName, outputNames, targetOutputCount, ensureOutputs, pruneOutputs,
    selectedIndex, remapValue, selectWidget, pollingWidget, isPolling, applyPollingState,
    connectedIndexes, resolveTargetIndex, pollingFinished, setPollingIndex, syncSelectWidget,
  };
`);
const api = factory();

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log("  ok   " + name); }
  else { fail += 1; console.log("  FAIL " + name); }
}

function makeOutput(name, label, links = []) {
  return { name, label, links, type: "*" };
}

function makeNode(outputs, selectValue = "") {
  const node = {
    type: "QQRouteDispatch",
    outputs,
    widgets: [{ name: "select", value: selectValue, options: { values: [] } }],
    addOutput(name, type) {
      this.outputs.push(makeOutput(name, undefined, []));
      this.outputs[this.outputs.length - 1].type = type;
    },
    removeOutput(index) {
      this.outputs.splice(index, 1);
    },
    setDirtyCanvas() {},
  };
  return node;
}

function namesOf(node) {
  return api.outputNames(node);
}

console.log("== 1. 默认口名 ==");
check("第 1 个口叫 输出1", api.defaultOutputName(0) === "输出1");
check("第 3 个口叫 输出3", api.defaultOutputName(2) === "输出3");
{
  const node = makeNode([makeOutput("输出1", "输出1"), makeOutput("输出2", "输出2")]);
  check("输出口名称取自 label", JSON.stringify(namesOf(node)) === JSON.stringify(["输出1", "输出2"]));
  node.outputs[0].label = "提示词优化A";
  check("改名后名称跟着变", namesOf(node)[0] === "提示词优化A");
  node.outputs[1].label = "";
  node.outputs[1].name = "自定义";
  check("label 为空时退回 name", namesOf(node)[1] === "自定义");
}

console.log("== 2. 输出口数量 ==");
{
  const node = makeNode([makeOutput("输出1", "输出1", [1]), makeOutput("输出2", "输出2")]);
  check("第 1 个口接满但仍有空口时保持 2 个", api.targetOutputCount(node) === 2);
}
{
  const node = makeNode([makeOutput("输出1", "输出1", [1]), makeOutput("输出2", "输出2", [2])]);
  check("接满最后一个口后目标为 3", api.targetOutputCount(node) === 3);
  api.ensureOutputs(node, api.targetOutputCount(node));
  check("补到 3 个口", node.outputs.length === 3);
  check("新口叫 输出3", node.outputs[2].name === "输出3");
  check("新口 label 也是 输出3", node.outputs[2].label === "输出3");
}
{
  const node = makeNode([makeOutput("输出1", "输出1")]);
  check("全空时至少 2 个口", api.targetOutputCount(node) === 2);
}
{
  const node = makeNode(
    Array.from({ length: 8 }, (_, i) => makeOutput(`输出${i + 1}`, `输出${i + 1}`, i === 7 ? [1] : [])),
  );
  check("最多 8 个口", api.targetOutputCount(node) === 8);
  api.ensureOutputs(node, 20);
  check("超过上限不再增加", node.outputs.length === 8);
}
{
  const node = makeNode([
    makeOutput("输出1", "输出1", [1]),
    makeOutput("输出2", "输出2"),
    makeOutput("输出3", "输出3"),
  ]);
  api.pruneOutputs(node, 2);
  check("尾部空闲口被收回", node.outputs.length === 2);
}
{
  const node = makeNode([
    makeOutput("输出1", "输出1"),
    makeOutput("输出2", "输出2", [9]),
  ]);
  api.pruneOutputs(node, 1);
  check("已连线的口绝不回收", node.outputs.length === 2);
}

console.log("== 3. 选择框内容 ==");
{
  const node = makeNode([makeOutput("输出1", "提示词优化A"), makeOutput("输出2", "提示词优化B")], "输出1");
  const names = api.syncSelectWidget(node);
  check("下拉项是输出口名称", JSON.stringify(names) === JSON.stringify(["提示词优化A", "提示词优化B"]));
  check("widget.options.values 同步", JSON.stringify(node.widgets[0].options.values) === JSON.stringify(names));
  check("旧值有对应口时保留", node.widgets[0].value === "提示词优化A");
}
{
  const node = makeNode([makeOutput("输出1", "输出1"), makeOutput("输出2", "输出2")], "2");
  api.syncSelectWidget(node, ["输出1", "输出2"]);
  check("数字写法映射到同名口", node.widgets[0].value === "输出2");
}
{
  const node = makeNode([makeOutput("输出1", "输出1"), makeOutput("输出2", "输出2")], "不存在");
  api.syncSelectWidget(node, ["输出1", "输出2"]);
  check("对不上时退回第一个口", node.widgets[0].value === "输出1");
}
{
  const node = makeNode([makeOutput("输出1", "输出1")], "输出1");
  node.widgets[0].options.values = () => [];
  const names = api.syncSelectWidget(node, ["输出1"]);
  check("远端下拉（函数）不被覆盖", typeof node.widgets[0].options.values === "function");
  check("仍返回当前名称", JSON.stringify(names) === JSON.stringify(["输出1"]));
}

console.log("== 4. 改名后选中项不丢 ==");
{
  const before = ["输出1", "输出2", "输出3"];
  const after = ["提示词优化A", "提示词优化B", "输出3"];
  check("按位置把旧名字换成新名字", api.remapValue("输出2", after, before) === "提示词优化B");
  check("没变的名字原样保留", api.remapValue("输出3", after, before) === "输出3");
  check("已经选中的新名字不被改写", api.remapValue("提示词优化A", after, before) === "提示词优化A");
  check("旧名字已不存在且无位置信息时退回第一个", api.remapValue("老名字", after, []) === "提示词优化A");
  check("空列表返回空字符串", api.remapValue("x", [], []) === "");
}

console.log("== 5. 序号解析 ==");
{
  const names = ["输出1", "提示词优化B", "输出3"];
  check("精确命中", api.selectedIndex("提示词优化B", names) === 1);
  check("输出N 命中", api.selectedIndex("输出3", names) === 2);
  check("数字命中", api.selectedIndex("2", names) === 1);
  check("outputN 命中", api.selectedIndex("output2", names) === 1);
  check("越界返回 -1", api.selectedIndex("9", names) === -1);
  check("空值返回 -1", api.selectedIndex("", names) === -1);
}

console.log("== 6. 无 select 控件时安全返回 ==");
{
  const node = { outputs: [makeOutput("输出1", "输出1")], widgets: [] };
  check("没有 select 控件返回 null", api.selectWidget(node) === null);
  check("同步不抛异常且返回数组", Array.isArray(api.syncSelectWidget(node)));
}

console.log("== 7. 轮询开关 ==");
{
  const node = makeNode([makeOutput("输出1", "输出1"), makeOutput("输出2", "输出2")]);
  node.widgets.push({ name: "轮询输出", value: false, options: {} });
  check("默认关闭", api.isPolling(node) === false);
  api.applyPollingState(node);
  check("关闭时选择框可改", !node.widgets[0].disabled);
  node.widgets[1].value = true;
  api.applyPollingState(node);
  check("开启后选择框置灰", node.widgets[0].disabled === true);
  check("开启后 options.disabled 也置位", node.widgets[0].options.disabled === true);
  node.widgets[1].value = false;
  api.applyPollingState(node);
  check("关回去后恢复可改", !node.widgets[0].disabled && !node.widgets[0].options.disabled);
}
{
  const node = makeNode([makeOutput("输出1", "输出1")]);
  check("没有轮询控件时视为关闭", api.isPolling(node) === false);
  check("没有轮询控件时不抛异常", api.applyPollingState(node) === undefined);
}

console.log("== 8. 已连接的口与轮换顺序 ==");
{
  const node = makeNode([
    makeOutput("输出1", "输出1", [1]),
    makeOutput("输出2", "输出2"),
    makeOutput("输出3", "输出3", [2]),
  ]);
  check("只列出已连接的口", JSON.stringify(api.connectedIndexes(node)) === JSON.stringify([0, 2]));
}
{
  const names = ["输出1", "输出2", "输出3"];
  const allLinked = [makeOutput("输出1", "输出1", [1]), makeOutput("输出2", "输出2", [2]), makeOutput("输出3", "输出3", [3])];
  const node = makeNode(allLinked, "输出1");
  node.widgets.push({ name: "轮询输出", value: true, options: {} });
  check("轮询关闭时按选择框走", api.resolveTargetIndex(makeNode(allLinked, "输出3")) === 2);
  check("轮询开启时从选择框的下一个口继续", api.resolveTargetIndex(node) === 1);
  api.setPollingIndex(node, 1);
  check("推进后指向下一个口", node.widgets[0].value === "输出2");
  check("下一次目标再往后", api.resolveTargetIndex(node) === 2);
  api.setPollingIndex(node, 2);
  check("最后一个口时判定本轮结束", api.pollingFinished(node) === true);
  api.setPollingIndex(node, 0);
  check("回到第一个口时不算结束", api.pollingFinished(node) === false);
}
{
  // 只接 1、3 两个口：轮换要跳过没接线的 2
  const node = makeNode([
    makeOutput("输出1", "输出1", [1]),
    makeOutput("输出2", "输出2"),
    makeOutput("输出3", "输出3", [3]),
  ], "输出1");
  node.widgets.push({ name: "轮询输出", value: true, options: {} });
  check("跳过未连接的口", api.resolveTargetIndex(node) === 2);
  api.setPollingIndex(node, 2);
  check("走到最后一个已连接口即结束", api.pollingFinished(node) === true);
  api.setPollingIndex(node, 0);
  check("只接了 1、3 时 2 也算未结束（后面还有 3）", api.pollingFinished(node) === false);
}
{
  // 一个口都没接：退回选择框的值，且视为结束，避免自动排队空转
  const node = makeNode([makeOutput("输出1", "输出1"), makeOutput("输出2", "输出2")], "输出1");
  node.widgets.push({ name: "轮询输出", value: true, options: {} });
  check("没接线时按选择框走", api.resolveTargetIndex(node) === 0);
  check("没接线时判定结束", api.pollingFinished(node) === true);
}
{
  const node = makeNode([makeOutput("输出1", "输出1", [1])], "输出1");
  check("写入越界序号返回 false", api.setPollingIndex(node, 5) === false);
  check("越界时不改值", node.widgets[0].value === "输出1");
}
{
  const node = makeNode([makeOutput("输出1", "输出1"), makeOutput("输出2", "输出2")], "输出1");
  let fired = [];
  node.widgets[0].callback = (value) => fired.push(value);
  node.widgets.push({ name: "轮询输出", value: true, options: {} });
  api.setPollingIndex(node, 1);
  check("切换口时触发 callback（写进 prompt）", JSON.stringify(fired) === JSON.stringify(["输出2"]));
}

console.log("== 9. 轮询开启时选择框仍随改名同步 ==");
{
  const node = makeNode([makeOutput("输出1", "输出1", [1]), makeOutput("输出2", "输出2", [2])], "输出1");
  node.widgets.push({ name: "轮询输出", value: true, options: {} });
  node.outputs[0].label = "优化器A";
  api.syncSelectWidget(node, ["输出1", "输出2"]);
  check("改名后下拉项更新", JSON.stringify(node.widgets[0].options.values) === JSON.stringify(["优化器A", "输出2"]));
  check("轮询开启时选择框仍保持置灰", node.widgets[0].disabled === true);
}

console.log("");
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
