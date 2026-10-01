import { app } from "../../scripts/app.js";

const STORAGE_KEY = "qq-comfyui-theme";
const STYLE_ID = "qq-comfyui-theme-style";
const SETTING_ID = "QQ.ComfyUI.Theme";
const DEFAULT_THEME = "default";
const PAPER_THEME = "recycled-paper";

const THEMES = {
    [DEFAULT_THEME]: { label: "默认主题" },
    [PAPER_THEME]: { label: "再生纸主题" },
};

const PAPER_TEXTURE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180' viewBox='0 0 180 180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.72' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='1 0 0 0 0 0 1 0 0 0 1 0 0 0 0 0 0 0 .055 0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='.55'/%3E%3C/svg%3E";

function getTheme() {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return THEMES[value] ? value : DEFAULT_THEME;
}

function ensureStyle() {
    let style = document.getElementById(STYLE_ID);
    if (style) return style;
    style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        :root[data-qq-theme="${PAPER_THEME}"] {
            --qq-paper-bg: #e7dfcf;
            --qq-paper-panel: #ded4c2;
            --qq-paper-menu: #d7ccb9;
            --qq-paper-border: #b9aa94;
            --qq-paper-text: #403b34;
            --qq-paper-muted: #70685d;
            --qq-paper-hover: #c9bca7;
        }
        :root[data-qq-theme="${PAPER_THEME}"] body {
            background-color: var(--qq-paper-bg) !important;
            background-image: url("${PAPER_TEXTURE}") !important;
            color: var(--qq-paper-text);
        }
        :root[data-qq-theme="${PAPER_THEME}"] #graph-canvas,
        :root[data-qq-theme="${PAPER_THEME}"] .litegraph {
            background-color: transparent !important;
        }
        :root[data-qq-theme="${PAPER_THEME}"] #comfy-menu,
        :root[data-qq-theme="${PAPER_THEME}"] .comfy-menu,
        :root[data-qq-theme="${PAPER_THEME}"] .comfy-modal,
        :root[data-qq-theme="${PAPER_THEME}"] .comfy-menus {
            background-color: var(--qq-paper-menu) !important;
            color: var(--qq-paper-text) !important;
            border-color: var(--qq-paper-border) !important;
        }
        :root[data-qq-theme="${PAPER_THEME}"] button,
        :root[data-qq-theme="${PAPER_THEME}"] input,
        :root[data-qq-theme="${PAPER_THEME}"] select,
        :root[data-qq-theme="${PAPER_THEME}"] textarea {
            background-color: color-mix(in srgb, var(--qq-paper-panel) 88%, white) !important;
            color: var(--qq-paper-text) !important;
            border-color: var(--qq-paper-border) !important;
        }
        :root[data-qq-theme="${PAPER_THEME}"] button:hover,
        :root[data-qq-theme="${PAPER_THEME}"] [role="menuitem"]:hover {
            background-color: var(--qq-paper-hover) !important;
        }
    `;
    document.head.append(style);
    return style;
}

function applyTheme(theme) {
    const next = THEMES[theme] ? theme : DEFAULT_THEME;
    if (next === DEFAULT_THEME) document.documentElement.removeAttribute("data-qq-theme");
    else document.documentElement.dataset.qqTheme = next;
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
}

function registerBuiltInSetting() {
    const addSetting = app?.ui?.settings?.addSetting;
    if (typeof addSetting !== "function") return false;
    addSetting.call(app.ui.settings, {
        id: SETTING_ID,
        name: "界面主题",
        type: "combo",
        defaultValue: getTheme(),
        options: Object.fromEntries(
            Object.entries(THEMES).map(([value, theme]) => [theme.label, value]),
        ),
        onChange: (value) => applyTheme(value),
    });
    return true;
}

app.registerExtension({
    name: "QQ.ThemeSwitcher",
    setup() {
        ensureStyle();
        applyTheme(getTheme());
        registerBuiltInSetting();
    },
});
