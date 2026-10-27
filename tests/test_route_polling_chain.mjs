/**
 * 续排链条测试：验证 app.queuePrompt 返回布尔值时，仍能完成 1→2→3 的完整续排。
 *
 * 之前两个测试都没覆盖「app.queuePrompt 返回 boolean」这个事实，
 * 于是 queuedRuns 永远为空、advancePolling 第一行就返回，
 * 表现就是「只跑输出1」。这里用与真实前端一致的签名来复刻整条链路。
 *
 * 运行：node tests/test_route_polling_chain.mjs
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
    connectedIndexes, resolveTargetIndex, pollingFinished, setPollingIndex,
    isPolling, selectWidget,
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
    outputs,
    widgets: [
      { name: "轮询输出", value: true, options: {} },
      { name: "select", value: startValue, options: { values: [] } },
    ],
    setDirtyCanvas() {},
  };
}

/**
 * 复刻 web/route_dispatch.js 的完整链路：
 *   preparePollingForQueue → 序列化提交 → execution_success → 认领快照 → advancePolling
 *
 * 关键：app.queuePrompt 返回 boolean（真实行为），prompt_id 只能从
 * execution_success 事件里拿。这正是之前漏掉的一环。
 */
function runFullCycle(node, { maxRounds = 20 } = {}) {
  const submitted = [];
  let pendingSnapshot = null;
  const queuedRuns = new Map();
  let autoAdvanceFlag = false;
  let guard = 0;

  function prepare() {
    const nodes = new Map();
    const linked = api.connectedIndexes(node);
    if (!autoAdvanceFlag && linked.length) api.setPollingIndex(node, linked[0]);
    autoAdvanceFlag = false;
    nodes.set(String(node.id), JSON.stringify({ value: api.selectWidget(node).value }));
    pendingSnapshot = nodes.size ? { nodes } : null;
  }

  function submit() {
    // 序列化：此刻的 select 就是本轮执行的口
    submitted.push(api.selectWidget(node).value);
    // app.queuePrompt 返回 boolean —— 拿不到 prompt_id
    return true;
  }

  function onSuccess(promptId) {
    const record = pendingSnapshot;
    pendingSnapshot = null;
    if (record && promptId) queuedRuns.set(promptId, record);

    // advancePolling
    const got = queuedRuns.get(promptId);
    queuedRuns.delete(promptId);
    if (!got) return false;
    if (api.pollingFinished(node)) return false;

    const target = api.resolveTargetIndex(node);
    if (!api.setPollingIndex(node, target)) return false;
    autoAdvanceFlag = true;
    return true;
  }

  // 用户点一次运行
  prepare();
  submit();

  while (guard < maxRounds) {
    guard += 1;
    const shouldContinue = onSuccess(`p-${guard}`);
    if (!shouldContinue) break;
    prepare();
    submit();
  }
  return submitted;
}

console.log("== 1. 完整一轮：1→2→3 ==");
{
  const node = makeNode([0, 1, 2], "输出2");
  const seq = runFullCycle(node);
  check("依次执行 输出1→输出2→输出3", JSON.stringify(seq) === JSON.stringify(["输出1", "输出2", "输出3"]));
  check("不是只跑第一个", seq.length > 1);
  check("恰好三次", seq.length === 3);
}

console.log("== 2. 停在任意口开始，都从输出1 起跑 ==");
{
  for (const parked of ["输出1", "输出2", "输出3"]) {
    const node = makeNode([0, 1, 2], parked);
    const seq = runFullCycle(node);
    check(`停在 ${parked} → 一轮仍是 1→2→3`, JSON.stringify(seq) === JSON.stringify(["输出1", "输出2", "输出3"]));
  }
}

console.log("== 3. 第二轮仍从输出1 开始 ==");
{
  const node = makeNode([0, 1, 2], "输出1");
  const first = runFullCycle(node);
  const second = runFullCycle(node);
  check("第一轮完整", JSON.stringify(first) === JSON.stringify(["输出1", "输出2", "输出3"]));
  check("第二轮仍从 输出1 开始", second[0] === "输出1");
  check("两轮一致", JSON.stringify(first) === JSON.stringify(second));
}

console.log("== 4. 只接 1、3：跳过 2 ==");
{
  const node = makeNode([0, 2], "输出1");
  const seq = runFullCycle(node);
  check("顺序是 输出1→输出3", JSON.stringify(seq) === JSON.stringify(["输出1", "输出3"]));
}

console.log("== 5. 只接一个口：跑一次即停 ==");
{
  const node = makeNode([1], "输出1");
  const seq = runFullCycle(node);
  check("只执行 输出2 一次", JSON.stringify(seq) === JSON.stringify(["输出2"]));
}

console.log("== 6. 一个都没接：只跑一次 ==");
{
  const node = makeNode([], "输出1");
  const seq = runFullCycle(node);
  check("只跑一次", seq.length === 1);
}

console.log("== 7. 八个口：跑满 8 次 ==");
{
  const node = makeNode([0, 1, 2, 3, 4, 5, 6, 7], "输出1");
  const seq = runFullCycle(node);
  check("跑 8 次", seq.length === 8);
  check("顺序完整", JSON.stringify(seq) === JSON.stringify(
    ["输出1", "输出2", "输出3", "输出4", "输出5", "输出6", "输出7", "输出8"]));
}

console.log("");
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
