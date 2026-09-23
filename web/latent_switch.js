import { app } from "../../scripts/app.js";

const NODE_TYPE = "WyslLatentSwitch";

function latentInputs(node) {
    return (node.inputs || []).filter((input) => input.type === "LATENT");
}

function displayName(input) {
    return input.label || input.name;
}

export function syncSelectWidget(node) {
    const widget = node.widgets?.find((item) => item.name === "select");
    if (!widget) {
        return;
    }
    const names = latentInputs(node).map(displayName);
    if (!names.length) {
        return;
    }
    const previous = widget.value;
    widget.options.values = names;
    widget.value = names.includes(previous) ? previous : names[0];
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
    if (type !== LiteGraph.INPUT) {
        return;
    }
    const input = node.inputs[index];
    if (!input || input.type !== "LATENT") {
        return;
    }
    const stack = new Error().stack || "";
    const loading = stack.includes("loadGraphData") || stack.includes("pasteFromClipboard");
    if (!loading && !connected) {
        const slots = latentInputs(node);
        const empty = slots.filter((slot) => slot.link == null);
        while (empty.length > 1) {
            node.removeInput(node.inputs.indexOf(empty.pop()));
        }
    }
    if (!loading && connected) {
        ensureTrailingSlot(node);
    }
    syncSelectWidget(node);
}

app.registerExtension({
    name: "Wysl.LatentSwitch",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) {
            return;
        }
        const original = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (type, index, connected, linkInfo) {
            const result = original?.apply(this, arguments);
            onLatentConnectionChange(this, type, index, connected, linkInfo);
            return result;
        };
    },
    nodeCreated(node) {
        if (node.comfyClass !== NODE_TYPE) {
            return;
        }
        for (const input of latentInputs(node)) {
            if (!input.label) {
                input.label = input.name;
            }
        }
        ensureTrailingSlot(node);
        syncSelectWidget(node);
        const widget = node.widgets?.find((item) => item.name === "select");
        const timer = setInterval(() => {
            if (!node.graph) {
                clearInterval(timer);
                return;
            }
            syncSelectWidget(node);
        }, 300);
        if (widget) {
            const original = widget.callback;
            widget.callback = function () {
                syncSelectWidget(node);
                return original?.apply(this, arguments);
            };
        }
    },
});
