import { app } from "../../scripts/app.js";

const PALETTE_ID = "qq-recycled-paper";
const PALETTES_SETTING = "Comfy.CustomColorPalettes";

app.registerExtension({
    name: "QQ.ThemeSwitcher",
    async setup() {
        // Remove the previous CSS overlay so native palettes can restore colors.
        document.getElementById("qq-comfyui-theme-style")?.remove();
        document.getElementById("qq-comfyui-theme-menu")?.remove();
        document.documentElement.removeAttribute("data-qq-theme");

        const settings = app.extensionManager?.setting;
        const legacy = app.ui?.settings;
        const get = settings?.get?.bind(settings) || legacy?.getSettingValue?.bind(legacy);
        const set = settings?.set?.bind(settings)
            || legacy?.setSettingValueAsync?.bind(legacy)
            || legacy?.setSettingValue?.bind(legacy);
        if (!get || !set) {
            console.warn("[QQ.ThemeSwitcher] Theme settings API unavailable; import recycled_paper.json using the native palette import button.");
            return;
        }

        const response = await fetch(new URL("./recycled_paper.json", import.meta.url));
        if (!response.ok) throw new Error(`[QQ.ThemeSwitcher] Palette load failed: ${response.status}`);
        const palette = await response.json();
        const existing = get(PALETTES_SETTING) || {};
        if (JSON.stringify(existing[PALETTE_ID]) === JSON.stringify(palette)) return;
        // Preserve every other custom palette and the currently selected theme.
        await set(PALETTES_SETTING, { ...existing, [PALETTE_ID]: palette });
    },
});
