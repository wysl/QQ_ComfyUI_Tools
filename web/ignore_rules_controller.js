import { app } from "../../../scripts/app.js";

const NODE_TYPE = "QQIgnoreRulesController";
const RULE_NODE_TYPE = "QQIgnoreRules";
const MIN_ROWS = 0;
const MAX_ROWS = 32;
const ROW_HEIGHT = 34;
const NODE_WIDTH = 280;
const NODE_TOP_HEIGHT = 42;
const NAME_PREFIX = "规则名称_";
const ENABLE_PREFIX = "启用_";
const ROWS_PROP = "qqIgnoreRuleRows";
const BINDINGS_PROP = "qqIgnoreRuleBindings";
const COUNT_PROP = "qqIgnoreRuleRowCount";
const TEXT = {
    title: "QQ-绕过规则开关",
    name: "规则",
    unnamed: "绕过规则",
};

function graphNodes(graph) {
    if (Array.isArray(graph?._nodes)) return graph._nodes;
    return graph?._nodes_by_id ? Object.values(graph._nodes_by_id) : [];
}

function nodeTypeName(node) {
    return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || "");
}

function isRuleNode(node) {
    return nodeTypeName(node) === RULE_NODE_TYPE;
}

function getWidget(node, name) {
    return (node?.widgets || []).find((widget) => widget?.name === name) || null;
}

function widgetValue(node, name, fallback = "") {
    return getWidget(node, name)?.value ?? fallback;
}

function enabledValue(value) {
    return value === true || value === 1 || value === "true" || value === "启用";
}

function currentGraph() {
    return app?.canvas?.graph || app?.graph || globalThis.LGraphCanvas?.active_canvas?.graph || null;
}

function allRuleNodes(graph) {
    return graphNodes(graph).filter(isRuleNode);
}

function discoveredRuleName(rule, index) {
    const title = String(rule?.title || "").trim();
    if (title && title !== RULE_NODE_TYPE && title !== TEXT.title) return title;
    const nodeRules = String(widgetValue(rule, "节点") || "").trim();
    if (nodeRules) return nodeRules.split(/[,，;；\n]+/)[0].trim();
    const groupRules = String(widgetValue(rule, "组") || "").trim();
    if (groupRules) return groupRules.split(/[,，;；\n]+/)[0].trim();
    return `${TEXT.unnamed} ${index + 1}`;
}

function ruleId(rule) {
    const value = rule?.id;
    return value === undefined || value === null ? "" : String(value);
}

function clampRows(value) {
    const count = Number(value);
    if (!Number.isFinite(count)) return MIN_ROWS;
    return Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.floor(count)));
}

function rowWidgets(node) {
    return (node?.widgets || []).filter((widget) => widget?.__qqIgnoreRuleRow);
}

function rowCount(node) {
    const marked = Math.floor(rowWidgets(node).length / 2);
    const saved = Number(node?.properties?.[COUNT_PROP]);
    return clampRows(Math.max(marked, Number.isFinite(saved) ? saved : 0));
}

function rowName(node, index) {
    return String(getWidget(node, `${NAME_PREFIX}${index + 1}`)?.value || "").trim();
}

function rowEnabled(node, index) {
    return enabledValue(getWidget(node, `${ENABLE_PREFIX}${index + 1}`)?.value);
}

function rowRecords(node) {
    const count = rowCount(node);
    return Array.from({ length: count }, (_, index) => ({
        name: rowName(node, index),
        enabled: rowEnabled(node, index),
    }));
}

function saveRows(node) {
    node.properties ||= {};
    node.properties[ROWS_PROP] = rowRecords(node);
    node.properties[COUNT_PROP] = rowCount(node);
}

function saveRuleBindings(node, bindings) {
    node.properties ||= {};
    node.properties[BINDINGS_PROP] = bindings.map((value) => String(value || ""));
}

function ruleBindings(node) {
    const raw = node?.properties?.[BINDINGS_PROP];
    if (!Array.isArray(raw)) return [];
    return raw.map((value) => (value === undefined || value === null ? "" : String(value)));
}

function nodeSize(node, count = rowCount(node), forceHeight = false) {
    const currentWidth = Number(node?.size?.[0]);
    const width = Number.isFinite(currentWidth) && currentWidth > 0 ? currentWidth : NODE_WIDTH;
    const requiredHeight = NODE_TOP_HEIGHT + count * ROW_HEIGHT;
    const currentHeight = Number(node?.size?.[1]);
    const height = forceHeight || !Number.isFinite(currentHeight) || currentHeight <= 0
        ? requiredHeight
        : Math.max(currentHeight, requiredHeight);
    return [width, height];
}

function setControllerSize(node, forceHeight = false) {
    node.setSize?.(nodeSize(node, rowCount(node), forceHeight));
}

function makeNameWidget(node, index, value = "") {
    const widget = node.addWidget(
        "text",
        `${NAME_PREFIX}${index}`,
        String(value || ""),
        () => {
            saveRows(node);
            syncController(node);
        },
        { serialize: true, multiline: false, placeholder: `${TEXT.name}${index}` },
    );
    widget.label = `${TEXT.name}${index}`;
    widget.__qqIgnoreRuleRow = true;
    return widget;
}

