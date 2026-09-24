import { app } from "../../../scripts/app.js";

const NODE_TYPE = "QQMultiSet";
const GET_NODE_TYPE = "GetNode";
const SET_NODE_TYPE = "SetNode";
const MIN_PAIRS = 2;
const MAX_PAIRS = 64;
const ZH_BROWSER = /^(zh)(?:[-_]|$)/i.test(
    String(globalThis.navigator?.language || globalThis.navigator?.languages?.[0] || ""),
);
const TEXT = {
    title: "QQ-多值设置",
    variable: ZH_BROWSER ? "变量" : "Variable",
    empty: ZH_BROWSER ? "接入值" : "Connect value",
    category: "QQ/工具",
};

function graphLink(graph, linkId) {
    if (linkId == null || !graph) return null;
    if (typeof graph.getLink === "function") return graph.getLink(linkId);
    if (graph.links) return graph.links[linkId] ?? null;
    if (graph._links instanceof Map) return graph._links.get(linkId) ?? null;
    return graph._links?.[linkId] ?? null;
}

function graphNodes(graph) {
    return Array.isArray(graph?._nodes) ? graph._nodes : [];
}

function entryWidget(node, slot) {
    return node?.widgets?.find((widget) => widget.name === `name_${slot + 1}`);
}

function entryName(node, slot) {
    return String(entryWidget(node, slot)?.value || "").trim();
}

function pairUsed(node, slot) {
    return node.inputs?.[slot]?.link != null || Boolean(node.outputs?.[slot]?.links?.length);
}

function sourceInfo(node, slot) {
    const input = node.inputs?.[slot];
    const link = graphLink(node.graph, input?.link);
    if (!link) return null;
    const sourceNode = node.graph?.getNodeById?.(link.origin_id);
    const sourceSlot = sourceNode?.outputs?.[link.origin_slot];
    if (!sourceSlot) return null;
    const type = String(sourceSlot.type || link.type || "*");
    const name = String(
        sourceSlot.localized_name
        || sourceSlot.label
        || sourceSlot.name
        || type
        || TEXT.variable,
    ).trim();
    return { link, name, sourceNode, sourceSlot, type };
}

function targetType(node, slot) {
    const linkId = node.outputs?.[slot]?.links?.[0];
    const link = graphLink(node.graph, linkId);
    if (!link) return "*";
    const targetNode = node.graph?.getNodeById?.(link.target_id);
    return String(targetNode?.inputs?.[link.target_slot]?.type || link.type || "*");
}

function multiSetEntries(graph) {
    const entries = [];
    for (const node of graphNodes(graph)) {
        if (node.type !== NODE_TYPE) continue;
        for (let slot = 0; slot < (node.inputs?.length || 0); slot += 1) {
            const name = entryName(node, slot);
            if (!name) continue;
            entries.push({ input: node.inputs[slot], name, node, output: node.outputs?.[slot], slot });
        }
    }
    return entries;
}

function findMultiSetEntry(graph, name) {
    const wanted = String(name || "").trim();
    if (!wanted) return null;
    return multiSetEntries(graph).find((entry) => entry.name === wanted) || null;
}

function conventionalSetNames(graph) {
    return graphNodes(graph)
        .filter((node) => node.type === SET_NODE_TYPE)
        .map((node) => String(node.widgets?.[0]?.value || "").trim())
        .filter(Boolean);
}

function uniqueName(graph, wanted, currentNode, currentSlot) {
    const base = String(wanted || TEXT.variable).trim() || TEXT.variable;
    const used = new Set(conventionalSetNames(graph));
    for (const entry of multiSetEntries(graph)) {
        if (entry.node === currentNode && entry.slot === currentSlot) continue;
        used.add(entry.name);
    }
    if (!used.has(base)) return base;
    let suffix = 2;
    while (used.has(`${base}_${suffix}`)) suffix += 1;
    return `${base}_${suffix}`;
}

function multiSetNames(graph) {
    return multiSetEntries(graph).map((entry) => entry.name);
}

