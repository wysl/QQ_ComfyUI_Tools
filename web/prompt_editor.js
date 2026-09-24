import { app } from "../../../scripts/app.js";

const NODE_TYPE = "QQMiniMaxH3EasyPrompt";
const H3_TARGET_TYPES = new Set([
    "MiniMaxH3Easy",
    "MiniMaxH3EasyContextSegments",
    "MiniMaxH3EasySelectedVideoContext",
]);
const PASS_THROUGH_TYPES = new Set(["QQMiniMaxH3EasyAreaSwitch"]);
const MEDIA_LOADER_TYPE = "MiniMaxH3EasyMediaLoader";
const LINKS_PROP = "minimax_h3_virtual_media_links";
const VIEW_PROP = "wsl_h3_prompt_view_mode";
const STRUCTURED = "structured";
const RAW = "raw";
const WIDGET_NAME = "wsl_h3_prompt_editor";
const STYLE_ID = "wsl-h3-prompt-editor-style";

const TYPE_INFO = Object.freeze({
    image: { label: "图片", tag: "Picture", aliases: ["图片", "图像", "Image", "Picture"] },
    video: { label: "视频", tag: "Video", aliases: ["视频", "Video"] },
    audio: { label: "音频", tag: "Audio", aliases: ["音频", "Audio"] },
});

function nodeClass(node) {
    return String(
        node?.comfyClass
        || node?.constructor?.comfyClass
        || node?.constructor?.nodeData?.name
        || node?.type
        || "",
    );
}

function widget(node, name) {
    return (node?.widgets || []).find((item) => item?.name === name) || null;
}

function setWidgetOption(target, name, value) {
    target.options ||= {};
    target.options[name] = value;
    if (target._state?.options) target._state.options[name] = value;
}

function restoreWidgetOption(target, name, value) {
    target.options ||= {};
    if (value === undefined) delete target.options[name];
    else target.options[name] = value;
    if (!target._state?.options) return;
    if (value === undefined) delete target._state.options[name];
    else target._state.options[name] = value;
}

function graphLink(graph, linkValue) {
    if (linkValue && typeof linkValue === "object" && !Array.isArray(linkValue)) return linkValue;
    for (const links of [graph?.links, graph?._links]) {
        if (!links) continue;
        const resolved = typeof links.get === "function"
            ? links.get(linkValue) ?? links.get(String(linkValue))
            : links[linkValue] ?? links[String(linkValue)];
        if (resolved) return resolved;
    }
    return Array.isArray(linkValue) ? linkValue : null;
}

function linkOrigin(link) {
    if (Array.isArray(link)) return { id: link[1], slot: link[2] ?? 0 };
    return {
        id: link?.origin_id ?? link?.originId ?? link?.from_id ?? link?.fromId,
        slot: link?.origin_slot ?? link?.originSlot ?? link?.from_slot ?? link?.fromSlot ?? 0,
    };
}

function linkTarget(link) {
    if (Array.isArray(link)) return { id: link[3], slot: link[4] ?? 0 };
    return {
        id: link?.target_id ?? link?.targetId ?? link?.to_id ?? link?.toId,
        slot: link?.target_slot ?? link?.targetSlot ?? link?.to_slot ?? link?.toSlot ?? 0,
    };
}

function outgoingConnections(node) {
    const graph = node?.graph || app.graph;
    const result = [];
    for (const output of node?.outputs || []) {
        for (const linkValue of output?.links || []) {
            const link = graphLink(graph, linkValue);
            const target = linkTarget(link);
            const targetNode = graph?.getNodeById?.(Number(target.id));
            if (!targetNode) continue;
            result.push({
                node: targetNode,
                input: targetNode.inputs?.[Number(target.slot) || 0] || null,
            });
        }
    }
    return result;
}

function isPassThrough(node) {
    const type = nodeClass(node);
    return PASS_THROUGH_TYPES.has(type) || /reroute/i.test(type);
}

function downstreamH3Targets(promptNode) {
    const queue = [promptNode];
    const visited = new Set();
    const targets = [];
    while (queue.length) {
        const source = queue.shift();
        const sourceId = Number(source?.id);
        if (Number.isFinite(sourceId)) {
            if (visited.has(sourceId)) continue;
            visited.add(sourceId);
        }
        for (const connection of outgoingConnections(source)) {
            const type = nodeClass(connection.node);
            if (H3_TARGET_TYPES.has(type) && connection.input?.name === "prompt") {
                targets.push(connection.node);
                continue;
            }
            if (isPassThrough(connection.node)) queue.push(connection.node);
        }
    }
    return targets;
}

