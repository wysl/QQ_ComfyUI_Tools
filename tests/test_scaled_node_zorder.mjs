/**
 * QQ-缩放节点沉底：1.0 重排 graph._nodes；2.0（Vue）把缩放节点 DOM z-index 压到未缩放之下。
 *
 * 运行：node tests/test_scaled_node_zorder.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = (await fs.readFile(new URL("../web/scaled_node_zorder.js", import.meta.url), "utf8"))
    .replace('import { app } from "../../scripts/app.js";', "");

function makeContext() {
    let ext;
    const nodes = [
        { id: 1, scale: 1 },
        { id: 2, scale: 0.5 },
        { id: 3, scale: 0.3 },
    ];
    const els = nodes.map((n) => {
        const attrs = {}; const props = {};
        return {
            dataset: { nodeId: String(n.id) },
            style: {
                setProperty: (k, v) => { props[k] = String(v); },
                removeProperty: (k) => { delete props[k]; },
                getPropertyValue: (k) => props[k] || "",
            },
            setAttribute: (k, v) => { attrs[k] = String(v); },
            getAttribute: (k) => attrs[k] ?? null,
            hasAttribute: (k) => k in attrs,
            removeAttribute: (k) => { delete attrs[k]; },
            _z: "11",
        };
    });
    const graph = {
        _nodes: [...nodes],
        getNodeById: (id) => nodes.find((n) => n.id === id) || null,
        setDirtyCanvas() {}, bringToFront() {},
    };
    const app = {
        registerExtension(v) { ext = v; },
        graph, canvas: { bringToFront() {} },
        ui: { settings: { getSettingValue: () => true } },
    };
    const document = {
        querySelectorAll: (sel) => (sel === ".lg-node" ? els : []),
        getElementById: () => null,
        createElement: () => ({ id: "", textContent: "" }),
        head: { append() {} },
        body: {},
    };
    const sandbox = {
        app, document,
        getComputedStyle: (el) => ({ zIndex: el._z }),
        MutationObserver: class { observe() {} },
        requestAnimationFrame: (fn) => { fn(); return 1; },
        setTimeout: (fn) => { fn(); return 1; },
        clearTimeout() {},
        LiteGraph: undefined,
    };
    vm.runInNewContext(source, sandbox);
    return { ext, els, graph, nodes };
}

// 1.0：缩放节点稳定沉到未缩放之下，且越小越靠底
{
    const { ext, graph } = makeContext();
    ext.setup();
    assert.deepEqual(graph._nodes.map((n) => n.id), [3, 2, 1], "scaled sorted below unscaled, smaller scale lower");
}

// 2.0：缩放节点带 data-qq-scaled + 低 --qq-z（CSS !important 压住 Vue），未缩放无标记
{
    const { ext, els } = makeContext();
    ext.setup();
    const [normal, scaledHalf, scaledThird] = els;
    assert.ok(!normal.hasAttribute("data-qq-scaled"), "unscaled left untouched");
    assert.equal(scaledHalf.getAttribute("data-qq-scaled"), "1");
    assert.equal(scaledThird.getAttribute("data-qq-scaled"), "1");
    const zHalf = Number(scaledHalf.style.getPropertyValue("--qq-z"));
    const zThird = Number(scaledThird.style.getPropertyValue("--qq-z"));
    assert.ok(zHalf < 11 && zThird < 11, "scaled below unscaled");
    assert.ok(zThird < zHalf, "smaller scale lower");
}

// 设置默认开启、可切换
{
    const { ext } = makeContext();
    const setting = ext.settings.find((s) => s.id === "QQ.ScaledNodeZOrder.Enabled");
    assert.equal(setting.type, "boolean");
    assert.equal(setting.defaultValue, true);
    setting.onChange(false);
    setting.onChange(true);
}
console.log("Scaled node z-order tests passed: 1.0 restack + 2.0 DOM z-index + setting.");
