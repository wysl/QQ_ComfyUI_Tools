import { app } from "../../scripts/app.js";

const NODE_TYPE = "QQMultiLineText";
const TOGGLE_WIDGET = "隐藏提示词";
const SYSTEM_WIDGET = "系统提示词";

function widget(node, name) {
    return (node?.widgets || []).find((item) => item?.name === name) || null;
}

function systemVisible(node) {
    return widget(node, TOGGLE_WIDGET)?.value !== true;
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

// Workflows saved by earlier iterations of this node stored widget values
// without the leading boolean; shift them back into the current order.
function repairWidgetOrder(node) {
    const widgets = node.widgets || [];
    if (widgets.length < 4) return;
    if (typeof widgets[0]?.value === "boolean") return;
    const [first, second, third] = widgets.map((item) => item.value);
    widgets[0].value = false;
    widgets[1].value = first;
    widgets[2].value = second;
    widgets[3].value = third;
}

function setup(node) {
    if (!node || node.__qqMultiLineTextSetup) return;
    node.__qqMultiLineTextSetup = true;
    const toggle = widget(node, TOGGLE_WIDGET);
    if (toggle && !toggle.__qqTogglePatched) {
        toggle.__qqTogglePatched = true;
        const original = toggle.callback;
        toggle.callback = (value, ...rest) => {
            const result = original?.apply(toggle, [value, ...rest]);
            applySystemVisibility(node);
            const size = node.computeSize?.();
            if (size) node.setSize([node.size[0], Math.max(size[1], 60)]);
            node.setDirtyCanvas?.(true, true);
            return result;
        };
    }
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
            repairWidgetOrder(this);
            setup(this);
            applySystemVisibility(this);
            return result;
        };
    },
});