function inputOriginNode(node, inputName) {
    const input = (node?.inputs || []).find((item) => item?.name === inputName);
    if (input?.link == null) return null;
    const graph = node.graph || app.graph;
    const origin = linkOrigin(graphLink(graph, input.link));
    return graph?.getNodeById?.(Number(origin.id)) || null;
}

function filenameValue(value) {
    const candidate = typeof value === "object" ? value?.filename || value?.name : value;
    const text = String(candidate || "").trim();
    if (!text || /^(?:data:|blob:|https?:)/i.test(text)) return "";
    return text.replaceAll("\\", "/").split("/").pop() || text;
}

function sourceFilename(node, mediaType) {
    const preferred = {
        image: ["image", "filename", "file"],
        video: ["video", "filename", "file", "video_file", "videofile"],
        audio: ["audio", "filename", "file", "audio_file", "audiofile"],
    }[mediaType] || ["filename", "file"];
    const preferredNames = new Set(preferred);
    const widgets = node?.widgets || [];
    const ordered = [
        ...widgets.filter((item) => preferred.includes(String(item?.name || "").toLowerCase())),
        ...widgets,
    ];
    for (const item of ordered) {
        const name = String(item?.name || "").toLowerCase();
        const value = filenameValue(item?.value);
        if (!value) continue;
        if (preferredNames.has(name) || /\.(?:png|jpe?g|webp|gif|bmp|mp4|webm|mov|mkv|avi|m4v|mp3|wav|flac|ogg|m4a)$/i.test(value)) {
            return value;
        }
    }
    return filenameValue(node?.properties?.filename || node?.properties?.file);
}

function sourcePreview(node, mediaType) {
    if (!node || mediaType === "audio") return "";
    const image = (node.imgs || []).find((item) => item?.src);
    if (image?.src) return image.src;
    for (const item of node.widgets || []) {
        const element = item?.element;
        const preview = element?.matches?.("img") ? element : element?.querySelector?.("img");
        if (preview?.src) return preview.src;
        const video = element?.matches?.("video") ? element : element?.querySelector?.("video");
        if (mediaType === "video" && video?.poster) return video.poster;
    }
    const fileWidget = widget(node, mediaType === "image" ? "image" : "video")
        || widget(node, "file")
        || widget(node, "filename");
    const value = fileWidget?.value;
    const filename = typeof value === "object" ? value?.filename : value;
    if (!filename) return "";
    const params = new URLSearchParams({
        filename: String(filename),
        type: typeof value === "object" ? String(value.type || "input") : "input",
    });
    if (typeof value === "object" && value.subfolder) params.set("subfolder", String(value.subfolder));
    return `/view?${params.toString()}`;
}

function referenceMode(target) {
    const value = String(widget(target, "reference_mention_mode")?.value || "index").toLowerCase();
    return value.includes("filename") || value.includes("文件") ? "filename" : "index";
}

function officialTag(mediaType, ordinal) {
    const type = TYPE_INFO[mediaType] ? mediaType : "image";
    return `<${TYPE_INFO[type].tag} ${ordinal}>`;
}

function mediaOption(target, mediaType, ordinal, source, extra = {}) {
    const type = TYPE_INFO[mediaType] ? mediaType : "image";
    const tag = officialTag(type, ordinal);
    const filename = String(extra.filename || sourceFilename(source, type) || "");
    const mode = referenceMode(target);
    return {
        type,
        ordinal,
        tag,
        label: mode === "filename" && filename ? filename : `${TYPE_INFO[type].label}${ordinal}`,
        filename,
        source: String(source?.title || nodeClass(source) || "媒体资源"),
        preview: extra.preview || sourcePreview(source, type),
    };
}

function mediaLoaderState(loader) {
    let value = widget(loader, "media_state")?.value || "";
    if (typeof value === "string") {
        try { value = JSON.parse(value || "{}"); } catch { value = {}; }
    }
    return value && typeof value === "object" ? value : {};
}

function loaderMediaOptions(target, loader) {
    const state = mediaLoaderState(loader);
    const result = [];
    for (const type of ["image", "audio", "video"]) {
        const values = Array.isArray(state[`${type}s`]) ? state[`${type}s`] : [];
        values.forEach((entry, index) => {
            const raw = typeof entry === "object" ? entry?.filename : entry;
            const filename = String(raw || "").replaceAll("\\", "/");
            const params = new URLSearchParams({ filename, type: "input" });
            result.push(mediaOption(target, type, index + 1, loader, {
                filename: filenameValue(filename),
                preview: type === "audio" || !filename ? "" : `/view?${params.toString()}`,
            }));
        });
    }
    return result;
}

