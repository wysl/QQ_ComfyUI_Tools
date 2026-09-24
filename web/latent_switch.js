import { app } from "../../scripts/app.js";

const NODE_TYPE = "QQLatentSwitch";

function latentInputs(node) {
    return (node.inputs || []).filter((input) => input.type === "LATENT");
}

function displayName(input) {
    return input.label || input.name;
}

export function syncSelectWidget(node) {
    const widget = node.widgets?.find((item) => item.name === "select");
    if (!widget) return;
    const names = latentInputs(node)
        .filter((input) => input.link != null)
        .map(displayName);
    const choices = names.length ? names : ["latent1"];
    const previous = widget.value;
    widget.options.values = choices;
    if (typeof widget.options.values === "function") return;
    widget.value = choices.includes(previous) ? previous : choices[0];
}

function refreshPrimitiveSources(node) {
    for (const output of node.outputs || []) {
        for (const linkId of output.links || []) {
            const link = node.graph?.links?.[linkId];
            const source = node.graph?.getNodeById?.(link?.origin_id);
            source?.refreshComboInNode?.();
        }
    }
}

function ensureTrailingSlot(node) {
    const slots = latentInputs(node);
    if (!slots.length || slots[slots.length - 1].link != null) {
        const next = slots.length + 1;
        node.addInput(`latent${next}`, "LATENT");
        node.inputs[node.inputs.length - 1].label = `latent${next}`;
    }
}

function onLatentConnectionChange(node, type, index, connected) {
    if (type !== LiteGraph.INPUT) return;
    const input = node.inputs[index];
    if (!input || input.type !== "LATENT") return;
    const stack = new Error().stack || "";
    const loading = stack.includes("loadGraphData") || stack.includes("pasteFromClipboard");
    if (!loading && !connected) {
        const empty = latentInputs(node).filter((slot) => slot.link == null);
        while (empty.length > 1) node.removeInput(node.inputs.indexOf(empty.pop()));
    }
    if (!loading && connected) ensureTrailingSlot(node);
    syncSelectWidget(node);
    refreshPrimitiveSources(node);
}

app.registerExtension({
    name: "QQ.LatentSwitch",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;
        const original = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (type, index, connected, linkInfo) {
            const result = original?.apply(this, arguments);
            onLatentConnectionChange(this, type, index, connected, linkInfo);
            return result;
        };
        const originalGetExtra = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function () {
            const options = originalGetExtra?.apply(this, arguments) || [];
            options.push({
                content: "同步输入名称到选择框",
                callback: () => {
                    syncSelectWidget(this);
                    refreshPrimitiveSources(this);
                },
            });
            return options;
        };
    },
    nodeCreated(node) {
        if (node.comfyClass !== NODE_TYPE) return;
        for (const input of latentInputs(node)) {
            if (!input.label) input.label = input.name;
        }
        ensureTrailingSlot(node);
        syncSelectWidget(node);
        const timer = setInterval(() => {
            if (!node.graph) {
                clearInterval(timer);
                return;
            }
            const before = JSON.stringify(node.widgets?.find((item) => item.name === "select")?.options?.values || []);
            syncSelectWidget(node);
            const after = JSON.stringify(node.widgets?.find((item) => item.name === "select")?.options?.values || []);
            if (before !== after) refreshPrimitiveSources(node);
        }, 400);
    },
});
