import { app } from "../../scripts/app.js";

// 只做「选框忽略」。不修改节点模式、不修改节点标题、不写只读属性。
const NODE_TYPE = "WyslIgnoreRules";

function nodesOf(graph) {
    if (!graph) return [];
    if (Array.isArray(graph._nodes)) return graph._nodes.slice();
    if (graph._nodes_by_id) return Object.values(graph._nodes_by_id);
    return [];
}

function getWidget(node, name) {
    if (!Array.isArray(node?.widgets)) return null;
    return node.widgets.find((entry) => entry && entry.name === name) || null;
}

function isEnabled(node) {
    const value = getWidget(node, "启用")?.value;
    return value === true || value === 1 || value === "true" || value === "启用";
}

function patternList(node, name) {
    const raw = String(getWidget(node, name)?.value ?? "");
    return raw.split(/[,，;；\n]+/).map((item) => item.trim()).filter(Boolean);
}

function textMatches(pattern, value) {
    const text = String(value ?? "");
    if (!pattern || !text) return false;
    if (/[\\^$.*+?()[\]{}|]/.test(pattern)) {
        try { return new RegExp(pattern).test(text); } catch { return false; }
    }
    return text.includes(pattern);
}

function hitAny(patterns, values) {
    for (const pattern of patterns) {
        for (const value of values) {
            if (textMatches(pattern, value)) return true;
        }
    }
    return false;
}

function isRuleNode(node) {
    return node?.comfyClass === NODE_TYPE || node?.type === NODE_TYPE;
}

// 找到节点容器里所有像「一行选框」的元素
function widgetRows(container) {
    const rows = new Set();
    for (const label of container.querySelectorAll("label")) {
        const row = label.closest(".p-float-label") || label.parentElement || label;
        if (row) rows.add(row);
    }
    for (const marked of container.querySelectorAll("[data-widget-name]")) {
        rows.add(marked);
    }
    return Array.from(rows);
}

function rowText(element) {
    const label = element.querySelector?.("label");
    const parts = [
        label?.textContent,
        element.getAttribute?.("data-widget-name"),
        element.getAttribute?.("data-testid"),
    ];
    return parts.filter((value) => typeof value === "string" && value.trim())
        .map((value) => value.trim())
        .join(" ");
}

function hide(element, hidden) {
    if (!element || !element.style) return;
    element.style.display = hidden ? "none" : "";
}

function applyWidgetRules(node, nodeHit, widgetPatterns) {
    // 旧版渲染：控件自带 DOM element
    for (const entry of node.widgets || []) {
        if (!entry?.element?.style) continue;
        hide(entry.element, nodeHit || hitAny(widgetPatterns, [entry.label, entry.name]));
    }

    // Vue 渲染：在节点容器里按标签文字匹配
    if (node.id == null) return;
    const container = document.querySelector(`[data-node-id="${node.id}"]`);
    if (!container) return;
    for (const row of widgetRows(container)) {
        hide(row, nodeHit || hitAny(widgetPatterns, [rowText(row)]));
    }
}

function applyRules(graph) {
    const all = nodesOf(graph);
    if (!all.length) return;

    const active = all.filter(isRuleNode).filter(isEnabled);
    const nodePatterns = [];
    const widgetPatterns = [];
    for (const node of active) {
        nodePatterns.push(...patternList(node, "节点"));
        widgetPatterns.push(...patternList(node, "选框"));
    }

    for (const node of all) {
        if (isRuleNode(node)) continue;
        try {
            const texts = [node.title, node.type, node.comfyClass]
                .filter((value) => typeof value === "string");
            const nodeHit = hitAny(nodePatterns, texts);
            applyWidgetRules(node, nodeHit, widgetPatterns);
        } catch (error) {
            console.warn("Wysl-忽略规则：跳过节点", node?.title, error);
        }
    }
}

function safeApply() {
    try {
        applyRules(app.canvas?.graph || app.graph);
    } catch (error) {
        console.warn("Wysl-忽略规则失败", error);
    }
}

app.registerExtension({
    name: "Wysl.IgnoreRules",
    setup() {
        const tick = () => {
            if (app.graph && !app.loading_graph && !app.configuringGraph) safeApply();
        };
        if (!globalThis.__wyslIgnoreTimer) globalThis.__wyslIgnoreTimer = setInterval(tick, 800);
        setTimeout(tick, 1600);
    },
});