function virtualMediaOptions(target) {
    const links = Array.isArray(target?.properties?.[LINKS_PROP])
        ? target.properties[LINKS_PROP]
        : [];
    const order = { image: 0, video: 1, audio: 2 };
    const entries = links
        .map((link, index) => ({ link, index }))
        .filter(({ link }) => TYPE_INFO[String(link?.media_type || "").toLowerCase()])
        .sort((left, right) => {
            const leftType = String(left.link.media_type).toLowerCase();
            const rightType = String(right.link.media_type).toLowerCase();
            return order[leftType] - order[rightType] || left.index - right.index;
        });
    const counts = { image: 0, video: 0, audio: 0 };
    return entries.map(({ link }) => {
        const type = String(link.media_type).toLowerCase();
        counts[type] += 1;
        const source = app.graph?.getNodeById?.(Number(link.source_id));
        return mediaOption(target, type, counts[type], source);
    });
}

function mentionOptions(promptNode) {
    const target = downstreamH3Targets(promptNode)[0];
    if (!target) return [];
    const mediaSource = inputOriginNode(target, "media");
    if (nodeClass(mediaSource) === MEDIA_LOADER_TYPE) {
        const options = loaderMediaOptions(target, mediaSource);
        if (options.length) return options;
    }
    return virtualMediaOptions(target);
}

function editorValue(editor) {
    let result = "";
    const visit = (item) => {
        if (item.nodeType === Node.TEXT_NODE) {
            result += String(item.textContent || "").replaceAll("\u200B", "");
            return;
        }
        if (item.nodeType !== Node.ELEMENT_NODE) return;
        if (item.classList?.contains("wsl-h3-mention-chip")) {
            result += item.dataset.tag || "";
            return;
        }
        if (item.tagName === "BR") {
            result += "\n";
            return;
        }
        const block = ["DIV", "P"].includes(item.tagName);
        if (block && result && !result.endsWith("\n")) result += "\n";
        for (const child of item.childNodes || []) visit(child);
    };
    for (const child of editor?.childNodes || []) visit(child);
    return result;
}

function appendText(container, value) {
    String(value || "").split("\n").forEach((part, index) => {
        if (index) container.append(document.createElement("br"));
        if (part) container.append(document.createTextNode(part));
    });
}

function makeThumb(option, menu = false) {
    const className = menu ? "wsl-h3-mention-menu-thumb" : "wsl-h3-mention-chip-thumb";
    if (option.preview) {
        const image = document.createElement("img");
        image.className = className;
        image.alt = "";
        image.draggable = false;
        image.src = option.preview;
        return image;
    }
    const icon = document.createElement("span");
    icon.className = `${className} is-${option.type}`;
    icon.textContent = option.type === "image" ? "图" : option.type === "video" ? "视" : "音";
    return icon;
}

function makeChip(option) {
    const chip = document.createElement("span");
    chip.className = "wsl-h3-mention-chip";
    chip.contentEditable = "false";
    chip.dataset.tag = option.tag;
    chip.dataset.type = option.type;
    chip.dataset.ordinal = String(option.ordinal);
    chip.title = option.filename || option.label;
    const label = document.createElement("span");
    label.className = "wsl-h3-mention-chip-label";
    label.textContent = `@${option.label}`;
    chip.append(makeThumb(option), label);
    return chip;
}

function optionForTag(promptNode, kind, ordinal) {
    const type = String(kind).toLowerCase() === "picture" ? "image" : String(kind).toLowerCase();
    return mentionOptions(promptNode).find(
        (option) => option.type === type && Number(option.ordinal) === Number(ordinal),
    ) || mediaOption(null, type, Number(ordinal), null);
}

function renderEditor(node) {
    const editor = node?.__wslH3PromptEditor;
    const promptWidget = widget(node, "prompt");
    if (!editor || !promptWidget || document.activeElement === editor) return;
    const value = String(promptWidget.value || "");
    editor.textContent = "";
    const raw = node.properties?.[VIEW_PROP] === RAW;
    editor.classList.toggle("is-raw", raw);
    if (raw) {
        appendText(editor, value);
        return;
    }
    const pattern = /<\s*(Picture|Video|Audio)\s+(\d+)\s*>/giu;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(value))) {
        appendText(editor, value.slice(cursor, match.index));
        editor.append(makeChip(optionForTag(node, match[1], match[2])));
        cursor = match.index + match[0].length;
    }
    appendText(editor, value.slice(cursor));
}

