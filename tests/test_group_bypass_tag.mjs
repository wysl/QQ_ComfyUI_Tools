/**
 * Regression tests for the group bypass tag (web/group_bypass_tag.js).
 *
 * 覆盖：
 *   1. 绕过 = 组内除魔术贴外全部 Bypass
 *   2. 启用 = 恢复被标记节点的原状态，用户手动绕过不动
 *   3. 魔术贴自己永远不被绕过（含被外部强行设为 BYPASS 时拉回）
 *   4. 同组多个魔术贴互不绕过
 *   5. 不在任何组里 = 不动作
 *   6. 嵌套组只作用最内层
 *
 * 运行：node tests/test_group_bypass_tag.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "web", "group_bypass_tag.js"), "utf8");

const cut = src.indexOf("function safeApply");
const pure = src
  .slice(0, cut)
  .replace(/^import .*$/m, "")
  .replace(/^const (NODE_TYPE|TAG|PROP_PREV_MODE|MODE_ON|MODE_BYPASS) = .*$/gm, "");

const factory = new Function(`
  const globalThis = {};
  const app = null;
  const NODE_TYPE = "QQGroupBypassTag";
  const PROP_PREV_MODE = "wyslPrevMode";
  const MODE_ON = "启用";
  const MODE_BYPASS = "绕过";
  ${pure}
  return { applyTag, setBypassed, isTagNode, tagMode, groupOf, nodesInGroup };
`);
const api = factory();

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log("  ok   " + name); }
  else { fail += 1; console.log("  FAIL " + name); }
}

function makeNode(type, mode = 0) {
  const state = { mode, properties: {} };
  return {
    type,
    comfyClass: type,
    _state: state,
    get mode() { return this._state.mode; },
    set mode(v) { this._state.mode = v; },
    get properties() { return this._state.properties; },
    widgets: [],
  };
}

function makeTag(mode) {
  const node = makeNode("QQGroupBypassTag");
  node.widgets = [{ name: "模式", value: mode }];
  return node;
}

function makeGraph(nodes, groups) {
  return { _nodes: nodes, _groups: groups, setDirtyCanvas() {}, change() {} };
}

console.log("== 1. 绕过：组内除魔术贴外全部 Bypass ==");
{
  const tag = makeTag("绕过");
  const a = makeNode("Foo");
  const b = makeNode("Bar", 2); // NEVER，恢复时应还原 2
  const group = { size: [200, 200], nodes: [tag, a, b] };
  const graph = makeGraph([tag, a, b], [group]);
  api.applyTag(graph);
  check("a 被绕过", a.mode === 4);
  check("b 被绕过", b.mode === 4);
  check("b 原状态被记录", b.properties.wyslPrevMode === 2);
  check("魔术贴保持启用态", tag.mode === 0);
}

console.log("== 2. 启用：恢复原状态，手动绕过不动 ==");
{
  const tag = makeTag("绕过");
  const a = makeNode("Foo");
  const manual = makeNode("Manual", 4); // 用户自己右键绕过的，无标记
  const group = { size: [200, 200], nodes: [tag, a, manual] };
  const graph = makeGraph([tag, a, manual], [group]);
  api.applyTag(graph);
  check("a 被绕过", a.mode === 4);
  check("手动绕过的也被记录后绕过", manual.mode === 4);
  tag.widgets[0].value = "启用";
  api.applyTag(graph);
  check("a 恢复为 ALWAYS", a.mode === 0);
  check("记录被清除", a.properties.wyslPrevMode === undefined);
}

console.log("== 3. 魔术贴自己永远不被绕过 ==");
{
  const tag = makeTag("启用");
  tag.mode = 4; // 被外部（规则/手滑）设成绕过
  const a = makeNode("Foo");
  const group = { size: [200, 200], nodes: [tag, a] };
  api.applyTag(makeGraph([tag, a], [group]));
  check("魔术贴被拉回 ALWAYS", tag.mode === 0);
  check("组内节点不受影响", a.mode === 0);
}

console.log("== 4. 同组多个魔术贴互不绕过 ==");
{
  const tag1 = makeTag("绕过");
  const tag2 = makeTag("启用");
  const a = makeNode("Foo");
  const group = { size: [200, 200], nodes: [tag1, tag2, a] };
  api.applyTag(makeGraph([tag1, tag2, a], [group]));
  check("普通节点被绕过", a.mode === 4);
  check("第二个魔术贴不被绕过", tag2.mode === 0);
}

console.log("== 5. 不在任何组里 = 不动作 ==");
{
  const tag = makeTag("绕过");
  const a = makeNode("Foo");
  const graph = makeGraph([tag, a], []);
  api.applyTag(graph);
  check("组外节点不动", a.mode === 0);
  const other = makeNode("Other");
  const group = { size: [200, 200], nodes: [other] };
  api.applyTag(makeGraph([tag, other], [group]));
  check("别的组节点不动", other.mode === 0);
}

console.log("== 6. 嵌套组只作用最内层 ==");
{
  const tag = makeTag("绕过");
  const inner = makeNode("Inner");
  const outer = makeNode("Outer");
  const innerGroup = { size: [100, 100], nodes: [tag, inner] };
  const outerGroup = { size: [400, 400], nodes: [tag, inner, outer] };
  api.applyTag(makeGraph([tag, inner, outer], [outerGroup, innerGroup]));
  check("内层节点被绕过", inner.mode === 4);
  check("外层节点不动", outer.mode === 0);
}

console.log("");
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
