import { app } from "../../scripts/app.js";

const NODE_TYPE = "QQMultiLineText";
const SYSTEM_WIDGET = "系统提示词";
const TOGGLE_WIDTH = 88;
const TOGGLE_HEIGHT = 24;

function widget(node, name) {
    return (node?.widgets || []).find((item) => item?.name === name) || null;
}

function systemVisible(node) {
    return node?.properties?.qq_system_visible !== false;
}

function applySystemVisibility(node) {
    const target = widget(node, SYSTEM_WIDGET);
    const visible = systemVisible(node);
    if (!target) return;
    if (visible) {
        target.hidden = false;
        delete target.computeSize;
        target.options ||= {};
        delete target.options.hidden;
    } else {
        target.hidden = true;
        target.computeSize = () => [0, -4];
        target.options ||= {};
        target.options.hidden = true;
    }
}

function toggleRect(node) {
    // Sit in the spare strip above the first widget box (node-local coords).
    const first = node.widgets?.[0];
    const y = Math.max(30, (first?.y ?? 34) - TOGGLE_HEIGHT - 6);
    return [8, y, TOGGLE_WIDTH, TOGGLE_HEIGHT];
}

function drawToggle(node, ctx) {
    const [x, y, w, h] = toggleRect(node);
    const visible = systemVisible(node);
    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, 4);
    else ctx.rect(x, y, w, h);
    ctx.fillStyle = "#3a4148";
    ctx.fill();
    ctx.strokeStyle = "#59616a";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#e9edf0";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(visible ? "隐藏提示词" : "显示提示词", x + w / 2, y + h / 2 + 0.5);
    ctx.restore();
}

function toggleSystemVisibility(node) {
    node.properties ||= {};
    node.properties.qq_system_visible = !systemVisible(node);
    applySystemVisibility(node);
    const size = node.computeSize?.();
    if (size) node.setSize([node.size[0], Math.max(size[1], 60)]);
    node.setDirtyCanvas?.(true, true);
}

function setup(node) {
    if (!node || node.__qqMultiLineTextSetup) return;
    node.__qqMultiLineTextSetup = true;
    applySystemVisibility(node);
}

app.registerExtension({
    name: "QQ.MultiLineText",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_TYPE) return;
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function onNodeCreatedQQMultiLineText() {
            const result = originalCreated?.apply(this, arguments);
            setup(this);
            return result;
        };
        const originalAdded = nodeType.prototype.onAdded;
        nodeType.prototype.onAdded = function onAddedQQMultiLineText() {
            const result = originalAdded?.apply(this, arguments);
            setup(this);
            return result;
        };
        const originalConfigured = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function onConfigureQQMultiLineText() {
            const result = originalConfigured?.apply(this, arguments);
            setup(this);
            applySystemVisibility(this);
            return result;
        };
        const originalDraw = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function onDrawForegroundQQMultiLineText(ctx) {
            const result = originalDraw?.apply(this, arguments);
            drawToggle(this, ctx);
            return result;
        };
        const originalMouseDown = nodeType.prototype.onMouseDown;
        nodeType.prototype.onMouseDown = function onMouseDownQQMultiLineText(e, pos, ...rest) {
            const [x, y, w, h] = toggleRect(this);
            if (pos && pos[0] >= x && pos[0] <= x + w && pos[1] >= y && pos[1] <= y + h) {
                toggleSystemVisibility(this);
                return true;
            }
            return originalMouseDown ? originalMouseDown.apply(this, [e, pos, ...rest]) : false;
        };
    },
});