function makeEnabledWidget(node, index, value = false) {
    const widget = node.addWidget(
        "toggle",
        `${ENABLE_PREFIX}${index}`,
        Boolean(value),
        () => {
            saveRows(node);
            syncController(node);
        },
        { serialize: true, on: "启用", off: "关闭" },
    );
    widget.label = "启用";
    widget.__qqIgnoreRuleRow = true;
    return widget;
}

function removeRowWidgets(node) {
    if (!Array.isArray(node?.widgets)) return;
    const oldRows = rowWidgets(node);
    for (const widget of oldRows) {
        try { widget.onRemove?.(); } catch { /* 兼容旧版 LiteGraph */ }
    }
    node.widgets = node.widgets.filter((widget) => !widget?.__qqIgnoreRuleRow);
}

function normalizeSavedRows(node, info) {
    const stored = node?.properties?.[ROWS_PROP];
    const values = Array.isArray(info?.widgets_values) ? info.widgets_values : [];
    const legacyHasContent = values.some((value, index) => (
        index % 2 === 0 ? String(value || "").trim() !== "" : enabledValue(value)
    ));
    const storedHasContent = Array.isArray(stored) && stored.some((row) => (
        String(row?.name || "").trim() !== "" || enabledValue(row?.enabled)
    ));
    if (Array.isArray(stored) && stored.length && (!legacyHasContent || storedHasContent)) {
        return stored.slice(0, MAX_ROWS).map((row) => ({
            name: String(row?.name || ""),
            enabled: enabledValue(row?.enabled),
        }));
    }

    // 旧版本只把动态控件按顺序写入 widgets_values。仅在迁移时读取一次，
    // 后续始终使用 qqIgnoreRuleRows，避免 LiteGraph 恢复顺序再次污染控件。
    const savedCount = Number(node?.properties?.[COUNT_PROP]);
    const count = clampRows(Math.max(
        Number.isFinite(savedCount) ? savedCount : 0,
        Math.ceil(values.length / 2),
        MIN_ROWS,
    ));
    return Array.from({ length: count }, (_, index) => ({
        name: String(values[index * 2] || ""),
        enabled: enabledValue(values[index * 2 + 1]),
    }));
}

function rebuildRows(node, records, count = records.length, forceHeight = false) {
    const wanted = clampRows(count);
    const rows = Array.from({ length: wanted }, (_, index) => records[index] || ({ name: "", enabled: false }));
    removeRowWidgets(node);
    rows.forEach((row, offset) => {
        const index = offset + 1;
        makeNameWidget(node, index, row.name);
        makeEnabledWidget(node, index, row.enabled);
    });
    node.properties ||= {};
    node.properties[COUNT_PROP] = wanted;
    saveRows(node);
    setControllerSize(node, forceHeight);
}

function ensureRows(node, count) {
    const wanted = clampRows(count);
    if (rowCount(node) === wanted && rowWidgets(node).length === wanted * 2) {
        setControllerSize(node);
        return;
    }
    rebuildRows(node, rowRecords(node), wanted);
}

function targetRowCount(node) {
    const rules = allRuleNodes(node?.graph || currentGraph());
    return clampRows(rules.length);
}

function sameRow(left, right) {
    return String(left?.name || "") === String(right?.name || "")
        && enabledValue(left?.enabled) === enabledValue(right?.enabled);
}

function alignRowsToRules(node, rules) {
    const oldRows = rowRecords(node);
    const oldBindings = ruleBindings(node);
    const existing = new Map();
    for (let index = 0; index < oldRows.length; index += 1) {
        const binding = oldBindings[index];
        if (binding && !existing.has(binding)) existing.set(binding, oldRows[index]);
    }

    const nextBindings = rules.map(ruleId).filter(Boolean);
    const nextRows = nextBindings.map((binding) => existing.get(binding) || ({ name: "", enabled: false }));
    const changed = rowCount(node) !== nextRows.length
        || oldBindings.length !== nextBindings.length
        || oldBindings.some((value, index) => value !== nextBindings[index])
        || oldRows.some((row, index) => !sameRow(row, nextRows[index]));

    if (changed) rebuildRows(node, nextRows, nextRows.length);
    saveRuleBindings(node, nextBindings);
    return changed;
}

function ensureRuleBindings(node, rules) {
    const bindings = ruleBindings(node);
    while (bindings.length < rowCount(node)) bindings.push("");
    bindings.length = rowCount(node);
    const available = new Set(rules.map(ruleId).filter(Boolean));
    for (let index = 0; index < bindings.length; index += 1) {
        if (bindings[index] && !available.has(bindings[index])) bindings[index] = "";
    }
    const known = new Set(bindings.filter(Boolean));
    let changed = false;
    for (let index = 0; index < rowCount(node); index += 1) {
        if (bindings[index]) continue;
        const candidate = rules.find((rule) => {
            const id = ruleId(rule);
            return id && !known.has(id);
        });
        if (!candidate) continue;
        bindings[index] = ruleId(candidate);
        known.add(bindings[index]);
        changed = true;
    }
    if (changed || !Array.isArray(node?.properties?.[BINDINGS_PROP])) saveRuleBindings(node, bindings);
    return bindings;
}

