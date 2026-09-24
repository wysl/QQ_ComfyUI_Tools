import { app } from "../../../scripts/app.js";

const PROMPT_NODE = "QQMiniMaxH3EasyPrompt";
const AREA_SWITCH_NODE = "QQMiniMaxH3EasyAreaSwitch";
const H3_NODE = "MiniMaxH3Easy";
const H3_CONTEXT_NODE = "MiniMaxH3EasyContextSegments";
const H3_SELECTED_VIDEO_CONTEXT_NODE = "MiniMaxH3EasySelectedVideoContext";
const H3_MEDIA_LOADER_NODE = "MiniMaxH3EasyMediaLoader";
const H3_PROMPT_TARGETS = new Set([H3_NODE, H3_CONTEXT_NODE, H3_SELECTED_VIDEO_CONTEXT_NODE]);
const REF_PATTERN = /@<?(picture|image|图片|图像|图|video|视频|audio|音频)\s*(\d+)>?/giu;
const LINKS_PROP = "minimax_h3_virtual_media_links";
const BRIDGE_MARKER = Symbol.for("QQ.PromptBridge.graphToPrompt");
const INSTALL_RECHECKS = 40;

let installGeneration = 0;

function graphNodes(graph) {
    return Array.isArray(graph?._nodes) ? graph._nodes : [];
}

function linkedInputReference(node, inputName) {
    const input = (node?.inputs || []).find((entry) => entry.name === inputName);
    const link = input?.link;
    if (link == null) return null;
    const graph = node.graph || app.graph;
    const graphLink = graph?.getLink?.(link)
        || graph?._links?.get?.(link)
        || graph?._links?.[link];
    const resolved = graphLink || link;
    let originId = resolved?.origin_id ?? resolved?.originId;
    let originSlot = resolved?.origin_slot ?? resolved?.originSlot ?? 0;
    if (Array.isArray(resolved)) {
        const compactLink = resolved.length < 6;
        originId = resolved[compactLink ? 0 : 1];
        originSlot = resolved[compactLink ? 1 : 2] ?? 0;
    }
    if (!Number.isFinite(Number(originId))) return null;
    return [String(originId), Number(originSlot) || 0];
}

function originNode(node, inputName) {
    const reference = linkedInputReference(node, inputName);
    if (!reference) return null;
    const graph = node.graph || app.graph;
    return graph?.getNodeById?.(Number(reference[0])) || null;
}

function resolvePromptNode(node, visited = new Set()) {
    if (!node) return null;
    const id = Number(node.id);
    if (Number.isFinite(id)) {
        if (visited.has(id)) return null;
        visited.add(id);
    }
    const type = String(node.comfyClass || node.type || "");
    if (type === PROMPT_NODE) return node;
    if (type !== AREA_SWITCH_NODE) return null;
    const useFirst = Boolean((node.widgets || []).find((item) => item.name === "use_first")?.value);
    return resolvePromptNode(originNode(node, useFirst ? "first" : "second"), visited);
}

function mentionType(label) {
    const value = String(label);
    if (/video|视频/i.test(value)) return "video";
    if (/audio|音频/i.test(value)) return "audio";
    return "image";
}

function mediaLoaderRuntimeIndex(targetNode, mediaType, ordinal) {
    const loader = originNode(targetNode, "media");
    const loaderType = String(loader?.comfyClass || loader?.type || "");
    if (loaderType !== H3_MEDIA_LOADER_NODE) return null;
    let state = (loader.widgets || []).find((item) => item?.name === "media_state")?.value || "";
    if (typeof state === "string") {
        try { state = JSON.parse(state || "{}"); } catch { state = {}; }
    }
    const counts = {
        image: Array.isArray(state?.images) ? state.images.length : 0,
        audio: Array.isArray(state?.audios) ? state.audios.length : 0,
        video: Array.isArray(state?.videos) ? state.videos.length : 0,
    };
    if (ordinal < 1 || ordinal > counts[mediaType]) return null;
    if (mediaType === "image") return ordinal;
    if (mediaType === "audio") return counts.image + ordinal;
    return counts.image + counts.audio + ordinal;
}

function runtimeIndexForMention(targetNode, mediaType, ordinal) {
    const links = targetNode?.properties?.[LINKS_PROP];
    if (!Array.isArray(links) || !links.length) {
        return mediaLoaderRuntimeIndex(targetNode, mediaType, ordinal) ?? ordinal;
    }
    let count = 0;
    for (let index = 0; index < links.length; index += 1) {
        const linkType = String(links[index]?.media_type || "image").toLowerCase();
        if (linkType !== mediaType) continue;
        count += 1;
        if (count === ordinal) return index + 1;
    }
    return ordinal;
}

function runtimePrompt(value, targetNode) {
    // Keep ordinary @ text unchanged.  Only the media mention forms accepted
    // by H3 are converted into the same placeholders used by the source node.
    return String(value || "").replace(REF_PATTERN, (_match, label, number) => {
        const mediaType = mentionType(label);
        const ordinal = Math.max(1, Number.parseInt(number, 10) || 1);
        const index = runtimeIndexForMention(targetNode, mediaType, ordinal);
        return `__MINIMAX_H3_REF_${index}__`;
    });
}

function patchGraphToPrompt() {
    if (typeof app.graphToPrompt !== "function" || app.graphToPrompt[BRIDGE_MARKER]) return;
    const original = app.graphToPrompt;
    const wrapped = async function graphToPromptWithWslPrompt() {
        const promptData = await original.apply(this, arguments);
        const output = promptData?.output || {};
        for (const node of graphNodes(app.graph)) {
            const nodeType = String(node.comfyClass || node.type || "");
            if (H3_PROMPT_TARGETS.has(nodeType)) {
                const sourceNode = resolvePromptNode(originNode(node, "prompt"));
                const sourceData = sourceNode ? output[String(sourceNode.id)] : null;
                if (sourceData?.inputs) {
                    sourceData.inputs.prompt = runtimePrompt(sourceData.inputs.prompt, node);
                }
            }
            if (nodeType !== H3_CONTEXT_NODE) continue;
            const segmentSecondsLink = linkedInputReference(node, "segment_seconds");
            if (!segmentSecondsLink) continue;
            const promptNode = output[String(node.id)];
            if (!promptNode) continue;
            promptNode.inputs ||= {};
            promptNode.inputs.segment_seconds = segmentSecondsLink;
        }
        return promptData;
    };
    Object.defineProperty(wrapped, BRIDGE_MARKER, { value: true });
    app.graphToPrompt = wrapped;
}

function installBridge() {
    const generation = ++installGeneration;
    const recheck = (attempt = 0) => {
        patchGraphToPrompt();
        if (generation !== installGeneration || attempt >= INSTALL_RECHECKS) return;
        setTimeout(() => recheck(attempt + 1), 250);
    };
    recheck();
}

app.registerExtension({
    name: "QQ.PromptBridge",
    setup() {
        installBridge();
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (H3_PROMPT_TARGETS.has(nodeData?.name)) installBridge();
        if (nodeData?.name !== PROMPT_NODE) return;
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function onWslPromptCreated() {
            const result = originalCreated?.apply(this, arguments);
            const prompt = (this.widgets || []).find((item) => item.name === "prompt");
            if (prompt) prompt.label = "提示词";
            installBridge();
            return result;
        };
    },
});
