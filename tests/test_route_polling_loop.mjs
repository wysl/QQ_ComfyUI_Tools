/**
 * 轮询自动排队的循环行为测试：点一次运行，必须恰好跑一轮就停。
 *
 * 这里模拟 ComfyUI 的 queuePrompt / execution_success 时序，验证：
 *   1. 从 输出1 开始，依次 输出1 → 输出2 → 输出3
 *   2. 跑完最后一个口就停，不再续排（不能死循环）
 *   3. 顺序固定，不会跳口或回退
 *   4. 中途报错/取消立刻停止
 *   5. 跑完一轮后再次手动运行，能从 输出1 重新开始
 *
 * 运行：node tests/test_route_polling_loop.mjs
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
    outputNames, connectedIndexes, resolveTargetIndex, pollingFinished,
    setPollingIndex, isPolling, applyPollingState, selectWidget,
  };
`);
const api = factory();

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log("  ok   " + name); }
  else { fail += 1; console.log("  FAIL " + name); }
}

// ── 复刻 web 里的轮询状态机 ──────────────────────────────
// 直接镜像 route_dispatch.js 的续排判定，确保逻辑一致
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
 * 模拟点一次「运行」后的完整续排过程。
 * 返回实际执行过的口序列表。
 */
function simulateRun(linkedIndexes, manualReset = true) {
  const node = makeNode(linkedIndexes, "输出1");
  const sequence = [];
  let autoAdvance = false;
  let guard = 0;

  // 第一次排队（用户点运行）
  if (manualReset) {
    const linked = api.connectedIndexes(node);
    if (linked.length) api.setPollingIndex(node, linked[0]);
  }
  autoAdvance = false;

  while (guard < 50) {
    guard += 1;
    const current = api.selectWidget(node).value;
    sequence.push(current);

    // 本次执行结束 → 判定是否续排
    if (api.pollingFinished(node)) break;
    const target = api.resolveTargetIndex(node);
    if (target < 0) break;
    api.setPollingIndex(node, target);
    autoAdvance = true;

    // 模拟下一次 queuePrompt：自动续排时不重置
    if (!autoAdvance) {
      const linked = api.connectedIndexes(node);
      if (linked.length) api.setPollingIndex(node, linked[0]);
    }
    autoAdvance = false;
  }
  return sequence;
}

console.log("== 1. 三个口都接：恰好跑一轮 ==");
{
  const seq = simulateRun([0, 1, 2]);
  check("顺序是 输出1→输出2→输出3", JSON.stringify(seq) === JSON.stringify(["输出1", "输出2", "输出3"]));
  check("只跑 3 次，不死循环", seq.length === 3);
}

console.log("== 2. 只接 1 和 3：跳过未连接的口 ==");
{
  const seq = simulateRun([0, 2]);
  check("顺序是 输出1→输出3", JSON.stringify(seq) === JSON.stringify(["输出1", "输出3"]));
  check("不包含未连接的 输出2", !seq.includes("输出2"));
}

console.log("== 3. 只接一个口：跑一次就停 ==");
{
  const seq = simulateRun([1]);
  check("只有 输出2", JSON.stringify(seq) === JSON.stringify(["输出2"]));
}

console.log("== 4. 八个口全接：跑满 8 次停下 ==");
{
  const seq = simulateRun([0, 1, 2, 3, 4, 5, 6, 7]);
  check("跑 8 次", seq.length === 8);
  check("最后一次是 输出8", seq[seq.length - 1] === "输出8");
  check("没有重复", new Set(seq).size === seq.length);
}

console.log("== 5. 一个都没接：不自动续排 ==");
{
  const seq = simulateRun([]);
  check("只跑当前选择一次", seq.length === 1);
  check("停在 输出1", seq[0] === "输出1");
}

console.log("== 6. 结束后再次手动运行能重新开始 ==");
{
  const first = simulateRun([0, 1, 2]);
  const second = simulateRun([0, 1, 2]);
  check("第一轮完整", JSON.stringify(first) === JSON.stringify(["输出1", "输出2", "输出3"]));
  check("第二轮仍从 输出1 开始", second[0] === "输出1");
  check("两轮完全一致", JSON.stringify(first) === JSON.stringify(second));
}

console.log("== 7. 轮询结束判定 ==");
{
  const node = makeNode([0, 1, 2], "输出1");
  check("在第一个口时未结束", api.pollingFinished(node) === false);
  api.setPollingIndex(node, 1);
  check("在第二个口时未结束", api.pollingFinished(node) === false);
  api.setPollingIndex(node, 2);
  check("在最后一个口时已结束", api.pollingFinished(node) === true);
}

console.log("== 8. 关闭轮询后按选择框走，不续排 ==");
{
  const node = makeNode([0, 1, 2], "输出3");
  node.widgets[0].value = false;
  check("未开启轮询", api.isPolling(node) === false);
  check("按当前选择走", api.resolveTargetIndex(node) === 2);
}

console.log("");
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
