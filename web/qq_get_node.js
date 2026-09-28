import { app } from "../../scripts/app.js";

// QQ-获取点：后端注册（菜单/搜索/存档），前端虚拟解析（和 KJ 获取点同机制）。
//   启用 = 排队时把同名 SetNode(设置点) 的输入连线透传给消费者（编译成真实连线）
//   关闭 = 消费者视为「未连接」，例如一键出图的 latent_image 回退到图1分辨率
// 名称是普通文本框（任何前端模式下都能正常显示/编辑），
// 另外在节点右键菜单里提供「选择设置点…」列表一键填入，避免和下拉控件搏斗。

const NODE_TYPE = "QQGetNode";
const NODE_TITLE = "QQ-获取点";
const SET_NODE_TYPE = "SetNode";
const TAG = "[QQ-获取点]";
const NAME_WIDGET = "名称";
const ENABLE_WIDGET = "启用";
const ENABLE_INPUT = "启用接线";
const MODE_ON = "启用";
const MODE_BYPASS = "绕过";

function graphAncestors(graph) {
    const out = [];
    let current = graph;
    for (let depth = 0; current && depth < 8; depth += 1) {
        if (out.includes(current)) break;
        out.push(current);
        const parent = current.parent || current._parent;
        const root = current.rootGraph;
        current = parent || (root && root !== current ? root : null);
    }
    return out;
}

function readLink(graph, linkId) {
    if (!graph || linkId == null) return null;
    if (typeof graph.getLink === "function") return graph.getLink(linkId);
    if (graph.links) return graph.links[linkId] ?? null;
    if (graph._links instanceof Map) return graph._links.get(linkId) ?? null;
    return graph._links?.[linkId] ?? null;
}

function findSetterNode(graph, name) {
    if (!name) return null;
    for (const scope of graphAncestors(graph)) {
        for (const node of (scope?._nodes || [])) {
            if (node?.type === SET_NODE_TYPE && node?.widgets?.[0]?.value === name) {
                return { node, graph: scope };
            }
        }
    }
    return null;
}

function resolveSetterLink(graph, name, slot, enabled) {
    if (!enabled) return null;
    const found = findSetterNode(graph, name);
    if (!found) return null;
    const slotInfo = found.node.inputs?.[slot];
    if (!slotInfo || slotInfo.link == null) return null;
    return readLink(found.graph, slotInfo.link);
}

function setNames(graph) {
    const names = [];
    for (const scope of graphAncestors(graph)) {
        for (const node of (scope?._nodes || [])) {
            if (node?.type !== SET_NODE_TYPE) continue;
            const value = node?.widgets?.[0]?.value;
            if (value && !names.includes(value)) names.push(value);
        }
    }
    return names;
}

function toBool(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") return value !== "" && value !== "false" && value !== "关闭";
    return Boolean(value);
}

function nameWidget(node) {
    return (node?.widgets || []).find((entry) => entry && entry.name === NAME_WIDGET) || null;
}

function enableWidgetValue(node) {
    const widget = (node?.widgets || []).find((entry) => entry && entry.name === ENABLE_WIDGET);
    if (!widget) return true;
    const value = widget.value;
    // 新版是 启用/绕过 文本选项；旧存档里可能是布尔值，一并兼容
    if (typeof value === "string") {
        return value !== MODE_BYPASS && value !== "关闭" && value !== "false" && value !== "";
    }
    return toBool(value);
}

// 启用接线口接常量源（PrimitiveNode / 其它虚拟节点）时，排队前就能读到值
function readEnableInput(node) {
    const input = (node?.inputs || []).find((entry) => entry && entry.name === ENABLE_INPUT);
    const link = input ? readLink(node?.graph, input.link) : null;
    if (!link) return enableWidgetValue(node);
    const origin = node?.graph?.getNodeById?.(link.origin_id);
    if (!origin) return enableWidgetValue(node);
    if (origin.type === "PrimitiveNode" || origin.isVirtualNode) {
        const widget = origin.widgets?.[0];
        if (widget) return toBool(widget.value);
    }
    console.warn(TAG, "启用接线接的不是常量源，虚拟节点排队前读不到运行时值，回退到节点上的开关", node);
    return enableWidgetValue(node);
}

