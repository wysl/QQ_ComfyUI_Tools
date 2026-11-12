/**
 * QQ-节点内容分区描边：Nodes 2.0 节点内多行文本/参数/控件行分界更清晰。
 * 纯 CSS（不改 DOM），只影响 .lg-node；可开关、默认开启。
 *
 * 运行：node tests/test_node_content_sections.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = (await fs.readFile(new URL("../web/node_content_sections.js", import.meta.url), "utf8"))
    .replace('import { app } from "../../scripts/app.js";', "");

// 静态断言
assert.ok(source.includes(".lg-node textarea"), "targets the prompt textarea");
assert.ok(source.includes("border:1px solid var(--border-color"), "gives the text block a clear boundary");
assert.ok(source.includes(":has(textarea)"), "separates the text block from following params");
assert.ok(source.includes("row-gap:6px"), "relaxes widget row rhythm");
assert.ok(!source.includes("MutationObserver"), "must not move Vue-managed DOM");

function makeContext(app) {
    let ext;
    app.registerExtension = (v) => { ext = v; };
    const head = [];
    const byId = {};
    const document = {
        getElementById: (id) => byId[id] || null,
        createElement: () => ({
            id: "", _css: "",
            set textContent(v) { this._css = v; }, get textContent() { return this._css; },
            remove() { delete byId[this.id]; const i = head.indexOf(this); if (i >= 0) head.splice(i, 1); },
        }),
        head: { append: (el) => { head.push(el); byId[el.id] = el; } },
    };
    vm.runInNewContext(source, { app, document });
    return { ext, head, byId };
}

// 默认开启、幂等
{
    const { ext, head, byId } = makeContext({});
    ext.setup();
    assert.equal(head.length, 1);
    assert.ok(byId["qq-node-content-sections"]);
    ext.setup();
    assert.equal(head.length, 1, "idempotent injection");
}

// 设置：布尔、默认 true、实时切换
{
    let def;
    const store = {};
    const app = { extensionManager: { setting: {
        get: (id) => store[id],
        registerSetting: (d) => { def = d; store[d.id] = d.defaultValue; },
    } } };
    const { ext, head } = makeContext(app);
    ext.setup();
    assert.equal(def.id, "QQ.NodeContent.Sections");
    assert.equal(def.type, "boolean");
    assert.equal(def.defaultValue, true);
    assert.equal(head.length, 1);
    def.onChange(false);
    assert.equal(head.length, 0, "toggle off removes styles");
    def.onChange(true);
    assert.equal(head.length, 1, "toggle on re-injects");
}

// 存 false 启动不注入
{
    const app = { extensionManager: { setting: { get: () => false, registerSetting: () => {} } } };
    const { ext, head } = makeContext(app);
    ext.setup();
    assert.equal(head.length, 0);
}
console.log("Node content sections tests passed: boundaries, CSS-only, default-on setting, live toggle.");
