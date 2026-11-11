import { app } from "../../scripts/app.js";

// QQ-Lora分组加载（仅模型）的面板。
//
// 数据都放在节点的隐藏控件里（工作流随存随读）：
//   分组数据  STRING  {"version":1,"active":0,"select":"","groups":[
//                        {"name":"…","loras":[{"name":"…","strength":1,"off":false}]}]}
//   启用开关  BOOLEAN 节点总开关（画布控件）
//   生效分组  COMBO   下拉选择哪一组生效；跟随面板 = 用面板里点亮的组
//
// 面板结构：分组条（点击切换 / 双击改名 / ×删除 / 右键复制 / +新增）→ 当前分组的
// LoRA 列表（左侧勾选框=本次是否参与叠加，名称点开目录树选择，强度可微调，行可拖动排序、
// 右键换组）→ 底部状态。鼠标停在 LoRA 上会弹出缩略图。

const NODE_TYPE = "QQLoraGroupLoader";
const DATA_WIDGET = "分组数据";
const ENABLE_WIDGET = "启用开关";
const GROUP_WIDGET = "生效分组";
const FOLLOW_PANEL = "跟随面板";

const MIN_PANEL_HEIGHT = 200;
const MIN_PANEL_WIDTH = 250;
// 画布上的最小宽度：面板 250 + DOM 控件边距
const MIN_NODE_WIDTH = 262;
const STRENGTH_STEP = 0.05;
const STRENGTH_STEP_BIG = 0.5;
const MIN_POP_WIDTH = 220;
const MAX_POP_HEIGHT = 280;
const MAX_POPUP_ROWS = 400;
const ROW_HEIGHT_PX = 30;
const PREVIEW_DELAY = 320;
const PREVIEW_SIZE = 190;
const LORA_PREVIEW_URL = "/qq_lora/preview";

const EXTERNAL_INPUTS = [
    { input: "启用开关", widget: "启用开关" },
    { input: "生效分组", widget: "生效分组" },
];

