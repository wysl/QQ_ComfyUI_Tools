import { app } from "../../scripts/app.js";

// QQ-Lora分组加载（仅模型）的面板。
//
// 数据都放在节点的隐藏控件里（工作流随存随读）：
//   启用      BOOLEAN  面板右上角的开关
//   分组数据  STRING   {"version":1,"active":0,"groups":[{"name":"…","loras":[…]}]}
//
// 面板结构：标题栏（开关）→ 分组条（点击切换 / 双击改名 / ×删除 / +新增）
// → 当前分组的 LoRA 列表（名称 + 强度 + 删除）→ 底部说明。

const NODE_TYPE = "QQLoraGroupLoader";
const DATA_WIDGET = "分组数据";
const ENABLE_WIDGET = "启用开关";
const GROUP_WIDGET = "生效分组";
const FOLLOW_PANEL = "跟随面板";

const ROW_H = 30;
// 外部控制用的两个控件（多值输入会往同名控件里写值；接线时再镜像一次）
const EXTERNAL_INPUTS = [
    { input: "启用开关", widget: "启用开关" },
    { input: "生效分组", widget: "生效分组" },
];
const MIN_PANEL_HEIGHT = 200;
const MIN_PANEL_WIDTH = 258;
const STRENGTH_STEP = 0.05;
const MIN_POP_WIDTH = 220;
const MAX_POP_HEIGHT = 280;