function syncPromptWidget(node, markDirty = true) {
    const editor = node?.__wslH3PromptEditor;
    const promptWidget = widget(node, "prompt");
    if (!editor || !promptWidget) return;
    const value = editorValue(editor);
    promptWidget.value = value;
    if (promptWidget._state) promptWidget._state.value = value;
    if (markDirty) {
        node.setDirtyCanvas?.(true, true);
        app.graph?.setDirtyCanvas?.(true, true);
        app.graph?.change?.();
    }
}

function mentionRange(editor) {
    const selection = window.getSelection?.();
    if (!selection?.isCollapsed || !selection.rangeCount) return null;
    const caret = selection.getRangeAt(0);
    if (!editor.contains(caret.startContainer) || caret.startContainer.nodeType !== Node.TEXT_NODE) return null;
    const before = String(caret.startContainer.textContent || "").slice(0, caret.startOffset);
    const match = before.match(/@[^@\n]*$/u);
    if (!match) return null;
    const range = document.createRange();
    range.setStart(caret.startContainer, caret.startOffset - match[0].length);
    range.setEnd(caret.startContainer, caret.startOffset);
    return { range, query: match[0].slice(1).trim().toLowerCase() };
}

function closeMenu(node) {
    node?.__wslH3MentionMenu?.element?.remove?.();
    if (node) node.__wslH3MentionMenu = null;
}

function positionMenu(menu, editor, range) {
    const caretRect = range?.getBoundingClientRect?.();
    const editorRect = editor.getBoundingClientRect();
    const width = Math.min(330, Math.max(220, editorRect.width));
    const left = Math.min(
        Math.max(8, caretRect?.left || editorRect.left),
        Math.max(8, window.innerWidth - width - 8),
    );
    const preferredTop = (caretRect?.bottom || editorRect.top) + 6;
    const top = preferredTop + 260 < window.innerHeight
        ? preferredTop
        : Math.max(8, (caretRect?.top || editorRect.top) - 266);
    Object.assign(menu.style, { left: `${left}px`, top: `${top}px`, width: `${width}px` });
}

function chooseMention(node, option) {
    const state = node?.__wslH3MentionMenu;
    if (!state?.range || !node?.__wslH3PromptEditor) return;
    state.range.deleteContents();
    const chip = makeChip(option);
    const after = document.createTextNode("\u200B");
    const fragment = document.createDocumentFragment();
    fragment.append(chip, after);
    state.range.insertNode(fragment);
    const selection = window.getSelection?.();
    if (selection) {
        const caret = document.createRange();
        caret.setStart(after, after.textContent.length);
        caret.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caret);
    }
    closeMenu(node);
    syncPromptWidget(node);
    node.__wslH3PromptEditor.focus({ preventScroll: true });
}

function renderMenu(node) {
    const state = node?.__wslH3MentionMenu;
    if (!state) return;
    state.element.textContent = "";
    if (!state.options.length) {
        const empty = document.createElement("div");
        empty.className = "wsl-h3-mention-empty";
        empty.textContent = downstreamH3Targets(node).length
            ? "目标节点中没有可引用的媒体"
            : "请先连接到 MiniMax H3 Easy 节点";
        state.element.append(empty);
        return;
    }
    state.options.forEach((option, index) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = `wsl-h3-mention-row${index === state.activeIndex ? " is-active" : ""}`;
        const title = document.createElement("span");
        title.className = "wsl-h3-mention-title";
        title.textContent = option.label;
        const detail = document.createElement("span");
        detail.className = "wsl-h3-mention-detail";
        detail.textContent = option.source;
        const text = document.createElement("span");
        text.className = "wsl-h3-mention-text";
        text.append(title, detail);
        row.append(makeThumb(option, true), text);
        row.addEventListener("pointermove", () => {
            if (!node.__wslH3MentionMenu || node.__wslH3MentionMenu.activeIndex === index) return;
            node.__wslH3MentionMenu.activeIndex = index;
            renderMenu(node);
        });
        row.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            event.stopPropagation();
            chooseMention(node, option);
        });
        state.element.append(row);
    });
}

function syncMentionMenu(node) {
    if (node?.properties?.[VIEW_PROP] === RAW) {
        closeMenu(node);
        return;
    }
    const editor = node?.__wslH3PromptEditor;
    const mention = editor ? mentionRange(editor) : null;
    if (!mention) {
        closeMenu(node);
        return;
    }
    const query = mention.query;
    const options = mentionOptions(node).filter((option) => {
        const searchable = `${option.label} ${option.filename} ${option.source}`.toLowerCase();
        return !query || searchable.includes(query);
    });
    let state = node.__wslH3MentionMenu;
    if (!state) {
        const element = document.createElement("div");
        element.className = "wsl-h3-mention-menu";
        document.body.append(element);
        state = node.__wslH3MentionMenu = { element, activeIndex: 0 };
    }
    state.range = mention.range;
    state.options = options;
    state.activeIndex = Math.min(state.activeIndex, Math.max(0, options.length - 1));
    renderMenu(node);
    positionMenu(state.element, editor, mention.range);
}