const CSS = `
.qq-lora{box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:5px;
  padding:6px;background:var(--comfy-menu-bg,#1e2128);color:var(--input-text,#e6e8ee);
  border-radius:6px;overflow:hidden;font:12px/1.35 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.qq-lora *{box-sizing:border-box}
.qq-lora-groups{display:flex;flex-wrap:wrap;align-items:center;gap:4px;flex:0 0 auto}
.qq-lora-chip{display:flex;align-items:center;gap:3px;height:22px;padding:0 7px;border-radius:12px;
  border:1px solid var(--border-color,#39404d);background:var(--comfy-input-bg,#12141a);
  color:inherit;font:inherit;cursor:pointer;max-width:132px}
.qq-lora-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qq-lora-chip:hover{border-color:#4f8cff}
.qq-lora-chip[data-on="1"]{border-color:#4f8cff;color:#8fb9d9;background:rgba(79,140,255,.14)}
/* 由「生效分组」下拉指定的组：描边提示，和面板当前组区分 */
.qq-lora-chip[data-eff="1"]{box-shadow:inset 0 0 0 1px rgba(143,185,217,.85)}
.qq-lora-chip .qq-lora-del{flex:0 0 auto;width:14px;height:14px;line-height:12px;padding:0;
  border:0;border-radius:7px;background:transparent;color:inherit;cursor:pointer;opacity:0;font-size:12px}
.qq-lora-chip:hover .qq-lora-del{opacity:.6}
.qq-lora-chip .qq-lora-del:hover{opacity:1;background:rgba(255,255,255,.12)}
.qq-lora-chip input{width:96px;height:18px;padding:0 4px;border-radius:6px;font:inherit;
  border:1px solid #4f8cff;background:var(--comfy-input-bg,#12141a);color:inherit}
.qq-lora-add{height:22px;padding:0 9px;border-radius:12px;border:1px dashed var(--border-color,#39404d);
  background:transparent;color:var(--descrip-text,#96a0b0);font:inherit;cursor:pointer}
.qq-lora-add:hover{border-color:#4f8cff;color:#8fb9d9}
.qq-lora-rows{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:4px;padding:2px 0}
.qq-lora-row{display:flex;align-items:center;gap:5px;height:${ROW_HEIGHT_PX - 4}px;flex:0 0 auto}
.qq-lora-row.is-dragging{opacity:.45}
.qq-lora-row.drop-before{box-shadow:0 -2px 0 0 #4f8cff}
.qq-lora-row.drop-after{box-shadow:0 2px 0 0 #4f8cff}
.qq-lora-on{flex:0 0 22px;width:22px;height:22px;padding:0;display:grid;place-items:center;
  border:1px solid var(--border-color,#39404d);border-radius:4px;
  background:var(--comfy-input-bg,#12141a);color:transparent;cursor:pointer}
.qq-lora-on svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2.8;
  stroke-linecap:round;stroke-linejoin:round}
.qq-lora-on:hover{border-color:#4f8cff}
.qq-lora-on[data-on="1"]{color:#8fb9d9;border-color:rgba(79,140,255,.65);background:rgba(79,140,255,.14)}
.qq-lora-row.is-off .qq-lora-on{color:transparent}
.qq-lora-row.is-off .qq-lora-combo-btn span{text-decoration:line-through;color:#8b95a5}
.qq-lora-row.is-off .qq-lora-combo,.qq-lora-row.is-off .qq-lora-stepper{opacity:.5}
.qq-lora-combo{position:relative;flex:1 1 auto;min-width:70px;display:flex}
.qq-lora-combo-btn{display:flex;align-items:center;gap:5px;width:100%;height:24px;padding:0 6px;
  border-radius:4px;border:1px solid var(--border-color,#39404d);
  background:var(--comfy-input-bg,#12141a);color:inherit;font:inherit;text-align:left;cursor:pointer}
.qq-lora-combo-btn:hover{border-color:#4f8cff}
.qq-lora-combo-btn span{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qq-lora-combo-btn.is-empty span{color:#7d8798}
.qq-lora-row.is-missing .qq-lora-combo-btn{border-color:#c95555;color:#ffb3b3}
.qq-lora-caret{flex:0 0 auto;width:6px;height:6px;margin-right:2px;opacity:.7;
  border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;
  transform:rotate(45deg) translate(-1px,-1px)}
.qq-lora-stepper{flex:0 0 auto;display:flex;align-items:center;height:22px;overflow:hidden;
  border:1px solid var(--border-color,#39404d);border-radius:4px;
  background:var(--comfy-input-bg,#12141a)}
.qq-lora-stepper:hover{border-color:#4f8cff}
.qq-lora-stepper:focus-within{border-color:#4f8cff;box-shadow:0 0 0 1px rgba(79,140,255,.35)}
.qq-lora-step{width:11px;height:20px;padding:0;border:0;border-radius:0;display:grid;place-items:center;
  background:transparent;color:var(--descrip-text,#96a0b0);cursor:pointer}
.qq-lora-step:hover{background:rgba(79,140,255,.18);color:#8fb9d9}
.qq-lora-strength{width:30px;height:20px;padding:0;font-size:11px;font-variant-numeric:tabular-nums;border:0;border-radius:0;text-align:center;
  background:transparent;color:inherit;font:inherit;appearance:textfield;-moz-appearance:textfield}
.qq-lora-strength:focus{outline:none}
.qq-lora-strength::-webkit-outer-spin-button,.qq-lora-strength::-webkit-inner-spin-button{
  -webkit-appearance:none;margin:0}
.qq-lora-del-row{flex:0 0 22px;width:22px;height:22px;padding:0;display:grid;place-items:center;
  border:1px solid var(--border-color,#39404d);border-radius:4px;
  background:var(--comfy-input-bg,#12141a);color:var(--descrip-text,#96a0b0);cursor:pointer}
.qq-lora-del-row svg{width:10px;height:10px;fill:none;stroke:currentColor;stroke-width:2.6;
  stroke-linecap:round}
.qq-lora-del-row:hover{border-color:#c95555;color:#ff8f8f;background:rgba(201,85,85,.14)}
.qq-lora-empty{flex:1 1 auto;display:flex;align-items:center;justify-content:center;text-align:center;
  color:var(--descrip-text,#96a0b0);line-height:1.7;padding:8px}
.qq-lora-foot{flex:0 0 auto;display:flex;align-items:center;gap:6px;color:var(--descrip-text,#96a0b0);
  font-size:11px;padding-top:2px}
.qq-lora-foot span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* LoRA 下拉：贴着按钮弹出的目录树 */
.qq-lora-pop{position:fixed;z-index:11000;display:flex;flex-direction:column;min-width:200px;
  border:1px solid var(--border-color,#4b545b);border-radius:6px;overflow:hidden;
  background:var(--comfy-menu-bg,#25292d);color:var(--input-text,#e6e8ee);
  box-shadow:0 14px 34px rgba(0,0,0,.55);
  font:12px/1.35 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.qq-lora-pop-tools{display:flex;gap:4px;align-items:center;margin:5px 5px 0}
.qq-lora-pop-search{flex:1 1 auto;min-width:0;height:26px;padding:0 7px;border-radius:4px;font:inherit;
  border:1px solid var(--border-color,#39404d);background:var(--comfy-input-bg,#12141a);color:inherit}
.qq-lora-pop-search:focus{outline:1px solid #4f8cff;outline-offset:-1px}
.qq-lora-pop-refresh{flex:0 0 auto;height:26px;padding:0 7px;border-radius:4px;font:inherit;cursor:pointer;
  border:1px solid var(--border-color,#39404d);background:var(--comfy-input-bg,#12141a);color:inherit}
.qq-lora-pop-refresh:hover{border-color:#4f8cff;color:#8fb9d9}
.qq-lora-pop-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:2px 0 4px}
.qq-lora-pop-item{display:block;width:100%;padding:4px 8px;border:0;background:transparent;
  color:inherit;font:inherit;text-align:left;cursor:pointer;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.qq-lora-pop-item:hover,.qq-lora-pop-item.is-active{background:rgba(79,140,255,.24)}
.qq-lora-pop-item.is-current{color:#8fb9d9}
.qq-lora-pop-item.is-dir{display:flex;align-items:center;gap:4px;color:#b8c2cf}
.qq-lora-pop-item.is-dir span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qq-lora-chevron{flex:0 0 8px;width:8px;height:8px;margin-right:2px;
  border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;
  transform:rotate(-45deg);transition:transform .12s ease;opacity:.75}
.qq-lora-chevron[data-open="1"]{transform:rotate(45deg)}
.qq-lora-pop-empty{padding:12px 8px;text-align:center;color:var(--descrip-text,#96a0b0)}
.qq-lora-pop-more{padding:4px 8px;color:var(--descrip-text,#96a0b0);font-size:11px}
/* 右键「移到分组」/ 分组菜单 */
.qq-lora-menu{position:fixed;z-index:11100;min-width:140px;max-height:260px;overflow-y:auto;padding:4px;
  border:1px solid var(--border-color,#4b545b);border-radius:6px;background:var(--comfy-menu-bg,#25292d);
  color:var(--input-text,#e6e8ee);box-shadow:0 12px 28px rgba(0,0,0,.55);
  font:12px/1.35 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.qq-lora-menu button{display:block;width:100%;padding:4px 8px;border:0;border-radius:4px;background:transparent;
  color:inherit;font:inherit;text-align:left;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qq-lora-menu button:hover{background:rgba(79,140,255,.24)}
.qq-lora-menu .qq-lora-menu-title{padding:2px 8px 4px;color:var(--descrip-text,#96a0b0);font-size:11px}
/* 缩略图预览 */
.qq-lora-preview{position:fixed;z-index:11200;padding:3px;border-radius:6px;
  border:1px solid var(--p-primary-color,#85a8c4);background:var(--comfy-menu-bg,#25292d);
  box-shadow:0 10px 28px rgba(0,0,0,.6);pointer-events:none}
.qq-lora-preview img{display:block;width:${PREVIEW_SIZE}px;height:auto;max-height:${PREVIEW_SIZE}px;
  object-fit:contain;border-radius:4px}
.qq-lora-preview span{display:block;max-width:${PREVIEW_SIZE}px;padding:2px 3px 0;font-size:10px;
  color:var(--descrip-text,#96a0b0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 停用时把可编辑区压暗，状态一眼可见 */
.qq-lora.is-off .qq-lora-groups,.qq-lora.is-off .qq-lora-rows{opacity:.5}
`;

function injectCSS() {
    if (document.getElementById("qq-lora-css")) return;
    const style = document.createElement("style");
    style.id = "qq-lora-css";
    style.textContent = CSS;
    document.head.append(style);
}

function widgetOf(node, name) {
    return node?.widgets?.find((entry) => entry?.name === name) || null;
}

