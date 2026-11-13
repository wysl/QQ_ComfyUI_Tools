import { app } from "../../scripts/app.js";

// QQ-字体切换：设置 → QQ → 外观 → 字体，提供两个下拉：
//   界面字体（QQ.Font.Family）与 代码/等宽字体（QQ.Font.Mono）。
// 默认均为「默认（当前）」即不覆盖，保持 ComfyUI 现有字体（英文 Inter、中文系统黑体、
// 等宽 ui-monospace）。选择后实时注入 CSS 生效并随设置持久化；切回默认即还原。
//
// 霞鹜文楷（LXGW WenKai，开源 OFL）通过 /qq_fonts/wenkai 复用本机已安装字体
// （如 LayerStyle 自带），不内置二进制；加载失败自然回退下一字体。

const STYLE_ID = "qq-font-switcher-css";
const MONO_STYLE_ID = "qq-font-switcher-mono-css";
const FACE_ID = "qq-font-wenkai-face";
const SETTING_ID = "QQ.Font.Family";
const MONO_SETTING_ID = "QQ.Font.Mono";

const WENKAI = '"LXGW WenKai"';

// 界面字体栈：优先系统常见字体，逐级回退，缺字不致空白。
const FONT_STACKS = {
    "默认（当前）": null,
    "霞鹜文楷": `${WENKAI},"Microsoft YaHei","PingFang SC",serif`,
    "微软雅黑": '"Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif',
    "系统黑体": 'system-ui,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif',
    "宋体（衬线）": '"SimSun","Songti SC","Noto Serif SC",serif',
    "楷体": '"KaiTi","Kaiti SC","STKaiti",serif',
    "幼圆": '"YouYuan","Yuanti SC","Microsoft YaHei",sans-serif',
};
// 代码/等宽字体栈：可单独覆盖 textarea/code/pre 等区域。
const MONO_STACKS = {
    "默认（当前）": null,
    "霞鹜文楷": `${WENKAI},"Microsoft YaHei",monospace`,
    "Consolas 等宽": 'Consolas,"SF Mono",Menlo,Monaco,"Liberation Mono",monospace',
    "微软雅黑": '"Microsoft YaHei","PingFang SC",monospace',
    "宋体（衬线）": '"SimSun","Songti SC",monospace',
};
const FONT_LABELS = Object.keys(FONT_STACKS);
const MONO_LABELS = Object.keys(MONO_STACKS);
const DEFAULT_LABEL = FONT_LABELS[0];

let originalNodeFont = null;

function captureOriginal() {
    if (originalNodeFont === null) {
        originalNodeFont = globalThis.LiteGraph?.NODE_FONT || "Arial";
    }
}

// 注入霞鹜文楷 @font-face（仅一次）。路由 404 时该 face 加载失败，回退下一字体。
function installWenkaiFace() {
    if (document.getElementById(FACE_ID)) return;
    const style = document.createElement("style");
    style.id = FACE_ID;
    style.textContent =
        `@font-face{font-family:${WENKAI};src:url("/qq_fonts/wenkai") format("truetype");`
        + `font-weight:normal;font-style:normal;font-display:swap;}`;
    document.head.append(style);
}

function removeStyle(id) {
    document.getElementById(id)?.remove();
}

function applyFont(label) {
    captureOriginal();
    const stack = FONT_STACKS[label] ?? null;
    removeStyle(STYLE_ID);
    if (!stack) {
        if (globalThis.LiteGraph && originalNodeFont !== null) {
            globalThis.LiteGraph.NODE_FONT = originalNodeFont;
        }
    } else {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        // 覆盖界面字体，但保留等宽区域（交给 代码/等宽字体 设置单独控制）。
        style.textContent =
            `:root{--font-sans:${stack};--font-inter:${stack};}`
            + `body,.lg-node,.lg-node :not(textarea):not(code):not(pre):not(.font-mono),`
            + `button,input,select{font-family:${stack}!important;}`;
        document.head.append(style);
        if (globalThis.LiteGraph) globalThis.LiteGraph.NODE_FONT = stack;
    }
    app.canvas?.setDirty?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
}

function applyMono(label) {
    const stack = MONO_STACKS[label] ?? null;
    removeStyle(MONO_STYLE_ID);
    if (!stack) return;
    const style = document.createElement("style");
    style.id = MONO_STYLE_ID;
    style.textContent =
        `:root{--font-mono:${stack};}`
        + `textarea,code,pre,.font-mono{font-family:${stack}!important;}`;
    document.head.append(style);
}

app.registerExtension({
    name: "QQ.FontSwitcher",
    settings: [
        {
            id: SETTING_ID,
            category: ["QQ", "外观", "字体"],
            name: "界面字体",
            tooltip: "选择界面字体；默认（当前）保持现有字体。霞鹜文楷需本机已安装该字体。等宽区域由「代码/等宽字体」单独控制。",
            type: "combo",
            options: FONT_LABELS,
            defaultValue: DEFAULT_LABEL,
            onChange(value) {
                applyFont(String(value ?? DEFAULT_LABEL));
            },
        },
        {
            id: MONO_SETTING_ID,
            category: ["QQ", "外观", "字体"],
            name: "代码/等宽字体",
            tooltip: "单独覆盖提示词文本框、代码等等宽区域的字体；默认（当前）保持 ui-monospace。",
            type: "combo",
            options: MONO_LABELS,
            defaultValue: DEFAULT_LABEL,
            onChange(value) {
                applyMono(String(value ?? DEFAULT_LABEL));
            },
        },
    ],
    setup() {
        captureOriginal();
        installWenkaiFace();
        let ui = DEFAULT_LABEL;
        let mono = DEFAULT_LABEL;
        try {
            ui = app.ui?.settings?.getSettingValue?.(SETTING_ID, DEFAULT_LABEL) ?? DEFAULT_LABEL;
            mono = app.ui?.settings?.getSettingValue?.(MONO_SETTING_ID, DEFAULT_LABEL) ?? DEFAULT_LABEL;
        } catch {
            ui = DEFAULT_LABEL;
            mono = DEFAULT_LABEL;
        }
        applyFont(String(ui));
        applyMono(String(mono));
    },
});
