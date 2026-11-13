/**
 * QQ-字体切换：界面字体 + 代码/等宽字体 两个下拉，默认「默认（当前）」不覆盖；
 * 霞鹜文楷经 @font-face(/qq_fonts/wenkai) 复用本机字体；等宽区域可单独覆盖。
 *
 * 运行：node tests/test_font_switcher.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = (await fs.readFile(new URL("../web/font_switcher.js", import.meta.url), "utf8"))
    .replace('import { app } from "../../scripts/app.js";', "");

const UI = "qq-font-switcher-css";
const MONO = "qq-font-switcher-mono-css";
const FACE = "qq-font-wenkai-face";

function makeContext(stored = {}) {
    let ext;
    const byId = {};
    const document = {
        getElementById: (id) => byId[id] || null,
        createElement: () => ({
            id: "", _css: "",
            set textContent(v) { this._css = v; }, get textContent() { return this._css; },
            remove() { delete byId[this.id]; },
        }),
        head: { append: (el) => { byId[el.id] = el; } },
    };
    const LiteGraph = { NODE_FONT: "Arial" };
    const app = {
        registerExtension(v) { ext = v; },
        ui: { settings: { getSettingValue: (id, d) => stored[id] ?? d } },
        canvas: { setDirty() {} },
        graph: { setDirtyCanvas() {} },
    };
    vm.runInNewContext(source, { app, document, LiteGraph });
    return { ext, byId, LiteGraph };
}
const setting = (ext, id) => ext.settings.find((x) => x.id === id);

// 两个 combo 设置，默认当前，含霞鹜文楷
{
    const { ext } = makeContext();
    const ui = setting(ext, "QQ.Font.Family");
    const mono = setting(ext, "QQ.Font.Mono");
    assert.equal(ui.type, "combo");
    assert.equal(mono.type, "combo");
    assert.equal(ui.defaultValue, "默认（当前）");
    assert.equal(mono.defaultValue, "默认（当前）");
    assert.ok(ui.options.includes("霞鹜文楷"));
    assert.ok(mono.options.includes("霞鹜文楷"));
}

// 默认：注入 wenkai face，但无界面/等宽覆盖，画布字体不变
{
    const { ext, byId, LiteGraph } = makeContext();
    ext.setup();
    assert.ok(byId[FACE], "wenkai @font-face injected");
    assert.ok(byId[FACE].textContent.includes("/qq_fonts/wenkai"));
    assert.equal(byId[UI], undefined, "default: no UI override");
    assert.equal(byId[MONO], undefined, "default: no mono override");
    assert.equal(LiteGraph.NODE_FONT, "Arial");
}

// 界面选微软雅黑：覆盖 + 画布同步；切回默认还原
{
    const { ext, byId, LiteGraph } = makeContext();
    ext.setup();
    setting(ext, "QQ.Font.Family").onChange("微软雅黑");
    assert.ok(byId[UI].textContent.includes("Microsoft YaHei"));
    assert.ok(byId[UI].textContent.includes(":not(textarea)"), "UI override preserves mono");
    assert.ok(LiteGraph.NODE_FONT.includes("Microsoft YaHei"));
    setting(ext, "QQ.Font.Family").onChange("默认（当前）");
    assert.equal(byId[UI], undefined);
    assert.equal(LiteGraph.NODE_FONT, "Arial");
}

// 等宽单独选霞鹜文楷：覆盖 textarea/code/pre；切回默认还原
{
    const { ext, byId } = makeContext();
    ext.setup();
    setting(ext, "QQ.Font.Mono").onChange("霞鹜文楷");
    assert.ok(byId[MONO].textContent.includes("LXGW WenKai"));
    assert.ok(byId[MONO].textContent.includes("textarea"));
    assert.equal(byId[UI], undefined, "mono change does not touch UI override");
    setting(ext, "QQ.Font.Mono").onChange("默认（当前）");
    assert.equal(byId[MONO], undefined);
}

// 已存值在 setup 时应用（界面楷体 + 等宽 Consolas）
{
    const { ext, byId } = makeContext({ "QQ.Font.Family": "楷体", "QQ.Font.Mono": "Consolas 等宽" });
    ext.setup();
    assert.ok(byId[UI].textContent.includes("KaiTi"));
    assert.ok(byId[MONO].textContent.includes("Consolas"));
}
console.log("Font switcher tests passed: two combos, default=current, wenkai face, UI/mono apply/restore.");
