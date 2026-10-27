import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// QQ-条件分发 的前端：动态增减输出口，并让下拉框列出「输出口的名字」。
//   输出口数量 = 最后一个已连线输出口的后一个（至少 MIN_OUTPUTS 个，最多 MAX_OUTPUTS 个）
//   选择框的取值是输出口名称：用户用右键「Rename Slot」改名后，下拉项和已选值一起跟着变
//   label 只在新建输出口时写入，之后绝不覆盖，保证改过的名字随工作流存档保留

const NODE_TYPE = "QQRouteDispatch";
const SELECT_WIDGET = "select";
const POLLING_WIDGET = "轮询输出";
const MIN_OUTPUTS = 2;
const MAX_OUTPUTS = 8;

export function defaultOutputName(index) {
    return `输出${index + 1}`;
}

function outputLabel(output, index) {
    const label = typeof output?.label === "string" ? output.label.trim() : "";
    if (label) return label;
    const name = typeof output?.name === "string" ? output.name.trim() : "";
    return name || defaultOutputName(index);
}

export function outputNames(node) {
    return (node?.outputs || []).map((output, index) => outputLabel(output, index));
}

function connected(output) {
    return Boolean(output?.links?.length);
}

export function targetOutputCount(node, min = MIN_OUTPUTS, max = MAX_OUTPUTS) {
    let lastConnected = -1;
    (node?.outputs || []).forEach((output, index) => {
        if (connected(output)) lastConnected = index;
    });
    return Math.min(max, Math.max(min, lastConnected + 2));
}

export function ensureOutputs(node, count, min = MIN_OUTPUTS, max = MAX_OUTPUTS) {
    const want = Math.min(max, Math.max(min, count));
    while ((node?.outputs?.length || 0) < want) {
        const index = node.outputs.length;
        const name = defaultOutputName(index);
        node.addOutput(name, "*");
        const output = node.outputs[node.outputs.length - 1];
        if (output) {
            output.label = name;
            output.localized_name = name;
        }
    }
    return want;
}

export function pruneOutputs(node, count, min = MIN_OUTPUTS, max = MAX_OUTPUTS) {
    const want = Math.min(max, Math.max(min, count));
    while ((node?.outputs?.length || 0) > want) {
        const last = node.outputs[node.outputs.length - 1];
        // 已连线的口绝不回收，避免断线
        if (connected(last)) break;
        node.removeOutput(node.outputs.length - 1);
    }
}

export function selectedIndex(value, names) {
    const choice = String(value ?? "").trim();
    if (!choice) return -1;
    const exact = names.indexOf(choice);
    if (exact >= 0) return exact;
    const stripped = choice.replace(/^(输出|output)/i, "").trim();
    if (!/^\d+$/.test(stripped)) return -1;
    const index = Number(stripped) - 1;
    return index >= 0 && index < names.length ? index : -1;
}

// 输出口改名后，把选择框里记着的旧名字换成同一个口的新名字
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

export function pollingWidget(node) {
    return node?.widgets?.find((widget) => widget?.name === POLLING_WIDGET) || null;
}

export function isPolling(node) {
    return Boolean(pollingWidget(node)?.value);
}

// 轮询开启时选择框由程序驱动（每次排队前自动换下一个口），因此置灰不可改
export function applyPollingState(node) {
    const widget = selectWidget(node);
    if (!widget) return;
    const polling = isPolling(node);
    widget.disabled = polling;
    widget.options ||= {};
    if (polling) widget.options.disabled = true;
    else delete widget.options.disabled;
}

export function connectedIndexes(node) {
    const indexes = [];
    (node?.outputs || []).forEach((output, index) => {
        if (connected(output)) indexes.push(index);
    });
    return indexes;
}