function getComboValues(widget) {
    let values = widget?.options?.values;
    if (typeof values === "function") values = values.call(widget.options);
    return Array.isArray(values) ? values : [];
}

function installGetWidgetClickCompatibility(node, widget) {
    const originalOnClick = widget?.onClick;
    if (typeof originalOnClick !== "function" || originalOnClick.__h3MultiSetWrapped) return;
    const wrappedOnClick = function openGetComboWithMultiSet(params) {
        const LiteGraph = globalThis.LiteGraph;
        if (LiteGraph?.vueNodesMode || !multiSetNames(node.graph).length) {
            return originalOnClick.apply(this, arguments);
        }
        const { e, canvas } = params || {};
        const x = Number(e?.canvasX) - Number(node.pos?.[0]);
        const width = Number(widget.width || node.size?.[0]) || 0;
        if (!e || !canvas || !Number.isFinite(x) || x < 40 || x > width - 40) {
            return originalOnClick.apply(this, arguments);
        }
        const values = getComboValues(widget);
        const getOptionLabel = widget.options?.getOptionLabel;
        const labels = values.map((value) => getOptionLabel?.(value) || value);
        new LiteGraph.ContextMenu(labels, {
            scale: Math.max(1, Number(canvas.ds?.scale) || 1),
            event: e,
            className: "dark",
            callback: (selectedLabel) => {
                const index = labels.indexOf(selectedLabel);
                if (index < 0) return;
                if (typeof widget.setValue === "function") {
                    widget.setValue(values[index], { e, node, canvas });
                } else {
                    widget.value = values[index];
                    widget.callback?.(values[index]);
                }
            },
        });
    };
    wrappedOnClick.__h3MultiSetWrapped = true;
    widget.onClick = wrappedOnClick;
}

function wrapGetCombo(node) {
    if (node?.type !== GET_NODE_TYPE) return;
    const widget = node.widgets?.[0];
    const options = widget?.options;
    if (!widget || !options) return;

    if (!options.__h3MultiSetValues) {
        const descriptor = Object.getOwnPropertyDescriptor(options, "values");
        widget.__h3MultiSetOriginalValues = () => {
            let values = descriptor?.get ? descriptor.get.call(options) : descriptor?.value;
            if (typeof values === "function") values = values();
            return Array.isArray(values) ? values : [];
        };
    }
    const readOriginal = widget.__h3MultiSetOriginalValues || (() => []);
    const wrapped = { ...options, __h3MultiSetValues: true };
    Object.defineProperty(wrapped, "values", {
        configurable: true,
        enumerable: true,
        get: () => [...new Set([...readOriginal(), ...multiSetNames(node.graph)])].sort(),
    });
    widget.options = wrapped;
    installGetWidgetClickCompatibility(node, widget);

    // Vue nodes cache combo options by object identity. Reinsert the widget so
    // newly connected or renamed Multi Set entries become visible immediately.
    const index = node.widgets.indexOf(widget);
    if (index >= 0) {
        node.widgets.splice(index, 1);
        node.widgets.splice(index, 0, widget);
    }
}

function installGetNodeInstanceCompatibility(node) {
    if (node?.type !== GET_NODE_TYPE) return;
    const refreshCombo = node._refreshComboOptions;
    if (typeof refreshCombo === "function" && !refreshCombo.__h3MultiSetWrapped) {
        const wrappedRefresh = function refreshComboWithMultiSet() {
            const result = refreshCombo.apply(this, arguments);
            wrapGetCombo(this);
            return result;
        };
        wrappedRefresh.__h3MultiSetWrapped = true;
        node._refreshComboOptions = wrappedRefresh;
    }
}

function refreshGetNode(node) {
    if (node?.type !== GET_NODE_TYPE) return;
    installGetNodeInstanceCompatibility(node);
    if (typeof node._refreshComboOptions === "function") node._refreshComboOptions();
    else wrapGetCombo(node);
    node.onRename?.();
}

