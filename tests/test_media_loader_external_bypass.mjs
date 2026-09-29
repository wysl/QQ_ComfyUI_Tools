/**
 * Regression tests for QQ-多媒体加载 external-image row visibility
 * (web/media_loader.js): the 外部图片序号 row must disappear when the
 * upstream node feeding external_images is bypassed.
 * 运行：node tests/test_media_loader_external_bypass.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "web", "media_loader.js"), "utf8");

const start = src.indexOf("const BYPASS_MODE");
const end = src.indexOf("function syncExternalRow");
if (start < 0 || end < 0) throw new Error("helper block not found");
const block = src.slice(start, end);

const factory = new Function(`
  const EXTERNAL_INPUT_NAME = "external_images";
  ${block}
  return { graphLink, externalUpstreamBypassed, externalLinked, externalActive, BYPASS_MODE };
`);
const api = factory();

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log("  ok   " + name); }
  else { fail += 1; console.log("  FAIL " + name); }
}

const ALWAYS = 0;
const NEVER = 2;
const BYPASS = 4;

function makeSource(id, mode) {
  return { id, type: "SomeNode", title: "上游节点", mode };
}

function makeLoader(sourceNode, linkId) {
  const graph = {
    _nodes: [sourceNode].filter(Boolean),
    _links: new Map(linkId ? [[linkId, { id: linkId, origin_id: sourceNode?.id, origin_slot: 0 }]] : []),
    getNodeById(id) { return this._nodes.find((n) => n.id === id) || null; },
  };
  const node = {
    graph,
    inputs: [{ name: "external_images", link: linkId ?? null }],
  };
  return node;
}

console.log("== 1. 常量 ==");
check("BYPASS 模式值为 4", api.BYPASS_MODE === 4);

console.log("== 2. 没有连线 ==");
{
  const node = makeLoader(null, null);
  check("未连线 → 未连接", api.externalLinked(node) === false);
  check("未连线 → 不活跃（序号框隐藏）", api.externalActive(node) === false);
  check("未连线 → 不算被绕过", api.externalUpstreamBypassed(node) === false);
}

console.log("== 3. 已连线且上游正常 ==");
{
  const node = makeLoader(makeSource(10, ALWAYS), 1);
  check("已连接", api.externalLinked(node) === true);
  check("上游未绕过", api.externalUpstreamBypassed(node) === false);
  check("活跃 → 显示序号框", api.externalActive(node) === true);
}

console.log("== 4. 已连线但上游被绕过 ==");
{
  const node = makeLoader(makeSource(10, BYPASS), 1);
  check("连线仍然存在", api.externalLinked(node) === true);
  check("识别为绕过", api.externalUpstreamBypassed(node) === true);
  check("不活跃 → 隐藏序号框（本次修复）", api.externalActive(node) === false);
}

console.log("== 5. 其它模式不受影响 ==");
{
  for (const mode of [ALWAYS, NEVER, 1, 3]) {
    const node = makeLoader(makeSource(10, mode), 1);
    check(`mode=${mode} 仍显示序号框`, api.externalActive(node) === true);
  }
}

console.log("== 6. 上游节点缺失时不误判 ==");
{
  const node = makeLoader(null, 7);
  check("找不到来源 → 不算绕过", api.externalUpstreamBypassed(node) === false);
  check("找不到来源 → 视为活跃", api.externalActive(node) === true);
}

console.log("== 7. 占位块跟随绕过状态（本次修复）==");
{
  const displayStart = src.indexOf("function expandPositionToken");
  const displayEnd = src.indexOf("function createExternalPlaceholderCard");
  const displaySrc = src.slice(displayStart, displayEnd);
  const modelFactory = new Function(`
    const EXTERNAL_WIDGET = "external_positions";
    const EXTERNAL_INPUT_NAME = "external_images";
    const widget = (node, name) => (node.widgets || []).find((w) => w.name === name) || null;
    ${block}
    ${displaySrc}
    return { externalDisplayModel };
  `);
  const makeNode = (mode) => {
    const sourceNode = { id: 10, type: "Src", title: "上游", mode };
    const graph = {
      _nodes: [sourceNode],
      _links: new Map([[1, { id: 1, origin_id: 10, origin_slot: 0 }]]),
      getNodeById(id) { return this._nodes.find((n) => n.id === id) || null; },
    };
    return {
      graph,
      inputs: [{ name: "external_images", link: 1 }],
      widgets: [{ name: "external_positions", value: "2" }],
      __wyslMediaLoaderExternalSpec: "2",
    };
  };
  const normal = makeNode(0);
  const bypassed = makeNode(4);
  const a = modelFactory().externalDisplayModel(normal, 2);
  const b = modelFactory().externalDisplayModel(bypassed, 2);
  check("正常时插入外部占位", a.placeholders.length === 1);
  check("绕过时没有占位（本次修复）", b.placeholders.length === 0);
  check("绕过时序号回到连续", JSON.stringify(b.numbers) === JSON.stringify([1, 2]));
}

console.log("");
console.log("");
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
