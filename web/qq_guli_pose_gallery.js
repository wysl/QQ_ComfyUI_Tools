import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// QQ-白模参考 的前端：三段折叠图库（姿态 / 脸模 / 服装）。
//
// 默认三行都收起，只显示「类型 + 当前选中项的缩略图 + 名字」；
// 点某一行才展开该类型的缩略图网格，点缩略图即选中并自动收起。
// 缩略图统一按固定格子缩放（object-fit: cover），不会像旧版那样堆叠。
//
// 数据全部来自 /qq_gulipose/<lib>/index.json，图片落在用户目录，插件目录不存图。

const NODE_NAME = "QQGuliPosePicker";
const PREFIX = "/qq_gulipose";

const LIBS = [
	{ key: "pose", label: "姿态", widget: "姿态" },
	{ key: "face", label: "脸模", widget: "脸模" },
	{ key: "garment", label: "服装", widget: "服装" },
];

const UNUSED = "未使用";
const CELL = 72; // 缩略图格子边长，自动缩放用
const MIN_BODY_H = 190;
const HEADER_H = 40;

const CSS = `
.qq-gp{box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:4px;padding:4px;
  background:var(--comfy-menu-bg,#1e2128);color:var(--input-text,#e6e8ee);border-radius:6px;
  overflow:hidden;font:12px/1.35 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.qq-gp *{box-sizing:border-box}
.qq-gp-sec{flex:0 0 auto;display:flex;flex-direction:column;min-height:0;
  border:1px solid var(--border-color,#39404d);border-radius:6px;background:var(--comfy-input-bg,#12141a)}
.qq-gp-sec[data-open="1"]{flex:1 1 auto;min-height:0}
.qq-gp-hd{display:flex;align-items:center;gap:6px;width:100%;height:${HEADER_H}px;padding:0 6px;
  background:transparent;border:0;color:inherit;font:inherit;cursor:pointer;text-align:left}
.qq-gp-hd:hover .qq-gp-cap{color:var(--qq-gp-ac,#4f8cff)}
.qq-gp-cap{flex:0 0 auto;font-weight:600}
.qq-gp-mini{flex:0 0 auto;width:28px;height:28px;border-radius:4px;object-fit:cover;
  background:#0b0d12;border:1px solid var(--border-color,#39404d)}
.qq-gp-sec[data-open="1"] .qq-gp-mini{width:64px;height:64px}
.qq-gp-cur{flex:1 1 auto;min-width:0;color:var(--descrip-text,#96a0b0);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qq-gp-badge{flex:0 0 auto;padding:0 5px;border-radius:8px;font-size:10px;
  background:rgba(79,140,255,.16);color:var(--qq-gp-ac,#4f8cff)}
.qq-gp-caret{flex:0 0 auto;color:var(--descrip-text,#96a0b0);transition:transform .12s}
.qq-gp-sec[data-open="1"] .qq-gp-caret{transform:rotate(90deg)}
.qq-gp-body{display:none;flex:1 1 auto;min-height:0;flex-direction:column;gap:5px;padding:0 5px 5px}
.qq-gp-sec[data-open="1"] .qq-gp-body{display:flex}
.qq-gp-tools{display:flex;gap:5px;align-items:center;flex:0 0 auto}
.qq-gp-tools input{flex:1 1 auto;min-width:0;height:22px;padding:0 6px;border-radius:4px;
  border:1px solid var(--border-color,#39404d);background:var(--comfy-input-bg,#12141a);
  color:inherit;font:inherit}
.qq-gp-btn{flex:0 0 auto;height:22px;padding:0 8px;border-radius:4px;cursor:pointer;
  border:1px solid var(--border-color,#39404d);background:var(--comfy-input-bg,#12141a);
  color:inherit;font:inherit}
.qq-gp-btn:hover{border-color:var(--qq-gp-ac,#4f8cff);color:var(--qq-gp-ac,#4f8cff)}
.qq-gp-grid{flex:1 1 auto;min-height:0;overflow-y:auto;display:grid;gap:5px;
  grid-template-columns:repeat(auto-fill,${CELL}px);
  grid-auto-rows:${CELL}px;align-content:start}
.qq-gp-cell{position:relative;width:${CELL}px;height:${CELL}px;padding:0;
  border:1px solid var(--border-color,#39404d);border-radius:5px;background:#0f1116;
  cursor:pointer;overflow:hidden}
.qq-gp-cell img{width:100%;height:100%;object-fit:cover;display:block}
.qq-gp-cell:hover{border-color:var(--qq-gp-ac,#4f8cff)}
.qq-gp-cell[data-on="1"]{border-color:var(--qq-gp-ac,#4f8cff);
  box-shadow:0 0 0 1px var(--qq-gp-ac,#4f8cff) inset}
.qq-gp-cell .qq-gp-tag{position:absolute;left:0;right:0;bottom:0;padding:1px 3px;font-size:9px;
  background:rgba(10,12,16,.74);color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qq-gp-empty{grid-column:1/-1;padding:12px 6px;text-align:center;line-height:1.6;
  color:var(--descrip-text,#96a0b0)}
.qq-gp-empty code{background:rgba(255,255,255,.06);padding:1px 4px;border-radius:3px;
  word-break:break-all}
.qq-gp-foot{flex:0 0 auto;display:flex;justify-content:space-between;gap:8px;
  color:var(--descrip-text,#96a0b0);font-size:10px;padding-top:2px}
.qq-gp-foot span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;

function injectCSS() {
	if (document.getElementById("qq-gp-css")) return;
	const el = document.createElement("style");
	el.id = "qq-gp-css";
	el.textContent = CSS;
	document.head.append(el);
}

function imgURL(lib, name) {
	return api.apiURL(`${PREFIX}/${lib}/img/${encodeURIComponent(name)}`);
}

function thumbURL(lib, name) {
	return api.apiURL(`${PREFIX}/${lib}/thumb/${encodeURIComponent(name)}`);
}

function firstImage(item) {
	const angles = item?.angles ?? {};
	const entry = angles.front ?? Object.values(angles)[0];
	return entry?.img ?? "";
}

const dbCache = new Map();

async function loadLib(lib, force = false) {
	if (!force && dbCache.has(lib)) return dbCache.get(lib);
	const res = await api.fetchApi(`${PREFIX}/${lib}/index.json`);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const data = await res.json();
	dataCacheSet(lib, data);
	return data;
}

function dataCacheSet(lib, data) {
	dbCache.set(lib, data);
}

function setWidget(node, widget, value) {
	if (!widget || widget.value === value) return false;
	widget.value = value;
	widget.callback?.(value, app.canvas, node, null, null);
	node.graph?.setDirtyCanvas(true, true);
	return true;
}

function hideWidget(widget) {
	if (!widget || widget.__qqGpHidden) return;
	widget.__qqGpHidden = true;
	widget.__qqGpOrigType = widget.type;
	widget.__qqGpOrigCompute = widget.computeSize;
	widget.hidden = true;
	widget.type = "hidden";
	widget.options ||= {};
	widget.options.hidden = true;
	widget.computeSize = () => [0, -4];
}

function setup(node) {
	injectCSS();

	const widgets = {};
	for (const lib of LIBS) {
		const widget = node.widgets?.find((w) => w.name === lib.widget);
		if (!widget) return; // 控件缺失就放弃画廊，节点仍可手选
		widgets[lib.key] = widget;
		hideWidget(widget);
	}

	const root = document.createElement("div");
	root.className = "qq-gp";

	const sections = {};
	for (const lib of LIBS) {
		const sec = document.createElement("div");
		sec.className = "qq-gp-sec";
		sec.dataset.open = "0";
		sec.innerHTML = `
			<button class="qq-gp-hd" type="button">
				<span class="qq-gp-cap">${lib.label}</span>
				<img class="qq-gp-mini" alt="" hidden>
				<span class="qq-gp-cur">未选择</span>
				<span class="qq-gp-badge">0</span>
				<span class="qq-gp-caret">▶</span>
			</button>
			<div class="qq-gp-body">
				<div class="qq-gp-tools">
					<input class="qq-gp-search" type="text" placeholder="搜索名称">
					<button class="qq-gp-btn qq-gp-rand" type="button" title="随机挑一张">随机</button>
					<button class="qq-gp-btn qq-gp-imp" type="button" title="导入图片（存到用户目录）">导入</button>
					<button class="qq-gp-btn qq-gp-clear" type="button" title="改回未使用">清除</button>
				</div>
				<div class="qq-gp-grid"></div>
				<div class="qq-gp-foot"><span class="qq-gp-count"></span><span class="qq-gp-hint"></span></div>
			</div>`;
		root.append(sec);

		const fileInput = document.createElement("input");
		fileInput.type = "file";
		fileInput.accept = "image/*";
		fileInput.multiple = true;
		fileInput.style.display = "none";
		sec.append(fileInput);

		sections[lib.key] = {
			lib,
			sec,
			hd: sec.querySelector(".qq-gp-hd"),
			mini: sec.querySelector(".qq-gp-mini"),
			cur: sec.querySelector(".qq-gp-cur"),
			badge: sec.querySelector(".qq-gp-badge"),
			grid: sec.querySelector(".qq-gp-grid"),
			search: sec.querySelector(".qq-gp-search"),
			count: sec.querySelector(".qq-gp-count"),
			hint: sec.querySelector(".qq-gp-hint"),
			fileInput,
			keyword: "",
			data: null,
			expanded: false,
		};
	}

	const gallery = node.addDOMWidget("qq_gp_gallery", "qq_gp_gallery", root, {
		serialize: false,
		hideOnZoom: false,
		getMinHeight: () => HEADER_H * LIBS.length + MIN_BODY_H,
	});

	let expandedKey = null;

	// 节点高度跟着「有没有展开」走：收起时只有三行表头，展开时给网格留出空间。
	function refreshGallerySize() {
		const height = HEADER_H * LIBS.length + (expandedKey ? MIN_BODY_H : 8) + 34;
		const width = node.size?.[0] ?? 340;
		node.setSize?.([width, height]);
		node.graph?.setDirtyCanvas(true, true);
	}

	function currentLabel(lib) {
		const value = widgets[lib.key]?.value ?? UNUSED;
		return value === UNUSED ? UNUSED : value;
	}

	function renderHeader(state) {
		const label = currentLabel(state.lib);
		const chosen = (state.data?.items ?? []).find((item) => item.label === label);
		state.badge.textContent = String(state.data?.items?.length ?? 0);
		state.cur.textContent = chosen ? chosen.label : UNUSED;
		state.cur.title = chosen ? chosen.label : UNUSED;
		const src = chosen ? firstImage(chosen) : "";
		if (src) {
			state.mini.hidden = false;
			state.mini.src = thumbURL(state.lib.key, src);
		} else {
			state.mini.hidden = true;
			state.mini.removeAttribute("src");
		}
	}

	function renderGrid(state) {
		const items = state.data?.items ?? [];
		const keyword = state.keyword.trim().toLowerCase();
		const shown = keyword
			? items.filter((item) => String(item.label).toLowerCase().includes(keyword))
			: items;
		const chosen = currentLabel(state.lib);

		state.grid.replaceChildren();
		if (!shown.length) {
			const empty = document.createElement("div");
			empty.className = "qq-gp-empty";
			if (!items.length) {
				empty.innerHTML = `这里还没有图。点「导入」放几张，或把图片丢进<br><code>ComfyUI/user/QQ_ComfyUI_Tools/GuliPoses/${state.lib.key}/img/</code>`;
			} else {
				empty.textContent = "没有匹配的名称，换个关键词。";
			}
			state.grid.append(empty);
		}

		const frag = document.createDocumentFragment();
		for (const item of shown) {
			const src = firstImage(item);
			if (!src) continue;
			const cell = document.createElement("button");
			cell.type = "button";
			cell.className = "qq-gp-cell";
			cell.title = item.label;
			if (item.label === chosen) cell.dataset.on = "1";
			const img = document.createElement("img");
			img.loading = "lazy";
			img.decoding = "async";
			img.src = thumbURL(state.lib.key, src);
			img.alt = item.label;
			const tag = document.createElement("span");
			tag.className = "qq-gp-tag";
			tag.textContent = item.label;
			cell.append(img, tag);
			cell.addEventListener("click", () => {
				setWidget(node, widgets[state.lib.key], item.label);
				collapseAll();
				syncAll();
			});
			cell.addEventListener("contextmenu", async (event) => {
				event.preventDefault();
				if (!confirm(`删除「${item.label}」这张图？\n文件会从用户目录里删掉，不可恢复。`)) return;
				for (const entry of Object.values(item.angles ?? {})) {
					if (!entry?.img) continue;
					try {
						await api.fetchApi(`${PREFIX}/${state.lib.key}/delete`, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ name: entry.img }),
						});
					} catch (err) {
						console.error("[QQ-白模参考] 删除失败", err);
					}
				}
				await reload(state.lib.key, true);
				syncAll();
			});
			frag.append(cell);
		}
		state.grid.append(frag);

		state.count.textContent = keyword
			? `匹配 ${shown.length} / ${items.length}`
			: `共 ${items.length} 张`;
		state.hint.textContent = `已选：${chosen === UNUSED ? "未使用" : chosen}`;
		state.hint.title = state.hint.textContent;
	}

	function syncAll() {
		for (const lib of LIBS) {
			const state = sections[lib.key];
			renderHeader(state);
			if (state.expanded) renderGrid(state);
		}
	}

	function collapseAll(exceptKey = null) {
		expandedKey = exceptKey;
		for (const lib of LIBS) {
			const state = sections[lib.key];
			state.expanded = lib.key === exceptKey;
			state.sec.dataset.open = state.expanded ? "1" : "0";
		}
		refreshGallerySize();
	}

	async function reload(key, force) {
		const state = sections[key];
		try {
			state.data = await loadLib(key, force);
		} catch (err) {
			state.data = { items: [], angles: [] };
			state.hint.textContent = `读取失败：${err.message ?? err}`;
		}
		renderHeader(state);
		if (state.expanded) renderGrid(state);
	}

	// ---- 交互 ----
	for (const lib of LIBS) {
		const state = sections[lib.key];

		state.hd.addEventListener("click", () => {
			if (expandedKey === lib.key) {
				collapseAll();
			} else {
				collapseAll(lib.key);
				reload(lib.key).then(() => renderGrid(state));
			}
			syncAll();
		});

		state.search.addEventListener("input", () => {
			state.keyword = state.search.value;
			renderGrid(state);
		});

		state.sec.querySelector(".qq-gp-clear").addEventListener("click", () => {
			setWidget(node, widgets[lib.key], UNUSED);
			renderGrid(state);
			renderHeader(state);
		});

		state.sec.querySelector(".qq-gp-rand").addEventListener("click", () => {
			const items = state.data?.items ?? [];
			if (!items.length) return;
			const picked = items[Math.floor(Math.random() * items.length)];
			setWidget(node, widgets[lib.key], picked.label);
			renderGrid(state);
			renderHeader(state);
		});

		state.sec.querySelector(".qq-gp-imp").addEventListener("click", () => state.fileInput.click());

		state.fileInput.addEventListener("change", async () => {
			const files = [...(state.fileInput.files ?? [])];
			state.fileInput.value = "";
			if (!files.length) return;
			let ok = 0;
			for (const file of files) {
				state.hint.textContent = `导入中… ${ok}/${files.length}`;
				const form = new FormData();
				form.append("file", file, file.name);
				try {
					const res = await api.fetchApi(`${PREFIX}/${lib.key}/upload`, {
						method: "POST",
						body: form,
					});
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					const body = await res.json();
					if (body?.index) dataCacheSet(lib.key, body.index);
					ok += 1;
				} catch (err) {
					console.error("[QQ-白模参考] 导入失败", file.name, err);
				}
			}
			state.hint.textContent = `已导入 ${ok}/${files.length} 张`;
			await reload(lib.key, true);
			renderGrid(state);
		});
	}

	collapseAll();
	refreshGallerySize();
	Promise.all(LIBS.map((lib) => reload(lib.key))).then(() => syncAll());
	node.__qqGpSync = syncAll;
}

app.registerExtension({
	name: "QQ.GuliReferenceGallery",
	beforeRegisterNodeDef(nodeType, nodeData) {
		if (nodeData?.name !== NODE_NAME) return;
		if (nodeType.prototype.__qqGpPatched) return;
		nodeType.prototype.__qqGpPatched = true;

		const onNodeCreated = nodeType.prototype.onNodeCreated;
		nodeType.prototype.onNodeCreated = function () {
			const result = onNodeCreated?.apply(this, arguments);
			// 画廊装不上也不能影响节点本身可用：只告警，保留下拉框与输出
			try {
				setup(this);
			} catch (err) {
				console.error("[QQ-白模参考] 画廊初始化失败，下拉框仍可用：", err);
			}
			return result;
		};

		// 从存档恢复后重新读一遍库（可能换了图）
		const onConfigure = nodeType.prototype.onConfigure;
		nodeType.prototype.onConfigure = function () {
			const result = onConfigure?.apply(this, arguments);
			try {
				this.__qqGpSync?.();
			} catch (err) {
				console.error("[QQ-白模参考] 刷新失败：", err);
			}
			return result;
		};
	},
});