function refreshGetNodes(graph) {
    for (const node of graphNodes(graph)) {
        refreshGetNode(node);
    }
    app.canvas?.setDirty?.(true, true);
}

function multiSetAdapter(entry) {
    return {
        __h3MultiSetEntry: entry,
        graph: entry.node.graph,
        id: entry.node.id,
        inputs: [entry.input],
        pos: entry.node.pos,
        size: entry.node.size,
        title: entry.node.title,
        type: entry.node.type,
        widgets: [{ value: entry.name }],
    };
}

function installGetNodeCompatibility() {
    const GetNode = globalThis.LiteGraph?.registered_node_types?.[GET_NODE_TYPE];
    const prototype = GetNode?.prototype;
    if (!prototype || prototype.__h3MultiSetCompatible) return Boolean(prototype);
    prototype.__h3MultiSetCompatible = true;

    const originalFindSetter = prototype.findSetter;
    prototype.findSetter = function findSetterWithMultiSet(graph) {
        const conventional = originalFindSetter?.apply(this, arguments);
        if (conventional) return conventional;
        const entry = findMultiSetEntry(graph, this.widgets?.[0]?.value);
        return entry ? multiSetAdapter(entry) : undefined;
    };

    const originalGetInputLink = prototype.getInputLink;
    prototype.getInputLink = function getMultiSetInputLink(slot) {
        const conventional = originalFindSetter?.call(this, this.graph);
        if (conventional || !findMultiSetEntry(this.graph, this.widgets?.[0]?.value)) {
            return originalGetInputLink?.apply(this, arguments) ?? null;
        }
        const entry = findMultiSetEntry(this.graph, this.widgets?.[0]?.value);
        if (!entry) return null;
        return {
            origin_id: entry.node.id,
            origin_slot: entry.slot,
            target_id: this.id,
            target_slot: slot,
            type: entry.output?.type || entry.input?.type || "*",
        };
    };

    const originalResolveVirtualOutput = prototype.resolveVirtualOutput;
    prototype.resolveVirtualOutput = function resolveMultiSetOutput(slot) {
        const conventional = originalResolveVirtualOutput?.apply(this, arguments);
        if (conventional) return conventional;
        const entry = findMultiSetEntry(this.graph, this.widgets?.[0]?.value);
        return entry ? { node: entry.node, slot: entry.slot } : undefined;
    };

    const originalGoToSetter = prototype.goToSetter;
    prototype.goToSetter = function goToMultiSetter() {
        const entry = this.currentSetter?.__h3MultiSetEntry;
        if (!entry) return originalGoToSetter?.apply(this, arguments);
        app.canvas?.centerOnNode?.(entry.node);
        app.canvas?.selectNode?.(entry.node, false);
        app.canvas?.setDirty?.(true, true);
    };

    const originalOnAdded = prototype.onAdded;
    prototype.onAdded = function onAddedWithMultiSetRefresh() {
        const result = originalOnAdded?.apply(this, arguments);
        scheduleCreatedGetRefresh(this);
        return result;
    };

    return true;
}

function scheduleGetCompatibility() {
    for (const delay of [0, 100, 500, 1500]) {
        setTimeout(() => {
            if (!installGetNodeCompatibility()) return;
            for (const node of graphNodes(app.graph)) refreshGetNode(node);
        }, delay);
    }
}

function scheduleCreatedGetRefresh(node) {
    const refresh = () => {
        if (!node?.graph) return;
        installGetNodeCompatibility();
        refreshGetNode(node);
    };
    queueMicrotask(refresh);
    for (const delay of [0, 50, 200]) setTimeout(refresh, delay);
}

function inputName(slot) {
    return `value_${slot + 1}`;
}

function addNameWidget(node, slot) {
    if (entryWidget(node, slot)) return;
    node.addWidget("text", `name_${slot + 1}`, "", () => {
        if (!node.graph || app.configuringGraph) return;
        node.commitName(slot);
        refreshGetNodes(node.graph);
    }, {});
}