function isEnabled(node) {
    return readEnableInput(node);
}

function setNameValue(node, value) {
    const widget = nameWidget(node);
    if (!widget) return false;
    widget.value = value;
    node.title = value ? `${NODE_TITLE} ${value}` : NODE_TITLE;
    widget.callback?.(value);
    node.setDirtyCanvas?.(true, true);
    try { node.graph?.change?.(); } catch { /* 忽略 */ }
    return true;
}

function install(nodeType) {
    const proto = nodeType?.prototype;
    if (!proto || proto.__qqGetInstalled) return;
    proto.__qqGetInstalled = true;

    proto.getInputLink = function getInputLink(slot) {
        const name = nameWidget(this)?.value;
        const link = resolveSetterLink(this.graph, name, slot, isEnabled(this));
        if (!link && name && isEnabled(this) && !findSetterNode(this.graph, name)) {
            console.warn(TAG, `找不到名为「${name}」的设置点`, this);
        }
        return link;
    };

    proto.resolveVirtualOutput = function resolveVirtualOutput(slot) {
        const name = nameWidget(this)?.value;
        const found = findSetterNode(this.graph, name);
        if (!found || found.graph === this.graph) return undefined;
        const slotInfo = found.node.inputs?.[slot];
        if (!slotInfo || slotInfo.link == null) return undefined;
        const link = readLink(found.graph, slotInfo.link);
        if (!link) return undefined;
        const source = found.graph.getNodeById?.(link.origin_id);
        if (!source) return undefined;
        return { node: source, slot: link.origin_slot };
    };

    const originalCreated = proto.onNodeCreated;
    proto.onNodeCreated = function onNodeCreatedQQGet() {
        const result = originalCreated?.apply(this, arguments);
        this.isVirtualNode = true;
        this.serialize_widgets = true;
        const widget = nameWidget(this);
        if (widget && !widget.__qqTitleHook) {
            widget.__qqTitleHook = true;
            const originalCallback = widget.callback;
            widget.callback = (value, ...rest) => {
                this.title = value ? `${NODE_TITLE} ${value}` : NODE_TITLE;
                return originalCallback?.call(this, value, ...rest);
            };
        }
        return result;
    };

    const originalConfigure = proto.onConfigure;
    proto.onConfigure = function onConfigureQQGet(info) {
        const result = originalConfigure?.apply(this, arguments);
        this.isVirtualNode = true;
        // 旧存档的布尔开关归一化成 启用/绕过 文本选项
        const enable = (this.widgets || []).find((entry) => entry && entry.name === ENABLE_WIDGET);
        if (enable && typeof enable.value === "boolean") {
            enable.value = enable.value ? MODE_ON : MODE_BYPASS;
        }
        const name = nameWidget(this)?.value;
        if (name) this.title = `${NODE_TITLE} ${name}`;
        return result;
    };

    // 右键菜单：列出当前图及外层图里的所有设置点，点一下填入名称
    const originalMenu = proto.getExtraMenuOptions;
    proto.getExtraMenuOptions = function getExtraMenuOptionsQQGet(_, options) {
        const result = originalMenu?.apply(this, arguments);
        const names = setNames(this.graph || app?.graph || null);
        if (!names.length) {
            options?.unshift({ content: "选择设置点…（图里还没有设置点）", disabled: true });
            return result;
        }
        options?.unshift({
            content: "选择设置点…",
            has_submenu: true,
            callback: () => {
                const LiteGraph = globalThis.LiteGraph;
                if (!LiteGraph?.ContextMenu) return;
                const node = this;
                new LiteGraph.ContextMenu(names, {
                    event: globalThis.event,
                    className: "dark",
                    title: "设置点",
                    callback: (value) => setNameValue(node, value),
                });
            },
        });
        return result;
    };
}

app.registerExtension({
    name: "QQ.GetNodeSwitch",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_TYPE) return;
        install(nodeType);
        console.info(TAG, "前端扩展已挂载到后端节点", NODE_TYPE);
    },
});
