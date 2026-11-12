import { app } from "../../scripts/app.js";

// Nodes 2.0（Vue 渲染）默认把节点 ID 徽章放在左下角。这里用纯 CSS 把它 lifted 到
// 节点右上角、与标题同一行的最右侧，和 1.0（LiteGraph）的观感一致。
//
// 只影响 Vue 节点（.lg-node 只在 2.0 存在），1.0 不受影响。不改动 DOM 结构，
// 仅视觉重定位，避免与 Vue 的重新渲染冲突；选择器失效时自动降级（不做任何事）。

const STYLE_ID = "qq-node-badge-topright";

const CSS = `
/* Vue 节点的徽章行（默认 mt-auto 沉在底部） lifted 到右上角标题行 */
.lg-node div.mt-auto.gap-2{
  position:absolute;
  top:4px;
  right:6px;
  left:auto;
  bottom:auto;
  width:auto;
  height:auto;
  margin:0;
  padding:0;
  z-index:5;
  pointer-events:none;
}
`;

function inject() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
}

app.registerExtension({
    name: "QQ.NodeBadgeTopRight",
    setup() {
        inject();
    },
});
