import { app } from "../../scripts/app.js";

// QQ-字体切换：在 设置 → QQ 分类下提供一个字体下拉，默认「默认（当前）」即不覆盖，
// 保持 ComfyUI 现有字体（英文 Inter、中文回退系统黑体）。选择其它字体时注入 CSS
// 覆盖界面字体（保留等宽/代码字体），并同步 1.0 画布节点字体；切回默认即还原。
//
// 只改 font-family，不改颜色/布局；纯前端、随设置持久化，实时生效无需刷新。

const STYLE_ID = "qq-font-switcher-css";
const SETTING_ID = "QQ.Font.Family";

// 候选字体栈：优先用户系统常见字体，逐级回退，缺字时不致空白。
const FONT_STACKS = {
    "默认（当前）": null,
    "微软雅黑": '"Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif',
    "系统黑体": 'system-ui,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif',
    "宋体（衬线）": '"SimSun","Songti SC","Noto Serif SC",serif',
    "楷体": '"KaiTi","Kaiti SC","STKaiti",serif',
    "幼圆": '"YouYuan","Yuanti SC","Microsoft YaHei",sans-serif',
    "等宽": 'ui-monospace,"SF Mono",Consolas,"Microsoft YaHei",monospace',
};
const FONT_LABELS = Object.keys(FONT_STACKS);
const DEFAULT_LABEL = FONT_LABELS[0];

let originalNodeFont = null;

function captureOriginal() {
    if (originalNodeFont === null) {
        originalNodeFont = globalThis.LiteGraph?.NODE_FONT || "Arial";
    }
}

function removeOverride() {
    document.getElementById(STYLE_ID)?.remove();
    if (globalThis.LiteGraph && originalNodeFont !== null) {
        globalThis.LiteGraph.NODE_FONT = originalNodeFont;
    }
    app.canvas?.setDirty?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
}

function applyFont(label) {
    captureOriginal();
    const stack = FONT_STACKS[label] ?? null;
    if (!stack) {
        removeOverride();
        return;
    }
    removeOverride();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    // 覆盖界面字体，但保留代码/等宽区域（textarea/code/pre/.font-mono）。
    style.textContent =
        `:root{--font-sans:${stack};--font-inter:${stack};}`
        + `body,.lg-node,.lg-node :not(textarea):not(code):not(pre):not(.font-mono),`
        + `button,input,select{font-family:${stack}!important;}`;
    document.head.append(style);
    if (globalThis.LiteGraph) globalThis.LiteGraph.NODE_FONT = stack;
    app.canvas?.setDirty?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
}

app.registerExtension({
    name: "QQ.FontSwitcher",
    settings: [
        {
            id: SETTING_ID,
            category: ["QQ", "外观", "字体"],
            name: "界面字体",
            tooltip: "选择界面字体；默认（当前）保持 ComfyUI 现有字体（英文 Inter、中文系统黑体）。等宽/代码区域不受影响。",
            type: "combo",
            options: FONT_LABELS,
            defaultValue: DEFAULT_LABEL,
            onChange(value) {
                applyFont(String(value ?? DEFAULT_LABEL));
            },
        },
    ],
    setup() {
        captureOriginal();
        let current = DEFAULT_LABEL;
        try {
            current = app.ui?.settings?.getSettingValue?.(SETTING_ID, DEFAULT_LABEL) ?? DEFAULT_LABEL;
        } catch {
            current = DEFAULT_LABEL;
        }
        applyFont(String(current));
    },
});
