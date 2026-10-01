import { app } from "../../scripts/app.js";

const STORAGE_KEY = "qq-comfyui-theme";
const STYLE_ID = "qq-comfyui-theme-style";
const MENU_ID = "qq-comfyui-theme-menu";
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
        #${MENU_ID} {
            position: relative;
            display: inline-flex;
            align-items: center;
            margin-left: 6px;
            z-index: 10001;
        }
        #${MENU_ID} > button {
            min-height: 28px;
            padding: 4px 9px;
            border: 1px solid var(--border-color, rgba(255,255,255,.18));
            border-radius: 4px;
            background: var(--comfy-menu-bg, rgba(30,34,38,.88));
            color: var(--fg-color, #ddd);
            cursor: pointer;
            font: inherit;
        }
        #${MENU_ID} > button:hover { filter: brightness(1.12); }
        #${MENU_ID} > div {
            position: absolute;
            top: calc(100% + 4px);
            right: 0;
            min-width: 132px;
            padding: 4px;
            border: 1px solid var(--border-color, rgba(255,255,255,.18));
            border-radius: 5px;
            background: var(--comfy-menu-bg, #25292d);
            box-shadow: 0 8px 22px rgba(0,0,0,.35);
        }
        #${MENU_ID}[data-open="false"] > div { display: none; }
        #${MENU_ID} [role="menuitem"] {
            display: block;
            width: 100%;
            padding: 7px 9px;
            border: 0;
            border-radius: 3px;
            background: transparent;
            color: var(--fg-color, #ddd);
            text-align: left;
            cursor: pointer;
            font: inherit;
        }
        #${MENU_ID} [role="menuitem"]:hover { background: var(--comfy-menu-hover-bg, rgba(255,255,255,.1)); }
        #${MENU_ID} [aria-checked="true"]::before { content: "✓ "; }
    `;
    document.head.append(style);
    return style;
}

function applyTheme(theme) {
    const next = THEMES[theme] ? theme : DEFAULT_THEME;
    if (next === DEFAULT_THEME) document.documentElement.removeAttribute("data-qq-theme");
    else document.documentElement.dataset.qqTheme = next;
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
    const menu = document.getElementById(MENU_ID);
    menu?.querySelectorAll("[role=menuitem]").forEach((item) => {
        item.setAttribute("aria-checked", item.dataset.theme === next ? "true" : "false");
    });
}

function menuHost() {
    const selectors = [
        "header", 
        "#comfy-header",
        ".comfyui-menu",
        ".comfy-menu-bar",
        ".comfy-top-menu",
        "body > div:first-child",
    ];
    return selectors.map((selector) => document.querySelector(selector)).find(Boolean) || document.body;
}

function buildMenu() {
    if (document.getElementById(MENU_ID)) return true;
    const host = menuHost();
    if (!host) return false;

    const menu = document.createElement("div");
    menu.id = MENU_ID;
    menu.dataset.open = "false";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "主题";
    button.title = "切换 ComfyUI 界面主题";
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    const popup = document.createElement("div");
    popup.setAttribute("role", "menu");
    for (const [key, value] of Object.entries(THEMES)) {
        const item = document.createElement("button");
        item.type = "button";
        item.dataset.theme = key;
        item.setAttribute("role", "menuitem");
        item.setAttribute("aria-checked", "false");
        item.textContent = value.label;
        item.addEventListener("click", () => {
            applyTheme(key);
            menu.dataset.open = "false";
            button.setAttribute("aria-expanded", "false");
        });
        popup.append(item);
    }
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        const open = menu.dataset.open !== "true";
        menu.dataset.open = String(open);
        button.setAttribute("aria-expanded", String(open));
    });
    menu.append(button, popup);
    host.append(menu);
    applyTheme(getTheme());
    return true;
}

app.registerExtension({
    name: "QQ.ThemeSwitcher",
    setup() {
        ensureStyle();
        applyTheme(getTheme());
        buildMenu();
        const observer = new MutationObserver(() => buildMenu());
        observer.observe(document.body, { childList: true, subtree: true });
        document.addEventListener("click", (event) => {
            const menu = document.getElementById(MENU_ID);
            if (menu && !menu.contains(event.target)) {
                menu.dataset.open = "false";
                menu.querySelector("button")?.setAttribute("aria-expanded", "false");
            }
        });
    },
});
