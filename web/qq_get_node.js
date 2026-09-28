import { app } from "../../scripts/app.js";

// QQ-获取点：后端注册（菜单/搜索/存档），前端虚拟解析（和 KJ 获取点同机制）。
//   启用 = 排队时把同名 SetNode(设置点) 的输入连线透传给消费者（编译成真实连线）
//   关闭 = 消费者视为「未连接」，例如一键出图的 latent_image 回退到图1分辨率
// 实例被标记 isVirtualNode，所以不进 prompt；名称 widget 会被原地替换成下拉框
// （保持 widget 索引不变，存档兼容）。

const NODE_TYPE = "QQGetNode";
const NODE_TITLE = "QQ-获取点";
const SET_NODE_TYPE = "SetNode";
const TAG = "[QQ-获取点]";
const NAME_WIDGET = "名称";
const ENABLE_WIDGET = "启用";
const ENABLE_INPUT = "启用接线";

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
    return widget ? toBool(widget.value) : true;
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

// Vue 控件会在挂载时快照 combo 的选项列表；节点刚创建时还不在图里，快照是空的，
// 选完名字显示不出来。这里整体替换 options 对象并重建 widget 绑定。
// 注意：options.values 可能是只读 getter，绝不能直接赋值（严格模式会抛错中断载入）。
// 下拉/选择器开着的时候绝不能替换 options 或摘插 widget，
// 否则菜单项的点击会落到被换掉的旧 widget 上，出现「选了好几次才选上」。
function menuOpen() {
    if (typeof document === "undefined" || !document.querySelector) return false;
    return Boolean(document.querySelector(
        ".litecontextmenu, .litemenu, .el-select-dropdown, .el-popper, .comfy-select-dropdown",
    ));
}

function refreshNameOptions(node) {
    const widget = nameWidget(node);
    if (!widget) return;
    if (menuOpen()) return;
    const values = setNames(node.graph || app?.graph || null);
    const signature = values.join("\u0001");
    if (node.__qqNameSignature === signature) return;
    node.__qqNameSignature = signature;
    try {
        widget.options = { ...(widget.options || {}), values };
    } catch (error) {
        console.warn(TAG, "刷新名称选项失败", error);
    }
    if (Array.isArray(node.widgets)) {
        const index = node.widgets.indexOf(widget);
        if (index >= 0 && node.widgets[index] === widget) {
            node.widgets.splice(index, 1);
            node.widgets.splice(index, 0, widget);
        }
    }
    node.setDirtyCanvas?.(true, true);
}

function makeCombo(node, currentValue) {
    const comboOptions = { getOptionLabel: (value) => value || "" };
    Object.defineProperty(comboOptions, "values", {
        get: () => setNames(node.graph || app?.graph || null),
        enumerable: true,
        configurable: true,
    });
    return node.addWidget("combo", NAME_WIDGET, currentValue || "", (value) => {
        node.title = value ? `${NODE_TITLE} ${value}` : NODE_TITLE;
        node.__qqNameSignature = null;
        // 等菜单关闭后再刷新，避免和点击事件抢 widget
        setTimeout(() => refreshNameOptions(node), 120);
    }, comboOptions);
}

// 原地替换：addWidget 会追加到末尾，先摘掉追加的再按原索引插入，保持存档顺序
function swapNameWidgetToCombo(node) {
    const index = (node.widgets || []).findIndex((entry) => entry && entry.name === NAME_WIDGET);
    if (index < 0) return;
    const current = node.widgets[index];
    if (current?.type === "combo") return;
    const combo = makeCombo(node, current?.value);
    node.widgets.splice(node.widgets.length - 1, 1);
    node.widgets.splice(index, 1, combo);
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
        swapNameWidgetToCombo(this);
        const name = nameWidget(this)?.value;
        if (name) this.title = `${NODE_TITLE} ${name}`;
        refreshNameOptions(this);
        return result;
    };

    const originalConfigure = proto.onConfigure;
    proto.onConfigure = function onConfigureQQGet(info) {
        const result = originalConfigure?.apply(this, arguments);
        this.isVirtualNode = true;
        swapNameWidgetToCombo(this);
        const name = nameWidget(this)?.value;
        if (name) this.title = `${NODE_TITLE} ${name}`;
        setTimeout(() => refreshNameOptions(this), 0);
        return result;
    };
}

function startNameRefresh() {
    if (globalThis.__qqGetNodeNameTimer) return;
    globalThis.__qqGetNodeNameTimer = setInterval(() => {
        if (!app || app.loading_graph || app.configuringGraph) return;
        if (menuOpen()) return;
        const graph = app.canvas?.graph || app.graph;
        for (const node of (graph?._nodes || [])) {
            if (node?.type === NODE_TYPE) refreshNameOptions(node);
        }
    }, 3000);
}

app.registerExtension({
    name: "QQ.GetNodeSwitch",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_TYPE) return;
        install(nodeType);
        startNameRefresh();
        console.info(TAG, "前端扩展已挂载到后端节点", NODE_TYPE);
    },
});
