import { app } from "../../scripts/app.js";

const GRID_SIZE = 100;
const HOTKEY_CODE = "Digit5";

function gridSize() {
    // The palette's major cells are 100px; inner lines are visual subdivisions.
    return GRID_SIZE;
}
const EXTENSION_NAME = "QQ.GridFill";

function selectedNodes() {
    const selected = app.canvas?.selected_nodes;
    if (selected && typeof selected === "object") {
        const nodes = Object.values(selected).filter(Boolean);
        if (nodes.length) return nodes;
    }
    return (app.graph?._nodes || []).filter((node) => node?.is_selected);
}

function snapDown(value, size = gridSize()) {
    return Math.floor(Number(value) / size) * size;
}

function snapUp(value, size = gridSize()) {
    return Math.ceil(Number(value) / size) * size;
}

function fillNodeGrid(node) {
    if (!node?.pos || !node?.size) return false;
    const size = gridSize();
    const left = snapDown(node.pos[0], size);
    const top = snapDown(node.pos[1], size);
    const right = snapUp(node.pos[0] + node.size[0], size);
    const bottom = snapUp(node.pos[1] + node.size[1], size);
    const width = Math.max(size, right - left);
    const height = Math.max(size, bottom - top);
    const changed = left !== node.pos[0]
        || top !== node.pos[1]
        || width !== node.size[0]
        || height !== node.size[1];
    if (!changed) return false;
    node.pos[0] = left;
    node.pos[1] = top;
    node.setSize?.([width, height]);
    if (!node.setSize) node.size = [width, height];
    node.setDirtyCanvas?.(true, true);
    return true;
}

function handleShortcut(event) {
    if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
    if (event.code !== HOTKEY_CODE) return;
    const target = event.target;
    if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName)) return;
    const nodes = selectedNodes();
    if (!nodes.length) return;
    event.preventDefault();
    event.stopPropagation();
    let changed = false;
    for (const node of nodes) changed = fillNodeGrid(node) || changed;
    if (changed) {
        app.graph?.change?.();
        app.canvas?.setDirty?.(true, true);
        app.graph?.setDirtyCanvas?.(true, true);
    }
}

app.registerExtension({
    name: EXTENSION_NAME,
    setup() {
        document.addEventListener("keydown", handleShortcut, true);
    },
});

export { fillNodeGrid, snapDown, snapUp };
