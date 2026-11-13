/**
 * 轮询提交链测试：点一次运行，N 个口各提交一次，且每份 prompt 里的
 * select 就是该轮该走的口。
 *
 * 真机 bug 回归：序列化可能只读 Vue 控件值存储（写 widget.value 无效），
 * 这里故意让 graphToPrompt 永远返回用户原选择，验证提交仍逐轮轮换。
 * 观测点放在「提交的 prompt」上，而不是节点当前值。
 *
 * 运行：node tests/test_route_polling_queue.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "web", "route_dispatch.js"), "utf8")
  .replace(/^import .*$/gm, "")
  .replace(/^export /gm, "");

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log("  ok   " + name); }
  else { fail += 1; console.log("  FAIL " + name); }
}

function makeNode(linkedIndexes, startValue, id = 10) {
  const outputs = Array.from({ length: 8 }, (_, i) => ({
    name: `输出${i + 1}`,
    label: `输出${i + 1}`,
    links: linkedIndexes.includes(i) ? [i + 1] : [],
    type: "*",
  }));
  return {
    type: "QQRouteDispatch",
    id,
    outputs,
    widgets: [
      { name: "轮询输出", value: true, options: {} },
      { name: "select", value: startValue, options: { values: [] } },
    ],
    setDirtyCanvas() {},
  };
}

/**
 * 装载真实 route_dispatch.js，graphToPrompt 冻结在 frozenSelect：
 * 模拟真机「写 widget.value 不进序列化」的最坏情况。
 */
function makeContext(node, frozenSelect) {
  let ext;
  const submitted = [];
  let serializeCalls = 0;
  let plainCalls = 0;
  const app = {
    registerExtension(v) { ext = v; },
    graph: { _nodes: [node], setDirtyCanvas() {} },
    rootGraph: {},
    async graphToPrompt() {
      serializeCalls += 1;
      return {
        output: {
          [node.id]: {
            class_type: "QQRouteDispatch",
            inputs: { select: frozenSelect, 轮询输出: true },
          },
        },
        workflow: { nodes: [{ id: node.id, widgets_values: [true, frozenSelect] }] },
      };
    },
    async queuePrompt() { plainCalls += 1; },
  };
  const api = {
    async queuePrompt(number, built) { submitted.push(built); },
  };
  vm.runInNewContext(src, { app, api, console, structuredClone });
  ext.setup(); // 安装 queuePrompt 钩子
  return { app, submitted, serializeCalls: () => serializeCalls, plainCalls: () => plainCalls };
}

const selects = (submitted) => submitted.map((b) => b.output[10].inputs.select);
const wfSelects = (submitted) => submitted.map((b) => b.workflow.nodes[0].widgets_values[1]);

console.log("== 1. 序列化冻结在用户选择：仍逐轮轮换（真机 bug 回归） ==");
{
  const node = makeNode([0, 1, 2], "输出2");
  const ctx = makeContext(node, "输出2");
  await ctx.app.queuePrompt(0, 1);
  check("提交了 3 次", ctx.submitted.length === 3);
  check("依次是 输出1/输出2/输出3", JSON.stringify(selects(ctx.submitted)) === JSON.stringify(["输出1", "输出2", "输出3"]));
  check("不是三次都跑选中的", new Set(selects(ctx.submitted)).size === 3);
  check("workflow 快照同步轮换", JSON.stringify(wfSelects(ctx.submitted)) === JSON.stringify(["输出1", "输出2", "输出3"]));
  check("选择框保持用户原值", node.widgets[1].value === "输出2");
  check("只序列化一次", ctx.serializeCalls() === 1);
}

console.log("== 2. 只接 1、3：跳过 2 ==");
{
  const node = makeNode([0, 2], "输出1");
  const ctx = makeContext(node, "输出1");
  await ctx.app.queuePrompt(0, 1);
  check("提交 2 次", ctx.submitted.length === 2);
  check("顺序是 输出1→输出3", JSON.stringify(selects(ctx.submitted)) === JSON.stringify(["输出1", "输出3"]));
}

console.log("== 3. 只接一个口：只提交一次 ==");
{
  const node = makeNode([1], "输出1");
  const ctx = makeContext(node, "输出1");
  await ctx.app.queuePrompt(0, 1);
  check("只提交 1 次", ctx.submitted.length === 1);
  check("走的是 输出2", selects(ctx.submitted)[0] === "输出2");
}

console.log("== 4. 八个口：提交 8 次，顺序完整 ==");
{
  const node = makeNode([0, 1, 2, 3, 4, 5, 6, 7], "输出1");
  const ctx = makeContext(node, "输出1");
  await ctx.app.queuePrompt(0, 1);
  check("提交 8 次", ctx.submitted.length === 8);
  check("顺序完整且无重复", JSON.stringify(selects(ctx.submitted)) === JSON.stringify(
    ["输出1", "输出2", "输出3", "输出4", "输出5", "输出6", "输出7", "输出8"]));
}

console.log("== 5. 连跑两轮，互不影响 ==");
{
  const node = makeNode([0, 1, 2], "输出3");
  const ctx = makeContext(node, "输出3");
  await ctx.app.queuePrompt(0, 1);
  const first = selects(ctx.submitted);
  ctx.submitted.length = 0;
  await ctx.app.queuePrompt(0, 1);
  check("两轮提交序列一致", JSON.stringify(first) === JSON.stringify(selects(ctx.submitted)));
  check("都从 输出1 开始", selects(ctx.submitted)[0] === "输出1");
}

console.log("== 6. 轮询关闭：走原始 queuePrompt，不展开 ==");
{
  const node = makeNode([0, 1, 2], "输出2");
  node.widgets[0].value = false;
  const ctx = makeContext(node, "输出2");
  await ctx.app.queuePrompt(0, 1);
  check("不提交轮询 prompt", ctx.submitted.length === 0);
  check("原始队列调用一次", ctx.plainCalls() === 1);
}

console.log("== 7. 连点两次：排队完整轮换，不插选中口单跑 ==");
{
  const node = makeNode([0, 1, 2], "输出2");
  const ctx = makeContext(node, "输出2");
  await Promise.all([ctx.app.queuePrompt(0, 1), ctx.app.queuePrompt(0, 1)]);
  check("共提交 6 次", ctx.submitted.length === 6);
  check("两次完整轮换", JSON.stringify(selects(ctx.submitted)) === JSON.stringify(
    ["输出1", "输出2", "输出3", "输出1", "输出2", "输出3"]));
  check("没有原始队列单跑", ctx.plainCalls() === 0);
}

console.log("");
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