function handleMenuKey(node, event) {
    const state = node?.__wslH3MentionMenu;
    if (!state) return false;
    if (event.key === "Escape") {
        closeMenu(node);
        return true;
    }
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        if (state.options.length) {
            const delta = event.key === "ArrowDown" ? 1 : -1;
            state.activeIndex = (state.activeIndex + delta + state.options.length) % state.options.length;
            renderMenu(node);
            state.element.querySelector(".is-active")?.scrollIntoView?.({ block: "nearest" });
        }
        return true;
    }
    if (["Enter", "Tab"].includes(event.key) && state.options[state.activeIndex]) {
        chooseMention(node, state.options[state.activeIndex]);
        return true;
    }
    return false;
}

function insertTextAtSelection(editor, text) {
    const selection = window.getSelection?.();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const fragment = document.createDocumentFragment();
    let last = null;
    String(text || "").split("\n").forEach((part, index) => {
        if (index) {
            last = document.createElement("br");
            fragment.append(last);
        }
        if (part || !last) {
            last = document.createTextNode(part);
            fragment.append(last);
        }
    });
    range.insertNode(fragment);
    if (last) {
        range.setStartAfter(last);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    }
}

function pastedMentionCandidates(node) {
    const candidates = [];
    const seen = new Set();
    for (const option of mentionOptions(node)) {
        const aliases = new Set([option.tag]);
        if (option.label) aliases.add(`@${option.label}`);
        if (option.filename) aliases.add(`@${option.filename}`);
        for (const prefix of TYPE_INFO[option.type]?.aliases || []) {
            aliases.add(`@${prefix}${option.ordinal}`);
            aliases.add(`@${prefix} ${option.ordinal}`);
        }
        for (const raw of aliases) {
            const value = String(raw || "");
            const key = value.toLocaleLowerCase();
            if (!value || seen.has(key)) continue;
            seen.add(key);
            candidates.push({ raw: value, option });
        }
    }
    return candidates.sort((left, right) => right.raw.length - left.raw.length);
}

function pastedMentionMatch(node, value, cursor, candidates) {
    const remaining = String(value || "").slice(cursor);
    const official = remaining.match(/^<\s*(Picture|Video|Audio)\s*(\d+)\s*>/iu);
    if (official) {
        return {
            raw: official[0],
            option: optionForTag(node, official[1], official[2]),
        };
    }

    const candidate = candidates.find(
        (item) => remaining.slice(0, item.raw.length).toLocaleLowerCase()
            === item.raw.toLocaleLowerCase(),
    );
    if (candidate) return candidate;

    const indexed = remaining.match(/^@(图片|图像|Image|Picture|视频|Video|音频|Audio)\s*(\d+)/iu);
    if (indexed) {
        const alias = indexed[1].toLocaleLowerCase();
        const type = ["视频", "video"].includes(alias)
            ? "video"
            : ["音频", "audio"].includes(alias)
                ? "audio"
                : "image";
        return {
            raw: indexed[0],
            option: optionForTag(node, TYPE_INFO[type].tag, indexed[2]),
        };
    }
    return null;
}

function appendPastedText(fragment, text) {
    String(text || "").split("\n").forEach((part, index) => {
        if (index) fragment.append(document.createElement("br"));
        if (part) fragment.append(document.createTextNode(part));
    });
}

function insertTextWithMentionChips(node, editor, text) {
    const selection = window.getSelection?.();
    if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) return false;
    const value = String(text || "");
    if (!value) return false;

    const range = selection.getRangeAt(0);
    const candidates = pastedMentionCandidates(node);
    const fragment = document.createDocumentFragment();
    let plainStart = 0;
    let cursor = 0;
    range.deleteContents();

    while (cursor < value.length) {
        const match = pastedMentionMatch(node, value, cursor, candidates);
        if (!match) {
            cursor += 1;
            continue;
        }
        if (plainStart < cursor) appendPastedText(fragment, value.slice(plainStart, cursor));
        fragment.append(makeChip(match.option), document.createTextNode("\u200B"));
        cursor += match.raw.length;
        plainStart = cursor;
    }
    if (plainStart < value.length) appendPastedText(fragment, value.slice(plainStart));

    const caretMarker = document.createTextNode("\u200B");
    fragment.append(caretMarker);
    range.insertNode(fragment);
    const caret = document.createRange();
    caret.setStart(caretMarker, caretMarker.textContent.length);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
    return true;
}

