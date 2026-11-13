/**
 * QQ-字体切换：设置内可选字体，默认「默认（当前）」不覆盖；选择后注入 CSS 并同步画布字体。
 *
 * 运行：node tests/test_font_switcher.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = (await fs.readFile(new URL("../web/font_switcher.js", import.meta.url), "utf8"))
    .replace('import { app } from "../../scripts/app.js";', "");

function makeContext(storedValue) {
    let ext;
    const byId = {};
    const head = [];
    const document = {
        getElementById: (id) => byId[id] || null,
        createElement: () => ({
            id: "", _css: "",
            set textContent(v) { this._css = v; }, get textContent() { return this._css; },
            remove() { delete byId[this.id]; const i = head.indexOf(this); if (i >= 0) head.splice(i, 1); },
        }),
        head: { append: (el) => { head.push(el); byId[el.id] = el; } },
    };
    const LiteGraph = { NODE_FONT: "Arial" };
    const app = {
        registerExtension(v) { ext = v; },
        ui: { settings: { getSettingValue: (id, d) => storedValue ?? d } },
        canvas: { setDirty() {} },
        graph: { setDirtyCanvas() {} },
    };
    vm.runInNewContext(source, { app, document, LiteGraph });
    return { ext, head, byId, LiteGraph };
}

// 设置：combo、默认当前、含默认选项
{
    const { ext } = makeContext(undefined);
    const s = ext.settings.find((x) => x.id === "QQ.Font.Family");
    assert.equal(s.type, "combo");
    assert.equal(s.defaultValue, "默认（当前）");
    assert.ok(s.options.includes("默认（当前）"));
    assert.ok(s.options.includes("微软雅黑"));
}

// 默认：不注入覆盖、画布字体不变
{
    const { ext, head, LiteGraph } = makeContext(undefined);
    ext.setup();
    assert.equal(head.length, 0, "default injects no override");
    assert.equal(LiteGraph.NODE_FONT, "Arial");
}

// 选择微软雅黑：注入 CSS（保留等宽）+ 同步画布字体
{
    const { ext, head, byId, LiteGraph } = makeContext(undefined);
    ext.setup();
    const s = ext.settings.find((x) => x.id === "QQ.Font.Family");
    s.onChange("微软雅黑");
    assert.equal(head.length, 1);
    const css = byId["qq-font-switcher-css"].textContent;
    assert.ok(css.includes("Microsoft YaHei"));
    assert.ok(css.includes(":not(textarea)"), "preserves monospace/textarea");
    assert.ok(LiteGraph.NODE_FONT.includes("Microsoft YaHei"));
    // 切回默认：移除覆盖、还原画布字体
    s.onChange("默认（当前）");
    assert.equal(head.length, 0);
    assert.equal(LiteGraph.NODE_FONT, "Arial");
}

// 已存值在 setup 时应用
{
    const { ext, head } = makeContext("楷体");
    ext.setup();
    assert.equal(head.length, 1);
    assert.ok(head[0].textContent.includes("KaiTi"));
}
console.log("Font switcher tests passed: combo setting, default=current, apply/restore, mono preserved.");
