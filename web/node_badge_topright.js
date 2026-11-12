import { app } from "../../scripts/app.js";

// Nodes 2.0（Vue 渲染）默认把节点 ID 徽章放在左下角。这里用纯 CSS 把它 lifted 到
// 节点右上角、与标题同一行的最右侧（裸文字、无底色包裹），和 1.0 观感一致。
//
// 提供开关设置 QQ.NodeBadge.TopRight（默认开启），可在设置里实时切换，无需刷新。
// 只影响 Vue 节点（.lg-node 只在 2.0 存在），1.0 不受影响。不改动 DOM 结构，
// 仅视觉重定位，避免与 Vue 重新渲染冲突；选择器失效时自动降级（不做任何事）。

const STYLE_ID = "qq-node-badge-topright";
const SETTING_ID = "QQ.NodeBadge.TopRight";

const CSS = `
/* Vue 节点的徽章行（默认 mt-auto 沉在底部） lifted 到右上角标题行 */
.lg-node div.mt-auto.gap-2{
  position:absolute;
  top:0;
  right:8px;
  left:auto;
  bottom:auto;
  width:auto;
  height:32px;
  margin:0;
  padding:0;
  display:flex;
  align-items:center;
  z-index:5;
  pointer-events:none;
}
/* 去掉徽章自带的圆角底色包裹，直接落在标题底色上，只留裸文字 */
.lg-node div.mt-auto.gap-2 > div,
.lg-node div.mt-auto.gap-2 > div > div{
  background:transparent !important;
  border-radius:0 !important;
  height:auto !important;
  padding:0 !important;
  overflow:visible;
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
            name: "节点ID徽章置于右上角（Nodes 2.0）",
            tooltip: "开启后把 Vue 节点的 ID 徽章从左下角移到标题行最右（裸文字、无底色）；关闭恢复默认左下角。",
            type: "boolean",
            defaultValue: true,
            category: ["QQ", "节点徽章"],
            onChange: (value) => apply(value !== false),
        });
    } catch {
        // 重复注册等异常不影响功能
    }
}

app.registerExtension({
    name: "QQ.NodeBadgeTopRight",
    setup() {
        registerSetting();
        const { get } = settingApi();
        const current = get ? get(SETTING_ID) : true;
        apply(current !== false);
    },
});