function hideWidget(widget) {
    if (!widget || widget.__qqLoraHidden) return;
    widget.__qqLoraHidden = true;
    widget.hidden = true;
    widget.type = "hidden";
    widget.computeSize = () => [0, -4];
    widget.options ||= {};
    widget.options.hidden = true;
}

/* ---------------- 数据 ---------------- */

function emptyData() {
    return { version: 1, active: 0, groups: [], select: "" };
}

export function normaliseData(raw) {
    let value = raw;
    if (typeof raw === "string") {
        try {
            value = JSON.parse(raw || "{}");
        } catch {
            return emptyData();
        }
    }
    if (!value || typeof value !== "object") return emptyData();
    const groups = [];
    for (const entry of value.groups || []) {
        if (!entry || typeof entry !== "object") continue;
        const name = String(entry.name || "").trim().slice(0, 60) || `分组 ${groups.length + 1}`;
        const loras = [];
        for (const item of entry.loras || []) {
            if (!item || typeof item !== "object") continue;
            // 允许还没填名字的空行：面板要能显示它，后端执行时会跳过
            const loraName = String(item.name || "").trim();
            const strength = Number(item.strength);
            loras.push({
                name: loraName,
                strength: Number.isFinite(strength) ? Math.max(-100, Math.min(100, strength)) : 1,
                off: Boolean(item.off),
            });
        }
        groups.push({ name, loras });
    }
    let active = Number(value.active);
    if (!Number.isFinite(active) || active < 0 || active >= groups.length) active = 0;
    const select = String(value.select || "").trim().slice(0, 60);
    return { version: 1, active: groups.length ? Math.trunc(active) : 0, groups, select };
}

export function activeGroup(data) {
    if (!data?.groups?.length) return null;
    return data.groups[data.active] || data.groups[0];
}

/** 同名分组会互相覆盖选择，新增/改名时补一个序号。 */
export function uniqueGroupName(data, desired, ignoreIndex = -1) {
    const base = String(desired || "").trim().slice(0, 60) || "分组";
    const taken = new Set(
        (data?.groups || []).filter((_group, index) => index !== ignoreIndex).map((group) => group.name),
    );
    if (!taken.has(base)) return base;
    let index = 2;
    while (taken.has(`${base} ${index}`)) index += 1;
    return `${base} ${index}`;
}

/** 把一条 LoRA 移到另一个分组（不存在或就是本组时返回原数据）。 */
export function moveLoraToGroup(data, groupIndex, loraIndex, targetIndex) {
    const source = data?.groups?.[groupIndex];
    const target = data?.groups?.[targetIndex];
    if (!source || !target || source === target) return data;
    const [entry] = source.loras.splice(loraIndex, 1);
    if (!entry) return data;
    target.loras.push(entry);
    return data;
}

/** 拖动排序：把 from 位置的项插到 to 位置。 */
export function reorderLora(list, from, to) {
    if (!Array.isArray(list) || from === to) return list;
    if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
    const [entry] = list.splice(from, 1);
    list.splice(to, 0, entry);
    return list;
}

/** LoRA 文件不在本地列表里（被删/改名）。 */
export function isMissingLora(name, names) {
    if (!name || !names?.length) return false;
    return !names.includes(name);
}

export function loraPreviewUrl(name) {
    return `${LORA_PREVIEW_URL}?name=${encodeURIComponent(String(name || ""))}`;
}

function readData(node) {
    return normaliseData(widgetOf(node, DATA_WIDGET)?.value ?? "{}");
}

let changeTimer = null;

function writeData(node, data) {
    const widget = widgetOf(node, DATA_WIDGET);
    if (!widget) return;
    const value = JSON.stringify(data);
    if (widget.value === value) return;
    widget.value = value;
    widget.callback?.(value);
    node.graph?.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
    // 连续调强度时别每次都标脏整个工作流
    if (changeTimer) clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
        changeTimer = null;
        node.graph?.change?.();
    }, 150);
}

/* ---------------- 目录树 ---------------- */

/**
 * 把 LoRA 名单整理成目录树：目录可以展开/收起，文件是叶子。
 * 名单里 "/" 和 "\\" 两种分隔符都认。
 */
function buildLoraTree(names) {
    const root = { children: new Map(), order: [] };
    for (const name of names || []) {
        const parts = String(name || "").split(/[\\/]/).filter(Boolean);
        if (!parts.length) continue;
        let node = root;
        for (let index = 0; index < parts.length - 1; index += 1) {
            const segment = parts[index];
            if (!node.children.has(segment)) {
                node.children.set(segment, { children: new Map(), order: [] });
                node.order.push(segment);
            }
            node = node.children.get(segment);
        }
        const leaf = parts[parts.length - 1];
        if (node.children.has(leaf)) continue;
        node.children.set(leaf, { full: name });
        node.order.push(leaf);
    }
    return root;
}

function loraTreeHasMatch(node, needle) {
    for (const key of node.order) {
        const child = node.children.get(key);
        if (child.full !== undefined) {
            if (child.full.toLowerCase().includes(needle)) return true;
        } else if (loraTreeHasMatch(child, needle)) {
            return true;
        }
    }
    return false;
}

/**
 * 展开成一列可见行；目录行带 path 与展开状态，文件行带完整名字。
 * 搜索时只保留有匹配的分支，并自动展开。
 */
function loraTreeRows(tree, expanded, needle) {
    const text = String(needle || "").trim().toLowerCase();
    const rows = [];
    const visit = (node, depth, path) => {
        for (const key of node.order) {
            const child = node.children.get(key);
            const childPath = path ? `${path}/${key}` : key;
            if (child.full !== undefined) {
                if (!text || child.full.toLowerCase().includes(text)) {
                    rows.push({ kind: "file", name: key, full: child.full, depth, path: childPath });
                }
                continue;
            }
            if (text && !loraTreeHasMatch(child, text)) continue;
            const open = Boolean(text) || expanded.has(childPath);
            rows.push({ kind: "dir", name: key, depth, path: childPath, open });
            if (open) visit(child, depth + 1, childPath);
        }
    };
    visit(tree, 0, "");
    return rows;
}

/* ---------------- LoRA 列表 ---------------- */

let loraNamesPromise = null;
let loraNames = [];

function fetchLoraNames() {
    if (!loraNamesPromise) {
        loraNamesPromise = fetch("/object_info/LoraLoaderModelOnly")
            .then((response) => (response.ok ? response.json() : null))
            .then((info) => {
                const names = info?.LoraLoaderModelOnly?.input?.required?.lora_name?.[0];
                return Array.isArray(names) ? names : [];
            })
            .catch(() => []);
    }
    return loraNamesPromise;
}

