import { app } from "../../../scripts/app.js";

const NODE_TYPE = "QQMiniMaxH3EasyAreaSwitch";
const IGNORE_NODE_TYPES = new Set(["忽略多组孤海", "goohaitools.ignore_groups"]);
const SYNC_INTERVAL_MS = 250;

function graphNodes(graph) {
    return graph?._nodes || graph?._nodes_by_id && Object.values(graph._nodes_by_id) || [];
}

function widget(node, name) {
    return (node.widgets || []).find((entry) => entry.name === name);
}

function widgetValue(node, name, fallback = "") {
    const entry = widget(node, name);
    return entry?.value ?? fallback;
}

function isEnabled(value) {
    return value === true || value === 1 || value === "true";
}

function nodeTypeName(node) {
    return node?.type || node?.comfyClass || node?.constructor?.type || "";
}

function findIgnoreNode(graph) {
    return graphNodes(graph).find((node) => IGNORE_NODE_TYPES.has(nodeTypeName(node)));
}

function getActiveState(ignoreNode, firstName, secondName) {
    const properties = ignoreNode?.properties || {};
    const activeSet = properties.guhai_ig_active_set;
    if (Array.isArray(activeSet)) {
        return {
            first: activeSet.includes(firstName),
            second: activeSet.includes(secondName),
        };
    }

    const active = String(properties.guhai_ig_active || "").trim();
    if (active) {
        return { first: active === firstName, second: active === secondName };
    }
    return null;
}

function syncRouteNode(node) {
    if (!node?.graph || !isEnabled(widgetValue(node, "auto_sync", true))) return;
    const now = Date.now();
    if (now - (node._h3RouteLastSync || 0) < SYNC_INTERVAL_MS) return;
    node._h3RouteLastSync = now;

    const firstName = String(widgetValue(node, "first_area", "反推")).trim() || "反推";
    const secondName = String(widgetValue(node, "second_area", "不反推")).trim() || "不反推";
    const state = getActiveState(findIgnoreNode(node.graph), firstName, secondName);
    if (!state || state.first === state.second) return;

    const useFirst = state.first;
    const useFirstWidget = widget(node, "use_first");
    if (!useFirstWidget || isEnabled(useFirstWidget.value) === useFirst) return;

    useFirstWidget.value = useFirst;
    node._h3RouteWidgetSync = true;
    try {
        node.setDirtyCanvas?.(true, true);
        node.graph.change?.();
    } finally {
        node._h3RouteWidgetSync = false;
    }
}

function syncAllRouteNodes() {
    for (const node of graphNodes(app.graph)) {
        if (nodeTypeName(node) === NODE_TYPE) syncRouteNode(node);
    }
}

app.registerExtension({
    name: "QQ.AreaSwitch",

    setup() {
        if (!globalThis.__wslAreaSwitchTimer) {
            globalThis.__wslAreaSwitchTimer = setInterval(
                syncAllRouteNodes,
                SYNC_INTERVAL_MS,
            );
        }
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;

        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            originalCreated?.apply(this, arguments);
            this.color = this.color || "#394b59";
            this.bgcolor = this.bgcolor || "#26333d";
            syncRouteNode(this);
        };

        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            originalConfigure?.apply(this, arguments);
            this._h3RouteLastSync = 0;
            syncRouteNode(this);
        };

        const originalDraw = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function () {
            originalDraw?.apply(this, arguments);
            syncRouteNode(this);
        };
    },
});

