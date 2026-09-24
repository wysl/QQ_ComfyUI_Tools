import { app } from "../../scripts/app.js";

// Wysl-轮询切换 的前端：只负责「显示几个输入口」。
// 后端声明了 MAX_INPUTS 个可选输入，这里默认只留 MIN_INPUTS 个；
// 每接满一个就补下一个，尾部空闲的再收回去。

const NODE_TYPE = "WyslPollingSwitch";
const MIN_INPUTS = 2;
const MAX_INPUTS = 8;

function inputName(slot) {
    return `input${slot + 1}`;
}

// 目标数量 = 最后一个已连接输入的下一个，且不少于 MIN_INPUTS
function targetCount(node) {
    let lastConnected = 0;
    (node.inputs || []).forEach((input, index) => {
        if (input?.link != null) lastConnected = index + 1;
    });
    return Math.min(MAX_INPUTS, Math.max(MIN_INPUTS, lastConnected + 1));
}

function ensureInputs(node, requestedCount) {
    const count = Math.min(MAX_INPUTS, Math.max(MIN_INPUTS, requestedCount));
    while ((node.inputs?.length || 0) < count) {
        node.addInput(inputName(node.inputs?.length || 0), "*");
    }
}

function normalizeInputs(node) {
    if (!node?.inputs || app?.configuringGraph) return;
    const want = targetCount(node);
    ensureInputs(node, want);
    // 只从尾部回收「空闲」的口，已连线的绝不删除
    while (node.inputs.length > MIN_INPUTS && node.inputs.length > want) {
        const last = node.inputs[node.inputs.length - 1];
        if (last?.link != null) break;
        node.removeInput(node.inputs.length - 1);
    }
    node.setDirtyCanvas?.(true, true);
}

function initializeSwitch(node) {
    // 后端给的 8 个口先收起到 MIN_INPUTS
    while ((node.inputs?.length || 0) > MIN_INPUTS) {
        const last = node.inputs[node.inputs.length - 1];
        if (last?.link != null) break;
        node.removeInput(node.inputs.length - 1);
    }
    ensureInputs(node, MIN_INPUTS);
}

function install(nodeType) {
    const prototype = nodeType?.prototype;
    if (!prototype || prototype.__wyslPollingInstalled) return;
    prototype.__wyslPollingInstalled = true;

    const originalCreated = prototype.onNodeCreated;
    prototype.onNodeCreated = function onNodeCreatedPollingSwitch() {
        const result = originalCreated?.apply(this, arguments);
        initializeSwitch(this);
        return result;
    };

    const originalConnectionsChange = prototype.onConnectionsChange;
    prototype.onConnectionsChange = function onConnectionsChangePollingSwitch(type) {
        const result = originalConnectionsChange?.apply(this, arguments);
        const LiteGraph = globalThis.LiteGraph;
        if (app?.configuringGraph || type !== (LiteGraph?.INPUT ?? 1)) return result;
        queueMicrotask(() => {
            if (this.graph) normalizeInputs(this);
        });
        return result;
    };

    const originalConfigure = prototype.onConfigure;
    prototype.onConfigure = function onConfigurePollingSwitch(info) {
        const result = originalConfigure?.apply(this, arguments);
        // 让保存时的口数先有落点，再交给 onAfterGraphConfigured 收敛
        const savedCount = Array.isArray(info?.inputs) ? info.inputs.length : 0;
        ensureInputs(this, Math.max(MIN_INPUTS, savedCount));
        return result;
    };

    const originalAfterConfigured = prototype.onAfterGraphConfigured;
    prototype.onAfterGraphConfigured = function onAfterGraphConfiguredPollingSwitch() {
        const result = originalAfterConfigured?.apply(this, arguments);
        normalizeInputs(this);
        return result;
    };
}

app.registerExtension({
    name: "Wysl.PollingSwitch",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_TYPE) return;
        install(nodeType);
    },
});