// 本次运行该走哪个口：轮询开启时只走「下一个已连接的口」，否则用选择框的值
export function resolveTargetIndex(node) {
    const names = outputNames(node);
    const linked = connectedIndexes(node);
    const current = selectedIndex(selectWidget(node)?.value, names);
    if (!isPolling(node)) return current >= 0 ? current : 0;
    if (!linked.length) return current >= 0 ? current : 0;
    const after = current < 0 ? -1 : linked.find((index) => index > current);
    return after === undefined ? linked[0] : after;
}

// 轮询跑完最后一个已连接的口后停下，避免无限自动排队
export function pollingFinished(node) {
    const linked = connectedIndexes(node);
    if (!linked.length) return true;
    const current = selectedIndex(selectWidget(node)?.value, outputNames(node));
    return current >= linked[linked.length - 1];
}

export function setPollingIndex(node, index) {
    const widget = selectWidget(node);
    const names = outputNames(node);
    if (!widget || index < 0 || index >= names.length) return false;
    widget.value = names[index];
    widget.callback?.(names[index]);
    node.setDirtyCanvas?.(true, true);
    return true;
}

export function syncSelectWidget(node, previousNames = []) {
    const widget = selectWidget(node);
    if (!widget) return [];
    const names = outputNames(node);
    widget.options ||= {};
    // 远端下拉（options.values 是函数）由后端刷新，这里不覆盖
    if (typeof widget.options.values === "function") return names;
    widget.value = remapValue(widget.value, names, previousNames);
    widget.options.values = names;
    applyPollingState(node);
    return names;
}

// 消费者若是虚拟节点（例如 PrimitiveNode），需要踢一下才会重读下拉项
function refreshVirtualConsumers(node) {
    for (const output of node?.outputs || []) {
        for (const linkId of output?.links || []) {
            const link = node.graph?.getLink?.(linkId) ?? node.graph?.links?.[linkId];
            const source = node.graph?.getNodeById?.(link?.origin_id);
            source?.refreshComboInNode?.();
        }
    }
}

export function syncNode(node) {
    if (!node || !node.graph) return;
    const previous = Array.isArray(node.__qqRouteNames) ? node.__qqRouteNames : [];
    const target = targetOutputCount(node);
    ensureOutputs(node, target);
    pruneOutputs(node, target);
    node.__qqRouteNames = syncSelectWidget(node, previous);
    refreshVirtualConsumers(node);
    node.setDirtyCanvas?.(true, true);
}

// 轮询开关变化时立刻同步选择框的可用状态
function installPollingToggle(node) {
    const widget = pollingWidget(node);
    if (!widget || widget.__qqRoutePollingHooked) return;
    widget.__qqRoutePollingHooked = true;
    const originalCallback = widget.callback;
    widget.callback = function onPollingChanged() {
        const result = originalCallback?.apply(this, arguments);
        applyPollingState(node);
        node.setDirtyCanvas?.(true, true);
        return result;
    };
}

function initializeNode(node) {
    if (!node) return;
    ensureOutputs(node, Math.max(MIN_OUTPUTS, node.outputs?.length || 0));
    node.__qqRouteNames = outputNames(node);
    syncSelectWidget(node, node.__qqRouteNames);
    installPollingToggle(node);
    if (!node.__qqRouteTimer) {
        node.__qqRouteTimer = globalThis.setInterval(() => {
            if (!node.graph) {
                globalThis.clearInterval(node.__qqRouteTimer);
                node.__qqRouteTimer = null;
                return;
            }
            if (app?.configuringGraph) return;
            const before = JSON.stringify(node.__qqRouteNames || []);
            syncNode(node);
            if (before !== JSON.stringify(node.__qqRouteNames || [])) {
                node.setDirtyCanvas?.(true, true);
            }
        }, 500);
    }
}

