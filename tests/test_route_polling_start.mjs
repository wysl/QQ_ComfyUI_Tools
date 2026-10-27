/**
 * 轮询起始口测试：必须在「序列化之前」把选择框拨正，否则本轮提交的仍是旧值。
 *
 * 复刻两个真实 bug：
 *   1. 开启轮询后第一个口没执行，直接从第二个开始
 *   2. 一轮结束后再次运行，从最后一个口开始而不是第一个
 *
 * 运行：node tests/test_route_polling_start.mjs
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
 * 复刻 route_dispatch.js 的 preparePollingForQueue + 提交 + 续排。
 * serializedAt 用来模拟「序列化时装进去的值」，这正是 bug 的观测点。
 */
function simulate(node, { manual }) {
  const submitted = [];
  let autoAdvance = node.__qqRouteAutoAdvance === true;

  // preparePollingForQueue：在序列化之前拨正
  if (!autoAdvance) {
    const linked = api.connectedIndexes(node);
    if (linked.length) api.setPollingIndex(node, linked[0]);
  }
  node.__qqRouteAutoAdvance = false;

  // 序列化 → 提交（此刻的 select 就是本轮实际执行的口）
  submitted.push(api.selectWidget(node).value);
  return submitted;
}

console.log("== 1. 开启轮询：第一个口必须执行 ==");
{
  // 用户本来停在 输出2，然后打开轮询点运行
  const node = makeNode([0, 1, 2], "输出2");
  const first = simulate(node, { manual: true });
  check("第一次提交走的是 输出1（而不是停在 输出2）", first[0] === "输出1");
}

console.log("== 2. 一轮结束后再次运行：回到输出1 ==");
{
  const node = makeNode([0, 1, 2], "输出1");
  const seq = [];
  // 完整跑一轮：手动 → 续排 → 续排
  seq.push(...simulate(node, { manual: true }));
  for (let i = 0; i < 2; i += 1) {
    if (api.pollingFinished(node)) break;
    const target = api.resolveTargetIndex(node);
    api.setPollingIndex(node, target);
    node.__qqRouteAutoAdvance = true;
    seq.push(...simulate(node, { manual: false }));
  }
  check("一轮是 输出1→输出2→输出3", JSON.stringify(seq) === JSON.stringify(["输出1", "输出2", "输出3"]));

  // select 现在停在 输出3，用户再次点运行
  const again = simulate(node, { manual: true });
  check("再次运行从 输出1 开始（而不是 输出3）", again[0] === "输出1");
}

console.log("== 3. 停在任意口再点运行，都从第一个已连接口开始 ==");
{
  for (const parked of ["输出1", "输出2", "输出3"]) {
    const node = makeNode([0, 1, 2], parked);
    const got = simulate(node, { manual: true })[0];
    check(`停在 ${parked} → 运行从 输出1 开始`, got === "输出1");
  }
}
{
  const node = makeNode([1, 2], "输出2");
  const got = simulate(node, { manual: true })[0];
  check("第一个口没接线时，从第一个已连接的 输出2 开始", got === "输出2");
}

console.log("== 4. 自动续排必须保持当前口（不能被拨回首口）==");
{
  const node = makeNode([0, 1, 2], "输出1");
  simulate(node, { manual: true });
  check("手动运行后停在 输出1", api.selectWidget(node).value === "输出1");

  // 续排到 输出2
  const target = api.resolveTargetIndex(node);
  api.setPollingIndex(node, target);
  node.__qqRouteAutoAdvance = true;
  const submitted = simulate(node, { manual: false });
  check("续排提交的是 输出2（没有被拨回 输出1）", submitted[0] === "输出2");
  check("推进后停在 输出2", api.selectWidget(node).value === "输出2");
}

console.log("== 5. 完整一轮：每个口只提交一次 ==");
{
  const node = makeNode([0, 1, 2], "输出2");
  const seq = simulate(node, { manual: true });
  let guard = 0;
  while (guard < 20) {
    guard += 1;
    if (api.pollingFinished(node)) break;
    const target = api.resolveTargetIndex(node);
    api.setPollingIndex(node, target);
    node.__qqRouteAutoAdvance = true;
    seq.push(...simulate(node, { manual: false }));
  }
  check("恰好三次", seq.length === 3);
  check("顺序固定为 1→2→3", JSON.stringify(seq) === JSON.stringify(["输出1", "输出2", "输出3"]));
  check("无重复", new Set(seq).size === seq.length);
}

console.log("== 6. 关掉轮询后不受影响 ==");
{
  const node = makeNode([0, 1, 2], "输出3");
  node.widgets[0].value = false;
  check("未开启轮询", api.isPolling(node) === false);
  check("保持用户选择 输出3", api.selectWidget(node).value === "输出3");
}

console.log("");
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
