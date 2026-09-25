import { app } from "../../../scripts/app.js";
import { ComfyWidgets } from "../../../scripts/widgets.js";

const NODE_TYPE = "QQ-多值输入";
const LEGACY_NODE_TYPE = "QQMultiPrimitive";
const MIN_OUTPUTS = 2;
const ZH_BROWSER = /^(zh)(?:[-_]|$)/i.test(
    String(globalThis.navigator?.language || globalThis.navigator?.languages?.[0] || ""),
);
const TEXT = {
    title: "QQ-多值输入",
    empty: ZH_BROWSER ? "连接到控件输入" : "Connect to widget input",
    category: "QQ/工具",
};

const NODE_METADATA = {
    name: NODE_TYPE,
    display_name: TEXT.title,
    category: TEXT.category,
    description: "将多个控件值集中输出，并根据连接目标自动匹配类型。",
};

let multiPrimitiveSourcePrototype = null;
const pendingNodeTypes = new Set();

function isInputSpec(value) {
    return Array.isArray(value)
        && value.length > 0
        && (typeof value[0] === "string" || Array.isArray(value[0]));
}

function symbolInputSpec(widget) {
    let current = widget;
    while (current && current !== Object.prototype) {
        for (const symbol of Object.getOwnPropertySymbols(current)) {
            const candidate = widget?.[symbol];
            if (isInputSpec(candidate)) return candidate;
            if (typeof candidate !== "function") continue;
            try {
                const config = candidate.call(widget);
                if (isInputSpec(config)) return config;
            } catch {
                // Ignore unrelated symbol callbacks on third-party widgets.
            }
        }
        current = Object.getPrototypeOf(current);
    }
    return null;
}

function nodeInputSpec(targetNode, widgetName) {
    const nodeData = targetNode?.constructor?.nodeData;
    return nodeData?.input?.required?.[widgetName]
        ?? nodeData?.input?.optional?.[widgetName]
        ?? null;
}

function fallbackInputSpec(input, targetWidget) {
    if (typeof input?.type === "string" && ComfyWidgets[input.type]) {
        return [input.type, {}];
    }

    const widgetType = String(targetWidget?.type || "").toLowerCase();
    if (widgetType === "combo") {
        return [targetWidget?.options?.values || [], { default: targetWidget?.value }];
    }
    if (widgetType === "number") {
        const options = targetWidget?.options || {};
        const numericType = Number.isInteger(targetWidget?.value) && Number.isInteger(options.step)
            ? "INT"
            : "FLOAT";
        return [numericType, { ...options, default: targetWidget?.value }];
    }
    if (widgetType === "toggle") return ["BOOLEAN", { default: targetWidget?.value }];
    if (widgetType === "text" || widgetType === "customtext") {
        return ["STRING", { ...targetWidget?.options, default: targetWidget?.value }];
    }
    return null;
}

function liveComboValues(widget) {
    const values = widget?.options?.values;
    if (typeof values === "function") {
        try {
            const resolved = values();
            return Array.isArray(resolved) ? resolved : null;
        } catch {
            return null;
        }
    }
    return Array.isArray(values) && values.length ? values : null;
}

function targetInfo(targetNode, input) {
    if (!targetNode || !input) return null;
    const widgetName = input.widget?.name || input.name;
    if (!widgetName) return null;
    const targetWidget = targetNode.widgets?.find((widget) => widget.name === widgetName);
    let config = symbolInputSpec(input.widget)
        ?? nodeInputSpec(targetNode, widgetName)
        ?? fallbackInputSpec(input, targetWidget);
    const liveValues = liveComboValues(targetWidget);
    if (liveValues) {
        const options = { ...(Array.isArray(config) ? config[1] : {}), values: liveValues };
        config = [liveValues, options];
    }
    if (!isInputSpec(config)) return null;
    return { config, input, targetNode, targetWidget, widgetName };
}

function configType(config) {
    return Array.isArray(config?.[0]) ? "COMBO" : String(config?.[0] || "*");
}

function inputDisplayName(info, fallback) {
    const displayName = String(
        info?.input?.localized_name
        || info?.input?.label
        || info?.input?.name
        || fallback,
    ).trim();
    return !displayName || /^value_\d+$/i.test(displayName) ? fallback : displayName;
}

function outputHasLink(output) {
    return Boolean(output?.links?.length);
}

function removeWidgets(node) {
    for (const widget of node.widgets || []) widget.onRemove?.();
    if (node.widgets) node.widgets.length = 0;
}