/** 运行中新增的 LoRA 需要刷新才能看到。 */
function refreshLoraNames() {
    loraNamesPromise = null;
    loraNames = [];
    return fetchLoraNames().then((names) => {
        loraNames = names;
        return names;
    });
}

function ensureNames() {
    if (loraNames.length) return Promise.resolve(loraNames);
    return fetchLoraNames().then((names) => {
        loraNames = names;
        return names;
    });
}

/* ---------------- 外部控制 ---------------- */

/**
 * 读连线另一端（虚拟节点 / PrimitiveNode）当前的值。
 * 没接线、或接的是真节点时返回 null——那种情况不该动控件本身的值。
 */
function linkedValue(node, pair) {
    const input = node?.inputs?.find((entry) => entry?.name === pair.input);
    const link = input?.link != null ? node?.graph?.links?.[input.link] : null;
    if (!link) return null;
    const source = node?.graph?.getNodeById?.(link.origin_id);
    if (!source) return null;
    if (!source.isVirtualNode && source.type !== "PrimitiveNode") return null;
    const widget = source.type === "PrimitiveNode"
        ? source.widgets?.[0]
        : source.widgets?.find((entry) => entry?.__h3MultiPrimitiveSlot === link.origin_slot);
    if (!widget) return null;
    return widget.value ?? "";
}

/** 把连线上的值写进同名控件；虚拟节点的值只有这样才到得了后端。 */
export function syncExternalInputs(node) {
    let changed = false;
    for (const pair of EXTERNAL_INPUTS) {
        const target = widgetOf(node, pair.widget);
        if (!target) continue;
        const value = linkedValue(node, pair);
        if (value === null) continue;
        // 开关控件要布尔值，别的控件统一成字符串
        const next = target.type === "toggle" || target.type === "BOOLEAN"
            ? Boolean(value === true || value === "true" || value === 1 || value === "1")
            : String(value);
        if (target.value === next) continue;
        target.value = next;
        if (target._state) target._state.value = next;
        changed = true;
    }
    return changed;
}

/** 排队前把所有这类节点的外部值刷新一遍（含子图里的）。 */
function syncAllExternalInputs(graph, seen = new Set()) {
    if (!graph || seen.has(graph)) return;
    seen.add(graph);
    for (const node of graph._nodes || []) {
        if (node?.type === NODE_TYPE) syncExternalInputs(node);
        if (node?.subgraph) syncAllExternalInputs(node.subgraph, seen);
    }
}

let promptHookInstalled = false;

function installPromptHook() {
    if (promptHookInstalled || typeof app?.graphToPrompt !== "function") return;
    promptHookInstalled = true;
    const original = app.graphToPrompt.bind(app);
    app.graphToPrompt = async function wrappedGraphToPrompt(...args) {
        syncAllExternalInputs(app.canvas?.graph || app.graph);
        return original(...args);
    };
}

/** 「生效分组」下拉的选项跟着分组走；当前值失效时回到跟随面板。 */
function syncGroupChoices(node, data) {
    const widget = widgetOf(node, GROUP_WIDGET);
    if (!widget) return;
    const values = [FOLLOW_PANEL, ...data.groups.map((group) => group.name)];
    const current = String(widget.value ?? FOLLOW_PANEL);
    widget.options ||= {};
    widget.options.values = values;
    if (!values.includes(current)) {
        widget.value = FOLLOW_PANEL;
        if (widget._state) widget._state.value = FOLLOW_PANEL;
        widget.callback?.(FOLLOW_PANEL);
    }
}

/** 读档后用数据里保存的选择覆盖动态下拉可能被重置的值。 */
function restoreGroupChoice(node) {
    const widget = widgetOf(node, GROUP_WIDGET);
    if (!widget) return;
    const saved = String(readData(node).select || "");
    if (!saved || String(widget.value ?? "") === saved) return;
    widget.value = saved;
    if (widget._state) widget._state.value = saved;
}

function closeLoraPops(node) {
    for (const pop of node?.__qqLoraPops || []) pop.remove();
    if (node) node.__qqLoraPops = [];
    closeLoraMenu(node);
    hideLoraPreview(node);
}

function closeLoraMenu(node) {
    const menu = node?.__qqLoraMenu;
    if (!menu) return;
    menu.remove();
    node.__qqLoraMenu = null;
}

/* ---------------- 缩略图 ---------------- */

function hideLoraPreview(node) {
    if (node?.__qqLoraPreviewTimer) {
        clearTimeout(node.__qqLoraPreviewTimer);
        node.__qqLoraPreviewTimer = null;
    }
    const preview = node?.__qqLoraPreview;
    if (!preview) return;
    preview.remove();
    node.__qqLoraPreview = null;
}

function positionLoraPreview(preview, anchor) {
    const rect = anchor.getBoundingClientRect();
    const width = preview.offsetWidth || PREVIEW_SIZE + 8;
    const height = preview.offsetHeight || PREVIEW_SIZE;
    const margin = 8;
    let left = rect.right + margin;
    if (left + width > window.innerWidth - margin) left = Math.max(margin, rect.left - width - margin);
    let top = rect.top + rect.height / 2 - height / 2;
    top = Math.max(margin, Math.min(window.innerHeight - height - margin, top));
    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
}

/** 鼠标停在 LoRA 上时显示同名预览图（没有就不显示）。 */
function attachLoraPreview(node, anchor, name) {
    if (!anchor || !name) return;
    const show = () => {
        hideLoraPreview(node);
        node.__qqLoraPreviewTimer = setTimeout(() => {
            node.__qqLoraPreviewTimer = null;
            const preview = document.createElement("div");
            preview.className = "qq-lora-preview";
            const image = document.createElement("img");
            image.alt = "";
            image.loading = "eager";
            image.src = loraPreviewUrl(name);
            const caption = document.createElement("span");
            caption.textContent = String(name).split(/[\\/]/).pop();
            preview.append(image, caption);
            preview.hidden = true;
            image.addEventListener("load", () => {
                if (!preview.isConnected) return;
                preview.hidden = false;
                positionLoraPreview(preview, anchor);
            });
            image.addEventListener("error", () => {
                preview.remove();
                if (node.__qqLoraPreview === preview) node.__qqLoraPreview = null;
            });
            document.body.append(preview);
            node.__qqLoraPreview = preview;
        }, PREVIEW_DELAY);
    };
    anchor.addEventListener("pointerenter", show);
    anchor.addEventListener("pointerleave", () => hideLoraPreview(node));
    anchor.addEventListener("pointerdown", () => hideLoraPreview(node));
}

