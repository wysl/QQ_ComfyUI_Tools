import { app } from "../../scripts/app.js";

// QQ-获取点：参照 KJNodes「获取点」的纯前端虚拟节点做法，额外加一个「启用」开关。
//   启用 = 排队时把同名 SetNode(设置点) 的输入连线透传给本节点的消费者（编译成真实连线）
//   关闭 = 消费者视为「未连接」，例如一键出图的 latent_image 会回退到图1分辨率
// 本节点 isVirtualNode=true，不进 prompt；名称下拉列出当前图及外层图里所有设置点。
// 「启用」是真正的输入口：可以接布尔常量（PrimitiveNode / widget 转出的口）；
// 虚拟节点在排队前拿不到运行时计算值，接非常量源时回退到节点上的开关并给出控制台提示。

const NODE_TYPE = "QQGetNode";
const NODE_TITLE = "QQ-获取点";
const SET_NODE_TYPE = "SetNode";
const TAG = "[QQ-获取点]";
const ENABLE_INPUT = "启用";
const NAME_WIDGET = "名称";

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
    const widget = (node?.widgets || []).find((entry) => entry && entry.name === ENABLE_INPUT);
    return widget ? toBool(widget.value) : true;
}

// 启用口接的是常量源（PrimitiveNode / 其它虚拟节点）时，排队前就能读到值
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
    console.warn(TAG, "启用口接的不是常量源，虚拟节点排队前读不到运行时值，回退到节点上的开关", node);
    return enableWidgetValue(node);
}

function isEnabled(node) {
    return readEnableInput(node);
}

// Vue 控件会在挂载时快照 combo 的选项列表；节点刚创建时还不在图里，
// 快照是空的，选完名字显示不出来。这里强制刷新选项并重建 widget 绑定。
function refreshNameOptions(node) {
    const widget = nameWidget(node);
    if (!widget) return;
    const values = setNames(node.graph || app?.graph || null);
    const signature = values.join("\u0001");
    if (node.__qqNameSignature === signature) return;
    node.__qqNameSignature = signature;
    // 注意：options.values 可能是只读 getter（构造时用 defineProperty 装的），
    // 直接赋值会在严格模式下抛 TypeError 并中断工作流加载，所以整体替换 options 对象。
    try {
        widget.options = { ...(widget.options || {}), values };
    } catch (error) {
        console.warn(TAG, "刷新名称选项失败", error);
    }
    if (Array.isArray(node.widgets)) {
        const index = node.widgets.indexOf(widget);
        if (index >= 0) {
            node.widgets.splice(index, 1);
            node.widgets.splice(index, 0, widget);
        }
    }
    node.setDirtyCanvas?.(true, true);
}

function installVirtualGet() {
    const LiteGraph = globalThis.LiteGraph;
    if (!LiteGraph || LiteGraph.__qqGetNodeRegistered) return;
    LiteGraph.__qqGetNodeRegistered = true;

    class QQGetNode extends LGraphNode {
        constructor(title) {
            super(title);
            this.properties = this.properties || {};
            this.properties["Node name for S&R"] = NODE_TYPE;
            this.isVirtualNode = true;
            this.serialize_widgets = true;
            this.addInput(ENABLE_INPUT, "BOOLEAN");
            const comboOptions = { getOptionLabel: (value) => value || "" };
            Object.defineProperty(comboOptions, "values", {
                get: () => setNames(this.graph || app?.graph || null),
                enumerable: true,
                configurable: true,
            });
            this.addWidget("combo", NAME_WIDGET, "", (value) => {
                this.title = value ? `${NODE_TITLE} ${value}` : NODE_TITLE;
                refreshNameOptions(this);
            }, comboOptions);
            this.addWidget("toggle", ENABLE_INPUT, true);
            this.addOutput("*", "*");
            this.title = NODE_TITLE;
        }

        onAdded(graph) {
            this.graph = graph || this.graph;
            refreshNameOptions(this);
        }

        onConfigure(info) {
            // 旧存盘顺序 [启用, 名称] → 新顺序 [名称, 启用]
            const values = info?.widgets_values;
            if (Array.isArray(values) && values.length >= 2
                && typeof values[0] === "boolean" && typeof values[1] === "string") {
                info.widgets_values = [values[1], values[0], ...values.slice(2)];
            }
            const result = super.onConfigure?.(info);
            const name = nameWidget(this)?.value;
            if (name) this.title = `${NODE_TITLE} ${name}`;
            setTimeout(() => refreshNameOptions(this), 0);
            return result;
        }

        getInputLink(slot) {
            // 同图：前端标准解析路径读这里返回的 link
            const name = nameWidget(this)?.value;
            const link = resolveSetterLink(this.graph, name, slot, isEnabled(this));
            if (!link && name && isEnabled(this) && !findSetterNode(this.graph, name)) {
                console.warn(TAG, `找不到名为「${name}」的设置点`, this);
            }
            return link;
        }

        resolveVirtualOutput(slot) {
            // 跨图/子图：告诉前端真正的源节点和槽位
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
        }
    }

    QQGetNode.title = NODE_TITLE;
    QQGetNode.category = "QQ/工具";
    LiteGraph.registerNodeType(NODE_TYPE, QQGetNode);
}

function startNameRefresh() {
    if (globalThis.__qqGetNodeNameTimer) return;
    globalThis.__qqGetNodeNameTimer = setInterval(() => {
        if (!app || app.loading_graph || app.configuringGraph) return;
        const graph = app.canvas?.graph || app.graph;
        for (const node of (graph?._nodes || [])) {
            if (node?.type === NODE_TYPE) refreshNameOptions(node);
        }
    }, 2000);
}

app.registerExtension({
    name: "QQ.GetNodeSwitch",
    registerCustomNodes() {
        installVirtualGet();
    },
    setup() {
        installVirtualGet();
        startNameRefresh();
    },
});
