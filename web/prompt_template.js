import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// QQ-提示词变量 / QQ-提示词模板 的前端。
//   变量节点：DOM 行面板编辑 {名称:值}，写回隐藏的「变量JSON」控件并随工作流保存。
//   模板节点：保留标准多行文本框（2.0 原生），下方 DOM 实时预览渲染结果与未解析 token。
// 全程事件驱动（控件回调 / 自定义事件 / executed），无定时器。

const VARS_TYPE = "QQPromptVariables";
const TEMPLATE_TYPE = "QQPromptTemplate";
const VARS_WIDGET = "变量JSON";
const VARS_EVENT = "qq-prompt-vars-changed";

const CSS = `
.qq-vars{display:flex;flex-direction:column;gap:4px;padding:4px;font:12px/1.35 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:var(--input-text,#e6e8ee)}
.qq-vars-row{display:flex;gap:4px;align-items:center}
.qq-vars-row input{height:22px;min-width:0;border-radius:4px;border:1px solid var(--border-color,#4b545b);background:var(--comfy-input-bg,#12141a);color:inherit;font:inherit;padding:0 6px;outline:none}
.qq-vars-row input:focus{border-color:#4f8cff}
.qq-vars-name{flex:0 0 34%}
.qq-vars-value{flex:1 1 auto}
.qq-vars-del{flex:0 0 22px;height:22px;border:0;border-radius:4px;background:transparent;color:var(--descrip-text,#96a0b0);cursor:pointer;font:14px/1 inherit}
.qq-vars-del:hover{background:rgba(164,67,47,.25);color:#e6a49a}
.qq-vars-add{height:22px;border:1px dashed var(--border-color,#4b545b);border-radius:4px;background:transparent;color:var(--descrip-text,#96a0b0);cursor:pointer;font:inherit}
.qq-vars-add:hover{border-color:#4f8cff;color:#8fb9d9}
.qq-tpl-preview{padding:6px;font:12px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:var(--input-text,#e6e8ee);white-space:pre-wrap;word-break:break-word}
.qq-tpl-preview .qq-tpl-miss{color:#e6a49a;background:rgba(164,67,47,.18);border-radius:3px;padding:0 2px}
.qq-tpl-empty{color:var(--descrip-text,#96a0b0)}
`;

function injectCSS() {
    if (document.getElementById("qq-prompt-template-css")) return;
    const style = document.createElement("style");
    style.id = "qq-prompt-template-css";
    style.textContent = CSS;
    document.head.append(style);
}

function parseVars(raw) {
    if (raw && typeof raw === "object") return raw;
    try {
        const data = JSON.parse(String(raw || "{}"));
        return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch {
        return {};
    }
}

// 与后端 resolve_template 同语义：{名称} / {名称:默认} / {{ }} 转义。
function resolveTemplate(template, variables) {
    const vars = variables || {};
    const text = String(template ?? "");
    const unresolved = [];
    let out = "";
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === "{" && text[i + 1] === "{") { out += "{"; i += 2; continue; }
        if (ch === "}" && text[i + 1] === "}") { out += "}"; i += 2; continue; }
        if (ch === "{") {
            const close = text.indexOf("}", i + 1);
            if (close === -1) { out += text.slice(i); break; }
            const token = text.slice(i + 1, close);
            const colon = token.indexOf(":");
            const name = (colon >= 0 ? token.slice(0, colon) : token).trim();
            const def = colon >= 0 ? token.slice(colon + 1) : null;
            if (Object.prototype.hasOwnProperty.call(vars, name)) out += String(vars[name]);
            else if (def !== null) out += def;
            else { out += text.slice(i, close + 1); if (name && !unresolved.includes(name)) unresolved.push(name); }
            i = close + 1;
            continue;
        }
        out += ch;
        i += 1;
    }
    return { text: out, unresolved };
}

function widget(node, name) {
    return (node?.widgets || []).find((w) => w?.name === name) || null;
}

function hideWidget(w) {
    if (!w) return;
    w.hidden = true;
    w.options ||= {};
    w.options.hidden = true;
    w.computeSize = () => [0, -4];
}

