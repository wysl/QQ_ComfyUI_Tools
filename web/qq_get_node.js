import { app } from "../../scripts/app.js";

// QQ-获取节点(可开关)：参照 KJNodes「获取点」的纯前端虚拟节点做法，额外加一个总开关。
//   启用 = 排队时把同名 SetNode(设置点) 的输入连线透传给本节点的消费者（编译成真实连线）
//   关闭 = 消费者视为「未连接」，例如一键出图的 latent_image 会回退到图1分辨率
// 本节点 isVirtualNode=true，不会进入 prompt，后端没有对应实现；
// 名称下拉列出当前图及外层图里所有 KJ SetNode 的名字。

const NODE_TYPE = "QQGetNode";
const SET_NODE_TYPE = "SetNode";
const TAG = "[QQ-获取节点]";

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

function isEnabled(node) {
    const widget = (node?.widgets || []).find((entry) => entry && entry.name === "启用");
    if (!widget) return true;
    return widget.value !== false && widget.value !== 0 && widget.value !== "关闭";
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
            const comboOptions = {
                getOptionLabel: (value) => value || "",
            };
            Object.defineProperty(comboOptions, "values", {
                get: () => setNames(this.graph || app?.graph || null),
                enumerable: true,
                configurable: true,
            });
            this.addWidget("combo", "名称", "", () => {}, comboOptions);
            this.addWidget("toggle", "启用", true);
            this.addOutput("*", "*");
        }

        onConfigure(info) {
            // 旧的后端版存的是 [启用, 名称]，新的顺序是 [名称, 启用]，这里做一次交换兼容
            const values = info?.widgets_values;
            if (Array.isArray(values) && values.length >= 2
                && typeof values[0] === "boolean" && typeof values[1] === "string") {
                info.widgets_values = [values[1], values[0], ...values.slice(2)];
            }
            return super.onConfigure?.(info);
        }

        getInputLink(slot) {
            // 同图：前端标准解析路径会读这里返回的 link
            const link = resolveSetterLink(this.graph, this.widgets?.[0]?.value, slot, isEnabled(this));
            if (!link && this.widgets?.[0]?.value) {
                if (!findSetterNode(this.graph, this.widgets[0].value)) {
                    console.warn(TAG, `找不到名为「${this.widgets[0].value}」的设置点`, this);
                }
            }
            return link;
        }

        resolveVirtualOutput(slot) {
            // 跨图/子图：告诉前端真正的源节点和槽位
            const name = this.widgets?.[0]?.value;
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

    QQGetNode.title = "QQ-获取节点(可开关)";
    QQGetNode.category = "QQ/工具";
    LiteGraph.registerNodeType(NODE_TYPE, QQGetNode);
}

app.registerExtension({
    name: "QQ.GetNodeSwitch",
    registerCustomNodes() {
        installVirtualGet();
    },
    setup() {
        installVirtualGet();
    },
});
