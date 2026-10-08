/**
 * Regression tests for QQ-多值输入 widget labels (web/multi_primitive.js).
 * 目标输入口精确为 模式/启用/规则 时，体内选择框标签继承本节点输出口的自定义名；
 * 只允许读本节点输出口的 label/name，禁止读取连接节点的任何信息。
 * 运行：node tests/test_multi_primitive_labels.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "web", "multi_primitive.js"), "utf8");

const a = src.slice(src.indexOf("function inputDisplayName"), src.indexOf("function outputHasLink"));
const b = src.slice(src.indexOf("function syncWidgetLabels"), src.indexOf("function startLabelSync"));

const factory = new Function(`
  const NODE_TYPE = "QQ-多值输入";
  const LEGACY_NODE_TYPE = "QQMultiPrimitive";
  ${a}
  ${b}
  return { inputDisplayName, customOutputName, widgetLabelFor, syncWidgetLabels, LABEL_SOURCE_INPUT_NAMES };
`);
const api = factory();

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log("  ok   " + name); }
  else { fail += 1; console.log("  FAIL " + name); }
}

const info = (inputName, label) => ({ input: { name: inputName, label }, targetNode: { title: "QQ-魔术贴" } });
const nodeWith = (output) => ({ outputs: [output] });

console.log("== 1. 自定义名来源：只认本节点输出口 ==");
check("label 优先", api.customOutputName(nodeWith({ label: "测试一下", name: "启用 1" }), 0) === "测试一下");
check("非自动 name 也算自定义", api.customOutputName(nodeWith({ name: "我希望显示的" }), 0) === "我希望显示的");
check("自动名（带序号后缀）不算", api.customOutputName(nodeWith({ name: "启用 1" }), 0) === "");
check("空输出口不算", api.customOutputName(nodeWith({ name: "空 1" }), 0) === "");
check("没有输出口不算", api.customOutputName({}, 0) === "");

console.log("== 2. 白名单内继承到选择框标签 ==");
check("启用 + 自定义名", api.widgetLabelFor(nodeWith({ label: "测试一下" }), 0, info("启用"), "输入 1") === "测试一下");
check("模式 + 自定义名", api.widgetLabelFor(nodeWith({ label: "整组开关" }), 0, info("模式"), "输入 2") === "整组开关");
check("规则 + 自定义名", api.widgetLabelFor(nodeWith({ label: "总闸" }), 0, info("规则"), "输入 3") === "总闸");
check("不拼接消费者标题", !api.widgetLabelFor(nodeWith({ label: "测试一下" }), 0, info("启用"), "输入 1").includes("魔术贴"));

console.log("== 3. 没有自定义名 / 白名单外保持原样 ==");
check("启用 无自定义名 → 输入口名", api.widgetLabelFor(nodeWith({ name: "启用 1" }), 0, info("启用"), "输入 1") === "启用");
check("输入口自定义 label 优先于 name", api.widgetLabelFor(nodeWith({ name: "启用 1" }), 0, info("启用", "整组绕过"), "输入 1") === "整组绕过");
check("任务模式 不继承", api.widgetLabelFor(nodeWith({ label: "测试一下" }), 0, info("任务模式"), "输入 1") === "任务模式");
check("启用接线 不继承", api.widgetLabelFor(nodeWith({ label: "测试一下" }), 0, info("启用接线"), "输入 1") === "启用接线");

console.log("== 4. 巡检同步与还原 ==");
{
  const widget = { name: "value_1", label: "启用", __h3MultiPrimitiveSlot: 0 };
  const node = {
    type: "QQ-多值输入",
    outputs: [{ label: "测试一下", name: "启用 1", links: [1] }],
    widgets: [widget],
    resolveOutputTarget: () => info("启用"),
  };
  const graph = { _nodes: [node], setDirtyCanvas() {} };
  api.syncWidgetLabels(graph);
  check("标签同步为自定义名", widget.label === "测试一下");
  node.outputs[0].label = "";
  node.outputs[0].name = "启用 1";
  api.syncWidgetLabels(graph);
  check("自定义名清掉后还原", widget.label === "启用");
  const other = { type: "OtherNode", outputs: [{ label: "x" }], widgets: [] };
  const graph2 = { _nodes: [other], setDirtyCanvas() {} };
  api.syncWidgetLabels(graph2);
  check("其它节点类型不动", other.outputs[0].label === "x" && other.widgets.length === 0);
}

console.log("== 5. 白名单常量 ==");
check("四个精确名字", JSON.stringify(api.LABEL_SOURCE_INPUT_NAMES) === JSON.stringify(["模式", "启用", "规则", "开关"]));

console.log("");
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
