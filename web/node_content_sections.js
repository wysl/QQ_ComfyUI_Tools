import { app } from "../../scripts/app.js";

// Nodes 2.0（Vue 渲染）节点内不同类型内容（多行文本 / 参数控件 / 各控件行）默认
// 底色接近、边界模糊，长时间看有视力压力。这里在**全局样式层**用纯 CSS 增加清晰而
// 克制的分界，不修改任何节点自身的源码：
//   * 多行文本（prompt）加描边，成为独立对象；
//   * 文本块与下方参数之间加一条细分隔线；
//   * 参数行垂直节奏放宽，控件彼此更分明；
//   * QQ-Lora 面板的分组 / 列表 / 状态各自成区（全局选择器覆盖，节点源码不动）。
// 仍沿用当前主题的描边/底色变量，保持再生纸等配色的整体美观。
//
// 提供开关 QQ.NodeContent.Sections（默认开启），设置里实时切换，无需刷新。
// 关闭即整体恢复默认；纯 CSS、不改 DOM，选择器失效自动降级。

const STYLE_ID = "qq-node-content-sections";
const SETTING_ID = "QQ.NodeContent.Sections";

const CSS = `
/* ===== 通用 Vue 节点：文本 / 参数 / 控件行 分界 ===== */
/* 多行文本块加描边，从节点底色中独立出来 */
.lg-node textarea{
  border:1px solid var(--border-color,#b3ad9c);
}
/* 文本块与后续参数控件之间加细分隔，区分内容类型 */
.lg-node-widget:has(textarea){
  padding-bottom:8px;
  margin-bottom:2px;
  border-bottom:1px solid var(--border-color,#b3ad9c);
}
/* 参数行节奏放宽，控件分界更清晰 */
.lg-node-widgets{
  row-gap:6px;
}

/* ===== QQ-Lora 面板：分组 / 列表 / 状态 分区 =====
   放在全局样式层（不修改节点源码），用元素+类选择器提高优先级，
   保证覆盖节点自带样式；随本开关统一启用/关闭。 */
div.qq-lora{ gap:6px; }
div.qq-lora-groups{
  background:var(--comfy-menu-secondary-bg,#ded4c2);
  border:1px solid var(--border-color,#39404d);
  border-radius:6px; padding:5px 6px;
}
div.qq-lora-rows{
  background:var(--comfy-menu-secondary-bg,#ded4c2);
  border:1px solid var(--border-color,#39404d);
  border-radius:6px; padding:6px;
}
div.qq-lora-foot{
  padding-top:6px;
  border-top:1px solid var(--border-color,#39404d);
}
`;

function inject() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
}

function remove() {
    document.getElementById(STYLE_ID)?.remove();
}

function apply(on) {
    if (on) inject();
    else remove();
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

function registerSetting() {
    if (registered) return;
    const { register } = settingApi();
    if (!register) return;
    registered = true;
    try {
        register({
            id: SETTING_ID,
            name: "节点内容分区描边（Nodes 2.0）",
            tooltip: "为节点内多行文本加描边、文本与参数间加分隔线、放宽参数行间距，让不同类型内容分界更清晰；关闭恢复默认。",
            type: "boolean",
            defaultValue: true,
            category: ["QQ", "节点外观"],
            onChange: (value) => apply(value !== false),
        });
    } catch {
        // 重复注册等异常不影响功能
    }
}

app.registerExtension({
    name: "QQ.NodeContentSections",
    setup() {
        registerSetting();
        const { get } = settingApi();
        const current = get ? get(SETTING_ID) : true;
        apply(current !== false);
    },
});