/* ---------------- 面板 ---------------- */

function setup(node) {
    if (!node || node.__qqLoraSetup) return;
    node.__qqLoraSetup = true;
    injectCSS();

    hideWidget(widgetOf(node, DATA_WIDGET));
    // 输入口 model 与输出口 模型 统一显示
    const modelInput = (node.inputs || []).find((input) => input?.name === "model");
    if (modelInput) {
        modelInput.label = "模型";
        modelInput.localized_name = "模型";
    }

    const root = document.createElement("div");
    root.className = "qq-lora";

    const groups = document.createElement("div");
    groups.className = "qq-lora-groups";

    const rows = document.createElement("div");
    rows.className = "qq-lora-rows";

    const foot = document.createElement("div");
    foot.className = "qq-lora-foot";
    const footText = document.createElement("span");
    foot.append(footText);

    root.append(groups, rows, foot);

    const gallery = node.addDOMWidget("qq_lora_groups", "qq_lora_groups", root, {
        serialize: false,
        hideOnZoom: false,
        margin: 6,
        getMinHeight: () => MIN_PANEL_HEIGHT,
    });
    if (gallery) {
        gallery.serialize = false;
        gallery.computeLayoutSize = () => ({
            minHeight: MIN_PANEL_HEIGHT,
            maxHeight: undefined,
            minWidth: MIN_PANEL_WIDTH,
        });
    }
    // 画布宽度只跟面板走：选完 LoRA 后内容再长也不能把最小宽度顶大
    const originalCompute = node.computeSize?.bind(node);
    node.computeSize = function qqLoraComputeSize(...args) {
        const computed = originalCompute?.(...args);
        const height = computed?.[1] ?? Math.max(MIN_PANEL_HEIGHT + 120, Number(this.size?.[1]) || 0);
        return [MIN_NODE_WIDTH, height];
    };
    const currentWidth = Number(node.size?.[0]) || 0;
    if (currentWidth !== MIN_NODE_WIDTH) {
        const height = Math.max(MIN_PANEL_HEIGHT + 120, Number(node.size?.[1]) || 0);
        node.setSize?.([MIN_NODE_WIDTH, height]);
    }

    // 第一次用：没有分组时给一个空的「默认」，面板不至于空着
    if (!readData(node).groups.length) {
        writeData(node, { version: 1, active: 0, groups: [{ name: "默认", loras: [] }], select: "" });
    }

    ensureNames().then(() => render());

    /* ---- 分组操作 ---- */

    function startRename(index) {
        const chip = groups.children[index];
        if (!chip) return;
        const data = readData(node);
        const group = data.groups[index];
        if (!group) return;
        const input = document.createElement("input");
        input.type = "text";
        input.value = group.name;
        input.maxLength = 60;
        chip.replaceChildren(input);
        input.focus();
        input.select();
        let done = false;
        const finish = (commit) => {
            if (done) return;
            done = true;
            if (commit) {
                const next = readData(node);
                if (next.groups[index]) {
                    const wanted = input.value.trim().slice(0, 60) || `分组 ${index + 1}`;
                    const name = uniqueGroupName(next, wanted, index);
                    const old = next.groups[index].name;
                    next.groups[index].name = name;
                    // 下拉选的是这一组时跟着改名
                    if (next.select === old) next.select = name;
                    writeData(node, next);
                    const widget = widgetOf(node, GROUP_WIDGET);
                    if (widget && widget.value === old) {
                        widget.value = name;
                        if (widget._state) widget._state.value = name;
                    }
                }
            }
            render();
        };
        input.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.key === "Enter") finish(true);
            else if (event.key === "Escape") finish(false);
        });
        input.addEventListener("blur", () => finish(true));
    }

    function toast(text) {
        const manager = app?.extensionManager;
        if (manager?.toast?.add) {
            manager.toast.add({ severity: "info", summary: text, life: 2000 });
            return;
        }
        console.info("[QQ-Lora分组加载]", text);
    }

    /* ---- 面板渲染 ---- */

    function render() {
        closeLoraPops(node);
        const data = readData(node);
        const enabled = Boolean(widgetOf(node, ENABLE_WIDGET)?.value ?? true);
        syncGroupChoices(node, data);
        root.classList.toggle("is-off", !enabled);

        // 分组条
        groups.replaceChildren();
        const chosenNow = String(widgetOf(node, GROUP_WIDGET)?.value ?? FOLLOW_PANEL);
        data.groups.forEach((group, index) => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "qq-lora-chip";
            chip.dataset.on = index === data.active ? "1" : "0";
            chip.dataset.eff = chosenNow !== FOLLOW_PANEL && chosenNow === group.name ? "1" : "0";
            chip.title = `${group.name}（${group.loras.length} 个 Lora）\n单击切换生效分组，双击改名，右键复制`;
            const label = document.createElement("span");
            label.textContent = group.name;
            chip.append(label);

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "qq-lora-del";
            remove.textContent = "×";
            remove.title = `删除分组「${group.name}」`;
            remove.disabled = data.groups.length <= 1;
            remove.addEventListener("click", (event) => {
                event.stopPropagation();
                if (data.groups.length <= 1) {
                    toast("至少保留一个分组");
                    return;
                }
                const ok = !group.loras.length
                    || confirm(`删除分组「${group.name}」？里面的 ${group.loras.length} 个 Lora 会一起移除。`);
                if (!ok) return;
                const next = readData(node);
                next.groups.splice(index, 1);
                if (next.active >= next.groups.length) next.active = next.groups.length - 1;
                if (next.select === group.name) next.select = FOLLOW_PANEL;
                writeData(node, next);
                render();
            });
            chip.append(remove);

            chip.addEventListener("click", () => {
                if (data.active === index) return;
                const next = readData(node);
                next.active = index;
                // 让画布上的「生效分组」和点亮的芯片保持一致
                next.select = group.name;
                writeData(node, next);
                const widget = widgetOf(node, GROUP_WIDGET);
                if (widget) {
                    widget.value = group.name;
                    if (widget._state) widget._state.value = group.name;
                }
                render();
            });
            chip.addEventListener("dblclick", (event) => {
                event.preventDefault();
                startRename(index);
            });
            chip.addEventListener("contextmenu", (event) => {
                event.preventDefault();
                openGroupMenu(event, index);
            });
            groups.append(chip);
        });

        const add = document.createElement("button");
        add.type = "button";
        add.className = "qq-lora-add";
        add.textContent = "+ 分组";
        add.title = "新增一个分组并立即改名";
        add.addEventListener("click", () => {
            const next = readData(node);
            const name = uniqueGroupName(next, `分组 ${next.groups.length + 1}`);
            next.groups.push({ name, loras: [] });
            next.active = next.groups.length - 1;
            writeData(node, next);
            render();
            startRename(next.active);
        });
        groups.append(add);

        // 当前分组的 Lora 列表
        rows.replaceChildren();
        const group = activeGroup(data);
        if (!group || !group.loras.length) {
            const empty = document.createElement("div");
            empty.className = "qq-lora-empty";
            empty.innerHTML = data.groups.length
                ? "这一组还没有 Lora。<br>点下面的「+ 添加 Lora」开始挑。"
                : "还没有分组，先点「+ 分组」建一个。";
            rows.append(empty);
        } else {
            group.loras.forEach((lora, index) => rows.append(loraRow(group, index, lora)));
        }

        const addRow = document.createElement("div");
        addRow.className = "qq-lora-row";
        const addLora = document.createElement("button");
        addLora.type = "button";
        addLora.className = "qq-lora-add";
        addLora.textContent = "+ 添加 Lora";
        addLora.disabled = !data.groups.length;
        addLora.addEventListener("click", () => {
            const next = readData(node);
            const target = activeGroup(next);
            if (!target) return;
            target.loras.push({ name: "", strength: 1, off: false });
            writeData(node, next);
            render();
            const buttons = rows.querySelectorAll(".qq-lora-row .qq-lora-combo-btn");
            buttons[buttons.length - 1]?.click();
        });
        addRow.append(addLora);
        rows.append(addRow);

        // 底部说明
        const chosen = String(widgetOf(node, GROUP_WIDGET)?.value ?? FOLLOW_PANEL);
        const effective = !enabled
            ? null
            : (chosen === FOLLOW_PANEL
                ? group
                : data.groups.find((entry) => entry.name === chosen) || group);
        if (effective) {
            const activeCount = effective.loras.filter((entry) => entry.name && !entry.off).length;
            footText.textContent = enabled
                ? (activeCount
                    ? `当前生效：${effective.name} · ${activeCount} 个 Lora（按顺序叠加）`
                    : `当前生效：${effective.name} · 这一组为空，不会改变模型`)
                : `已停用：模型原样透传（当前分组 ${effective.name}）`;
        } else {
            footText.textContent = enabled ? "没有分组，模型原样透传" : "已停用";
        }
        footText.title = footText.textContent;
    }

    function loraRow(group, index, lora) {
        const missing = isMissingLora(lora.name, loraNames);
        const row = document.createElement("div");
        row.className = "qq-lora-row";
        row.draggable = true;
        row.dataset.index = String(index);
        row.title = `第 ${index + 1} 个叠加（拖动行可调整顺序）`;
        if (lora.off) row.classList.add("is-off");
        if (missing) {
            row.classList.add("is-missing");
            row.title = `找不到 ${lora.name}，运行时会跳过`;
        }

        // 勾选框：这条 LoRA 本次是否参与叠加（取消勾选=临时停用，配置保留）
        const enabledBox = document.createElement("button");
        enabledBox.type = "button";
        enabledBox.className = "qq-lora-on";
        enabledBox.dataset.on = lora.off ? "0" : "1";
        enabledBox.setAttribute("role", "checkbox");
        enabledBox.setAttribute("aria-checked", String(!lora.off));
        enabledBox.title = lora.off
            ? "已停用：这次不叠加（点一下恢复）"
            : "勾选=参与本次叠加；点一下可临时停用，保留配置";
        enabledBox.setAttribute("aria-label", `${lora.name || "这条 Lora"} 是否参与叠加`);
        enabledBox.innerHTML =
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5 11-12"/></svg>';
        enabledBox.addEventListener("click", (event) => {
            event.stopPropagation();
            const next = readData(node);
            const target = activeGroup(next);
            if (!target?.loras[index]) return;
            target.loras[index].off = !target.loras[index].off;
            writeData(node, next);
            render();
        });

        // 名字：点开目录树
        const combo = document.createElement("div");
        combo.className = "qq-lora-combo";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "qq-lora-combo-btn";
        if (!lora.name) button.classList.add("is-empty");
        const label = document.createElement("span");
        label.textContent = lora.name || "选择 LoRA";
        label.title = lora.name || "选择 LoRA";
        const caret = document.createElement("i");
        caret.className = "qq-lora-caret";
        button.append(label, caret);
        combo.append(button);
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            openLoraCombo(index, button, label, lora);
        });
        attachLoraPreview(node, button, lora.name);

        // 强度
        const stepper = document.createElement("div");
        stepper.className = "qq-lora-stepper";
        const strength = document.createElement("input");
        strength.className = "qq-lora-strength";
        strength.type = "number";
        strength.step = String(STRENGTH_STEP);
        strength.min = "-100";
        strength.max = "100";
        strength.value = String(round2(lora.strength));
        strength.title = "强度（可直接输入，或用两侧箭头微调；双击归 1）";
        const commitStrength = (value) => {
            let number = Number(value);
            if (!Number.isFinite(number)) number = 1;
            number = Math.max(-100, Math.min(100, number));
            const next = readData(node);
            const target = activeGroup(next);
            if (!target?.loras[index]) return;
            target.loras[index].strength = round2(number);
            writeData(node, next);
            strength.value = String(round2(number));
        };
        strength.addEventListener("change", () => commitStrength(strength.value));
        strength.addEventListener("dblclick", () => commitStrength(1));
        strength.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.key === "Enter") commitStrength(strength.value);
        });
        const nudge = (delta) => {
            commitStrength(round2((Number(strength.value) || 0) + delta));
        };
        const decrease = stepButton(-1, (event) => nudge(event?.shiftKey ? -STRENGTH_STEP_BIG : -STRENGTH_STEP));
        const increase = stepButton(1, (event) => nudge(event?.shiftKey ? STRENGTH_STEP_BIG : STRENGTH_STEP));
        stepper.append(decrease, strength, increase);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "qq-lora-del-row";
        remove.innerHTML =
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>';
        remove.title = "移除这个 Lora";
        remove.addEventListener("click", (event) => {
            event.stopPropagation();
            const next = readData(node);
            const target = activeGroup(next);
            if (!target) return;
            target.loras.splice(index, 1);
            writeData(node, next);
            render();
        });

        row.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            openRowMenu(event, index, lora);
        });

        // 拖动排序
        row.addEventListener("dragstart", (event) => {
            row.classList.add("is-dragging");
            event.dataTransfer?.setData("text/plain", String(index));
            if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        });
        row.addEventListener("dragend", () => {
            row.classList.remove("is-dragging");
            for (const other of rows.querySelectorAll(".qq-lora-row")) {
                other.classList.remove("drop-before", "drop-after");
            }
        });
        row.addEventListener("dragover", (event) => {
            event.preventDefault();
            const rect = row.getBoundingClientRect();
            const after = event.clientY > rect.top + rect.height / 2;
            row.classList.toggle("drop-after", after);
            row.classList.toggle("drop-before", !after);
        });
        row.addEventListener("dragleave", () => {
            row.classList.remove("drop-before", "drop-after");
        });
        row.addEventListener("drop", (event) => {
            event.preventDefault();
            const from = Number(event.dataTransfer?.getData("text/plain"));
            if (!Number.isInteger(from)) return;
            const rect = row.getBoundingClientRect();
            const after = event.clientY > rect.top + rect.height / 2;
            let to = index + (after ? 1 : 0);
            if (from < to) to -= 1;
            const next = readData(node);
            const target = activeGroup(next);
            if (!target) return;
            reorderLora(target.loras, from, to);
            writeData(node, next);
            render();
        });

        row.append(enabledBox, combo, stepper, remove);
        return row;
    }

    function stepButton(direction, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "qq-lora-step";
        button.title = direction < 0 ? `减 ${STRENGTH_STEP}（Shift 大步）` : `加 ${STRENGTH_STEP}（Shift 大步）`;
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("width", "9");
        svg.setAttribute("height", "9");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "2.6");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", direction < 0 ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7");
        svg.append(path);
        button.append(svg);
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            onClick(event);
        });
        return button;
    }

    /* ---- 右键菜单：换组 / 分组操作 ---- */

    function placeMenu(menu, event) {
        document.body.append(menu);
        const rect = menu.getBoundingClientRect();
        menu.style.left = `${Math.min(event.clientX, window.innerWidth - rect.width - 6)}px`;
        menu.style.top = `${Math.min(event.clientY, window.innerHeight - rect.height - 6)}px`;
        node.__qqLoraMenu = menu;
        const off = (ev) => {
            if (!menu.contains(ev.target)) {
                closeLoraMenu(node);
                document.removeEventListener("pointerdown", off, true);
            }
        };
        document.addEventListener("pointerdown", off, true);
    }

    function openRowMenu(event, index, lora) {
        closeLoraMenu(node);
        const data = readData(node);
        if (data.groups.length <= 1) {
            toast("只有一个分组，先加一个再移动");
            return;
        }
        const menu = document.createElement("div");
        menu.className = "qq-lora-menu";
        const title = document.createElement("div");
        title.className = "qq-lora-menu-title";
        title.textContent = `「${lora.name || "未命名"}」移到：`;
        menu.append(title);
        data.groups.forEach((target, targetIndex) => {
            if (targetIndex === data.active) return;
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = target.name;
            button.addEventListener("click", () => {
                closeLoraMenu(node);
                const next = readData(node);
                moveLoraToGroup(next, data.active, index, targetIndex);
                writeData(node, next);
                render();
            });
            menu.append(button);
        });
        placeMenu(menu, event);
    }

    function openGroupMenu(event, index) {
        closeLoraMenu(node);
        const data = readData(node);
        const group = data.groups[index];
        if (!group) return;
        const menu = document.createElement("div");
        menu.className = "qq-lora-menu";
        const title = document.createElement("div");
        title.className = "qq-lora-menu-title";
        title.textContent = group.name;
        menu.append(title);
        const copy = document.createElement("button");
        copy.type = "button";
        copy.textContent = "复制这一组";
        copy.addEventListener("click", () => {
            closeLoraMenu(node);
            const next = readData(node);
            const name = uniqueGroupName(next, `${group.name} 副本`);
            next.groups.push({
                name,
                loras: next.groups[index].loras.map((entry) => ({ ...entry })),
            });
            next.active = next.groups.length - 1;
            writeData(node, next);
            render();
        });
        menu.append(copy);
        placeMenu(menu, event);
    }

    /* ---- 目录树下拉 ---- */

    function openLoraCombo(index, button, label, lora) {
        closeLoraPops(node);
        const pop = document.createElement("div");
        pop.className = "qq-lora-pop";
        const tools = document.createElement("div");
        tools.className = "qq-lora-pop-tools";
        const search = document.createElement("input");
        search.className = "qq-lora-pop-search";
        search.type = "search";
        search.placeholder = "搜索 LoRA";
        const refresh = document.createElement("button");
        refresh.type = "button";
        refresh.className = "qq-lora-pop-refresh";
        refresh.textContent = "刷新";
        refresh.title = "重新读取 loras 目录";
        tools.append(search, refresh);
        const list = document.createElement("div");
        list.className = "qq-lora-pop-list";
        pop.append(tools, list);

        const close = () => {
            document.removeEventListener("pointerdown", onOutside, true);
            window.removeEventListener("resize", close);
            pop.remove();
            node.__qqLoraPops = (node.__qqLoraPops || []).filter((item) => item !== pop);
            hideLoraPreview(node);
            // 没选到名字的空行直接收掉
            if (!String(lora.name || "").trim()) {
                const next = readData(node);
                const target = activeGroup(next);
                const row = target?.loras[index];
                if (row && !row.name) {
                    target.loras.splice(index, 1);
                    writeData(node, next);
                    render();
                }
            }
        };
        const onOutside = (event) => {
            if (!pop.contains(event.target) && !button.contains(event.target)) close();
        };

        const commit = (value) => {
            const next = readData(node);
            const target = activeGroup(next);
            if (!target?.loras[index]) {
                close();
                return;
            }
            target.loras[index].name = String(value || "").trim();
            writeData(node, next);
            label.textContent = target.loras[index].name || "选择 LoRA";
            label.title = label.textContent;
            button.classList.toggle("is-empty", !target.loras[index].name);
            close();
            render();
        };

        let active = -1;
        let tree = buildLoraTree(loraNames);
        const expanded = new Set();

        const paint = () => {
            const treeRows = loraTreeRows(tree, expanded, search.value);
            list.replaceChildren();
            active = -1;
            if (!treeRows.length) {
                const empty = document.createElement("div");
                empty.className = "qq-lora-pop-empty";
                empty.textContent = loraNames.length
                    ? "没有匹配的 LoRA"
                    : "读不到 LoRA 列表，点「刷新」重试";
                list.append(empty);
                return;
            }
            const shown = treeRows.slice(0, MAX_POPUP_ROWS);
            for (const row of shown) {
                const item = document.createElement("button");
                item.type = "button";
                item.className = row.kind === "dir" ? "qq-lora-pop-item is-dir" : "qq-lora-pop-item is-file";
                item.style.paddingLeft = `${6 + row.depth * 14}px`;
                if (row.kind === "dir") {
                    const chevron = document.createElement("i");
                    chevron.className = "qq-lora-chevron";
                    chevron.dataset.open = row.open ? "1" : "0";
                    const text = document.createElement("span");
                    text.textContent = row.name;
                    item.append(chevron, text);
                    item.title = row.name;
                    item.addEventListener("click", () => {
                        if (expanded.has(row.path)) expanded.delete(row.path);
                        else expanded.add(row.path);
                        paint();
                    });
                } else {
                    if (row.full === lora.name) item.classList.add("is-current");
                    item.textContent = row.name;
                    item.title = row.full;
                    item.dataset.name = row.full;
                    item.addEventListener("click", () => commit(row.full));
                    attachLoraPreview(node, item, row.full);
                }
                list.append(item);
            }
            if (treeRows.length > shown.length) {
                const more = document.createElement("div");
                more.className = "qq-lora-pop-more";
                more.textContent = `还有 ${treeRows.length - shown.length} 条，输入关键字继续筛选`;
                list.append(more);
            }

            const items = [...list.querySelectorAll(".qq-lora-pop-item")];
            const current = list.querySelector(".qq-lora-pop-item.is-current");
            const fallback = search.value.trim() ? items.find((item) => item.dataset.name) : null;
            const highlight = current || fallback;
            if (highlight) {
                highlight.classList.add("is-active");
                active = items.indexOf(highlight);
                highlight.scrollIntoView({ block: "nearest" });
            }
        };

        const move = (delta) => {
            const items = [...list.querySelectorAll(".qq-lora-pop-item")];
            if (!items.length) return;
            active = (active + delta + items.length) % items.length;
            items.forEach((item, index) => item.classList.toggle("is-active", index === active));
            items[active]?.scrollIntoView({ block: "nearest" });
        };

        const pickActive = () => {
            const items = [...list.querySelectorAll(".qq-lora-pop-item")];
            if (!items.length) return;
            const target = items[active] || items.find((item) => item.dataset.name) || items[0];
            if (target.dataset.name) commit(target.dataset.name);
            else target.click();
        };

        refresh.addEventListener("click", async () => {
            refresh.disabled = true;
            refresh.textContent = "…";
            await refreshLoraNames();
            tree = buildLoraTree(loraNames);
            refresh.disabled = false;
            refresh.textContent = "刷新";
            paint();
        });

        pop.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            close();
        });
        search.addEventListener("input", paint);
        search.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.key === "ArrowDown") {
                event.preventDefault();
                move(1);
            } else if (event.key === "ArrowUp") {
                event.preventDefault();
                move(-1);
            } else if (event.key === "Enter") {
                event.preventDefault();
                const typed = search.value.trim();
                const items = [...list.querySelectorAll(".qq-lora-pop-item")];
                const exact = typed
                    ? items.find((item) => item.dataset.name === typed || item.textContent === typed)
                    : null;
                if (exact) commit(exact.dataset.name || typed);
                else if (items.length) pickActive();
                else if (typed) commit(typed);
            } else if (event.key === "Escape") {
                close();
            }
        });

        document.body.append(pop);
        node.__qqLoraPops = node.__qqLoraPops || [];
        node.__qqLoraPops.push(pop);
        positionPop(pop, button);
        paint();
        search.focus();
        document.addEventListener("pointerdown", onOutside, true);
        window.addEventListener("resize", close);

        ensureNames().then(() => {
            if (!pop.isConnected) return;
            tree = buildLoraTree(loraNames);
            paint();
        });
    }

    function positionPop(pop, button) {
        const rect = button.getBoundingClientRect();
        const width = Math.max(rect.width, MIN_POP_WIDTH);
        pop.style.width = `${width}px`;
        pop.style.left = `${Math.max(6, Math.min(window.innerWidth - width - 6, rect.left))}px`;
        const roomBelow = window.innerHeight - rect.bottom - 10;
        const height = Math.min(MAX_POP_HEIGHT, Math.max(140, roomBelow));
        pop.style.maxHeight = `${height}px`;
        if (roomBelow >= 150) {
            pop.style.top = `${rect.bottom + 2}px`;
        } else {
            pop.style.top = `${Math.max(6, rect.top - height - 2)}px`;
        }
    }

    /* ---- 外部控件联动 ---- */

    function hookGroupWidget() {
        const widget = widgetOf(node, GROUP_WIDGET);
        if (!widget || widget.__qqLoraHooked) return;
        widget.__qqLoraHooked = true;
        const original = widget.callback;
        widget.callback = function qqLoraGroupCallback(...args) {
            const result = original?.apply(this, args);
            const value = String(this.value ?? "");
            const data = readData(node);
            if (String(data.select || "") !== value) {
                data.select = value;
                // 下拉换组时把面板也切到同一组，两边一致
                const at = data.groups.findIndex((group) => group.name === value);
                if (at >= 0) data.active = at;
                writeData(node, data);
            }
            render();
            return result;
        };
    }

    syncExternalInputs(node);
    hookGroupWidget();
    installPromptHook();

    node.__qqLoraRender = render;
    render();

    // 连线变化时刷新外部值
    const originalConnectionsChange = node.onConnectionsChange;
    node.onConnectionsChange = function onConnectionsChangeLoraGroup(...args) {
        const result = originalConnectionsChange?.apply(this, args);
        syncExternalInputs(this);
        render();
        return result;
    };
}

function round2(value) {
    return Math.round(Number(value) * 100) / 100;
}

app.registerExtension({
    name: "QQ.LoraGroupLoader",
    setup() {
        installPromptHook();
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_TYPE) return;

        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function onNodeCreatedLoraGroup() {
            const result = originalCreated?.apply(this, arguments);
            setup(this);
            return result;
        };

        const originalConfigured = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function onConfigureLoraGroup() {
            const result = originalConfigured?.apply(this, arguments);
            setup(this);
            restoreGroupChoice(this);
            this.__qqLoraRender?.();
            return result;
        };
    },
});
