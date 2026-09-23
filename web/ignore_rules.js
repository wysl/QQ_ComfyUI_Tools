import { app } from "../../scripts/app.js";

// Wysl-忽略规则
// 依据 ComfyUI_frontend 官方机制：隐藏控件应写 widget.hidden（= suppression.byExtension），
// 该标志对 canvas / vueNode / panel 三个渲染面同时生效，是官方支持的公开写法。
// 参考：src/types/widgetVisibility.ts  (applyLegacyHiddenWrite / isWidgetHidden)
//
// 注意：绝不写 widget.disabled / computedDisabled —— 新版这些是只读 getter。

const NODE_TYPE = "WyslIgnoreRules";
const TAG = "[Wysl-忽略规则]";

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

// 官方支持的隐藏方式：写 widget.hidden
function setWidgetHidden(entry, hidden) {
    if (!entry) return false;
    try {
        if (entry.hidden !== hidden) entry.hidden = hidden;
        // 旧渲染里同步 options，保持与历史行为一致
        if (entry.options && typeof entry.options === "object" && "hidden" in entry.options) {
            entry.options.hidden = hidden;
        }
        return true;
    } catch (error) {
        console.warn(TAG, "无法设置 hidden:", entry?.name, error);
        return false;
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
    const hasRules = nodePatterns.length > 0 || widgetPatterns.length > 0;

    let hiddenCount = 0;
    for (const node of all) {
        if (isRuleNode(node)) continue;
        try {
            const nodeHit = nodePatterns.length
                ? hitAny(nodePatterns, [node.title, node.type, node.comfyClass])
                : false;

            for (const entry of node.widgets || []) {
                // 规则节点自己的开关控件永不隐藏
                const ownControls = ["启用", "节点", "选框"];
                if (isRuleNode(node) && ownControls.includes(entry?.name)) continue;

                const hit = hasRules && (
                    nodeHit || hitAny(widgetPatterns, [entry?.label, entry?.name])
                );
                if (setWidgetHidden(entry, Boolean(hit)) && hit) hiddenCount += 1;
            }

            if (nodeHit) {
                node.mode = 2; // Never
            }
        } catch (error) {
            console.warn(TAG, "跳过节点", node?.title, error);
        }
    }
    return { active: active.length, hiddenCount, hasRules };
}

function safeApply() {
    try {
        return applyRules(app.canvas?.graph || app.graph);
    } catch (error) {
        console.warn(TAG, "执行失败", error);
        return null;
    }
}

app.registerExtension({
    name: "Wysl.IgnoreRules",
    setup() {
        console.log(TAG, "扩展已加载");
        let lastLog = 0;
        const tick = () => {
            // 加载工作流期间不动，避免干扰
            if (!app.graph || app.loading_graph || app.configuringGraph) return;
            const result = safeApply();
            const now = Date.now();
            if (result?.hasRules && now - lastLog > 5000) {
                lastLog = now;
                console.log(TAG, `规则 ${result.active} 条，已隐藏选框 ${result.hiddenCount} 个`);
            }
        };
        if (!globalThis.__wyslIgnoreTimer) {
            globalThis.__wyslIgnoreTimer = setInterval(tick, 800);
        }
        setTimeout(tick, 2000);
    },
});
