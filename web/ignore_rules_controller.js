import { app } from "../../../scripts/app.js";

const NODE_TYPE = "QQIgnoreRulesController";
const RULE_NODE_TYPE = "QQIgnoreRules";
const MIN_ROWS = 2;
const MAX_ROWS = 32;
const NAME_PREFIX = "规则名称_";
const ENABLE_PREFIX = "启用_";
const TEXT = {
    title: "QQ-绕过规则开关",
    name: "规则名称",
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

function ruleSearchText(rule) {
    return [
        rule?.title,
        rule?.properties?.name,
        widgetValue(rule, "节点"),
        widgetValue(rule, "组"),
    ].map((value) => String(value || "").trim()).filter(Boolean);
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

function rowName(node, index) {
    return String(node?.widgets?.find((widget) => widget?.name === `${NAME_PREFIX}${index + 1}`)?.value || "").trim();
}

function rowEnabled(node, index) {
    return enabledValue(node?.widgets?.find((widget) => widget?.name === `${ENABLE_PREFIX}${index + 1}`)?.value);
}

function ruleId(rule) {
    const value = rule?.id;
    return value === undefined || value === null ? "" : String(value);
}

function ruleBindings(node) {
    const raw = node?.properties?.qqIgnoreRuleBindings;
    if (!Array.isArray(raw)) return [];
    return raw.map((value) => (value === undefined || value === null ? "" : String(value)));
}

function saveRuleBindings(node, bindings) {
    node.properties ||= {};
    node.properties.qqIgnoreRuleBindings = bindings.map((value) => String(value || ""));
}

function rowCount(node) {
    const markedCount = Math.floor((node?.widgets || []).filter((widget) => widget?.__qqIgnoreRuleRow).length / 2);
    const savedCount = Number(node?.properties?.qqIgnoreRuleRowCount);
    return Math.max(
        MIN_ROWS,
        Math.min(MAX_ROWS, Math.max(markedCount, Number.isFinite(savedCount) ? Math.floor(savedCount) : 0)),
    );
}

function ensureRows(node, count) {
    const want = Math.max(MIN_ROWS, Math.min(MAX_ROWS, count));
    let current = rowCount(node);
    while (current < want) {
        const index = current + 1;
        const nameWidget = node.addWidget(
            "text",
            `${NAME_PREFIX}${index}`,
            "",
            (value) => {
                node._qqIgnoreRulesDirty = true;
                syncController(node);
            },
            { serialize: true, multiline: false, placeholder: `${TEXT.name} ${index}` },
        );
        const enabledWidget = node.addWidget(
            "toggle",
            `${ENABLE_PREFIX}${index}`,
            false,
            (value) => {
                node._qqIgnoreRulesDirty = true;
                syncController(node);
            },
            { serialize: true, on: "启用", off: "关闭" },
        );
        nameWidget.label = `${TEXT.name} ${index}`;
        enabledWidget.label = "启用";
        nameWidget.__qqIgnoreRuleRow = true;
        enabledWidget.__qqIgnoreRuleRow = true;
        current += 1;
    }
    node.properties ||= {};
    node.properties.qqIgnoreRuleRowCount = want;
}

function trimRows(node, count) {
    const want = Math.max(MIN_ROWS, Math.min(MAX_ROWS, count));
    ensureRows(node, want);
    while (rowCount(node) > want) {
        const lastIndex = rowCount(node);
        for (const name of [`${ENABLE_PREFIX}${lastIndex}`, `${NAME_PREFIX}${lastIndex}`]) {
            const position = node.widgets?.findIndex((widget) => widget?.name === name) ?? -1;
            if (position >= 0) node.widgets.splice(position, 1);
        }
    }
    node.properties ||= {};
    node.properties.qqIgnoreRuleRowCount = want;
    node.setSize?.([node.size?.[0] || 280, Math.max(120, 42 + want * 34)]);
}

function targetRowCount(node) {
    let lastFilled = 0;
    for (let index = 0; index < rowCount(node); index += 1) {
        if (rowName(node, index)) lastFilled = index + 1;
    }
    const rules = allRuleNodes(node?.graph || currentGraph());
    return Math.min(MAX_ROWS, Math.max(MIN_ROWS, lastFilled + 1, rules.length));
}

function ensureRuleBindings(node, rules) {
    const bindings = ruleBindings(node);
    while (bindings.length < rowCount(node)) bindings.push("");
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
    if (changed || !Array.isArray(node?.properties?.qqIgnoreRuleBindings)) {
        saveRuleBindings(node, bindings);
    }
    return bindings;
}

function boundRule(node, index, rules, bindings) {
    const id = bindings[index];
    return id ? rules.find((rule) => ruleId(rule) === id) || null : null;
}

function fillDiscoveredNames(node, rules, bindings) {
    let changed = false;
    for (let index = 0; index < rowCount(node); index += 1) {
        const widget = node.widgets?.find((entry) => entry?.name === `${NAME_PREFIX}${index + 1}`);
        if (!widget || String(widget.value || "").trim()) continue;
        const rule = boundRule(node, index, rules, bindings);
        if (!rule) continue;
        widget.value = discoveredRuleName(rule, index);
        changed = true;
    }
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
    if (!rules.length) return;
    const bindings = ensureRuleBindings(node, rules);
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
    if (!node || app?.configuringGraph) return;
    trimRows(node, targetRowCount(node));
    syncController(node);
    // Names may be auto-discovered during sync; keep one empty row ready for
    // the next rule without growing the node on every canvas redraw.
    trimRows(node, targetRowCount(node));
    const computed = node.computeSize?.();
    if (computed) {
        node.setSize?.([Math.max(280, computed[0]), Math.max(110, computed[1])]);
    }
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
        ensureRows(this, MIN_ROWS);
        this.setSize?.([280, 42 + MIN_ROWS * 34]);
        return result;
    };
    const originalConfigure = prototype.onConfigure;
    prototype.onConfigure = function onQQIgnoreRulesControllerConfigured(info) {
        const result = originalConfigure?.apply(this, arguments);
        const savedCount = Number(info?.properties?.qqIgnoreRuleRowCount);
        const widgetCount = Array.isArray(info?.widgets_values)
            ? Math.ceil(info.widgets_values.length / 2)
            : 0;
        ensureRows(this, Math.max(MIN_ROWS, Number.isFinite(savedCount) ? savedCount : 0, widgetCount, rowCount(this)));
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
            refresh(this);
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

