/**
 * Regression tests for QQ-多值输入 widget labels (web/multi_primitive.js).
 * 目标输入口精确为 模式/启用/规则 时，体内控件标签继承本节点输出口的自定义名。
 * 运行：node tests/test_multi_primitive_labels.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "web", "multi_primitive.js"), "utf8");

const start = src.indexOf("function inputDisplayName");
const end = src.indexOf("function outputHasLink");
const pure = src.slice(start, end);

const factory = new Function(`
  ${pure}
  return { inputDisplayName, widgetLabelFor, LABEL_SOURCE_INPUT_NAMES };
`);
const api = factory();

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log("  ok   " + name); }
  else { fail += 1; console.log("  FAIL " + name); }
}

const info = (inputName, label) => ({ input: { name: inputName, label }, targetNode: { title: "QQ-魔术贴" } });
const nodeWithOutputLabel = (label) => ({ outputs: [{ label }] });

console.log("== 1. 白名单内继承输出口自定义名 ==");
check("启用 + 输出口改名测试一下", api.widgetLabelFor(nodeWithOutputLabel("测试一下"), 0, info("启用"), "输入 1") === "测试一下");
check("模式 + 输出口改名", api.widgetLabelFor(nodeWithOutputLabel("我希望显示的"), 0, info("模式"), "输入 2") === "我希望显示的");
check("规则 + 输出口改名", api.widgetLabelFor(nodeWithOutputLabel("总闸"), 0, info("规则"), "输入 3") === "总闸");

console.log("== 2. 没有自定义名时保持原行为 ==");
check("启用 无自定义名 → 输入口名", api.widgetLabelFor({ outputs: [{}] }, 0, info("启用"), "输入 1") === "启用");
check("输入口自定义 label 优先", api.widgetLabelFor({ outputs: [{}] }, 0, info("启用", "整组绕过"), "输入 1") === "整组绕过");
check("value_N 回退 fallback", api.widgetLabelFor({ outputs: [{}] }, 0, { input: { name: "value_2" } }, "输入 2") === "输入 2");

console.log("== 3. 白名单外不继承 ==");
check("任务模式 不继承", api.widgetLabelFor(nodeWithOutputLabel("测试一下"), 0, info("任务模式"), "输入 1") === "任务模式");
check("启用接线 不继承", api.widgetLabelFor(nodeWithOutputLabel("测试一下"), 0, info("启用接线"), "输入 1") === "启用接线");
check("select 不继承", api.widgetLabelFor(nodeWithOutputLabel("测试一下"), 0, info("select"), "输入 1") === "select");

console.log("== 4. 白名单常量 ==");
check("三个精确名字", JSON.stringify(api.LABEL_SOURCE_INPUT_NAMES) === JSON.stringify(["模式", "启用", "规则"]));

console.log("");
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
