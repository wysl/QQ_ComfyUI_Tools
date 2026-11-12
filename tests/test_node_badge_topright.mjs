/**
 * QQ-节点ID徽章右上角：Nodes 2.0 徽章从左下角 lifted 到标题行最右。
 * 纯 CSS 重定位（不改 DOM），只影响 .lg-node（Vue 渲染）。
 *
 * 运行：node tests/test_node_badge_topright.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = (await fs.readFile(new URL("../web/node_badge_topright.js", import.meta.url), "utf8"))
    .replace('import { app } from "../../scripts/app.js";', "");

// 静态断言：选择器与纯 CSS 方式
assert.ok(source.includes(".lg-node div.mt-auto.gap-2"), "targets the Vue node badge footer row");
assert.ok(source.includes("position:absolute"), "repositions via CSS");
assert.ok(source.includes("right:6px"), "anchors to the right edge");
assert.ok(source.includes("top:4px"), "aligns with the title row");
assert.ok(!source.includes("appendChild(badge") && !source.includes("MutationObserver"), "must not move Vue-managed DOM");

// 行为断言：setup 注入样式且幂等
for (const legacy of [false, true]) {
    let ext;
    const head = [];
    const byId = {};
    const app = { registerExtension(v) { ext = v; } };
    vm.runInNewContext(source, {
        app,
        document: {
            getElementById: (id) => byId[id] || null,
            createElement: () => ({ set textContent(v) { this._css = v; }, get textContent() { return this._css; } }),
            head: { append: (el) => { head.push(el); byId[el.id] = el; } },
        },
    });
    ext.setup();
    assert.equal(head.length, 1, "injects one style");
    assert.ok(byId["qq-node-badge-topright"], "style has stable id");
    ext.setup();
    assert.equal(head.length, 1, "repeated setup must not duplicate the style");
}
console.log("Node badge top-right tests passed: selector, CSS-only, idempotent injection.");