function install(nodeType) {
    const prototype = nodeType?.prototype;
    if (!prototype || prototype.__qqRouteInstalled) return;
    prototype.__qqRouteInstalled = true;

    const originalCreated = prototype.onNodeCreated;
    prototype.onNodeCreated = function onNodeCreatedRouteDispatch() {
        const result = originalCreated?.apply(this, arguments);
        initializeNode(this);
        return result;
    };

    const originalAdded = prototype.onAdded;
    prototype.onAdded = function onAddedRouteDispatch() {
        const result = originalAdded?.apply(this, arguments);
        initializeNode(this);
        syncNode(this);
        return result;
    };

    const originalConfigure = prototype.onConfigure;
    prototype.onConfigure = function onConfigureRouteDispatch(info) {
        const result = originalConfigure?.apply(this, arguments);
        // 存档里的输出口数量先落位，再交给 syncNode 收敛
        const saved = Array.isArray(info?.outputs) ? info.outputs.length : 0;
        ensureOutputs(this, Math.max(MIN_OUTPUTS, saved));
        this.__qqRouteNames = outputNames(this);
        return result;
    };

    const originalAfterConfigured = prototype.onAfterGraphConfigured;
    prototype.onAfterGraphConfigured = function onAfterGraphConfiguredRouteDispatch() {
        const result = originalAfterConfigured?.apply(this, arguments);
        syncNode(this);
        return result;
    };

    const originalConnectionsChange = prototype.onConnectionsChange;
    prototype.onConnectionsChange = function onConnectionsChangeRouteDispatch(type) {
        const result = originalConnectionsChange?.apply(this, arguments);
        if (app?.configuringGraph) return result;
        const LiteGraph = globalThis.LiteGraph;
        const isOutput = type === (LiteGraph?.OUTPUT ?? 2);
        const isInput = type === (LiteGraph?.INPUT ?? 1);
        if (!isOutput && !isInput) return result;
        queueMicrotask(() => {
            if (this.graph) syncNode(this);
        });
        return result;
    };

    const originalRemoved = prototype.onRemoved;
    prototype.onRemoved = function onRemovedRouteDispatch() {
        if (this.__qqRouteTimer) {
            globalThis.clearInterval(this.__qqRouteTimer);
            this.__qqRouteTimer = null;
        }
        return originalRemoved?.apply(this, arguments);
    };

    const originalGetExtraMenuOptions = prototype.getExtraMenuOptions;
    prototype.getExtraMenuOptions = function getExtraMenuOptionsRouteDispatch() {
        const options = originalGetExtraMenuOptions?.apply(this, arguments) || [];
        options.push(null, {
            content: "增加一个输出口",
            callback: () => {
                if ((this.outputs?.length || 0) >= MAX_OUTPUTS) return;
                ensureOutputs(this, (this.outputs?.length || 0) + 1);
                syncNode(this);
            },
        });
        options.push({
            content: "同步输出名称到选择框",
            callback: () => syncNode(this),
        });
        return options;
    };
}

// ── 轮询自动排队 ───────────────────────────────────────────────
// 开了轮询后：点一次运行，前端按「已连接的口」顺序连续排队，每次排队前把
// select 改成下一个口；跑到最后一个就停。中途报错、取消、换图、手动改选择都停。

const queuedRuns = new Map();
const pendingRuns = new Set();
let continuationTimer = null;
let continuationGeneration = 0;

function routeNodes() {
    return (app?.graph?._nodes || []).filter((node) => node?.type === NODE_TYPE);
}

function cancelContinuation() {
    continuationGeneration += 1;
    globalThis.clearTimeout(continuationTimer);
    continuationTimer = null;
}

function routeSnapshot(node) {
    return JSON.stringify({
        value: selectWidget(node)?.value,
        polling: isPolling(node),
        outputs: (node.outputs || []).map((output) => output?.links?.length || 0),
    });
}

function currentNode(record, nodeId) {
    const node = app.graph?.getNodeById?.(nodeId);
    const snapshot = record?.nodes?.get(String(nodeId));
    if (record?.graph !== app.graph || !snapshot || !node || node.__qqRouteRemoved) return null;
    if (Number(node.mode || 0) !== 0 || routeSnapshot(node) !== snapshot) return null;
    return node;
}

