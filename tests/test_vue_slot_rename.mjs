/**
 * QQ-Vue端口重命名：Nodes 2.0 右击输入/输出端口可重命名接口（而非节点标题）。
 * 拦截 .lg-slot 的 contextmenu，写 slot.label/localized_name 并同步 Vue 显示。
 *
 * 运行：node tests/test_vue_slot_rename.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = (await fs.readFile(new URL("../web/vue_slot_rename.js", import.meta.url), "utf8"))
    .replace('import { app } from "../../scripts/app.js";', "");

// 静态断言：拦截端口右键、改接口显示名、不改节点标题
assert.ok(source.includes(".lg-slot"), "targets Vue node slots");
assert.ok(source.includes('addEventListener("contextmenu", onContextMenu, true)'), "intercepts slot right-click in capture phase");
assert.ok(source.includes("info.slot.label = name"), "renames the slot label");
assert.ok(source.includes("info.slot.localized_name = name"), "renames the slot localized_name");
assert.ok(!source.includes(".title ="), "must not rename the node title");
assert.ok(source.includes("重命名接口") && source.includes("断开连接"), "offers rename + disconnect");

// 行为断言：设置注册、默认开启、可切换
function makeContext(app) {
    let ext;
    app.registerExtension = (v) => { ext = v; };
    const listeners = [];
    const document = {
        getElementById: () => null,
        createElement: () => ({ style: {}, classList: { add() {} }, addEventListener() {}, append() {}, remove() {} }),
        head: { append() {} },
        body: { append() {} },
        addEventListener: (t, f, c) => listeners.push([t, c]),
        removeEventListener() {},
    };
    vm.runInNewContext(source, { app, document, window: { innerWidth: 1200, innerHeight: 800 } });
    return { ext, listeners };
}

{
    let def;
    const store = {};
    const app = { extensionManager: { setting: {
        get: (id) => store[id],
        registerSetting: (d) => { def = d; store[d.id] = d.defaultValue; },
    } } };
    const { ext, listeners } = makeContext(app);
    ext.setup();
    assert.equal(def.id, "QQ.VueSlotRename");
    assert.equal(def.type, "boolean");
    assert.equal(def.defaultValue, true, "default on");
    assert.ok(listeners.some(([t, c]) => t === "contextmenu" && c === true), "capture-phase contextmenu listener");
    // 切换不抛错
    def.onChange(false);
    def.onChange(true);
}
console.log("Vue slot rename tests passed: slot targeting, label rename, no title change, default-on setting.");
