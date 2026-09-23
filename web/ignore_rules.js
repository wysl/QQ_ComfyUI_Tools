// Wysl-忽略规则：只隐藏选框（可选按节点标题忽略整个节点的选框）。
// 设计原则：
//   1. 不写任何只读属性（例如 ComboWidget.disabled），避免中断工作流加载。
//   2. 导入路径自动探测，兼容不同的 ComfyUI 目录结构。
//   3. 全部包在 try/catch 中，并且加载工作流期间不执行。

const NODE_TYPE = "WyslIgnoreRules";
const MODE_NEVER = 2;
const TAG = "[Wysl-忽略规则]";

let APP = null;

async function resolveApp() {
    if (APP) return APP;
    const candidates = [
        "../../scripts/app.js",
        "../../../scripts/app.js",
        "/scripts/app.js",
    ];
    for (const candidate of candidates) {
        try {
            const mod = await import(candidate);
            const found = mod?.app ?? mod?.default?.app;
            if (found?.registerExtension) {
                APP = found;
                console.log(TAG, "已加载 app 模块:", candidate);
                return APP;
            }
        } catch (error) {
            // 换下一个候选路径
        }
    }
    APP = globalThis.app ?? null;
    if (APP) console.log(TAG, "使用 globalThis.app");
    return APP;
}

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

function hide(element, hidden) {
    if (!element || !element.style) return;
    element.style.display = hidden ? "none" : "";
}

// 旧渲染：控件自带 element
function hideByWidgetElement(node, nodeHit, widgetPatterns) {
    let count = 0;
    for (const entry of node.widgets || []) {
        const element = entry?.element;
        if (!element?.style) continue;
        const row = element.closest?.(".p-float-label") || element.parentElement || element;
        const hit = nodeHit || hitAny(widgetPatterns, [entry.label, entry.name]);
        hide(row, hit);
        if (hit) count += 1;
    }
    return count;
}

// Vue 渲染：节点容器为 [data-node-id]
function hideByNodeContainer(node, nodeHit, widgetPatterns) {
    if (node?.id == null || typeof document === "undefined") return 0;
    let container = null;
    try {
        container = document.querySelector(`[data-node-id="${node.id}"]`);
    } catch {
        return 0;
    }
    if (!container) return 0;

    const rows = new Set();
    for (const label of container.querySelectorAll("label")) {
        rows.add(label.closest(".p-float-label") || label.parentElement || label);
    }
    for (const marked of container.querySelectorAll("[data-widget-name]")) {
        rows.add(marked);
    }
    for (const marked of container.querySelectorAll("[class*='widget']")) {
        rows.add(marked);
    }

    let count = 0;
    for (const row of rows) {
        if (!row?.style) continue;
        const label = row.querySelector?.("label")?.textContent;
        const texts = [
            label,
            row.getAttribute?.("data-widget-name"),
            row.textContent,
        ].filter((value) => typeof value === "string" && value.trim());
        const hit = nodeHit || hitAny(widgetPatterns, texts);
        hide(row, hit);
        if (hit) count += 1;
    }
    return count;
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

    let hiddenTotal = 0;
    for (const node of all) {
        if (isRuleNode(node)) continue;
        try {
            const nodeHit = nodePatterns.length
                ? hitAny(nodePatterns, [node.title, node.type, node.comfyClass])
                : false;

            let hidden = hideByWidgetElement(node, nodeHit, widgetPatterns);
            hidden += hideByNodeContainer(node, nodeHit, widgetPatterns);
            hiddenTotal += hidden;

            // 节点级忽略：仅在明确填了「节点」规则时生效
            if (nodeHit) {
                if (node.mode !== MODE_NEVER) {
                    if (node._wyslPrevMode === undefined) node._wyslPrevMode = node.mode ?? 0;
                    node.mode = MODE_NEVER;
                }
            } else if (node._wyslPrevMode !== undefined) {
                node.mode = node._wyslPrevMode;
                delete node._wyslPrevMode;
            }
        } catch (error) {
            console.warn(TAG, "跳过节点", node?.title, error);
        }
    }
    return { active: active.length, hiddenTotal };
}

(async () => {
    const app = await resolveApp();
    if (!app?.registerExtension) {
        console.error(TAG, "无法加载 ComfyUI app 模块，扩展未启用");
        return;
    }

    let lastReport = 0;

    app.registerExtension({
        name: "Wysl.IgnoreRules",
        setup() {
            const tick = () => {
                if (!app.graph || app.loading_graph || app.configuringGraph) return;
                let result = null;
                try {
                    result = applyRules(app.canvas?.graph || app.graph);
                } catch (error) {
                    console.warn(TAG, "执行失败", error);
                    return;
                }
                const now = Date.now();
                if (result && now - lastReport > 5000) {
                    lastReport = now;
                    if (result.active > 0) {
                        console.log(TAG, `启用规则 ${result.active} 条，已隐藏选框 ${result.hiddenTotal} 个`);
                    }
                }
            };
            if (!globalThis.__wyslIgnoreTimer) {
                globalThis.__wyslIgnoreTimer = setInterval(tick, 800);
            }
            setTimeout(tick, 2000);
        },
    });
    console.log(TAG, "扩展已注册");
})();