function ensurePairs(node, requestedCount) {
    const count = Math.min(MAX_PAIRS, Math.max(MIN_PAIRS, requestedCount));
    while ((node.inputs?.length || 0) < count) {
        const slot = node.inputs?.length || 0;
        node.addInput(inputName(slot), "*");
    }
    while ((node.outputs?.length || 0) < count) {
        const slot = node.outputs?.length || 0;
        node.addOutput(`${TEXT.empty} ${slot + 1}`, "*");
    }
    for (let slot = 0; slot < count; slot += 1) addNameWidget(node, slot);
}

function initializeMultiSet(node) {
    node.title = TEXT.title;
    node.serialize_widgets = true;
    node.properties ||= {};
    node.properties.multi_set_previous_names ||= [];

    while ((node.inputs?.length || 0) > MIN_PAIRS) node.removeInput(node.inputs.length - 1);
    while ((node.outputs?.length || 0) > MIN_PAIRS) node.removeOutput(node.outputs.length - 1);
    ensurePairs(node, MIN_PAIRS);
    const computed = node.computeSize?.();
    if (computed) node.setSize?.([Math.max(210, computed[0]), computed[1]]);
}

function installMultiSetNode(nodeType) {
    const prototype = nodeType?.prototype;
    if (!prototype || prototype.__h3MultiSetInstalled) return;
    prototype.__h3MultiSetInstalled = true;

    const originalCreated = prototype.onNodeCreated;
    prototype.onNodeCreated = function onNodeCreatedMultiSet() {
        const result = originalCreated?.apply(this, arguments);
        initializeMultiSet(this);
        return result;
    };

    prototype.addPair = function addPair() {
        const slot = this.inputs?.length || 0;
        if (slot >= MAX_PAIRS) return;
        this.addInput(inputName(slot), "*");
        this.addOutput(`${TEXT.empty} ${slot + 1}`, "*");
        addNameWidget(this, slot);
    };

    prototype.ensurePairs = function ensureMultiSetPairs(count) {
        ensurePairs(this, count);
    };

    prototype.addNameWidget = function addMultiSetNameWidget(slot) {
        addNameWidget(this, slot);
    };

    prototype.removeLastPair = function removeLastPair() {
        const slot = this.inputs.length - 1;
        const widget = entryWidget(this, slot);
        widget?.onRemove?.();
        if (widget) this.widgets.splice(this.widgets.indexOf(widget), 1);
        this.removeInput(slot);
        this.removeOutput(slot);
        this.properties.multi_set_previous_names.length = slot;
    };

    prototype.normalizePairs = function normalizePairs() {
        const count = Math.max(MIN_PAIRS, this.inputs?.length || 0, this.outputs?.length || 0);
        ensurePairs(this, count);
        while (
            this.inputs.length > MIN_PAIRS
            && !pairUsed(this, this.inputs.length - 1)
            && !pairUsed(this, this.inputs.length - 2)
        ) {
            this.removeLastPair();
        }
        if (
            this.inputs.length < MAX_PAIRS
            && this.inputs.every((input) => input.link != null)
        ) this.addPair();
    };

    prototype.commitName = function commitName(slot, suggestedName = "") {
        const widget = entryWidget(this, slot);
        if (!widget) return "";
        const previous = String(this.properties.multi_set_previous_names?.[slot] || "");
        if (!String(widget.value || "").trim() && suggestedName) widget.value = suggestedName;
        if (String(widget.value || "").trim()) {
            widget.value = uniqueName(this.graph, widget.value, this, slot);
        }
        const name = String(widget.value || "").trim();
        const visibleName = name || `${TEXT.empty} ${slot + 1}`;
        this.properties.multi_set_previous_names[slot] = name;
        const input = this.inputs?.[slot];
        const output = this.outputs?.[slot];
        if (input) {
            input.name = inputName(slot);
            input.label = visibleName;
        }
        if (output) output.name = visibleName;

        if (previous && previous !== name) {
            for (const getNode of graphNodes(this.graph)) {
                if (getNode.type !== GET_NODE_TYPE || getNode.widgets?.[0]?.value !== previous) continue;
                getNode.widgets[0].value = name;
                getNode.onRename?.();
            }
        }
        return name;
    };

    prototype.syncPair = function syncPair(slot) {
        const input = this.inputs?.[slot];
        const output = this.outputs?.[slot];
        if (!input || !output) return;
        const source = sourceInfo(this, slot);
        const type = source?.type || targetType(this, slot) || "*";
        input.type = type;
        output.type = type;
        this.commitName(slot, source?.name || (type !== "*" ? type : ""));
    };

    prototype.syncAllPairs = function syncAllPairs() {
        this.normalizePairs();
        for (let slot = 0; slot < this.inputs.length; slot += 1) this.syncPair(slot);
        const computed = this.computeSize?.();
        if (computed) this.setSize?.([
            Math.max(this.size?.[0] || 0, computed[0]),
            Math.max(this.size?.[1] || 0, computed[1]),
        ]);
        refreshGetNodes(this.graph);
        this.setDirtyCanvas?.(true, true);
    };

    const originalConnectionsChange = prototype.onConnectionsChange;
    prototype.onConnectionsChange = function onConnectionsChangeMultiSet(type) {
        const result = originalConnectionsChange?.apply(this, arguments);
        const LiteGraph = globalThis.LiteGraph;
        if (
            app.configuringGraph
            || (type !== (LiteGraph?.INPUT ?? 1) && type !== (LiteGraph?.OUTPUT ?? 2))
        ) return result;
        queueMicrotask(() => {
            if (this.graph) this.syncAllPairs();
        });
        return result;
    };

    const originalAfterConfigured = prototype.onAfterGraphConfigured;
    prototype.onAfterGraphConfigured = function onAfterGraphConfiguredMultiSet() {
        const result = originalAfterConfigured?.apply(this, arguments);
        const savedValues = this.__h3MultiSetSavedWidgetValues || [];
        const count = Math.max(MIN_PAIRS, this.inputs?.length || 0, this.outputs?.length || 0);
        ensurePairs(this, count);
        for (let slot = 0; slot < savedValues.length; slot += 1) {
            const widget = entryWidget(this, slot);
            if (widget) widget.value = savedValues[slot];
        }
        this.syncAllPairs();
        this.__h3MultiSetSavedWidgetValues = null;
        return result;
    };

    const originalConfigure = prototype.onConfigure;
    prototype.onConfigure = function onConfigureMultiSet(info) {
        const result = originalConfigure?.apply(this, arguments);
        this.__h3MultiSetSavedWidgetValues = Array.isArray(info?.widgets_values)
            ? [...info.widgets_values]
            : [];
        const count = Math.max(
            MIN_PAIRS,
            info?.inputs?.length || 0,
            info?.outputs?.length || 0,
            this.inputs?.length || 0,
            this.outputs?.length || 0,
        );
        ensurePairs(this, count);
        for (let slot = 0; slot < this.__h3MultiSetSavedWidgetValues.length; slot += 1) {
            const widget = entryWidget(this, slot);
            if (widget) widget.value = this.__h3MultiSetSavedWidgetValues[slot];
        }
        return result;
    };

    const originalRemoved = prototype.onRemoved;
    prototype.onRemoved = function onRemovedMultiSet() {
        const graph = this.graph;
        const result = originalRemoved?.apply(this, arguments);
        if (graph) setTimeout(() => refreshGetNodes(graph), 0);
        return result;
    };
}

app.registerExtension({
    name: "QQ.MultiSet",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_TYPE) return;
        installMultiSetNode(nodeType);
    },
    nodeCreated(node) {
        if (node?.type !== GET_NODE_TYPE) return;
        installGetNodeCompatibility();
        scheduleCreatedGetRefresh(node);
    },
    setup() {
        scheduleGetCompatibility();
    },
});

