import { app } from "../../scripts/app.js";

const NODE_TYPE = "QQMultiLineText";
const SYSTEM_WIDGET = "系统提示词";
const VISIBILITY_WIDGET = "显示系统提示词";
const CSS_TEXT = `
.qq-multi-line-text-toggle{width:100%;border:1px solid var(--border-color,rgba(255,255,255,.14));border-radius:4px;background:var(--comfy-input-bg,#343a40);color:var(--fg-color,#e9edf0);padding:4px 8px;cursor:pointer;font:inherit;font-size:11px}
.qq-multi-line-text-toggle:hover{background:var(--comfy-menu-hover-bg,#46505a);border-color:var(--border-color,rgba(255,255,255,.26))}
.qq-multi-line-text-toggle:focus-visible{outline:2px solid var(--p-primary-color,#4b86b4);outline-offset:1px}
`;

function installStyles() {
    if (installStyles.installed) return;
    installStyles.installed = true;
    const style = document.createElement("style");
    style.textContent = CSS_TEXT;
    document.head.append(style);
}

function widget(node, name) {
    return (node?.widgets || []).find((item) => item?.name === name) || null;
}

function applySystemVisibility(node) {
    const target = widget(node, SYSTEM_WIDGET);
    const visible = widget(node, VISIBILITY_WIDGET)?.value !== false;
    if (target) {
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
    const button = node.__qqMultiLineTextToggle;
    if (button) button.textContent = visible ? "隐藏提示词" : "显示提示词";
}

function setup(node) {
    if (!node || node.__qqMultiLineTextSetup || typeof node.addDOMWidget !== "function") return;
    node.__qqMultiLineTextSetup = true;
    installStyles();
    const visibility = widget(node, VISIBILITY_WIDGET);
    if (visibility) {
        visibility.hidden = true;
        visibility.type = "hidden";
        visibility.computeSize = () => [0, -4];
        visibility.options ||= {};
        visibility.options.hidden = true;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "qq-multi-line-text-toggle";
    button.addEventListener("click", () => {
        const vis = widget(node, VISIBILITY_WIDGET);
        if (!vis) return;
        vis.value = vis.value === false;
        applySystemVisibility(node);
        const size = node.computeSize?.();
        if (size) node.setSize([node.size[0], Math.max(size[1], 60)]);
        node.setDirtyCanvas?.(true, true);
    });
    const domWidget = node.addDOMWidget("qq_text_toggle", "qq_text_toggle", button, { serialize: false });
    if (domWidget) {
        domWidget.serialize = false;
        domWidget.computeLayoutSize = () => ({ minHeight: 26, minWidth: 100 });
        const index = node.widgets.indexOf(domWidget);
        if (index > 0) {
            node.widgets.splice(index, 1);
            node.widgets.unshift(domWidget);
        }
    }
    node.__qqMultiLineTextToggle = button;
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
    },
});
