import { app } from "../../scripts/app.js";

// Nodes 2.0（Vue 渲染）里右击输入/输出端口选「Rename」会改到节点标题，
// 无法像 1.0 那样重命名接口。这里拦截端口的右键，提供正确的「重命名接口」
// （以及「断开连接」），直接写 slot.label / localized_name 并同步 Vue 显示。
//
// 只作用于 Vue 节点端口（.lg-slot），1.0 不受影响。提供开关 QQ.VueSlotRename
// （默认开启）。纯前端、不改后端数据结构的 name，仅改显示名，随工作流序列化。

const SETTING_ID = "QQ.VueSlotRename";
const MENU_ID = "qq-vue-slot-menu";

const CSS = `
.qq-slot-menu{position:fixed;z-index:11300;min-width:132px;padding:4px;border-radius:6px;
  border:1px solid var(--border-color,#4b545b);background:var(--comfy-menu-bg,#25292d);
  color:var(--input-text,#e6e8ee);box-shadow:0 12px 28px rgba(0,0,0,.4);
  font:12px/1.35 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.qq-slot-menu button{display:block;width:100%;padding:5px 8px;border:0;border-radius:4px;
  background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;white-space:nowrap}
.qq-slot-menu button:hover{background:rgba(79,140,255,.24)}
.qq-slot-rename{position:fixed;z-index:11301;height:24px;padding:0 6px;border-radius:4px;
  border:1px solid #4f8cff;background:var(--comfy-input-bg,#12141a);color:var(--input-text,#e6e8ee);
  font:12px system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;outline:none}
`;

let enabled = true;
let menuEl = null;
let renameEl = null;

function injectCSS() {
    if (document.getElementById("qq-vue-slot-css")) return;
    const style = document.createElement("style");
    style.id = "qq-vue-slot-css";
    style.textContent = CSS;
    document.head.append(style);
}

function closeMenu() {
    menuEl?.remove();
    menuEl = null;
}
function closeRename() {
    renameEl?.remove();
    renameEl = null;
}

function slotInfo(target) {
    const slotEl = target.closest?.(".lg-slot");
    if (!slotEl) return null;
    const root = slotEl.closest(".lg-node");
    if (!root) return null;
    const node = app.graph?.getNodeById?.(Number(root.dataset.nodeId));
    if (!node) return null;
    const isInput = slotEl.classList.contains("lg-slot--input");
    const list = [...root.querySelectorAll(isInput ? ".lg-slot--input" : ".lg-slot--output")];
    const index = list.indexOf(slotEl);
    const slot = (isInput ? node.inputs : node.outputs)?.[index];
    if (index < 0 || !slot) return null;
    return { node, slot, slotEl, isInput, index };
}

function currentName(slot) {
    return slot.localized_name || slot.label || slot.name || "";
}

function applyRename(info, value) {
    const name = String(value || "").trim();
    if (!name) return;
    info.slot.label = name;
    info.slot.localized_name = name;
    // 同步 Vue 端口显示文字
    const span = info.slotEl.querySelector("span.truncate") || info.slotEl.querySelector("span");
    if (span) span.textContent = name;
    info.node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
    app.graph?.change?.();
}

function openRename(info) {
    closeRename();
    const rect = info.slotEl.getBoundingClientRect();
    const input = document.createElement("input");
    input.className = "qq-slot-rename";
    input.type = "text";
    input.value = currentName(info.slot);
    input.style.left = `${Math.max(6, rect.left)}px`;
    input.style.top = `${rect.top - 2}px`;
    input.style.width = `${Math.max(140, rect.width)}px`;
    document.body.append(input);
    renameEl = input;
    input.focus();
    input.select();
    let done = false;
    const finish = (commit) => {
        if (done) return;
        done = true;
        if (commit) applyRename(info, input.value);
        closeRename();
    };
    input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
}

function openMenu(info, x, y) {
    closeMenu();
    const menu = document.createElement("div");
    menu.className = "qq-slot-menu";
    menu.id = MENU_ID;

    const rename = document.createElement("button");
    rename.type = "button";
    rename.textContent = "重命名接口";
    rename.addEventListener("click", () => {
        closeMenu();
        openRename(info);
    });
    menu.append(rename);

    const disconnect = document.createElement("button");
    disconnect.type = "button";
    disconnect.textContent = "断开连接";
    disconnect.addEventListener("click", () => {
        closeMenu();
        if (info.isInput) info.node.disconnectInput?.(info.index);
        else info.node.disconnectOutput?.(info.index);
        info.node.setDirtyCanvas?.(true, true);
        app.graph?.change?.();
    });
    menu.append(disconnect);

    document.body.append(menu);
    menuEl = menu;
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, window.innerWidth - r.width - 6)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - r.height - 6)}px`;

    const off = (ev) => {
        if (!menu.contains(ev.target)) {
            closeMenu();
            document.removeEventListener("pointerdown", off, true);
        }
    };
    document.addEventListener("pointerdown", off, true);
}

function onContextMenu(e) {
    if (!enabled) return;
    const info = slotInfo(e.target);
    if (!info) return;
    e.preventDefault();
    e.stopPropagation();
    closeRename();
    openMenu(info, e.clientX, e.clientY);
}

let registered = false;
function settingApi() {
    const modern = app.extensionManager?.setting;
    const legacy = app.ui?.settings;
    return {
        get: modern?.get?.bind(modern) || legacy?.getSettingValue?.bind(legacy),
        register: modern?.registerSetting?.bind(modern) || legacy?.addSetting?.bind(legacy),
    };
}

app.registerExtension({
    name: "QQ.VueSlotRename",
    setup() {
        injectCSS();
        const { get, register } = settingApi();
        if (register && !registered) {
            registered = true;
            try {
                register({
                    id: SETTING_ID,
                    name: "Nodes 2.0 端口右键重命名接口",
                    tooltip: "在 Vue 节点输入/输出端口右键提供「重命名接口 / 断开连接」，修复 2.0 右键 Rename 改到节点标题的问题。",
                    type: "boolean",
                    defaultValue: true,
                    category: ["QQ", "节点外观"],
                    onChange: (v) => { enabled = v !== false; },
                });
            } catch { /* 重复注册忽略 */ }
        }
        const cur = get ? get(SETTING_ID) : true;
        enabled = cur !== false;
        document.addEventListener("contextmenu", onContextMenu, true);
    },
});