function chainWidgetCallback(node, slot, widget) {
    const original = widget.callback;
    widget.callback = function multiPrimitiveWidgetCallback() {
        const result = original?.apply(this, arguments);
        node.applySlotToGraph(slot);
        return result;
    };
}

function installVirtualNode(nodeType) {
    const prototype = nodeType?.prototype;
    if (!prototype || prototype.__qqMultiPrimitiveInstalled) return;
    if (!multiPrimitiveSourcePrototype) {
        pendingNodeTypes.add(nodeType);
        return;
    }

    for (const name of Object.getOwnPropertyNames(multiPrimitiveSourcePrototype)) {
        if (name === "constructor") continue;
        Object.defineProperty(
            prototype,
            name,
            Object.getOwnPropertyDescriptor(multiPrimitiveSourcePrototype, name),
        );
    }

    const originalCreated = prototype.onNodeCreated;
    prototype.onNodeCreated = function onQQMultiPrimitiveCreated() {
        const result = originalCreated?.apply(this, arguments);
        this.title = TEXT.title;
        this.serialize_widgets = true;
        this.isVirtualNode = true;
        this.properties ||= {};
        this.ensureMinimumOutputs();
        return result;
    };
    prototype.__qqMultiPrimitiveInstalled = true;
    nodeType.title = TEXT.title;
    nodeType.display_name = TEXT.title;
    nodeType.comfyClass = NODE_TYPE;
    nodeType.category = TEXT.category;
}

function registerLegacyNodeType(LiteGraph, BaseClass) {
    if (LiteGraph.registered_node_types?.[LEGACY_NODE_TYPE]) return;
    class LegacyMultiPrimitiveNode extends BaseClass {}
    LiteGraph.registerNodeType(
        LEGACY_NODE_TYPE,
        Object.assign(LegacyMultiPrimitiveNode, {
            title: TEXT.title,
            skip_list: true,
            comfyClass: NODE_TYPE,
        }),
    );
    LegacyMultiPrimitiveNode.category = TEXT.category;
}

