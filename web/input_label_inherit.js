import { app } from "../../scripts/app.js";

// 输入口标签继承：当消费者输入口名字精确等于 模式 / 启用 / 规则 时，
// 把它显示成「来源」的名字——源输出口的自定义名优先，泛称（值/OUTPUT/*）时退化为源节点标题。
// 这样 QQ-多值输入 连到很远的节点时，一眼能看出这条线控制的是什么。
//
// 规则：
//   - 只改 input.label（LiteGraph 渲染优先显示 label），不动 input.name，匹配/执行逻辑不受影响
//   - 用户手动设过 label 的口不接管；断开或来源变化时还原成接管前的 label
//   - 纯前端显示增强，不进 prompt、不影响执行

const TAG = "[QQ-标签继承]";
const TARGET_INPUT_NAMES = ["模式", "启用", "规则"];
const GENERIC_OUTPUT_NAMES = ["", "*", "值", "output", "OUTPUT", "Output", "result", "RESULT"];

function graphLinks(graph) {
    if (!graph) return [];
    if (graph._links instanceof Map) return [...graph._links.values()];
    if (graph.links instanceof Map) return [...graph.links.values()];
    return Object.values(graph.links || {});
}

function isTargetInput(input) {
    return Boolean(input) && TARGET_INPUT_NAMES.includes(String(input.name || ""));
}

// 源输出口的「可读名字」：自定义名优先，泛称退化为源节点标题
function desiredLabel(source, output) {
    const outName = String(output?.label || output?.name || "");
    if (outName && !GENERIC_OUTPUT_NAMES.includes(outName)) return outName;
    return String(source?.title || source?.type || "");
}

function syncLabels(graph) {
    if (!graph) return null;
    const seen = new Set();
    let owned = 0;
    let changed = false;

    for (const link of graphLinks(graph)) {
        if (!link) continue;
        const target = graph.getNodeById?.(link.target_id);
        const input = target?.inputs?.[link.target_slot];
        if (!target || !input) continue;
        seen.add(input);
        if (!isTargetInput(input)) continue;

        const source = graph.getNodeById?.(link.origin_id);
        const output = source?.outputs?.[link.origin_slot];
        if (!source || !output) continue;
        const wanted = desiredLabel(source, output);
        if (!wanted) continue;

        // 用户手动设过 label 的口不接管
        if (!input.__qqLabelOwned && input.label && input.label !== input.__qqPrevLabel) continue;
        if (input.label === wanted && input.__qqLabelOwned) continue;
        if (!input.__qqLabelOwned) input.__qqPrevLabel = input.label;
        input.__qqLabelOwned = true;
        input.label = wanted;
        owned += 1;
        changed = true;
    }

    // 断开/来源消失的口还原
    for (const node of (graph._nodes || [])) {
        for (const input of (node?.inputs || [])) {
            if (!input?.__qqLabelOwned || seen.has(input)) continue;
            input.label = input.__qqPrevLabel;
            delete input.__qqPrevLabel;
            delete input.__qqLabelOwned;
            changed = true;
        }
    }

    if (changed) {
        try { graph.setDirtyCanvas?.(true, true); } catch { /* 忽略 */ }
    }
    return { owned, changed };
}

function currentGraph() {
    const candidates = [app?.canvas?.graph, app?.graph, globalThis.LGraphCanvas?.active_canvas?.graph];
    for (const g of candidates) {
        if (g && (Array.isArray(g._nodes) || g._nodes_by_id)) return g;
    }
    return null;
}

function start() {
    if (globalThis.__qqLabelInheritTimer) return;
    let lastSignature = "";
    const tick = () => {
        if (!app || app.loading_graph || app.configuringGraph) return;
        const graph = currentGraph();
        if (!graph) return;
        const signature = graphLinks(graph)
            .map((link) => {
                const source = graph.getNodeById?.(link?.origin_id);
                const output = source?.outputs?.[link?.origin_slot];
                return `${link?.id}:${link?.target_id}:${link?.target_slot}`
                    + `:${link?.origin_id}:${link?.origin_slot}:${output?.label ?? ""}:${output?.name ?? ""}`;
            })
            .join("|");
        if (signature === lastSignature) return;
        lastSignature = signature;
        syncLabels(graph);
    };
    globalThis.__qqLabelInheritTimer = setInterval(tick, 700);
    setTimeout(tick, 1200);
}

app.registerExtension({
    name: "QQ.InputLabelInherit",
    setup() {
        start();
        console.info(TAG, "已加载：模式/启用/规则 输入口会显示来源名称");
    },
    async afterGraphConfigured(graph) {
        try { syncLabels(graph); } catch (error) { console.warn(TAG, error); }
    },
});
