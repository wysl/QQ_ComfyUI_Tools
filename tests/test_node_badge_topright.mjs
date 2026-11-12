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
assert.ok(source.includes("right:8px"), "anchors to the right edge");
assert.ok(source.includes("top:0"), "aligns with the title row");
assert.ok(source.includes("background:transparent !important"), "strips the pill background so it sits on the title color");
assert.ok(!source.includes("appendChild(badge") && !source.includes("MutationObserver"), "must not move Vue-managed DOM");

// 行为断言：搭建一个支持 remove 的假 DOM
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

// 1) 无设置 API（旧环境）：默认开启、注入且幂等
for (const legacy of [false, true]) {
    const { ext, head, byId } = makeContext({});
    ext.setup();
    assert.equal(head.length, 1, "injects one style");
    assert.ok(byId["qq-node-badge-topright"], "style has stable id");
    ext.setup();
    assert.equal(head.length, 1, "repeated setup must not duplicate the style");
}

// 2) 有设置 API：注册布尔开关、默认 true、可实时切换
{
    let def;
    const store = {};
    const app = {
        extensionManager: {
            setting: {
                get: (id) => store[id],
                registerSetting: (d) => { def = d; store[d.id] = d.defaultValue; },
            },
        },
    };
    const { ext, head, byId } = makeContext(app);
    ext.setup();
    assert.ok(def, "registers a setting");
    assert.equal(def.id, "QQ.NodeBadge.TopRight");
    assert.equal(def.type, "boolean");
    assert.equal(def.defaultValue, true, "default on");
    assert.equal(head.length, 1, "default-on injects style");
    // 实时关闭 -> 移除样式（徽章回左下角）
    def.onChange(false);
    assert.equal(head.length, 0, "toggle off removes style");
    assert.ok(!byId["qq-node-badge-topright"]);
    // 实时开启 -> 重新注入
    def.onChange(true);
    assert.equal(head.length, 1, "toggle on re-injects style");
}

// 3) 已存为 false 时启动不注入
{
    const app = {
        extensionManager: { setting: { get: () => false, registerSetting: () => {} } },
    };
    const { ext, head } = makeContext(app);
    ext.setup();
    assert.equal(head.length, 0, "stored false keeps default position");
}
console.log("Node badge top-right tests passed: selector, CSS-only, idempotent, default-on setting, live toggle.");
