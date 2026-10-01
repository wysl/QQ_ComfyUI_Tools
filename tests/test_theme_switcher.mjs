import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = (await fs.readFile(new URL("../web/theme_switcher.js", import.meta.url), "utf8"))
    .replace('import { app } from "../../scripts/app.js";', "")
    .replaceAll("import.meta.url", '"https://example.test/extensions/QQ_ComfyUI_Tools/theme_switcher.js"');
const palette = JSON.parse(await fs.readFile(new URL("../web/recycled_paper.json", import.meta.url), "utf8"));
assert.equal(palette.id, "qq-recycled-paper");
assert.equal(palette.colors.litegraph_base.CLEAR_BACKGROUND_COLOR, "#e7dfcf");
const grid = decodeURIComponent(palette.colors.litegraph_base.BACKGROUND_IMAGE);
assert.ok(grid.startsWith("data:image/svg+xml,"));
assert.ok(grid.includes("width='100' height='100'"));
assert.ok(grid.includes("M20 0V100"), "Palette must include minor grid lines");
assert.ok(grid.includes("M0 .5H100"), "Palette must include major grid lines");

for (const legacy of [false, true]) {
    let extension;
    let writes = 0;
    let stored = { other: { id: "other", name: "Other" } };
    const removed = [];
    const get = (id) => { assert.equal(id, "Comfy.CustomColorPalettes"); return stored; };
    const set = async (id, value) => {
        assert.equal(id, "Comfy.CustomColorPalettes");
        writes++;
        stored = value;
    };
    const app = { registerExtension(value) { extension = value; } };
    if (legacy) app.ui = { settings: { getSettingValue: get, setSettingValueAsync: set } };
    else app.extensionManager = { setting: { get, set } };
    vm.runInNewContext(source, {
        app, URL, console,
        document: {
            getElementById: (id) => ({ remove: () => removed.push(id) }),
            documentElement: { removeAttribute: (id) => removed.push(id) },
        },
        fetch: async (url) => {
            assert.equal(url.href, "https://example.test/extensions/QQ_ComfyUI_Tools/recycled_paper.json");
            return { ok: true, json: async () => palette };
        },
    });
    await extension.setup();
    assert.equal(writes, 1);
    assert.equal(stored.other.name, "Other");
    assert.deepEqual(stored[palette.id], palette);
    assert.ok(removed.includes("data-qq-theme"));
    await extension.setup();
    assert.equal(writes, 1, "Repeated startup must not rewrite unchanged palettes");
}
console.log("Theme registration tests passed: modern/legacy APIs, preservation, cleanup, idempotence.");