app.registerExtension({
    name: "QQ.MultiPrimitive",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name === NODE_TYPE) installVirtualNode(nodeType);
    },
    registerCustomNodes() {
        const LiteGraph = globalThis.LiteGraph;
        if (!LiteGraph?.LGraphNode) return;

        class MultiPrimitiveNode extends LiteGraph.LGraphNode {
            constructor(title) {
                super(title);
                this.title = TEXT.title;
                this.serialize_widgets = true;
                this.isVirtualNode = true;
                this.properties ||= {};
                this.ensureMinimumOutputs();
            }

            addEmptyOutput() {
                const number = (this.outputs?.length || 0) + 1;
                this.addOutput(`${TEXT.empty} ${number}`, "*");
            }

            ensureMinimumOutputs() {
                while ((this.outputs?.length || 0) < MIN_OUTPUTS) this.addEmptyOutput();
            }

            normalizeOutputs() {
                this.ensureMinimumOutputs();
                while (
                    this.outputs.length > MIN_OUTPUTS
                    && !outputHasLink(this.outputs.at(-1))
                    && !outputHasLink(this.outputs.at(-2))
                ) {
                    this.removeOutput(this.outputs.length - 1);
                }
                if (this.outputs.every(outputHasLink)) this.addEmptyOutput();
            }

            resolveOutputTarget(slot) {
                const output = this.outputs?.[slot];
                const linkId = output?.links?.[0];
                const link = linkId == null ? null : this.graph?.links?.[linkId];
                if (!link) return null;
                const targetNode = this.graph?.getNodeById?.(link.target_id);
                const input = targetNode?.inputs?.[link.target_slot];
                const info = targetInfo(targetNode, input);
                return info ? { ...info, link } : null;
            }

            createSlotWidget(slot, info, previousValues) {
                const name = `value_${slot + 1}`;
                const type = configType(info.config);
                const constructor = ComfyWidgets[type];
                let widget = constructor?.(this, name, info.config, app)?.widget;
                if (!widget) {
                    const options = info.config?.[1] || {};
                    widget = this.addWidget(
                        String(info.targetWidget?.type || type).toLowerCase(),
                        name,
                        options.default ?? info.targetWidget?.value ?? null,
                        () => {},
                        { ...options },
                    );
                }
                if (!widget) return null;

                // Keep value_N as the serialized/internal key, but expose the
                // connected input's readable label instead of leaking it into the UI.
                widget.label = inputDisplayName(info, `输入 ${slot + 1}`);
                if (previousValues.has(name)) {
                    widget.value = previousValues.get(name);
                } else if (info.targetWidget) {
                    widget.value = info.targetWidget.value;
                }
                widget.__h3MultiPrimitiveSlot = slot;
                chainWidgetCallback(this, slot, widget);
                return widget;
            }

            rebuildWidgets(savedValues = null) {
                const previousValues = new Map(
                    (this.widgets || []).map((widget) => [widget.name, widget.value]),
                );
                const oldSize = [...(this.size || [180, 60])];
                removeWidgets(this);

                for (let slot = 0; slot < this.outputs.length; slot += 1) {
                    const output = this.outputs[slot];
                    const info = this.resolveOutputTarget(slot);
                    if (!info) {
                        output.type = "*";
                        output.name = `${TEXT.empty} ${slot + 1}`;
                        delete output.widget;
                        continue;
                    }
                    const type = configType(info.config);
                    output.type = type;
                    output.name = `${info.input.localized_name || info.input.label || info.input.name || type} ${slot + 1}`;
                    output.widget = info.input.widget || { name: info.widgetName };
                    this.createSlotWidget(slot, info, previousValues);
                }

                if (Array.isArray(savedValues)) {
                    for (let index = 0; index < savedValues.length; index += 1) {
                        if (this.widgets?.[index]) this.widgets[index].value = savedValues[index];
                    }
                }

                const computed = this.computeSize?.() || oldSize;
                this.setSize?.([
                    Math.max(oldSize[0], computed[0]),
                    Math.max(oldSize[1], computed[1]),
                ]);
                this.setDirtyCanvas?.(true, true);
            }

            applySlotToGraph(slot) {
                const info = this.resolveOutputTarget(slot);
                const sourceWidget = this.widgets?.find(
                    (widget) => widget.__h3MultiPrimitiveSlot === slot,
                );
                if (!info?.targetWidget || !sourceWidget) return;
                info.targetWidget.value = sourceWidget.value;
                info.targetWidget.callback?.(
                    info.targetWidget.value,
                    app.canvas,
                    info.targetNode,
                    app.canvas?.graph_mouse || [0, 0],
                    {},
                );
            }

            applyToGraph() {
                for (let slot = 0; slot < this.outputs.length; slot += 1) {
                    this.applySlotToGraph(slot);
                }
            }

            refreshComboInNode() {
                for (let slot = 0; slot < this.outputs.length; slot += 1) {
                    const info = this.resolveOutputTarget(slot);
                    const widget = this.widgets?.find(
                        (candidate) => candidate.__h3MultiPrimitiveSlot === slot,
                    );
                    if (!info || widget?.type !== "combo") continue;
                    const values = Array.isArray(info.config[0])
                        ? info.config[0]
                        : info.config?.[1]?.values;
                    if (!values) continue;
                    const choices = typeof values === "function" ? values() : values;
                    widget.options.values = choices;
                    if (Array.isArray(choices) && choices.length && !choices.includes(widget.value)) {
                        widget.value = choices[0];
                        widget.callback?.(widget.value);
                    }
                }
            }

            onConnectOutput(slot, _type, input, targetNode) {
                if (outputHasLink(this.outputs?.[slot])) return false;
                return Boolean(targetInfo(targetNode, input));
            }

            onConnectionsChange(type) {
                if (type !== (globalThis.LiteGraph?.OUTPUT ?? 2) || app.configuringGraph) return;
                queueMicrotask(() => {
                    if (!this.graph) return;
                    this.normalizeOutputs();
                    this.rebuildWidgets();
                });
            }

            onAfterGraphConfigured() {
                const savedValues = Array.isArray(this.widgets_values)
                    ? [...this.widgets_values]
                    : null;
                this.normalizeOutputs();
                this.rebuildWidgets(savedValues);
                this.applyToGraph();
            }
        }

        multiPrimitiveSourcePrototype = MultiPrimitiveNode.prototype;
        for (const pendingNodeType of pendingNodeTypes) installVirtualNode(pendingNodeType);
        pendingNodeTypes.clear();

        const existingNodeType = LiteGraph.registered_node_types?.[NODE_TYPE];
        if (existingNodeType) {
            installVirtualNode(existingNodeType);
            registerLegacyNodeType(LiteGraph, existingNodeType);
            return;
        }

        LiteGraph.registerNodeType(
            NODE_TYPE,
            Object.assign(MultiPrimitiveNode, {
                title: TEXT.title,
                display_name: TEXT.title,
                comfyClass: NODE_TYPE,
                nodeData: NODE_METADATA,
            }),
        );
        MultiPrimitiveNode.category = TEXT.category;
        registerLegacyNodeType(LiteGraph, MultiPrimitiveNode);
    },
});

