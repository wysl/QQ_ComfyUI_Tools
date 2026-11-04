import { api } from "../../scripts/api.js";

// 预制图像参考的共享选择层：QQ-预制图像参考 与 QQ-多媒体加载 内置入口共用。
//
// 令牌格式：姿态是「条目::视角」，脸模/服装就是条目名，用 | 连接。
// 这里只做纯数据（拆分/编号/摘要/过滤/拼格子）和全屏选择层，
// 节点面板的样式与布局仍由各自负责。

export const PREFIX = "/qq_gulipose";
export const SEP = "|";
export const ANGLE_SEP = "::";
export const CAT_ALL = "/";
export const LANES = [
    { lib: "pose", label: "姿态" },
    { lib: "face", label: "脸模" },
    { lib: "cloth", label: "服装" },
];

export const UNUSED = "未使用";

/* ---------------- 纯数据 ---------------- */

export function parseTokens(raw) {
    const text = String(raw ?? "");
    const seen = [];
    for (const piece of text.split(SEP)) {
        const name = piece.trim();
        if (name && name !== UNUSED && !seen.includes(name)) seen.push(name);
    }
    return seen;
}

export function tokenLabel(token) {
    return String(token).split(ANGLE_SEP)[0];
}

export function tokenAngle(token) {
    return String(token).split(ANGLE_SEP)[1] ?? "";
}

export function tokenOf(item, key) {
    return key ? `${item.label}${ANGLE_SEP}${key}` : item.label;
}

/** "未使用" / "3 张：A、B…" —— 面板摘要用。 */
export function summarize(tokens) {
    const list = Array.isArray(tokens) ? tokens : parseTokens(tokens);
    if (!list.length) return UNUSED;
    const names = list.map((token) => tokenLabel(token));
    const head = names.slice(0, 2).join("、");
    return `${list.length} 张：${head}${list.length > 2 ? "…" : ""}`;
}

export function angleLabel(data, key) {
    const found = (data?.angles || []).find((entry) => entry.key === key);
    return found?.label || key || "";
}

/** "/" 表示全部（按子目录分组），其它值只留对应子目录。 */
export function filterItems(data, cat = CAT_ALL, keyword = "") {
    const needle = String(keyword || "").trim().toLowerCase();
    return (data?.items || []).filter((item) => {
        if (cat && cat !== CAT_ALL && (item.cat || "") !== cat) return false;
        if (!needle) return true;
        return String(item.label || "").toLowerCase().includes(needle);
    });
}

/** 一格一图：多视角条目按「序号 · 视角」拆开，单视角条目一格。 */
export function refTiles(data, items = null) {
    const source = items || data?.items || [];
    const tiles = [];
    for (const item of source) {
        const angles = Object.entries(item.angles || {}).filter(([, entry]) => entry?.img);
        if (!angles.length) continue;
        const leaf = String(item.label || "").split("/").pop();
        if (angles.length > 1) {
            for (const [key, entry] of angles) {
                tiles.push({
                    token: tokenOf(item, key),
                    img: entry.img,
                    caption: `${leaf} · ${angleLabel(data, key)}`,
                });
            }
        } else {
            tiles.push({ token: item.label, img: angles[0][1].img, caption: leaf });
        }
    }
    return tiles;
}

export function thumbURL(lib, name) {
    return api.apiURL(`${PREFIX}/${lib}/thumb?name=${encodeURIComponent(name)}`);
}

export function imageURL(lib, name) {
    return api.apiURL(`${PREFIX}/${lib}/img?name=${encodeURIComponent(name)}`);
}

const indexCache = new Map();