function updateModeControls(node) {
    const raw = node?.properties?.[VIEW_PROP] === RAW;
    node?.__wslH3StructuredButton?.classList.toggle("is-active", !raw);
    node?.__wslH3RawButton?.classList.toggle("is-active", raw);
    node?.__wslH3PromptEditor?.classList.toggle("is-raw", raw);
    node?.__wslH3PromptEditor?.setAttribute("aria-label", raw ? "原始提示词" : "结构化提示词");
}

function setViewMode(node, mode) {
    syncPromptWidget(node, false);
    node.properties ||= {};
    node.properties[VIEW_PROP] = mode === RAW ? RAW : STRUCTURED;
    closeMenu(node);
    renderEditor(node);
    updateModeControls(node);
    node.setDirtyCanvas?.(true, true);
    app.graph?.change?.();
}

function hidePromptWidget(target) {
    if (!target || target.__wslH3PromptHidden) return;
    target.__wslH3PromptHidden = {
        type: target.type,
        computeSize: target.computeSize,
        hidden: target.hidden,
        optionHidden: target.options?.hidden,
        canvasOnly: target.options?.canvasOnly,
    };
    target.hidden = true;
    target.type = "hidden";
    setWidgetOption(target, "hidden", true);
    setWidgetOption(target, "canvasOnly", true);
    target.computeSize = () => [0, -4];
}

function restorePromptWidget(target) {
    const state = target?.__wslH3PromptHidden;
    if (!state) return;
    target.type = state.type;
    target.computeSize = state.computeSize;
    target.hidden = state.hidden;
    restoreWidgetOption(target, "hidden", state.optionHidden);
    restoreWidgetOption(target, "canvasOnly", state.canvasOnly);
    delete target.__wslH3PromptHidden;
}

function patchCanvasKeyHandling() {
    const prototype = globalThis.LGraphCanvas?.prototype;
    if (!prototype || prototype.__wslH3PromptKeyHandlingPatched || typeof prototype.processKey !== "function") return;
    prototype.__wslH3PromptKeyHandlingPatched = true;
    const original = prototype.processKey;
    prototype.processKey = function processKeyWithWslH3PromptEditor(event) {
        const activeEditor = event?.target?.closest?.(".wsl-h3-prompt-editor")
            || document.activeElement?.closest?.(".wsl-h3-prompt-editor");
        if (activeEditor) return;
        return original.apply(this, arguments);
    };
}

