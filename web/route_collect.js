import { app } from "../../scripts/app.js";

// QQ-条件收集 的前端：动态增减输入口，并让选择框列出「输入口名称」。
//   输入口数量 = 最后一个已连线输入口的后一个（至少 MIN_INPUTS，最多 MAX_INPUTS）
//   选择框的值是输入口名称；改名后按位置跟着换
//   同一条链路上的 QQ-条件分发 与本节点的选择会自动对齐（双向）

const NODE_TYPE = "QQRouteCollect";
const DISPATCH_TYPE = "QQRouteDispatch";
const SELECT_WIDGET = "select";
const MIN_INPUTS = 2;
const MAX_INPUTS = 8;
const SYNC_GUARD = "__qqRouteSyncing";

export function defaultInputName(index) {
    return `输入${index + 1}`;
}

function inputLabel(input, index) {
    const label = typeof input?.label === "string" ? input.label.trim() : "";
    if (label) return label;
    const name = typeof input?.name === "string" ? input.name.trim() : "";
    return name || defaultInputName(index);
}

export function inputNames(node) {
    return (node?.inputs || []).map((input, index) => inputLabel(input, index));
}

function connected(input) {
    return input?.link != null;
}

export function targetInputCount(node, min = MIN_INPUTS, max = MAX_INPUTS) {
    let lastConnected = -1;
    (node?.inputs || []).forEach((input, index) => {
        if (connected(input)) lastConnected = index;
    });
    return Math.min(max, Math.max(min, lastConnected + 2));
}

export function ensureInputs(node, count, min = MIN_INPUTS, max = MAX_INPUTS) {
    const want = Math.min(max, Math.max(min, count));
    while ((node?.inputs?.length || 0) < want) {
        const index = node.inputs.length;
        const name = defaultInputName(index);
        node.addInput(name, "*");
        const input = node.inputs[node.inputs.length - 1];
        if (input) {
            // 惰性求值必须在前端标记，否则 ComfyUI 会照常求值全部分支
            input.lazy = true;
            input.label = name;
            input.localized_name = name;
        }
    }
    return want;
}

export function pruneInputs(node, count, min = MIN_INPUTS, max = MAX_INPUTS) {
    const want = Math.min(max, Math.max(min, count));
    while ((node?.inputs?.length || 0) > want) {
        const last = node.inputs[node.inputs.length - 1];
        // 已连线的口绝不回收
        if (connected(last)) break;
        node.removeInput(node.inputs.length - 1);
    }
}

export function selectedIndex(value, names) {
    const choice = String(value ?? "").trim();
    if (!choice) return -1;
    const exact = names.indexOf(choice);
    if (exact >= 0) return exact;
    const stripped = choice.replace(/^(输入|input)/i, "").trim();
    if (!/^\d+$/.test(stripped)) return -1;
    const index = Number(stripped) - 1;
    return index >= 0 && index < names.length ? index : -1;
}

export function remapValue(value, names, previousNames = []) {
    if (!names.length) return "";
    if (names.includes(value)) return value;
    const oldIndex = previousNames.indexOf(value);
    if (oldIndex >= 0 && oldIndex < names.length) return names[oldIndex];
    const numeric = selectedIndex(value, names);
    if (numeric >= 0) return names[numeric];
    return names[0];
}

export function selectWidget(node) {
    return node?.widgets?.find((widget) => widget?.name === SELECT_WIDGET) || null;
}

export function syncSelectWidget(node, previousNames = []) {
    const widget = selectWidget(node);
    if (!widget) return [];
    const names = inputNames(node);
    widget.options ||= {};
    if (typeof widget.options.values === "function") return names;
    widget.value = remapValue(widget.value, names, previousNames);
    widget.options.values = names;
    return names;
}

// ── 与分发节点对齐 ─────────────────────────────────────
// 分发的 select 值形如「输出2」，收集的形如「输入2」；对齐时只比较序号。