function installPollingQueue() {
    if (globalThis.__qqRoutePollingQueue) return;
    globalThis.__qqRoutePollingQueue = true;

    const originalQueue = api.queuePrompt;
    api.queuePrompt = async function qqRouteQueue(number, prompt, ...rest) {
        // 每次手动/自动排队都从「干净状态」开始
        cancelContinuation();
        const graph = app.graph;
        const generation = continuationGeneration;
        const nodes = new Map();
        for (const node of routeNodes()) {
            if (!isPolling(node)) continue;
            if (prompt?.output?.[String(node.id)]?.class_type !== NODE_TYPE) continue;
            const linked = connectedIndexes(node);
            // 新一轮的起点：只有「用户手动点运行」才回到第一个口。
            // 自动续排时 node.__qqRouteAutoAdvance 为 true，保持当前口继续往下走，
            // 否则每轮都会被拉回第一个口，永远跑不到头。
            if (!node.__qqRouteAutoAdvance && linked.length) {
                setPollingIndex(node, linked[0]);
            }
            node.__qqRouteAutoAdvance = false;
            nodes.set(String(node.id), routeSnapshot(node));
        }
        const submission = { graph, nodes, generation };
        if (nodes.size) pendingRuns.add(submission);
        try {
            const response = await originalQueue.call(this, number, prompt, ...rest);
            const promptId = String(response?.prompt_id || "");
            if (nodes.size && generation === continuationGeneration && promptId) {
                queuedRuns.set(promptId, submission);
                while (queuedRuns.size > 50) queuedRuns.delete(queuedRuns.keys().next().value);
            }
            return response;
        } finally {
            pendingRuns.delete(submission);
        }
    };

    api.addEventListener("execution_success", (event) => {
        advancePolling(String(event?.detail?.prompt_id || ""));
    });

    for (const name of ["execution_interrupted", "execution_error"]) {
        api.addEventListener(name, (event) => {
            const promptId = String(event?.detail?.prompt_id || "");
            cancelContinuation();
            queuedRuns.delete(promptId);
        });
    }

    api.addEventListener("graphCleared", () => {
        cancelContinuation();
        queuedRuns.clear();
        pendingRuns.clear();
    });

    function advancePolling(promptId) {
        const record = queuedRuns.get(promptId);
        queuedRuns.delete(promptId);
        if (!record || record.generation !== continuationGeneration) return;

        const active = [];
        for (const [nodeId] of record.nodes) {
            const node = currentNode(record, nodeId);
            if (!node || !isPolling(node)) continue;
            // 已经跑到最后一个已连接的口：这一轮结束，不再排队
            if (pollingFinished(node)) continue;
            active.push(node);
        }
        if (!active.length) return;

        const generation = continuationGeneration;
        continuationTimer = globalThis.setTimeout(async () => {
            continuationTimer = null;
            try {
                // 有别的任务在排队/运行就不插队，免得用户的批处理被打乱
                const response = await api.fetchApi("/queue");
                if (!response.ok) throw new Error("无法读取队列状态");
                const queue = await response.json();
                if (generation !== continuationGeneration) return;
                const running = (queue.queue_running || []).filter(
                    (item) => String(item[1]) !== promptId,
                );
                if ((queue.queue_pending || []).length || running.length) {
                    cancelContinuation();
                    return;
                }
                for (const node of active) {
                    const target = resolveTargetIndex(node);
                    if (!setPollingIndex(node, target)) {
                        cancelContinuation();
                        return;
                    }
                    // 标记成自动续排：下一次 queuePrompt 不再把选择重置回第一个口
                    node.__qqRouteAutoAdvance = true;
                }
                const queued = await app.queuePrompt(0, 1);
                if (queued === false) cancelContinuation();
            } catch (error) {
                console.warn("[QQ-条件分发] 轮询自动排队失败", error);
                cancelContinuation();
            }
        }, 180);
    }
}

app.registerExtension({
    name: "QQ.RouteDispatch",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_TYPE) return;
        install(nodeType);
    },
    setup() {
        installPollingQueue();
    },
});