function boundRule(node, index, rules, bindings) {
    const id = bindings[index];
    return id ? rules.find((rule) => ruleId(rule) === id) || null : null;
}

function fillDiscoveredNames(node, rules, bindings) {
    let changed = false;
    for (let index = 0; index < rowCount(node); index += 1) {
        const widget = getWidget(node, `${NAME_PREFIX}${index + 1}`);
        if (!widget || String(widget.value || "").trim()) continue;
        const rule = boundRule(node, index, rules, bindings);
        if (!rule) continue;
        widget.value = discoveredRuleName(rule, index);
        changed = true;
    }
    if (changed) saveRows(node);
    return changed;
}

function touchRuleWidget(rule, enabled) {
    const widget = getWidget(rule, "启用");
    if (!widget || enabledValue(widget.value) === enabled) return false;
    widget.value = enabled;
    try { widget.callback?.(enabled, app.canvas, rule, app.canvas?.graph_mouse || [0, 0], {}); } catch { /* 兼容旧版 */ }
    rule.setDirtyCanvas?.(true, true);
    return true;
}

function syncController(node) {
    const graph = node?.graph || currentGraph();
    if (!graph || app?.loading_graph || app?.configuringGraph) return;
    const rules = allRuleNodes(graph);
    alignRowsToRules(node, rules);
    if (!rules.length) return;
    const bindings = ruleBindings(node);
    fillDiscoveredNames(node, rules, bindings);
    let changed = false;
    for (let index = 0; index < rowCount(node); index += 1) {
        const rule = boundRule(node, index, rules, bindings);
        if (rule) changed = touchRuleWidget(rule, rowEnabled(node, index)) || changed;
    }
    if (changed) {
        graph.setDirtyCanvas?.(true, true);
        graph.change?.();
    }
}

function refresh(node) {
    if (!node || app?.configuringGraph || app?.loading_graph) return;
    syncController(node);
    setControllerSize(node);
    node.setDirtyCanvas?.(true, true);
}

function install(nodeType) {
    const prototype = nodeType?.prototype;
    if (!prototype || prototype.__qqIgnoreRulesControllerInstalled) return;

    const originalCreated = prototype.onNodeCreated;
    prototype.onNodeCreated = function onQQIgnoreRulesControllerCreated() {
        const result = originalCreated?.apply(this, arguments);
        this.title = TEXT.title;
        this.serialize_widgets = true;
        this.properties ||= {};
        rebuildRows(this, [], MIN_ROWS, true);
        return result;
    };

    const originalConfigure = prototype.onConfigure;
    prototype.onConfigure = function onQQIgnoreRulesControllerConfigured(info) {
        const result = originalConfigure?.apply(this, arguments);
        this.title = TEXT.title;
        this.serialize_widgets = true;
        this.properties ||= {};
        const rows = normalizeSavedRows(this, info);
        const savedCount = Number(info?.properties?.[COUNT_PROP]);
        const count = clampRows(Math.max(rows.length, Number.isFinite(savedCount) ? savedCount : 0, MIN_ROWS));
        rebuildRows(this, rows, count);
        return result;
    };

    const originalAfter = prototype.onAfterGraphConfigured;
    prototype.onAfterGraphConfigured = function onQQIgnoreRulesControllerAfterConfigured() {
        const result = originalAfter?.apply(this, arguments);
        refresh(this);
        return result;
    };

    const originalDraw = prototype.onDrawForeground;
    prototype.onDrawForeground = function onQQIgnoreRulesControllerDrawForeground() {
        const result = originalDraw?.apply(this, arguments);
        // 绘制阶段只同步已有控件；结构变化通过 refresh 的行数检查处理，
        // 不再按时间反复删除/添加 widget。
        if (!this._qqIgnoreRulesLastRefresh || Date.now() - this._qqIgnoreRulesLastRefresh > 400) {
            this._qqIgnoreRulesLastRefresh = Date.now();
            refresh(this);
        }
        return result;
    };

    const originalWidgetChanged = prototype.onWidgetChanged;
    prototype.onWidgetChanged = function onQQIgnoreRulesControllerWidgetChanged(name, value) {
        const result = originalWidgetChanged?.apply(this, arguments);
        if (String(name || "").startsWith(NAME_PREFIX) || String(name || "").startsWith(ENABLE_PREFIX)) {
            saveRows(this);
            syncController(this);
        }
        return result;
    };

    prototype.__qqIgnoreRulesControllerInstalled = true;
}

app.registerExtension({
    name: "QQ.IgnoreRulesController",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name === NODE_TYPE) install(nodeType);
    },
});
