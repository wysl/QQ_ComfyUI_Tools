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
const ENABLE_WIDGET = "启用";

const ROW_H = 30;
const MIN_PANEL_HEIGHT = 250;
const MIN_PANEL_WIDTH = 330;
const STRENGTH_STEP = 0.05;
const MIN_POP_WIDTH = 220;
const MAX_POP_HEIGHT = 280;

const CSS = `
.qq-lora{box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:6px;
  padding:8px;background:var(--comfy-menu-bg,#1e2128);color:var(--input-text,#e6e8ee);
  border-radius:6px;overflow:hidden;font:12px/1.35 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.qq-lora *{box-sizing:border-box}
.qq-lora-head{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.qq-lora-title{font-weight:600}
.qq-lora-hint{flex:1 1 auto;min-width:0;color:var(--descrip-text,#96a0b0);font-size:11px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qq-lora-switch{display:flex;align-items:center;gap:6px;flex:0 0 auto;cursor:pointer;user-select:none}
.qq-lora-switch input{position:absolute;opacity:0;width:0;height:0}
.qq-lora-track{position:relative;width:34px;height:18px;border-radius:9px;background:#3a4250;
  border:1px solid var(--border-color,#39404d);transition:background .16s ease}
.qq-lora-track::after{content:"";position:absolute;top:1px;left:1px;width:14px;height:14px;
  border-radius:50%;background:#cfd6e4;transition:transform .16s ease}
.qq-lora-switch input:checked + .qq-lora-track{background:#3d6fd0;border-color:#4f8cff}
.qq-lora-switch input:checked + .qq-lora-track::after{transform:translateX(16px);background:#fff}
.qq-lora-switch-label{font-size:11px;color:var(--descrip-text,#96a0b0)}
.qq-lora-groups{display:flex;flex-wrap:wrap;align-items:center;gap:4px;flex:0 0 auto}
.qq-lora-chip{display:flex;align-items:center;gap:4px;height:24px;padding:0 8px;border-radius:12px;
  border:1px solid var(--border-color,#39404d);background:var(--comfy-input-bg,#12141a);
  color:inherit;font:inherit;cursor:pointer;max-width:180px}
.qq-lora-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qq-lora-chip:hover{border-color:#4f8cff}
.qq-lora-chip[data-on="1"]{border-color:#4f8cff;color:#8fb9d9;background:rgba(79,140,255,.14)}
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
.qq-lora-index{flex:0 0 16px;text-align:right;color:var(--descrip-text,#96a0b0);font-size:10px}
.qq-lora-combo{position:relative;flex:1 1 auto;min-width:92px;display:flex}
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
.qq-lora-step{width:15px;height:22px;padding:0;border-radius:3px;display:grid;place-items:center;
  border:1px solid var(--border-color,#39404d);background:var(--comfy-input-bg,#12141a);
  color:var(--descrip-text,#96a0b0);cursor:pointer}
.qq-lora-step:hover{border-color:#4f8cff;color:#8fb9d9}
.qq-lora-strength{width:42px;height:22px;padding:0 2px;border-radius:4px;text-align:center;
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
.qq-lora-pop-group{padding:5px 8px 2px;font-size:10px;letter-spacing:.02em;color:#8fa3b0;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qq-lora-pop-item.is-child{padding-left:18px}
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
    return { version: 1, active: 0, groups: [] };
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
    return { version: 1, active: groups.length ? Math.trunc(active) : 0, groups };
}

export function activeGroup(data) {
    if (!data?.groups?.length) return null;
    return data.groups[data.active] || data.groups[0];
}

/** 把 LoRA 名单按子目录分组：根目录在 ""，其它按完整目录名。 */
function groupLoras(names) {
    const groups = new Map();
    for (const name of names || []) {
        const text = String(name || "");
        if (!text) continue;
        const cut = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
        const dir = cut > 0 ? text.slice(0, cut) : "";
        const leaf = cut > 0 ? text.slice(cut + 1) : text;
        if (!leaf) continue;
        if (!groups.has(dir)) groups.set(dir, []);
        groups.get(dir).push({ name: text, leaf });
    }
    return [...groups.entries()].map(([dir, items]) => ({ dir, items }));
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

function setEnabled(node, enabled) {
    const widget = widgetOf(node, ENABLE_WIDGET);
    if (!widget || widget.value === enabled) return;
    widget.value = enabled;
    widget.callback?.(enabled);
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

function closeLoraPops(node) {
    for (const pop of node?.__qqLoraPops || []) pop.remove();
    if (node) node.__qqLoraPops = [];
}

function setup(node) {
    if (!node || node.__qqLoraSetup) return;
    node.__qqLoraSetup = true;
    injectCSS();

    hideWidget(widgetOf(node, DATA_WIDGET));
    hideWidget(widgetOf(node, ENABLE_WIDGET));

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
    const toggle = document.createElement("label");
    toggle.className = "qq-lora-switch";
    toggle.title = "关掉后模型原样透传，所有分组都不生效";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const track = document.createElement("span");
    track.className = "qq-lora-track";
    const toggleLabel = document.createElement("span");
    toggleLabel.className = "qq-lora-switch-label";
    toggle.append(checkbox, track, toggleLabel);
    head.append(title, hint, toggle);

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
    const width = Math.max(MIN_PANEL_WIDTH, Number(node.size?.[0]) || MIN_PANEL_WIDTH);
    const height = Math.max(MIN_PANEL_HEIGHT + 40, Number(node.size?.[1]) || 0);
    node.setSize?.([width, height]);

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
        checkbox.checked = enabled;
        toggleLabel.textContent = enabled ? "启用" : "停用";
        root.classList.toggle("is-off", !enabled);

        const external = [];
        if (isExternallyControlled(node, "启用开关")) external.push("启用开关");
        if (isExternallyControlled(node, "生效分组")) external.push("生效分组");
        hint.textContent = external.length
            ? `外部控制：${external.join("、")}（面板设置仍会保存）`
            : `共 ${data.groups.length} 组`;
        hint.title = hint.textContent;

        // 分组条
        groups.replaceChildren();
        data.groups.forEach((group, index) => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "qq-lora-chip";
            chip.dataset.on = index === data.active ? "1" : "0";
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
        if (group) {
            footText.textContent = enabled
                ? `当前生效：${group.name} · ${group.loras.length} 个 Lora（按顺序叠加）`
                : `已停用：模型原样透传（当前分组 ${group.name}）`;
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

        let active = -1;
        const paint = () => {
            const needle = search.value.trim().toLowerCase();
            const matches = names.filter((name) => name.toLowerCase().includes(needle));
            list.replaceChildren();
            active = -1;
            if (!matches.length) {
                const empty = document.createElement("div");
                empty.className = "qq-lora-pop-empty";
                empty.textContent = names.length
                    ? "没有匹配的 LoRA"
                    : "读不到 LoRA 列表，可直接输入名字后回车";
                list.append(empty);
                return;
            }
            // 按子目录分组显示：目录名做小标题，文件缩进一级
            for (const group of groupLoras(matches)) {
                if (group.dir) {
                    const header = document.createElement("div");
                    header.className = "qq-lora-pop-group";
                    header.textContent = group.dir;
                    header.title = group.dir;
                    list.append(header);
                }
                for (const entry of group.items) {
                    const item = document.createElement("button");
                    item.type = "button";
                    item.className = group.dir ? "qq-lora-pop-item is-child" : "qq-lora-pop-item";
                    if (entry.name === lora.name) item.classList.add("is-current");
                    item.textContent = entry.leaf;
                    item.title = entry.name;
                    item.dataset.name = entry.name;
                    item.addEventListener("click", () => commit(entry.name));
                    list.append(item);
                }
            }
            const current = list.querySelector(".qq-lora-pop-item.is-current");
            if (current) {
                current.classList.add("is-active");
                active = [...list.querySelectorAll(".qq-lora-pop-item")].indexOf(current);
                current.scrollIntoView({ block: "nearest" });
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
            const target = items[active] || items[0];
            if (target) commit(target.dataset.name || target.textContent);
        };

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

    checkbox.addEventListener("change", () => {
        setEnabled(node, checkbox.checked);
        render();
    });

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
        render();
        return result;
    };
}

function round2(value) {
    return Math.round(Number(value) * 100) / 100;
}

app.registerExtension({
    name: "QQ.LoraGroupLoader",
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
            this.__qqLoraRender?.();
            return result;
        };
    },
});
