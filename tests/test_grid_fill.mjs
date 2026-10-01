import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = await fs.readFile(new URL("../web/grid_fill.js", import.meta.url), "utf8");
const transformed = source
    .replace('import { app } from "../../scripts/app.js";', "")
    .replace("export { fillNodeGrid, snapDown, snapUp };", "globalThis.__grid = { fillNodeGrid, snapDown, snapUp };");
let extension;
const app = {
    registerExtension(value) { extension = value; },
    canvas: { selected_nodes: {}, setDirty() {} },
    graph: { _nodes: [], change() {}, setDirtyCanvas() {} },
};
const context = {
    app,
    LiteGraph: { NODE_TITLE_HEIGHT: 30 },
    document: { addEventListener() {} },
};
vm.runInNewContext(transformed, context);
const { fillNodeGrid, snapDown, snapUp } = context.__grid;

assert.equal(snapDown(139), 100);
assert.equal(snapUp(141), 200);
let resized;
const node = {
    pos: [123, 137],
    size: [44, 31],
    setSize(value) { resized = value; this.size = value; },
    setDirtyCanvas() {},
};
assert.equal(fillNodeGrid(node), true);
assert.deepEqual(Array.from(node.pos), [100, 130]);
assert.deepEqual(Array.from(resized), [100, 70]);
assert.equal(fillNodeGrid(node), false);
assert.ok(extension?.name);
console.log("Grid fill tests passed: snapping, expansion, and idempotence.");
