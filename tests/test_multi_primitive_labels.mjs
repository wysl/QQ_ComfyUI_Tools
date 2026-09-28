/**
 * Regression tests for the multi-value node's consumer-identity labels
 * (web/multi_primitive.js 的 controlDisplayName).
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
  return { inputDisplayName, controlDisplayName, LABEL_SOURCE_INPUT_NAMES };
`);
const api = factory();

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log("  ok   " + name); }
  else { fail += 1; console.log("  FAIL " + name); }
}

const info = (inputName, title, label, type) => ({
  input: { name: inputName, label, type },
  targetNode: { title, type: type || "SomeType" },
});

console.log("== 1. 白名单内：带上消费者节点身份 ==");
check("模式 → 节点标题.模式", api.controlDisplayName(info("模式", "QQ-魔术贴"), "输入 1") === "QQ-魔术贴.模式");
check("启用 → 节点标题.启用", api.controlDisplayName(info("启用", "QQ-获取点"), "输入 2") === "QQ-获取点.启用");
check("规则 → 节点标题.规则", api.controlDisplayName(info("规则", "QQ-绕过规则"), "输入 3") === "QQ-绕过规则.规则");
check("输入口自定义 label 优先于 name", api.controlDisplayName(info("模式", "QQ-魔术贴", "整组绕过"), "输入 1") === "QQ-魔术贴.整组绕过");
check("没有标题时退化为类型", api.controlDisplayName(info("模式", "", undefined, "QQMagicTag"), "输入 1") === "QQMagicTag.模式");

console.log("== 2. 白名单外：保持原样 ==");
check("任务模式不加前缀", api.controlDisplayName(info("任务模式", "QQ-增强"), "输入 1") === "任务模式");
check("启用接线不加前缀", api.controlDisplayName(info("启用接线", "QQ-获取点"), "输入 1") === "启用接线");
check("select 不加前缀", api.controlDisplayName(info("select", "QQ-潜空间切换"), "输入 1") === "select");

console.log("== 3. 基础回退 ==");
check("value_N 回退到 fallback", api.inputDisplayName({ input: { name: "value_2" } }, "输入 2") === "输入 2");
check("空名字回退到 fallback", api.inputDisplayName({ input: {} }, "输入 3") === "输入 3");

console.log("");
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
