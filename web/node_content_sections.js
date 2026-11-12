import { app } from "../../scripts/app.js";

// Nodes 2.0（Vue 渲染）节点内不同类型内容（多行文本 / 参数控件 / 各控件行）默认
// 底色接近、边界模糊，长时间看有视力压力。这里用纯 CSS 增加清晰而克制的分界：
//   * 多行文本（prompt）加描边，成为独立对象；
//   * 文本块与下方参数之间加一条细分隔线；
//   * 参数行垂直节奏放宽，控件彼此更分明。
// 仍沿用当前主题的描边/底色变量，保持再生纸等配色的整体美观。
//
// 提供开关 QQ.NodeContent.Sections（默认开启），设置里实时切换，无需刷新。
// 只影响 Vue 节点（.lg-node 只在 2.0 存在）；纯 CSS、不改 DOM，选择器失效自动降级。

const STYLE_ID = "qq-node-content-sections";
const SETTING_ID = "QQ.NodeContent.Sections";

const CSS = `
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