function slotIndexText(value, prefix) {
    const text = String(value ?? "").trim();
    return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

export function linkedDispatch(node) {
    if (!node?.graph) return null;
    for (const input of node.inputs || []) {
        if (input?.link == null) continue;
        const link = node.graph.getLink?.(input.link) ?? node.graph.links?.[input.link];
        const source = node.graph.getNodeById?.(link?.origin_id);
        if (!source) continue;
        if (source.type === DISPATCH_TYPE) return source;
        if (source.type === NODE_TYPE) {
            const upstream = linkedDispatch(source);
            if (upstream) return upstream;
        }
    }
    return null;
}

function setWidgetValue(node, value) {
    const widget = selectWidget(node);
    if (!widget || widget.value === value) return false;
    widget.value = value;
    widget.callback?.(value);
    node.setDirtyCanvas?.(true, true);
    return true;
}

export function syncFromDispatch(node) {
    const dispatch = linkedDispatch(node);
    if (!dispatch || node[SYNC_GUARD]) return false;
    const index = slotIndexText(selectWidget(dispatch)?.value, "输出");
    const names = inputNames(node);
    const wanted = names.find((name, position) => String(position + 1) === index);
    if (!wanted) return false;
    node[SYNC_GUARD] = true;
    try {
        return setWidgetValue(node, wanted);
    } finally {
        node[SYNC_GUARD] = false;
    }
}

export function syncToDispatch(node) {
    const dispatch = linkedDispatch(node);
    if (!dispatch || node[SYNC_GUARD]) return false;
    const index = selectedIndex(selectWidget(node)?.value, inputNames(node));
    if (index < 0) return false;
    const names = (dispatch.outputs || []).map((output, position) => (
        (typeof output?.label === "string" && output.label.trim()) || `输出${position + 1}`
    ));
    const wanted = names[index];
    if (!wanted) return false;
    dispatch[SYNC_GUARD] = true;
    try {
        return setWidgetValue(dispatch, wanted);
    } finally {
        dispatch[SYNC_GUARD] = false;
    }
}

function refreshDispatchConsumers(node) {
    const dispatch = linkedDispatch(node);
    if (!dispatch) return;
    for (const output of dispatch.outputs || []) {
        for (const linkId of output?.links || []) {
            const link = node.graph?.getLink?.(linkId) ?? node.graph?.links?.[linkId];
            const consumer = node.graph?.getNodeById?.(link?.target_id);
            consumer?.setDirtyCanvas?.(true, true);
        }
    }
}

export function syncNode(node) {
    if (!node || !node.graph) return;
    const previous = Array.isArray(node.__qqCollectNames) ? node.__qqCollectNames : [];
    const target = targetInputCount(node);
    ensureInputs(node, target);
    pruneInputs(node, target);
    node.__qqCollectNames = syncSelectWidget(node, previous);
    refreshDispatchConsumers(node);
    node.setDirtyCanvas?.(true, true);
}

function initializeNode(node) {
    if (!node) return;
    ensureInputs(node, Math.max(MIN_INPUTS, node.inputs?.length || 0));
    node.__qqCollectNames = inputNames(node);
    syncSelectWidget(node, node.__qqCollectNames);
    if (!node.__qqRouteCollectTimer) {
        node.__qqRouteCollectTimer = globalThis.setInterval(() => {
            if (!node.graph) {
                globalThis.clearInterval(node.__qqRouteCollectTimer);
                node.__qqRouteCollectTimer = null;
                return;
            }
            if (app?.configuringGraph) return;
            const before = JSON.stringify(node.__qqCollectNames || []);
            syncNode(node);
            if (before !== JSON.stringify(node.__qqCollectNames || [])) {
                node.setDirtyCanvas?.(true, true);
            }
        }, 500);
    }
}

function install(nodeType) {
    const prototype = nodeType?.prototype;
    if (!prototype || prototype.__qqRouteCollectInstalled) return;
    prototype.__qqRouteCollectInstalled = true;

    const originalCreated = prototype.onNodeCreated;
    prototype.onNodeCreated = function onNodeCreatedRouteCollect() {
        const result = originalCreated?.apply(this, arguments);
        initializeNode(this);
        return result;
    };

    const originalAdded = prototype.onAdded;
    prototype.onAdded = function onAddedRouteCollect() {
        const result = originalAdded?.apply(this, arguments);
        initializeNode(this);
        syncNode(this);
        syncFromDispatch(this);
        return result;
    };

    const originalConfigure = prototype.onConfigure;
    prototype.onConfigure = function onConfigureRouteCollect(info) {
        const result = originalConfigure?.apply(this, arguments);
        const saved = Array.isArray(info?.inputs) ? info.inputs.length : 0;
        ensureInputs(this, Math.max(MIN_INPUTS, saved));
        this.__qqCollectNames = inputNames(this);
        return result;
    };

    const originalAfterConfigured = prototype.onAfterGraphConfigured;
    prototype.onAfterGraphConfigured = function onAfterGraphConfiguredRouteCollect() {
        const result = originalAfterConfigured?.apply(this, arguments);
        syncNode(this);
        syncFromDispatch(this);
        return result;
    };

    const originalConnectionsChange = prototype.onConnectionsChange;
    prototype.onConnectionsChange = function onConnectionsChangeRouteCollect(type) {
        const result = originalConnectionsChange?.apply(this, arguments);
        if (app?.configuringGraph) return result;
        const LiteGraph = globalThis.LiteGraph;
        if (type !== (LiteGraph?.INPUT ?? 1)) return result;
        queueMicrotask(() => {
            if (!this.graph) return;
            syncNode(this);
            syncFromDispatch(this);
        });
        return result;
    };

    const originalRemoved = prototype.onRemoved;
    prototype.onRemoved = function onRemovedRouteCollect() {
        if (this.__qqRouteCollectTimer) {
            globalThis.clearInterval(this.__qqRouteCollectTimer);
            this.__qqRouteCollectTimer = null;
        }
        return originalRemoved?.apply(this, arguments);
    };

    const originalGetExtraMenuOptions = prototype.getExtraMenuOptions;
    prototype.getExtraMenuOptions = function getExtraMenuOptionsRouteCollect() {
        const options = originalGetExtraMenuOptions?.apply(this, arguments) || [];
        options.push(null, {
            content: "增加一个输入口",
            callback: () => {
                if ((this.inputs?.length || 0) >= MAX_INPUTS) return;
                ensureInputs(this, (this.inputs?.length || 0) + 1);
                syncNode(this);
            },
        });
        options.push({
            content: "选择对齐到分发节点",
            callback: () => {
                syncFromDispatch(this);
                syncNode(this);
            },
        });
        options.push({
            content: "把选择推给分发节点",
            callback: () => syncToDispatch(this),
        });
        return options;
    };
}

// 收集节点上的选择变化要反向同步给分发节点
function hookSelectionSync(node) {
    const widget = selectWidget(node);
    if (!widget || widget.__qqRouteSyncHooked) return;
    widget.__qqRouteSyncHooked = true;
    const originalCallback = widget.callback;
    widget.callback = function onCollectSelectChanged() {
        const result = originalCallback?.apply(this, arguments);
        // widget 回调里的 this 是 widget，节点要从闭包拿
        if (!node[SYNC_GUARD]) syncToDispatch(node);
        return result;
    };
}

app.registerExtension({
    name: "QQ.RouteCollect",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_TYPE) return;
        install(nodeType);
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function onNodeCreatedRouteCollectSync() {
            const result = originalCreated?.apply(this, arguments);
            hookSelectionSync(this);
            return result;
        };
        const originalConfigured = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function onConfigureRouteCollectSync() {
            const result = originalConfigured?.apply(this, arguments);
            hookSelectionSync(this);
            return result;
        };
    },
});
