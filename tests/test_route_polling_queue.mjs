/**
 * 轮询提交链测试：点一次运行，N 个口各提交一次，且每份 prompt 里的
 * select 就是该轮该走的口。
 *
 * 前几版失败的共同点：值改了但没进到那一轮的 prompt 里。所以这里的
 * 观测点放在「序列化出来的 prompt」上，而不是节点当前值。
 *
 * 运行：node tests/test_route_polling_queue.mjs
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
    connectedIndexes, selectWidget, isPolling, outputNames,
  };
`);
const api = factory();

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log("  ok   " + name); }
  else { fail += 1; console.log("  FAIL " + name); }
}

function makeNode(linkedIndexes, startValue) {
  const outputs = Array.from({ length: 8 }, (_, i) => ({
    name: `输出${i + 1}`,
    label: `输出${i + 1}`,
    links: linkedIndexes.includes(i) ? [i + 1] : [],
    type: "*",
  }));
  return {
    type: "QQRouteDispatch",
    id: 10,
    outputs,
    widgets: [
      { name: "轮询输出", value: true, options: {} },
      { name: "select", value: startValue, options: { values: [] } },
    ],
    setDirtyCanvas() {},
  };
}

function writeSelectValue(node, index) {
  const widget = api.selectWidget(node);
  const names = api.outputNames(node);
  if (!widget || index < 0 || index >= names.length) return false;
  widget.value = names[index];
  return true;
}

/**
 * 复刻 runPollingRound：每轮先写值，再序列化，再提交。
 * serialize 会读取节点当前状态 —— 与真实 graphToPrompt 一致。
 */
async function runRound(node) {
  const entry = { node, indexes: api.connectedIndexes(node), original: api.selectWidget(node).value };
  const plan = [entry];
  const submitted = [];   // 每次提交的 prompt 里 select 的值
  let serializeCalls = 0;

  const graphToPrompt = async () => {
    serializeCalls += 1;
    // 真实行为：读当前节点状态
    return { output: { "10": { inputs: { select: api.selectWidget(node).value } } } };
  };
  const queuePrompt = async (number, built) => {
    submitted.push(built.output["10"].inputs.select);
    return true;
  };

  const rounds = Math.max(...plan.map((e) => e.indexes.length));
  for (let round = 0; round < rounds; round += 1) {
    for (const e of plan) {
      writeSelectValue(e.node, e.indexes[Math.min(round, e.indexes.length - 1)]);
    }
    const built = await graphToPrompt();
    await queuePrompt(0, built);
  }
  // 还原
  for (const e of plan) {
    if (e.indexes.length) writeSelectValue(e.node, e.indexes[0]);
  }
  return { submitted, serializeCalls, finalValue: api.selectWidget(node).value };
}

console.log("== 1. 三个口：每轮提交不同的 select ==");
{
  const node = makeNode([0, 1, 2], "输出2");
  const { submitted } = await runRound(node);
  check("提交了 3 次", submitted.length === 3);
  check("依次是 输出1/输出2/输出3", JSON.stringify(submitted) === JSON.stringify(["输出1", "输出2", "输出3"]));
  check("不是三次都一样", new Set(submitted).size === 3);
}

console.log("== 2. 每轮都重新序列化 ==");
{
  const node = makeNode([0, 1, 2], "输出1");
  const { serializeCalls } = await runRound(node);
  check("序列化次数等于轮次数", serializeCalls === 3);
}

console.log("== 3. 提交后还原成第一个口 ==");
{
  const node = makeNode([0, 1, 2], "输出3");
  const { finalValue } = await runRound(node);
  check("结束后选择框停在 输出1", finalValue === "输出1");
}

console.log("== 4. 只接 1、3：跳过 2 ==");
{
  const node = makeNode([0, 2], "输出1");
  const { submitted } = await runRound(node);
  check("提交 2 次", submitted.length === 2);
  check("顺序是 输出1→输出3", JSON.stringify(submitted) === JSON.stringify(["输出1", "输出3"]));
}

console.log("== 5. 只接一个口：只提交一次 ==");
{
  const node = makeNode([1], "输出1");
  const { submitted } = await runRound(node);
  check("只提交 1 次", submitted.length === 1);
  check("走的是 输出2", submitted[0] === "输出2");
}

console.log("== 6. 八个口：提交 8 次，顺序完整 ==");
{
  const node = makeNode([0, 1, 2, 3, 4, 5, 6, 7], "输出1");
  const { submitted } = await runRound(node);
  check("提交 8 次", submitted.length === 8);
  check("顺序完整且无重复", JSON.stringify(submitted) === JSON.stringify(
    ["输出1", "输出2", "输出3", "输出4", "输出5", "输出6", "输出7", "输出8"]));
}

console.log("== 7. 连跑两轮，互不影响 ==");
{
  const node = makeNode([0, 1, 2], "输出1");
  const first = await runRound(node);
  const second = await runRound(node);
  check("两轮提交序列一致", JSON.stringify(first.submitted) === JSON.stringify(second.submitted));
  check("都从 输出1 开始", second.submitted[0] === "输出1");
}

console.log("");
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