/** 读图库索引；force=true 时重新拉（刷新按钮用）。 */
export async function fetchLibIndex(lib, force = false) {
    if (!force && indexCache.has(lib)) return indexCache.get(lib);
    const res = await api.fetchApi(`${PREFIX}/${lib}/index.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    indexCache.set(lib, data);
    return data;
}

/* ---------------- 样式 ---------------- */

const CSS = `
.qq-gr-overlay{position:fixed;inset:0;z-index:12000;display:flex;flex-direction:column;
  background:rgba(10,12,16,.92);color:var(--fg-color,#e3e7ea);
  font:12px/1.35 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.qq-gr-panel{display:flex;flex-direction:column;width:min(980px,calc(100vw - 32px));
  height:min(720px,calc(100vh - 32px));margin:auto;border:1px solid var(--border-color,#4b545b);
  border-radius:8px;background:var(--comfy-menu-bg,#25292d);overflow:hidden;
  box-shadow:0 18px 55px rgba(0,0,0,.55)}
.qq-gr-head{display:flex;align-items:center;gap:8px;padding:9px 11px;
  border-bottom:1px solid rgba(255,255,255,.1)}
.qq-gr-title{flex:1 1 auto;font-weight:600;font-size:13px}
.qq-gr-btn{height:24px;padding:0 10px;border-radius:5px;cursor:pointer;
  border:1px solid var(--border-color,#4b545b);background:var(--comfy-input-bg,#1a1d22);
  color:inherit;font:inherit}
.qq-gr-btn:hover{border-color:var(--p-primary-color,#85a8c4)}
.qq-gr-btn.primary{background:#3b6fd4;border-color:#3b6fd4;color:#fff}
.qq-gr-tools{display:flex;gap:6px;align-items:center;padding:8px 11px;
  border-bottom:1px solid rgba(255,255,255,.06)}
.qq-gr-tools input,.qq-gr-tools select{height:24px;min-width:0;padding:0 6px;border-radius:5px;
  border:1px solid var(--border-color,#4b545b);background:var(--comfy-input-bg,#1a1d22);
  color:inherit;font:inherit}
.qq-gr-tools input{flex:1 1 auto}
.qq-gr-tools select{flex:0 0 26%}
.qq-gr-grid{flex:1 1 auto;min-height:0;overflow-y:auto;padding:10px;display:grid;gap:6px;
  grid-template-columns:repeat(auto-fill,minmax(96px,1fr));grid-auto-rows:110px;align-content:start}
.qq-gr-tile{position:relative;height:110px;padding:0;border:2px solid transparent;border-radius:8px;
  overflow:hidden;background:#0d1015;cursor:pointer}
.qq-gr-tile img{display:block;width:100%;height:100%;object-fit:cover}
.qq-gr-tile[data-on="1"]{border-color:#4f8cff}
.qq-gr-tile span.qq-gr-cap{position:absolute;left:0;right:0;bottom:0;padding:2px 4px;font-size:10px;
  background:rgba(8,10,14,.74);color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qq-gr-tile b{position:absolute;right:4px;top:4px;min-width:16px;height:16px;border-radius:8px;
  background:#4f8cff;color:#fff;font-size:10px;line-height:16px;text-align:center;font-weight:600}
.qq-gr-tile button.qq-gr-zoom{position:absolute;left:4px;top:4px;width:20px;height:20px;padding:0;
  border:0;border-radius:10px;background:rgba(8,10,14,.7);color:#fff;font-size:11px;line-height:20px;
  cursor:zoom-in}
.qq-gr-empty{grid-column:1/-1;padding:26px 10px;text-align:center;color:#8b95a5;line-height:1.7}
.qq-gr-viewer{position:fixed;inset:0;z-index:12100;background:#000;display:flex;
  align-items:center;justify-content:center;overflow:auto}
.qq-gr-viewer img{max-width:100%;max-height:100%}
`;

export function injectStyles() {
    if (document.getElementById("qq-gr-css")) return;
    const style = document.createElement("style");
    style.id = "qq-gr-css";
    style.textContent = CSS;
    document.head.append(style);
}

/* ---------------- 选择层 ---------------- */

/**
 * 打开一个图库的全屏选择层。
 *
 * tokens 是当前的令牌数组，点「完成」时通过 onChange(tokensString) 回写。
 * 返回一个 Promise，在层关闭时 resolve，方便调用方刷新摘要。
 */
export function openGuliPicker({ lib, tokens = [], title = "", onChange = null }) {
    injectStyles();
    const selected = new Set(tokens);
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "qq-gr-overlay";
        overlay.innerHTML = `
            <div class="qq-gr-panel">
                <div class="qq-gr-head">
                    <button type="button" class="qq-gr-btn" data-role="close">关闭</button>
                    <span class="qq-gr-title"></span>
                    <button type="button" class="qq-gr-btn primary" data-role="done">完成</button>
                </div>
                <div class="qq-gr-tools">
                    <input type="search" data-role="search" placeholder="搜索名称">
                    <select data-role="cat" title="按子目录筛选"></select>
                    <button type="button" class="qq-gr-btn" data-role="random">随机</button>
                    <button type="button" class="qq-gr-btn" data-role="import">导入</button>
                    <button type="button" class="qq-gr-btn" data-role="refresh">刷新</button>
                    <button type="button" class="qq-gr-btn" data-role="clear">清空</button>
                </div>
                <div class="qq-gr-grid"></div>
            </div>`;
        overlay.querySelector(".qq-gr-title").textContent = title || "";

        const grid = overlay.querySelector(".qq-gr-grid");
        const search = overlay.querySelector('[data-role="search"]');
        const cat = overlay.querySelector('[data-role="cat"]');
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "image/*";
        fileInput.multiple = true;
        fileInput.style.display = "none";
        overlay.append(fileInput);

        let data = null;
        let keyword = "";
        let category = CAT_ALL;

        const close = (commit) => {
            if (commit) onChange?.([...selected].join(SEP));
            overlay.remove();
            document.body.style.removeProperty("overflow");
            resolve([...selected]);
        };

        const paint = () => {
            const tiles = refTiles(data, filterItems(data, category, keyword));
            grid.replaceChildren();
            if (!tiles.length) {
                const empty = document.createElement("div");
                empty.className = "qq-gr-empty";
                empty.textContent = (data?.items || []).length
                    ? "没有匹配的图片，换个关键词或分类。"
                    : "这个图库还没有图片，点「导入」或把图片放进 img/ 目录。";
                grid.append(empty);
                return;
            }
            let order = 0;
            const frag = document.createDocumentFragment();
            for (const tile of tiles) {
                const on = selected.has(tile.token);
                if (on) order += 1;
                const button = document.createElement("button");
                button.type = "button";
                button.className = "qq-gr-tile";
                button.dataset.on = on ? "1" : "0";
                button.dataset.token = tile.token;
                button.title = tile.caption;
                const img = document.createElement("img");
                img.loading = "lazy";
                img.src = thumbURL(lib, tile.img);
                img.alt = tile.caption;
                const cap = document.createElement("span");
                cap.className = "qq-gr-cap";
                cap.textContent = tile.caption;
                const badge = document.createElement("b");
                badge.textContent = String(order);
                badge.hidden = !on;
                const zoom = document.createElement("button");
                zoom.type = "button";
                zoom.className = "qq-gr-zoom";
                zoom.innerHTML =
                    '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor"'
                    + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
                    + '<path d="M9 3H3v6"/><path d="M15 3h6v6"/><path d="M9 21H3v-6"/>'
                    + '<path d="M21 15v6h-6"/></svg>';
                zoom.title = "查看原图";
                zoom.addEventListener("click", (event) => {
                    event.stopPropagation();
                    openViewer(imageURL(lib, tile.img));
                });
                button.append(img, cap, badge, zoom);
                button.addEventListener("click", () => {
                    if (selected.has(tile.token)) selected.delete(tile.token);
                    else selected.add(tile.token);
                    paint();
                });
                frag.append(button);
            }
            grid.append(frag);
        };

        const paintCats = () => {
            cat.replaceChildren();
            const options = [{ value: CAT_ALL, label: "/" }];
            for (const name of data?.cats || []) options.push({ value: name, label: name });
            for (const option of options) {
                const node = document.createElement("option");
                node.value = option.value;
                node.textContent = option.label;
                cat.append(node);
            }
            cat.value = options.some((option) => option.value === category) ? category : CAT_ALL;
            category = cat.value;
        };

        const load = async (force = false) => {
            grid.replaceChildren();
            const loading = document.createElement("div");
            loading.className = "qq-gr-empty";
            loading.textContent = "载入图库…";
            grid.append(loading);
            try {
                data = await fetchLibIndex(lib, force);
            } catch (error) {
                grid.replaceChildren();
                const failed = document.createElement("div");
                failed.className = "qq-gr-empty";
                failed.textContent = `读取图库失败：${error?.message ?? error}`;
                grid.append(failed);
                return;
            }
            paintCats();
            paint();
        };

        overlay.querySelector('[data-role="close"]').addEventListener("click", () => close(false));
        overlay.querySelector('[data-role="done"]').addEventListener("click", () => close(true));
        search.addEventListener("input", () => {
            keyword = search.value;
            paint();
        });
        cat.addEventListener("change", () => {
            category = cat.value;
            paint();
        });
        overlay.querySelector('[data-role="random"]').addEventListener("click", () => {
            const tiles = refTiles(data, filterItems(data, category, keyword));
            if (!tiles.length) return;
            selected.clear();
            selected.add(tiles[Math.floor(Math.random() * tiles.length)].token);
            paint();
        });
        overlay.querySelector('[data-role="clear"]').addEventListener("click", () => {
            selected.clear();
            paint();
        });
        overlay.querySelector('[data-role="refresh"]').addEventListener("click", () => load(true));
        overlay.querySelector('[data-role="import"]').addEventListener("click", () => fileInput.click());
        fileInput.addEventListener("change", async () => {
            const files = [...(fileInput.files || [])];
            fileInput.value = "";
            if (!files.length) return;
            for (const file of files) {
                const form = new FormData();
                form.append("file", file, file.name);
                if (category && category !== CAT_ALL) form.append("cat", category);
                try {
                    await api.fetchApi(`${PREFIX}/${lib}/upload`, { method: "POST", body: form });
                } catch (error) {
                    console.error("[QQ-预制图像参考] 导入失败", file.name, error);
                }
            }
            await load(true);
        });

        // 点击遮罩空白处关闭（保留选择）
        overlay.addEventListener("pointerdown", (event) => {
            if (event.target === overlay) close(false);
        });

        document.body.append(overlay);
        document.body.style.overflow = "hidden";
        load();
    });
}

/** 全屏看原图（浏览器自带缩放，手机可双指放大）。 */
export function openViewer(src) {
    injectStyles();
    const view = document.createElement("div");
    view.className = "qq-gr-viewer";
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    view.append(img);
    view.addEventListener("click", () => view.remove());
    document.body.append(view);
}