function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .wsl-h3-prompt-wrap { width:100%; height:100%; min-height:92px; display:flex; flex-direction:column; gap:5px; box-sizing:border-box; color:var(--input-text,#ddd); }
      .wsl-h3-prompt-toolbar { display:flex; justify-content:flex-end; min-height:25px; }
      .wsl-h3-prompt-modes { display:grid; grid-template-columns:1fr 1fr; padding:2px; border:1px solid var(--border-color,rgba(255,255,255,.14)); border-radius:6px; background:var(--comfy-input-bg,#222); }
      .wsl-h3-prompt-mode { min-width:64px; height:21px; padding:0 8px; border:0; border-radius:4px; background:transparent; color:rgba(255,255,255,.55); cursor:pointer; font:inherit; font-size:11px; }
      .wsl-h3-prompt-mode.is-active { background:rgba(255,255,255,.13); color:var(--input-text,#eee); }
      .wsl-h3-prompt-editor { flex:1 1 auto; width:100%; min-height:62px; padding:8px; overflow:auto; box-sizing:border-box; border:1px solid var(--border-color,rgba(255,255,255,.16)); border-radius:6px; outline:none; background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd); font:var(--comfy-textarea-font-size,12px)/1.45 sans-serif; white-space:pre-wrap; overflow-wrap:anywhere; }
      .wsl-h3-prompt-editor:focus { border-color:rgba(154,190,255,.72); box-shadow:0 0 0 1px rgba(154,190,255,.22); }
      .wsl-h3-prompt-editor:empty::before { content:"输入提示词，使用 @ 引用目标节点的媒体"; color:rgba(255,255,255,.34); pointer-events:none; }
      .wsl-h3-prompt-editor.is-raw:empty::before { content:"原始提示词"; }
      .wsl-h3-mention-chip { display:inline-flex; align-items:center; gap:4px; max-width:190px; margin:1px 2px; padding:2px 5px; border:1px solid rgba(116,180,255,.42); border-radius:5px; background:rgba(66,120,180,.22); color:#dcecff; vertical-align:middle; user-select:all; }
      .wsl-h3-mention-chip-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .wsl-h3-mention-chip-thumb { width:18px; height:18px; flex:0 0 18px; display:inline-flex; align-items:center; justify-content:center; object-fit:cover; border-radius:3px; background:#376b9b; color:#fff; font-size:9px; }
      .wsl-h3-mention-chip-thumb.is-video { background:#7b536e; }
      .wsl-h3-mention-chip-thumb.is-audio { background:#4f765c; }
      .wsl-h3-mention-menu { position:fixed; z-index:100000; max-height:260px; overflow:auto; padding:5px; box-sizing:border-box; border:1px solid var(--border-color,rgba(255,255,255,.18)); border-radius:7px; background:var(--comfy-menu-bg,#202124); box-shadow:0 12px 28px rgba(0,0,0,.48); }
      .wsl-h3-mention-row { width:100%; min-height:45px; display:grid; grid-template-columns:38px minmax(0,1fr); gap:8px; align-items:center; padding:4px 6px; border:0; border-radius:5px; background:transparent; color:var(--input-text,#ddd); cursor:pointer; text-align:left; }
      .wsl-h3-mention-row:hover, .wsl-h3-mention-row.is-active { background:rgba(116,180,255,.15); }
      .wsl-h3-mention-menu-thumb { width:36px; height:36px; display:flex; align-items:center; justify-content:center; object-fit:cover; border-radius:4px; background:#376b9b; color:#fff; font-size:12px; }
      .wsl-h3-mention-menu-thumb.is-video { background:#7b536e; }
      .wsl-h3-mention-menu-thumb.is-audio { background:#4f765c; }
      .wsl-h3-mention-text { min-width:0; display:flex; flex-direction:column; gap:2px; }
      .wsl-h3-mention-title, .wsl-h3-mention-detail { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .wsl-h3-mention-title { font-size:13px; font-weight:600; }
      .wsl-h3-mention-detail { color:rgba(255,255,255,.5); font-size:11px; }
      .wsl-h3-mention-empty { padding:10px; color:rgba(255,255,255,.55); font-size:12px; }
    `;
    document.head.append(style);
}

function ensurePromptEditor(node) {
    if (!node || node.__wslH3PromptEditor || typeof node.addDOMWidget !== "function") return;
    const promptWidget = widget(node, "prompt");
    if (!promptWidget) return;
    installStyles();
    patchCanvasKeyHandling();
    node.properties ||= {};
    node.properties[VIEW_PROP] = node.properties[VIEW_PROP] === RAW ? RAW : STRUCTURED;
    hidePromptWidget(promptWidget);

    const wrap = document.createElement("div");
    wrap.className = "wsl-h3-prompt-wrap";
    const toolbar = document.createElement("div");
    toolbar.className = "wsl-h3-prompt-toolbar";
    const modes = document.createElement("div");
    modes.className = "wsl-h3-prompt-modes";
    const structured = document.createElement("button");
    structured.type = "button";
    structured.className = "wsl-h3-prompt-mode";
    structured.textContent = "结构化";
    const raw = document.createElement("button");
    raw.type = "button";
    raw.className = "wsl-h3-prompt-mode";
    raw.textContent = "原始文本";
    modes.append(structured, raw);
    toolbar.append(modes);

    const editor = document.createElement("div");
    editor.className = "wsl-h3-prompt-editor";
    editor.contentEditable = "true";
    editor.spellcheck = false;
    editor.tabIndex = 0;
    wrap.append(toolbar, editor);
    node.__wslH3PromptEditor = editor;
    node.__wslH3StructuredButton = structured;
    node.__wslH3RawButton = raw;

    structured.addEventListener("pointerdown", (event) => event.stopPropagation());
    raw.addEventListener("pointerdown", (event) => event.stopPropagation());
    structured.addEventListener("click", () => setViewMode(node, STRUCTURED));
    raw.addEventListener("click", () => setViewMode(node, RAW));
    editor.addEventListener("beforeinput", (event) => {
        if (node.properties?.[VIEW_PROP] !== RAW && event.data === "@") {
            setTimeout(() => syncMentionMenu(node), 0);
        }
    });
    editor.addEventListener("input", () => {
        syncPromptWidget(node);
        syncMentionMenu(node);
    });
    editor.addEventListener("keyup", (event) => {
        if (!["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab"].includes(event.key)) syncMentionMenu(node);
        event.stopPropagation();
    });
    editor.addEventListener("keydown", (event) => {
        if (handleMenuKey(node, event)) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            insertTextAtSelection(editor, "\n");
            syncPromptWidget(node);
            closeMenu(node);
        } else if (event.key === "Escape") {
            closeMenu(node);
        }
        event.stopPropagation();
    });
    editor.addEventListener("paste", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const text = event.clipboardData?.getData("text/plain") || "";
        if (node.properties?.[VIEW_PROP] === RAW) insertTextAtSelection(editor, text);
        else insertTextWithMentionChips(node, editor, text);
        syncPromptWidget(node);
        syncMentionMenu(node);
    });
    editor.addEventListener("blur", () => {
        syncPromptWidget(node);
        setTimeout(() => {
            if (!node.__wslH3MentionMenu?.element?.matches?.(":hover")) closeMenu(node);
        }, 160);
    });
    wrap.addEventListener("pointerdown", (event) => event.stopPropagation());
    wrap.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });

    const domWidget = node.addDOMWidget(WIDGET_NAME, WIDGET_NAME, wrap, {
        getValue: () => String(promptWidget.value || ""),
        setValue: (value) => {
            promptWidget.value = String(value || "");
            renderEditor(node);
        },
        serialize: false,
        getMinHeight: () => 92,
        afterResize: () => node.setDirtyCanvas?.(true, true),
    });
    if (!domWidget) {
        wrap.remove();
        node.__wslH3PromptEditor = null;
        restorePromptWidget(promptWidget);
        return;
    }
    domWidget.serialize = false;
    node.__wslH3PromptDomWidget = domWidget;
    node.resizable = true;
    renderEditor(node);
    updateModeControls(node);
}

function teardownPromptEditor(node) {
    closeMenu(node);
    const domWidget = node?.__wslH3PromptDomWidget;
    const wrap = node?.__wslH3PromptEditor?.closest?.(".wsl-h3-prompt-wrap");
    wrap?.remove?.();
    if (Array.isArray(node?.widgets) && domWidget) {
        const nextWidgets = node.widgets.filter((item) => item !== domWidget);
        node.widgets = nextWidgets;
        if (Array.isArray(node._widgets)) node._widgets = nextWidgets;
    }
    restorePromptWidget(widget(node, "prompt"));
    node.__wslH3PromptEditor = null;
    node.__wslH3PromptDomWidget = null;
    node.__wslH3StructuredButton = null;
    node.__wslH3RawButton = null;
}

function scheduleEditor(node) {
    if (node?.__wslH3EditorScheduled) return;
    node.__wslH3EditorScheduled = true;
    requestAnimationFrame(() => {
        node.__wslH3EditorScheduled = false;
        ensurePromptEditor(node);
        renderEditor(node);
    });
}

function patchPromptNode(nodeType) {
    const prototype = nodeType?.prototype;
    if (!prototype || prototype.__wslH3PromptEditorPatched) return;
    prototype.__wslH3PromptEditorPatched = true;

    const originalCreated = prototype.onNodeCreated;
    prototype.onNodeCreated = function onWslH3PromptCreated() {
        const result = originalCreated?.apply(this, arguments);
        scheduleEditor(this);
        return result;
    };

    const originalConfigured = prototype.onConfigure;
    prototype.onConfigure = function onWslH3PromptConfigured() {
        const result = originalConfigured?.apply(this, arguments);
        scheduleEditor(this);
        requestAnimationFrame(() => renderEditor(this));
        return result;
    };

    const originalConnectionsChange = prototype.onConnectionsChange;
    prototype.onConnectionsChange = function onWslH3PromptConnectionsChange() {
        const result = originalConnectionsChange?.apply(this, arguments);
        closeMenu(this);
        requestAnimationFrame(() => renderEditor(this));
        return result;
    };

    const originalAdded = prototype.onAdded;
    prototype.onAdded = function onWslH3PromptAdded() {
        const result = originalAdded?.apply(this, arguments);
        scheduleEditor(this);
        return result;
    };

    const originalSerialize = prototype.onSerialize;
    prototype.onSerialize = function onWslH3PromptSerialize() {
        syncPromptWidget(this, false);
        return originalSerialize?.apply(this, arguments);
    };

    const originalRemoved = prototype.onRemoved;
    prototype.onRemoved = function onWslH3PromptRemoved() {
        const result = originalRemoved?.apply(this, arguments);
        teardownPromptEditor(this);
        return result;
    };
}

app.registerExtension({
    name: "QQ.H3PromptEditor",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name === NODE_TYPE) patchPromptNode(nodeType);
    },
});
