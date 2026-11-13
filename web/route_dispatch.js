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

// 下拉框只列「已经连上线」的输出口：没接东西的口选了也没用，
// 反而让人以为能往一个空口送数据。
export function selectOptionNames(node) {
    const names = outputNames(node);
    return connectedIndexes(node)
        .map((index) => names[index])
        .filter(Boolean);
}

export function syncSelectWidget(node, previousNames = []) {
    const widget = selectWidget(node);
    if (!widget) return [];
    const names = outputNames(node);
    widget.options ||= {};
    // 远端下拉（options.values 是函数）由后端刷新，这里不覆盖
    if (typeof widget.options.values === "function") return names;

    const linked = selectOptionNames(node);
    // 一个口都没连时保留当前值，避免下拉变成空列表（那会让控件显示异常）
    const options = linked.length
        ? linked
        : [widget.value].filter((value) => names.includes(value));
    if (!options.length) options.push(names[0]);

    if (!options.includes(widget.value)) {
        // 原来选的口被断开或改名了：先按位置平移，再按「输出N / 数字」解析，
        // 都对不上就退回第一个可用项
        const oldIndex = previousNames.indexOf(widget.value);
        const renamed = oldIndex >= 0 ? names[oldIndex] : "";
        const numeric = selectedIndex(widget.value, names);
        const byNumber = numeric >= 0 ? names[numeric] : "";
        const mapped = [renamed, byNumber].find((name) => name && options.includes(name));
        widget.value = mapped || options[0];
    }
    widget.options.values = options;
    applyPollingState(node);
    // 返回值仍是全部输出口名称：调用方用它记录「上一轮的名字」做改名平移
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

// ── 轮询：一次点击，按端口顺序把所有已连接的口都排进队列 ───────────
// 早先试过「跑完一个再排下一个」，依赖 execution_success 与队列状态的重入，
// 在真机上反复失效（只跑第一个口 / 每点一次只前进一个口）。
// 现在改成一次点击就把 N 个口全部提交：ComfyUI 自带队列按提交顺序串行执行。
//
// 实现要点：只序列化一次得到基准 prompt，每轮克隆后直接改写该轮 prompt 里的
// select（连同 workflow 快照里的 select）。不再「写 widget.value 再序列化」——
// 真机上序列化可能读 Vue 控件值存储、或受控件置灰影响，写进去的值到不了
// prompt，表现为每轮都跑用户选中的那个口。prompt 是纯 JSON，改写即本轮状态。

function routeNodes() {
    return (app?.graph?._nodes || []).filter((node) => node?.type === NODE_TYPE);
}

let pollingFlight = null;

function installPollingQueue() {
    if (globalThis.__qqRoutePollingQueue) return;
    globalThis.__qqRoutePollingQueue = true;

    const originalAppQueue = app.queuePrompt;
    app.queuePrompt = async function qqRouteAppQueue(number, batchCount, options) {
        if (!routeNodes().some((node) => isPolling(node))) {
            return originalAppQueue.call(this, number, batchCount, options);
        }
        // 连点排在上一轮轮询之后：旧 queueGuard 会把第二次点击放行到原始
        // 队列，插进一次「选中口」的单跑。链式等待保证每次点击都完整轮换。
        const run = () => runPollingRound(this, number, batchCount, options, originalAppQueue);
        const prev = pollingFlight ?? Promise.resolve();
        const flight = prev.then(run, run);
        pollingFlight = flight;
        try {
            return await flight;
        } finally {
            if (pollingFlight === flight) pollingFlight = null;
        }
    };

    /**
     * 点一次运行 = 每个已连接的口各提交一次，顺序就是端口顺序。
     * 基准 prompt 只序列化一次；每轮克隆并改写 select，提交互不串值。
     */
    async function runPollingRound(appInstance, number, batchCount, options, originalQueue) {
        const plan = routeNodes()
            .filter((node) => isPolling(node))
            .map((node) => ({ node, indexes: connectedIndexes(node) }))
            .filter((entry) => entry.indexes.length);
        if (!plan.length) {
            return originalQueue.call(appInstance, number, batchCount, options);
        }

        const rounds = Math.max(...plan.map((entry) => entry.indexes.length));
        let allQueued = true;
        try {
            let base;
            try {
                base = await appInstance.graphToPrompt(appInstance.rootGraph);
            } catch (error) {
                console.warn("[QQ-条件分发] 轮询构建 prompt 失败", error);
                return false;
            }
            for (let round = 0; round < rounds; round += 1) {
                const built = patchPollingRound(base, plan, round);
                try {
                    await api.queuePrompt(number, built);
                } catch (error) {
                    console.warn("[QQ-条件分发] 轮询提交失败", error);
                    allQueued = false;
                    break;
                }
            }
        } finally {
            // 不写选择框：界面保持用户原来选的口
            appInstance.graph?.setDirtyCanvas?.(true, true);
        }
        return allQueued;
    }
}

// 克隆基准 prompt，把每个轮询节点本轮该走的口写进 inputs.select。
// 同时同步 workflow 快照里的 select（手机端自动跟随读这份存档）。
export function patchPollingRound(base, plan, round) {
    const built = structuredClone(base);
    for (const entry of plan) {
        const index = entry.indexes[Math.min(round, entry.indexes.length - 1)];
        const name = outputNames(entry.node)[index];
        const promptNode = built?.output?.[entry.node.id];
        if (promptNode) {
            promptNode.inputs ||= {};
            promptNode.inputs[SELECT_WIDGET] = name;
        }
        const wfNode = (built?.workflow?.nodes || []).find(
            (n) => String(n?.id) === String(entry.node.id)
        );
        const pos = (entry.node.widgets || []).findIndex((w) => w?.name === SELECT_WIDGET);
        if (wfNode && pos >= 0 && Array.isArray(wfNode.widgets_values) && pos < wfNode.widgets_values.length) {
            wfNode.widgets_values[pos] = name;
        }
    }
    return built;
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
