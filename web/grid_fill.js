import { app } from "../../scripts/app.js";

const GRID_SIZE = 100;
const HOTKEY_SETTING = "QQ.GridFill.Hotkey";
const DEFAULT_HOTKEY = "Ctrl+5";

function gridSize() {
    // The palette's major cells are 100px; inner lines are visual subdivisions.
    return GRID_SIZE;
}
const EXTENSION_NAME = "QQ.GridFill";

function settingApi() {
    const modern = app.extensionManager?.setting;
    if (modern?.get && modern?.set) return modern;
    const legacy = app.ui?.settings;
    if (legacy?.getSettingValue && (legacy.setSettingValueAsync || legacy.setSettingValue)) {
        return {
            get: legacy.getSettingValue.bind(legacy),
            set: (id, value) => legacy.setSettingValueAsync?.(id, value) ?? legacy.setSettingValue(id, value),
        };
    }
    return null;
}

function configuredHotkey() {
    const value = settingApi()?.get(HOTKEY_SETTING);
    return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_HOTKEY;
}

function parseHotkey(value) {
    const parts = String(value).split("+").map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return null;
    const key = parts.pop().toLowerCase();
    const modifiers = new Set(parts.map((part) => part.toLowerCase()));
    const allowed = new Set(["ctrl", "control", "shift", "alt", "option", "meta", "cmd", "command"]);
    if ([...modifiers].some((part) => !allowed.has(part))) return null;
    return {
        key,
        ctrl: modifiers.has("ctrl") || modifiers.has("control"),
        shift: modifiers.has("shift"),
        alt: modifiers.has("alt") || modifiers.has("option"),
        meta: modifiers.has("meta") || modifiers.has("cmd") || modifiers.has("command"),
    };
}

function keyMatches(event, shortcut) {
    if (!shortcut) return false;
    const key = String(event.key || "").toLowerCase();
    const code = String(event.code || "").toLowerCase();
    const expectedCode = shortcut.key.length === 1
        ? (/[a-z]/.test(shortcut.key) ? `key${shortcut.key}` : `digit${shortcut.key}`)
        : shortcut.key;
    return (key === shortcut.key || code === expectedCode)
        && event.ctrlKey === shortcut.ctrl
        && event.shiftKey === shortcut.shift
        && event.altKey === shortcut.alt
        && event.metaKey === shortcut.meta;
}

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

function titleHeight(node) {
    const value = Number(globalThis.LiteGraph?.NODE_TITLE_HEIGHT);
    return Number.isFinite(value) && value >= 0
        ? value
        : Number(node?.constructor?.title_height) || 30;
}

function fillNodeGrid(node) {
    if (!node?.pos || !node?.size) return false;
    const size = gridSize();
    const title = titleHeight(node);
    // LiteGraph stores pos at the content origin; the title bar extends upward.
    const visualTop = node.pos[1] - title;
    const left = snapDown(node.pos[0], size);
    const top = snapDown(visualTop, size);
    const right = snapUp(node.pos[0] + node.size[0], size);
    const bottom = snapUp(node.pos[1] + node.size[1], size);
    const contentTop = top + title;
    const width = Math.max(size, right - left);
    // The title occupies part of the visual cell, so content height is the
    // remaining cell height after aligning the title's top edge.
    const height = Math.max(1, bottom - contentTop);
    const changed = left !== node.pos[0]
        || contentTop !== node.pos[1]
        || width !== node.size[0]
        || height !== node.size[1];
    if (!changed) return false;
    node.pos[0] = left;
    node.pos[1] = contentTop;
    node.setSize?.([width, height]);
    if (!node.setSize) node.size = [width, height];
    node.setDirtyCanvas?.(true, true);
    return true;
}

function handleShortcut(event) {
    if (!keyMatches(event, parseHotkey(configuredHotkey()))) return;
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
    settings: [{
        id: HOTKEY_SETTING,
        name: "网格填充快捷键",
        type: "text",
        defaultValue: DEFAULT_HOTKEY,
        tooltip: "选中节点后使用此快捷键，让节点占用完整的大网格区域。格式示例：Ctrl+5、Ctrl+G、Alt+F2。",
    }],
    setup() {
        document.addEventListener("keydown", handleShortcut, true);
    },
});

export { fillNodeGrid, snapDown, snapUp };