// ── 变量节点：行面板 ──────────────────────────────────────────
function setupVariables(node) {
    if (node.__qqVarsSetup) return;
    node.__qqVarsSetup = true;
    const jsonWidget = widget(node, VARS_WIDGET);
    hideWidget(jsonWidget);

    const root = document.createElement("div");
    root.className = "qq-vars";
    const list = document.createElement("div");
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "4px";
    const addBtn = document.createElement("button");
    addBtn.className = "qq-vars-add";
    addBtn.type = "button";
    addBtn.textContent = "+ 添加变量";
    root.append(list, addBtn);

    function rows() {
        const vars = parseVars(jsonWidget?.value);
        return Object.entries(vars).map(([name, value]) => ({ name, value: String(value) }));
    }

    function commit() {
        const obj = {};
        for (const row of list.children) {
            const name = row.querySelector(".qq-vars-name").value.trim();
            if (!name) continue;
            obj[name] = row.querySelector(".qq-vars-value").value;
        }
        if (jsonWidget) {
            jsonWidget.value = JSON.stringify(obj);
            jsonWidget.callback?.(jsonWidget.value);
        }
        node.setDirtyCanvas?.(true, true);
        node.graph?.change?.();
        document.dispatchEvent(new CustomEvent(VARS_EVENT, { detail: { source: node.id } }));
    }

    function makeRow(name = "", value = "") {
        const row = document.createElement("div");
        row.className = "qq-vars-row";
        const nameInput = document.createElement("input");
        nameInput.className = "qq-vars-name";
        nameInput.placeholder = "名称";
        nameInput.value = name;
        const valueInput = document.createElement("input");
        valueInput.className = "qq-vars-value";
        valueInput.placeholder = "值";
        valueInput.value = value;
        const del = document.createElement("button");
        del.className = "qq-vars-del";
        del.type = "button";
        del.textContent = "×";
        del.title = "删除该变量";
        for (const input of [nameInput, valueInput]) {
            input.addEventListener("input", commit);
            input.addEventListener("pointerdown", (e) => e.stopPropagation());
        }
        del.addEventListener("click", () => { row.remove(); commit(); });
        row.append(nameInput, valueInput, del);
        return row;
    }

    function render() {
        list.replaceChildren(...rows().map(({ name, value }) => makeRow(name, value)));
    }

    addBtn.addEventListener("click", () => {
        const row = makeRow();
        list.append(row);
        row.querySelector(".qq-vars-name").focus();
    });
    root.addEventListener("pointerdown", (e) => e.stopPropagation());
    root.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

    node.addDOMWidget("qq_vars_panel", "qq_vars", root, {
        serialize: false, hideOnZoom: false, margin: 4, getMinHeight: () => 60,
    });
    node.resizable = true;
    render();
    node.__qqVarsRender = render;
}

// ── 模板节点：实时预览 ────────────────────────────────────────
function connectedVarsValue(node) {
    const input = (node.inputs || []).find((i) => i.name === "变量");
    if (!input || input.link == null) return null;
    const link = node.graph?.getLink?.(input.link) ?? node.graph?.links?.[input.link];
    const source = node.graph?.getNodeById?.(link?.origin_id);
    return widget(source, VARS_WIDGET)?.value ?? null;
}

function setupTemplate(node) {
    if (node.__qqTplSetup) return;
    node.__qqTplSetup = true;
    const preview = document.createElement("div");
    preview.className = "qq-tpl-preview";

    function render() {
        const tpl = widget(node, "模板")?.value ?? "";
        const vars = parseVars(connectedVarsValue(node));
        const { text, unresolved } = resolveTemplate(tpl, vars);
        preview.replaceChildren();
        if (!text) {
            const empty = document.createElement("span");
            empty.className = "qq-tpl-empty";
            empty.textContent = "模板为空";
            preview.append(empty);
        } else {
            // 把未解析 token 高亮：按 unresolved 名称切分渲染
            let rest = text;
            const frag = document.createDocumentFragment();
            const pattern = unresolved.length
                ? new RegExp(`\\{(${unresolved.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\}`, "g")
                : null;
            let last = 0;
            if (pattern) {
                let m;
                while ((m = pattern.exec(rest)) !== null) {
                    if (m.index > last) frag.append(document.createTextNode(rest.slice(last, m.index)));
                    const mark = document.createElement("span");
                    mark.className = "qq-tpl-miss";
                    mark.textContent = m[0];
                    mark.title = "未解析变量";
                    frag.append(mark);
                    last = m.index + m[0].length;
                }
            }
            if (last < rest.length) frag.append(document.createTextNode(rest.slice(last)));
            preview.append(frag);
        }
        preview.title = unresolved.length ? `未解析：${unresolved.join(", ")}` : "";
    }

    preview.addEventListener("pointerdown", (e) => e.stopPropagation());
    preview.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    node.addDOMWidget("qq_tpl_preview", "qq_tpl", preview, {
        serialize: false, hideOnZoom: false, margin: 4, getMinHeight: () => 40,
    });
    node.resizable = true;

    const tplWidget = widget(node, "模板");
    if (tplWidget) {
        const original = tplWidget.callback;
        tplWidget.callback = (...args) => {
            const result = original?.apply(tplWidget, args);
            render();
            return result;
        };
    }
    const onVarsChanged = () => render();
    document.addEventListener(VARS_EVENT, onVarsChanged);
    const onExecuted = (event) => {
        if (String(event?.detail?.node ?? "") === String(node.id)) render();
    };
    api.addEventListener("executed", onExecuted);
    const originalRemoved = node.onRemoved;
    node.onRemoved = function () {
        document.removeEventListener(VARS_EVENT, onVarsChanged);
        api.removeEventListener?.("executed", onExecuted);
        return originalRemoved?.apply(this, arguments);
    };

    render();
    node.__qqTplRender = render;
}

app.registerExtension({
    name: "QQ.PromptTemplate",
    setup() { injectCSS(); },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        const name = nodeData?.name;
        if (name !== VARS_TYPE && name !== TEMPLATE_TYPE) return;
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            if (name === VARS_TYPE) setupVariables(this);
            else setupTemplate(this);
            return result;
        };
        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = originalConfigure?.apply(this, arguments);
            if (name === VARS_TYPE) { setupVariables(this); this.__qqVarsRender?.(); }
            else { setupTemplate(this); this.__qqTplRender?.(); }
            return result;
        };
    },
});