const CSS = `
.qq-lora{box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:5px;
  padding:6px;background:var(--comfy-menu-bg,#1e2128);color:var(--input-text,#e6e8ee);
  border-radius:6px;overflow:hidden;font:12px/1.35 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.qq-lora *{box-sizing:border-box}
.qq-lora-head{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.qq-lora-title{font-weight:600}
.qq-lora-hint{flex:1 1 auto;min-width:0;color:var(--descrip-text,#96a0b0);font-size:11px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
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
  border:0;border-radius:7px;background:transparent;color:inherit;cursor:pointer;opacity:0;
  font-size:12px}
.qq-lora-chip:hover .qq-lora-del{opacity:.6}
.qq-lora-chip .qq-lora-del:hover{opacity:1;background:rgba(255,255,255,.12)}
.qq-lora-chip input{width:110px;height:18px;padding:0 4px;border-radius:6px;font:inherit;
  border:1px solid #4f8cff;background:var(--comfy-input-bg,#12141a);color:inherit}
.qq-lora-add{height:24px;padding:0 9px;border-radius:12px;border:1px dashed var(--border-color,#39404d);
  background:transparent;color:var(--descrip-text,#96a0b0);font:inherit;cursor:pointer}
.qq-lora-add:hover{border-color:#4f8cff;color:#8fb9d9}
.qq-lora-rows{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:4px;
  padding:2px 0}
.qq-lora-row{display:flex;align-items:center;gap:6px;height:${ROW_H - 4}px;flex:0 0 auto}
.qq-lora-index{flex:0 0 14px;text-align:right;color:var(--descrip-text,#96a0b0);font-size:10px}
.qq-lora-combo{position:relative;flex:1 1 auto;min-width:70px;display:flex}
.qq-lora-combo-btn{display:flex;align-items:center;gap:5px;width:100%;height:24px;padding:0 6px;
  border-radius:4px;border:1px solid var(--border-color,#39404d);
  background:var(--comfy-input-bg,#12141a);color:inherit;font:inherit;text-align:left;cursor:pointer}
.qq-lora-combo-btn:hover{border-color:#4f8cff}
.qq-lora-combo-btn span{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qq-lora-combo-btn.is-empty span{color:#7d8798}
.qq-lora-caret{flex:0 0 auto;width:6px;height:6px;margin-right:2px;opacity:.7;
  border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;
  transform:rotate(45deg) translate(-1px,-1px)}
.qq-lora-stepper{flex:0 0 auto;display:flex;align-items:center;gap:2px}
.qq-lora-step{width:14px;height:22px;padding:0;border-radius:3px;display:grid;place-items:center;
  border:1px solid var(--border-color,#39404d);background:var(--comfy-input-bg,#12141a);
  color:var(--descrip-text,#96a0b0);cursor:pointer}
.qq-lora-step:hover{border-color:#4f8cff;color:#8fb9d9}
.qq-lora-strength{width:38px;height:22px;padding:0 2px;border-radius:4px;text-align:center;
  border:1px solid var(--border-color,#39404d);background:var(--comfy-input-bg,#12141a);
  color:inherit;font:inherit;appearance:textfield;-moz-appearance:textfield}
.qq-lora-strength::-webkit-outer-spin-button,.qq-lora-strength::-webkit-inner-spin-button{
  -webkit-appearance:none;margin:0}
/* LoRA 下拉：贴着按钮弹出的搜索面板 */
.qq-lora-pop{position:fixed;z-index:11000;display:flex;flex-direction:column;min-width:200px;
  border:1px solid var(--border-color,#4b545b);border-radius:6px;overflow:hidden;
  background:var(--comfy-menu-bg,#25292d);color:var(--input-text,#e6e8ee);
  box-shadow:0 14px 34px rgba(0,0,0,.55);
  font:12px/1.35 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.qq-lora-pop-search{height:26px;margin:5px;padding:0 7px;border-radius:4px;font:inherit;
  border:1px solid var(--border-color,#39404d);background:var(--comfy-input-bg,#12141a);color:inherit}
.qq-lora-pop-search:focus{outline:1px solid #4f8cff;outline-offset:-1px}
.qq-lora-pop-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:0 0 4px}
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
.qq-lora-del-row{flex:0 0 auto;width:20px;height:20px;padding:0;border-radius:4px;border:0;
  background:transparent;color:var(--descrip-text,#96a0b0);cursor:pointer;font-size:14px;line-height:1}
.qq-lora-del-row:hover{background:rgba(255,255,255,.1);color:#ff8f8f}
.qq-lora-empty{flex:1 1 auto;display:flex;align-items:center;justify-content:center;text-align:center;
  color:var(--descrip-text,#96a0b0);line-height:1.7;padding:10px}
.qq-lora-foot{flex:0 0 auto;display:flex;align-items:center;gap:6px;color:var(--descrip-text,#96a0b0);
  font-size:11px;padding-top:2px}
.qq-lora-foot span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 停用时把可编辑区压暗，状态一眼可见 */
.qq-lora.is-off .qq-lora-groups,.qq-lora.is-off .qq-lora-rows{opacity:.5}
.qq-lora.is-off .qq-lora-title{color:var(--descrip-text,#96a0b0)}
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

function readData(node) {
    return normaliseData(widgetOf(node, DATA_WIDGET)?.value ?? "{}");
}

function writeData(node, data) {
    const widget = widgetOf(node, DATA_WIDGET);
    if (!widget) return;
    const value = JSON.stringify(data);
    if (widget.value === value) return;
    widget.value = value;
    widget.callback?.(value);
    node.graph?.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
}

/* ---------------- Lora 名称列表 ---------------- */

let loraNamesPromise = null;

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

/* ---------------- 面板 ---------------- */

function isExternallyControlled(node, inputName) {
    return Boolean(node?.inputs?.find((input) => input?.name === inputName)?.link);
}

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
}

function setup(node) {
    if (!node || node.__qqLoraSetup) return;
    node.__qqLoraSetup = true;
    injectCSS();

    hideWidget(widgetOf(node, DATA_WIDGET));

    if (!readData(node).groups.length) {
        writeData(node, { version: 1, active: 0, groups: [{ name: "默认", loras: [] }] });
    }

    const root = document.createElement("div");
    root.className = "qq-lora";

    const head = document.createElement("div");
    head.className = "qq-lora-head";
    const title = document.createElement("span");
    title.className = "qq-lora-title";
    title.textContent = "Lora 分组";
    const hint = document.createElement("span");
    hint.className = "qq-lora-hint";
    head.append(title, hint);

    const groups = document.createElement("div");
    groups.className = "qq-lora-groups";

    const rows = document.createElement("div");
    rows.className = "qq-lora-rows";

    const foot = document.createElement("div");
    foot.className = "qq-lora-foot";
    const footText = document.createElement("span");
    foot.append(footText);

    root.append(head, groups, rows, foot);

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
    const currentWidth = Number(node.size?.[0]) || 0;
    if (currentWidth < MIN_PANEL_WIDTH) {
        const width = MIN_PANEL_WIDTH;
        const height = Math.max(MIN_PANEL_HEIGHT + 120, Number(node.size?.[1]) || 0);
        node.setSize?.([width, height]);
    }

    let names = [];
    const ensureNames = () => {
        if (names.length) return Promise.resolve(names);
        return fetchLoraNames().then((fetched) => {
            names = fetched;
            return names;
        });
    };
    ensureNames().then(() => render());

    function render() {
        closeLoraPops(node);
        const data = readData(node);
        const enabled = Boolean(widgetOf(node, ENABLE_WIDGET)?.value ?? true);
        syncGroupChoices(node, data);
        root.classList.toggle("is-off", !enabled);

        const linked = EXTERNAL_INPUTS.filter((pair) => isExternallyControlled(node, pair.input));
        const chosen = String(widgetOf(node, GROUP_WIDGET)?.value ?? FOLLOW_PANEL) || FOLLOW_PANEL;
        hint.textContent = linked.length
            ? `外部控制：${linked.map((pair) => pair.input).join("、")}（生效分组=${chosen}）`
            : `${enabled ? "" : "已停用 · "}共 ${data.groups.length} 组`;
        hint.title = hint.textContent;

        // 分组条
        groups.replaceChildren();
        const chosenNow = String(widgetOf(node, GROUP_WIDGET)?.value ?? FOLLOW_PANEL);
        data.groups.forEach((group, index) => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "qq-lora-chip";
            chip.dataset.on = index === data.active ? "1" : "0";
            chip.dataset.eff = chosenNow !== FOLLOW_PANEL && chosenNow === group.name ? "1" : "0";
            chip.title = `${group.name}（${group.loras.length} 个 Lora）\n单击切换生效分组，双击改名`;
            const label = document.createElement("span");
            label.textContent = group.name;
            chip.append(label);

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "qq-lora-del";
            remove.textContent = "×";
            remove.title = `删除分组「${group.name}」`;
            if (data.groups.length <= 1) remove.disabled = true;
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
                writeData(node, next);
                render();
            });
            chip.append(remove);

            chip.addEventListener("click", () => {
                if (data.active === index) return;
                const next = readData(node);
                next.active = index;
                writeData(node, next);
                render();
            });
            chip.addEventListener("dblclick", (event) => {
                event.preventDefault();
                startRename(index);
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
            next.groups.push({ name: `分组 ${next.groups.length + 1}`, loras: [] });
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
            target.loras.push({ name: "", strength: 1 });
            writeData(node, next);
            render();
            const last = rows.querySelectorAll(".qq-lora-row .qq-lora-name");
            last[last.length - 1]?.focus();
        });
        addRow.append(addLora);
        rows.append(addRow);

        // 底部说明
        const chosenName = String(widgetOf(node, GROUP_WIDGET)?.value ?? FOLLOW_PANEL);
        const effective = enabled
            ? (chosenName === FOLLOW_PANEL
                ? group
                : data.groups.find((entry) => entry.name === chosenName) || group)
            : null;
        if (group && effective) {
            footText.textContent = enabled
                ? `当前生效：${effective.name} · ${effective.loras.length} 个 Lora（按顺序叠加）`
                : `已停用：模型原样透传（当前分组 ${effective.name}）`;
        } else {
            footText.textContent = enabled ? "没有分组，模型原样透传" : "已停用";
        }
        footText.title = footText.textContent;
    }

    function loraRow(group, index, lora) {
        const row = document.createElement("div");
        row.className = "qq-lora-row";

        const order = document.createElement("span");
        order.className = "qq-lora-index";
        order.textContent = String(index + 1);

        // 名字用下拉框选，样子对齐 ComfyUI 的 LoRA 加载器（点击才弹出搜索列表）
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

        const stepper = document.createElement("div");
        stepper.className = "qq-lora-stepper";
        const strength = document.createElement("input");
        strength.className = "qq-lora-strength";
        strength.type = "number";
        strength.step = String(STRENGTH_STEP);
        strength.min = "-100";
        strength.max = "100";
        strength.value = String(round2(lora.strength));
        strength.title = "强度（可直接输入，或用两侧箭头微调）";
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
        strength.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.key === "Enter") commitStrength(strength.value);
        });
        const nudge = (delta) => {
            commitStrength(round2((Number(strength.value) || 0) + delta));
        };
        const decrease = stepButton(-1, () => nudge(-STRENGTH_STEP));
        const increase = stepButton(1, () => nudge(STRENGTH_STEP));
        stepper.append(decrease, strength, increase);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "qq-lora-del-row";
        remove.textContent = "×";
        remove.title = "移除这个 Lora";
        remove.addEventListener("click", () => {
            const next = readData(node);
            const target = activeGroup(next);
            if (!target) return;
            target.loras.splice(index, 1);
            writeData(node, next);
            render();
        });

        row.append(order, combo, stepper, remove);
        return row;
    }

    function stepButton(direction, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "qq-lora-step";
        button.title = direction < 0 ? `减 ${STRENGTH_STEP}` : `加 ${STRENGTH_STEP}`;
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
            onClick();
        });
        return button;
    }

    // 贴着按钮弹出的 LoRA 列表：搜索 + 点选 + 上下键/回车
    function openLoraCombo(index, button, label, lora) {
        closeLoraPops(node);
        const pop = document.createElement("div");
        pop.className = "qq-lora-pop";
        const search = document.createElement("input");
        search.className = "qq-lora-pop-search";
        search.type = "search";
        search.placeholder = "搜索 LoRA";
        const list = document.createElement("div");
        list.className = "qq-lora-pop-list";
        pop.append(search, list);

        const close = () => {
            document.removeEventListener("pointerdown", onOutside, true);
            window.removeEventListener("resize", close);
            pop.remove();
            node.__qqLoraPops = (node.__qqLoraPops || []).filter((item) => item !== pop);
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
        };

        const tree = buildLoraTree(names);
        const expanded = new Set();
        let active = -1;
        const paint = () => {
            const rows = loraTreeRows(tree, expanded, search.value);
            list.replaceChildren();
            active = -1;
            if (!rows.length) {
                const empty = document.createElement("div");
                empty.className = "qq-lora-pop-empty";
                empty.textContent = names.length
                    ? "没有匹配的 LoRA"
                    : "读不到 LoRA 列表，可直接输入名字后回车";
                list.append(empty);
                return;
            }
            for (const row of rows) {
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
                }
                list.append(item);
            }
            const items = [...list.querySelectorAll(".qq-lora-pop-item")];
            const current = list.querySelector(".qq-lora-pop-item.is-current");
            const fallback = search.value.trim()
                ? items.find((item) => item.dataset.name)
                : null;
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
            // 没选中时直接选第一个文件，别把目录行当成结果
            const target = items[active] || items.find((item) => item.dataset.name) || items[0];
            if (target.dataset.name) commit(target.dataset.name);
            else target.click();
        };

        // 焦点落在列表行上时 Esc 也要能关
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
                // 有列表项时优先选中的那一条，只有完全没匹配才把手输的名字当作文件名
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
            if (pop.isConnected) paint();
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
                    const name = input.value.trim().slice(0, 60);
                    next.groups[index].name = name || `分组 ${index + 1}`;
                    writeData(node, next);
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

    node.__qqLoraRender = render;
    render();

    // 连线变化时刷新「外部控制」提示
    const originalConnectionsChange = node.onConnectionsChange;
    node.onConnectionsChange = function onConnectionsChangeLoraGroup(...args) {
        const result = originalConnectionsChange?.apply(this, args);
        syncExternalInputs(this);
        render();
        return result;
    };

/** 「生效分组」的选择同步进分组数据，避免读档时被动态下拉重置。 */
// 「生效分组」的选择同步进分组数据，避免读档时被动态下拉重置
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
            writeData(node, data);
        }
        render();
        return result;
    };
}

    syncExternalInputs(node);
    hookGroupWidget();
    installPromptHook();
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
