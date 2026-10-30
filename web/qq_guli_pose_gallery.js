import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// QQ-预制图像参考 的前端：三段折叠图库（姿态 / 脸模 / 服装），每段可多选。
//
// 三个隐藏控件里存的是「名1|名2|名3」，后端正按这个顺序拼批次。
// 默认三行都收起，只显示「类型 + 已选张数 + 第一张的缩略图」；
// 点某一行才展开该类型的缩略图网格，点缩略图是**切换选中**（可多选）。
// 缩略图统一固定格子 + object-fit: cover，不会像旧版那样堆叠。

const NODE_NAME = "QQGuliPosePicker";
const PREFIX = "/qq_gulipose";
const SEP = "|";
const UNUSED = "未使用";

const LIBS = [
	{ key: "pose", label: "姿态", widget: "姿态" },
	{ key: "face", label: "脸模", widget: "脸模" },
	{ key: "cloth", label: "服装", widget: "服装" },
];

const CELL = 72; // 缩略图格子边长
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
.qq-gp-minis{flex:0 0 auto;display:flex;align-items:center;gap:2px}
.qq-gp-mini{flex:0 0 auto;width:22px;height:28px;border-radius:4px;object-fit:cover;
  background:#0b0d12;border:1px solid var(--border-color,#39404d)}
.qq-gp-cur{flex:1 1 auto;min-width:0;color:var(--descrip-text,#96a0b0);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qq-gp-pick{flex:0 0 auto;padding:0 5px;border-radius:8px;font-size:10px;
  background:rgba(79,140,255,.16);color:var(--qq-gp-ac,#4f8cff)}
.qq-gp-pick[data-zero="1"]{background:rgba(255,255,255,.06);color:var(--descrip-text,#96a0b0)}
.qq-gp-caret{flex:0 0 auto;color:var(--descrip-text,#96a0b0);transition:transform .12s}
.qq-gp-sec[data-open="1"] .qq-gp-caret{transform:rotate(90deg)}
.qq-gp-body{display:none;flex:1 1 auto;min-height:0;flex-direction:column;gap:5px;padding:0 5px 5px}
.qq-gp-sec[data-open="1"] .qq-gp-body{min-height:190px}
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
.qq-gp-cell[data-on="1"]::after{content:"✓";position:absolute;right:3px;top:1px;
  font-size:12px;font-weight:700;color:var(--qq-gp-ac,#4f8cff);
  text-shadow:0 0 3px #000,0 0 3px #000}
.qq-gp-cell .qq-gp-tag{position:absolute;left:0;right:0;bottom:0;padding:1px 3px;font-size:9px;
  background:rgba(10,12,16,.74);color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qq-gp-empty{grid-column:1/-1;padding:12px 6px;text-align:center;line-height:1.6;
  color:var(--descrip-text,#96a0b0)}
.qq-gp-empty code{background:rgba(255,255,255,.06);padding:1px 4px;border-radius:3px;
  word-break:break-all}
.qq-gp-foot{flex:0 0 auto;display:flex;justify-content:space-between;gap:8px;
  color:var(--descrip-text,#96a0b0);font-size:10px;padding-top:2px}
.qq-gp-foot span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qq-gp-hover{position:fixed;z-index:1400;box-sizing:border-box;display:block;overflow:hidden;
  padding:3px;border-radius:7px;border:1px solid var(--p-primary-color,#85a8c4);
  background:var(--comfy-menu-bg,#25292d);box-shadow:0 10px 28px rgba(0,0,0,.62);
  pointer-events:auto;cursor:zoom-in;opacity:0;transition:opacity .14s ease}
.qq-gp-hover.is-visible{opacity:1}
.qq-gp-hover img{display:block;width:100%;height:100%;object-fit:contain;border-radius:4px;
  background:#111;pointer-events:none}
`;

function injectCSS() {
	if (document.getElementById("qq-gp-css")) return;
	const el = document.createElement("style");
	el.id = "qq-gp-css";
	el.textContent = CSS;
	document.head.append(el);
}

// ---- 悬停大图预览（与 QQ-多媒体加载 同一做法：浮层 + 贴边定位）----
let hoverPreview = null;
let hoverCloseTimer = null;

function closeHoverPreview() {
	clearTimeout(hoverCloseTimer);
	hoverCloseTimer = null;
	hoverPreview?.remove();
	hoverPreview = null;
}

function positionHoverPreview(preview, anchor) {
	if (!preview?.isConnected || !anchor?.isConnected) return;
	const rect = anchor.getBoundingClientRect();
	const width = preview.offsetWidth || 200;
	const height = preview.offsetHeight || 200;
	const margin = 8;
	let left = rect.left + rect.width / 2 - width / 2;
	let top = rect.top - margin - height;
	if (top < margin) top = Math.min(window.innerHeight - margin - height, rect.bottom + margin);
	left = Math.max(margin, Math.min(window.innerWidth - margin - width, left));
	preview.style.left = `${Math.round(left)}px`;
	preview.style.top = `${Math.round(top)}px`;
}

function showHoverPreview(anchor, thumb, full) {
	closeHoverPreview();
	const preview = document.createElement("a");
	preview.className = "qq-gp-hover";
	preview.href = full || thumb;
	preview.target = "_blank";
	preview.rel = "noopener noreferrer";
	preview.title = "点击查看原图";
	const image = document.createElement("img");
	image.alt = "";
	image.decoding = "async";
	// 预览用缩略图就够（盒子最大也就 3×72），点开才是原图
	image.src = thumb;
	image.addEventListener("load", () => positionHoverPreview(preview, anchor), { once: true });
	preview.append(image);
	// 与 QQ-多媒体加载 一致：盒子各边 = 缩略图 3 倍，再夹到视口内
	const width = Math.round(
		Math.min(Math.max(anchor.clientWidth || 72, 48) * 3, window.innerWidth - 16)
	);
	const height = Math.round(
		Math.min(Math.max(anchor.clientHeight || 72, 48) * 3, window.innerHeight - 16)
	);
	preview.style.width = `${width}px`;
	preview.style.height = `${height}px`;
	preview.addEventListener("pointerenter", () => clearTimeout(hoverCloseTimer));
	preview.addEventListener("pointerleave", () => {
		clearTimeout(hoverCloseTimer);
		hoverCloseTimer = setTimeout(closeHoverPreview, 140);
	});
	preview.addEventListener("pointerdown", (event) => event.stopPropagation());
	preview.addEventListener("click", (event) => event.stopPropagation());
	document.body.append(preview);
	hoverPreview = preview;
	positionHoverPreview(preview, anchor);
	requestAnimationFrame(() => preview.classList.add("is-visible"));
}

function attachHoverPreview(anchor, thumb, full) {
	if (!anchor) return;
	anchor.__qqGpHoverThumb = thumb || "";
	anchor.__qqGpHoverFull = full || thumb || "";
	if (anchor.__qqGpHover) return;
	anchor.__qqGpHover = true;
	anchor.addEventListener("pointerenter", () => {
		if (anchor.__qqGpHoverThumb) {
			showHoverPreview(anchor, anchor.__qqGpHoverThumb, anchor.__qqGpHoverFull);
		}
	});
	anchor.addEventListener("pointerleave", () => {
		clearTimeout(hoverCloseTimer);
		hoverCloseTimer = setTimeout(closeHoverPreview, 140);
	});
}

function thumbURL(lib, name) {
	return api.apiURL(`${PREFIX}/${lib}/thumb/${encodeURIComponent(name)}`);
}

function imgURL(lib, name) {
	return api.apiURL(`${PREFIX}/${lib}/img/${encodeURIComponent(name)}`);
}

function firstImage(item) {
	const angles = item?.angles ?? {};
	const entry = angles.front ?? Object.values(angles)[0];
	return entry?.img ?? "";
}

const libData = new Map();

async function loadLib(lib, force = false) {
	if (!force && libData.has(lib)) return libData.get(lib);
	const res = await api.fetchApi(`${PREFIX}/${lib}/index.json`);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const data = await res.json();
	libData.set(lib, data);
	return data;
}

function hideWidget(widget) {
	if (!widget || widget.__qqGpHidden) return;
	widget.__qqGpHidden = true;
	widget.hidden = true;
	widget.type = "hidden";
	widget.options ||= {};
	widget.options.hidden = true;
	widget.computeSize = () => [0, -4];
}

function splitValue(value) {
	return String(value ?? "")
		.split(SEP)
		.map((piece) => piece.trim())
		.filter((piece) => piece && piece !== UNUSED);
}

function setup(node) {
	injectCSS();

	const widgets = {};
	for (const lib of LIBS) {
		const widget = node.widgets?.find((w) => w.name === lib.widget);
		if (!widget) return; // 控件缺失就放弃画廊，节点仍可手填
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
				<span class="qq-gp-minis"></span>
				<span class="qq-gp-cur">未选择</span>
				<span class="qq-gp-pick" data-zero="1">0</span>
				<span class="qq-gp-caret">▶</span>
			</button>
			<div class="qq-gp-body">
				<div class="qq-gp-tools">
					<input class="qq-gp-search" type="text" placeholder="搜索名称">
					<button class="qq-gp-btn qq-gp-rand" type="button" title="随机挑一张加入选择">随机</button>
					<button class="qq-gp-btn qq-gp-imp" type="button" title="导入图片（存到用户目录）">导入</button>
					<button class="qq-gp-btn qq-gp-clear" type="button" title="清空这一类的选择">清空</button>
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
			minis: sec.querySelector(".qq-gp-minis"),
			cur: sec.querySelector(".qq-gp-cur"),
			pick: sec.querySelector(".qq-gp-pick"),
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

	let expandedKey = null;

	const gallery = node.addDOMWidget("qq_gp_gallery", "qq_gp_gallery", root, {
		serialize: false,
		hideOnZoom: false,
		// 最小高度只给个下限，真正的尺寸由 fitToContent 按实测内容高度调
		getMinHeight: () => HEADER_H * LIBS.length,
	});

	// 按「内容实际需要的高度」和「当前可用高度」的差值调节点。
	// 不写死标题栏/行高常数：实测过一次就准，换主题、缩放、字体都不受影响。
	function fitToContent(attempt = 0) {
		if (!root?.isConnected) return;
		const need = root.scrollHeight;
		const have = root.clientHeight;
		if (!need || !have) return;
		const delta = need - have;
		if (Math.abs(delta) <= 2) return;
		const width = node.size?.[0] ?? 340;
		const height = Math.max(120, (node.size?.[1] ?? 200) + delta);
		node.setSize?.([width, height]);
		node.graph?.setDirtyCanvas(true, true);
		// 布局一帧后再量一次，收敛到刚好包住内容
		if (attempt < 3) requestAnimationFrame(() => fitToContent(attempt + 1));
	}

	function refreshGallerySize() {
		requestAnimationFrame(() => fitToContent());
	}

	function selected(state) {
		return splitValue(widgets[state.lib.key]?.value);
	}

	function setSelected(state, names) {
		const widget = widgets[state.lib.key];
		if (!widget) return;
		const value = names.join(SEP);
		if (widget.value === value) return;
		widget.value = value;
		widget.callback?.(value, app.canvas, node, null, null);
		node.graph?.setDirtyCanvas(true, true);
	}

	function renderHeader(state) {
		const names = selected(state);
		state.pick.textContent = String(names.length);
		state.pick.dataset.zero = names.length ? "0" : "1";
		if (!names.length) {
			state.cur.textContent = UNUSED;
			state.cur.title = UNUSED;
		} else if (names.length === 1) {
			state.cur.textContent = names[0];
			state.cur.title = names[0];
		} else {
			const head = names.slice(0, 2).join("、");
			state.cur.textContent = `${names.length} 张：${head}${names.length > 2 ? "…" : ""}`;
			state.cur.title = names.join("\n");
		}
		// 行头最多列出已选的前 3 张，多选时能一眼看出不止一张
		state.minis.replaceChildren();
		const picks = names
			.map((name) => (state.data?.items ?? []).find((item) => item.label === name))
			.filter(Boolean)
			.slice(0, 3);
		for (const item of picks) {
			const src = firstImage(item);
			if (!src) continue;
			const thumb = document.createElement("img");
			thumb.className = "qq-gp-mini";
			thumb.alt = item.label;
			thumb.loading = "lazy";
			thumb.src = thumbURL(state.lib.key, src);
			attachHoverPreview(thumb, thumbURL(state.lib.key, src), imgURL(state.lib.key, src));
			state.minis.append(thumb);
		}
	}

	function renderGrid(state) {
		const items = state.data?.items ?? [];
		const keyword = state.keyword.trim().toLowerCase();
		const shown = keyword
			? items.filter((item) => String(item.label).toLowerCase().includes(keyword))
			: items;
		const chosen = new Set(selected(state));

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
			cell.title = `${item.label}\n点击切换选中（可多选）`;
			if (chosen.has(item.label)) cell.dataset.on = "1";
			const img = document.createElement("img");
			img.loading = "lazy";
			img.decoding = "async";
			img.src = thumbURL(state.lib.key, src);
			img.alt = item.label;
			const tag = document.createElement("span");
			tag.className = "qq-gp-tag";
			tag.textContent = item.label;
			cell.append(img, tag);
			attachHoverPreview(cell, thumbURL(state.lib.key, src), imgURL(state.lib.key, src));
			cell.addEventListener("click", () => {
				const current = selected(state);
				const index = current.indexOf(item.label);
				if (index >= 0) current.splice(index, 1);
				else current.push(item.label);
				setSelected(state, current);
				renderHeader(state);
				renderGrid(state);
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
						console.error("[QQ-预制图像参考] 删除失败", err);
					}
				}
				await reload(state.lib.key, true);
				setSelected(state, selected(state).filter((name) => name !== item.label));
				renderGrid(state);
				renderHeader(state);
			});
			frag.append(cell);
		}
		state.grid.append(frag);

		state.count.textContent = keyword
			? `匹配 ${shown.length} / ${items.length}`
			: `共 ${items.length} 张`;
		const names = selected(state);
		state.hint.textContent = names.length
			? `已选 ${names.length} 张（按点击顺序输出）`
			: "还没选";
		state.hint.title = names.join("\n");
	}

	function syncAll() {
		for (const lib of LIBS) {
			const state = sections[lib.key];
			renderHeader(state);
			if (state.expanded) renderGrid(state);
		}
	}

	function collapseAll(exceptKey = null) {
		closeHoverPreview();
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
			state.hint.textContent = `读取失败：${err?.message ?? err}`;
		}
		renderHeader(state);
		if (state.expanded) renderGrid(state);
	}

	// ---- 交互 ----
	for (const lib of LIBS) {
		const state = sections[lib.key];

		state.sec.querySelector(".qq-gp-hd").addEventListener("click", () => {
			if (expandedKey === lib.key) {
				collapseAll();
			} else {
				collapseAll(lib.key);
				reload(lib.key).then(() => {
					renderGrid(state);
					renderHeader(state);
				});
			}
			syncAll();
		});

		state.search.addEventListener("input", () => {
			state.keyword = state.search.value;
			renderGrid(state);
		});

		state.sec.querySelector(".qq-gp-clear").addEventListener("click", () => {
			setSelected(state, []);
			renderGrid(state);
			renderHeader(state);
		});

		state.sec.querySelector(".qq-gp-rand").addEventListener("click", () => {
			const items = state.data?.items ?? [];
			if (!items.length) return;
			const current = selected(state);
			const pool = items.filter((item) => !current.includes(item.label));
			if (!pool.length) return; // 全都选过了
			const picked = pool[Math.floor(Math.random() * pool.length)];
			current.push(picked.label);
			setSelected(state, current);
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
					if (body?.index) libData.set(lib.key, body.index);
					ok += 1;
				} catch (err) {
					console.error("[QQ-预制图像参考] 导入失败", file.name, err);
				}
			}
			state.hint.textContent = `已导入 ${ok}/${files.length} 张`;
			await reload(lib.key, true);
			renderGrid(state);
		});
	}

	collapseAll();
	refreshGallerySize();
	Promise.all(LIBS.map((lib) => reload(lib.key))).then(() => {
		syncAll();
		refreshGallerySize();
	});
	node.__qqGpSync = syncAll;
	node.__qqGpFit = refreshGallerySize;
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
			// 画廊装不上也不能影响节点本身可用：只告警，保留字符串控件与输出
			try {
				setup(this);
			} catch (err) {
				console.error("[QQ-预制图像参考] 画廊初始化失败，控件仍可用：", err);
			}
			return result;
		};

		const onRemoved = nodeType.prototype.onRemoved;
		nodeType.prototype.onRemoved = function () {
			try {
				closeHoverPreview();
			} catch (err) {
				console.error("[QQ-预制图像参考] 清理预览失败：", err);
			}
			return onRemoved?.apply(this, arguments);
		};

		const onConfigure = nodeType.prototype.onConfigure;
		nodeType.prototype.onConfigure = function () {
			const result = onConfigure?.apply(this, arguments);
			try {
				this.__qqGpSync?.();
				this.__qqGpFit?.();
			} catch (err) {
				console.error("[QQ-预制图像参考] 刷新失败：", err);
			}
			return result;
		};
	},
});
