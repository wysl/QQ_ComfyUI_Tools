import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "QQGuliPosePicker";
const API = "/qq_gulipose/pose";

const MODE_FIXED = "固定选中";
const MODE_RANDOM_ALL = "全库随机";
const MODE_RANDOM_FILTERED = "范围内随机";
const ALL = "全部";

// 画廊高度随节点高度走：这三个常量只用来算「除画廊外占掉多少」。
const MIN_GALLERY_H = 240;
const NODE_CHROME_H = 38; // 标题栏 + 节点内边距
const PARAM_ROW_H = 24; // 一个参数行：widget 20 + 间距 4

const CSS = `
.qq-gp{box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:6px;padding:6px;
  background:var(--comfy-menu-bg,#1e2128);color:var(--input-text,#e6e8ee);border-radius:6px;
  overflow:hidden;font:12px/1.35 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.qq-gp *{box-sizing:border-box}
.qq-gp-tools{display:flex;gap:6px;align-items:center;flex:0 0 auto}
.qq-gp-tools select,.qq-gp-tools input{min-width:0;height:24px;padding:0 6px;border-radius:4px;
  border:1px solid var(--border-color,#39404d);background:var(--comfy-input-bg,#12141a);
  color:inherit;font:inherit}
.qq-gp-tools select{flex:0 0 34%}
.qq-gp-tools input{flex:1 1 auto}
.qq-gp-btn{flex:0 0 auto;height:24px;padding:0 10px;border-radius:4px;cursor:pointer;
  border:1px solid var(--border-color,#39404d);background:var(--comfy-input-bg,#12141a);color:inherit;
  font:inherit}
.qq-gp-btn:hover{border-color:var(--qq-gp-ac,#4f8cff);color:var(--qq-gp-ac,#4f8cff)}
.qq-gp-grid{flex:1 1 auto;min-height:0;overflow-y:auto;display:grid;gap:6px;
  grid-template-columns:repeat(auto-fill,minmax(78px,1fr));align-content:start}
.qq-gp-cell{position:relative;padding:0;border:1px solid var(--border-color,#39404d);
  border-radius:6px;background:#0f1116;cursor:pointer;overflow:hidden;aspect-ratio:1/1}
.qq-gp-cell img{width:100%;height:100%;object-fit:cover;display:block}
.qq-gp-cell:hover{border-color:var(--qq-gp-ac,#4f8cff)}
.qq-gp-cell[data-on="1"]{border-color:var(--qq-gp-ac,#4f8cff);box-shadow:0 0 0 1px var(--qq-gp-ac,#4f8cff) inset}
.qq-gp-cell .qq-gp-tag{position:absolute;left:0;right:0;bottom:0;padding:1px 4px;font-size:10px;
  background:rgba(12,14,18,.72);color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qq-gp-empty{grid-column:1/-1;padding:18px 10px;text-align:center;color:var(--descrip-text,#96a0b0);
  line-height:1.6}
.qq-gp-foot{flex:0 0 auto;display:flex;justify-content:space-between;gap:8px;
  color:var(--descrip-text,#96a0b0);font-size:11px}
.qq-gp-foot span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;

function injectCSS() {
	if (document.getElementById("qq-gp-css")) return;
	const el = document.createElement("style");
	el.id = "qq-gp-css";
	el.textContent = CSS;
	document.head.append(el);
}

let dbPromise = null;

function loadDB(force = false) {
	if (!dbPromise || force) {
		dbPromise = api
			.fetchApi(`${API}/index.json`)
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return res.json();
			})
			.catch((err) => {
				if (!force) dbPromise = null;
				throw err;
			});
	}
	return dbPromise;
}

function thumbURL(pose) {
	const base = pose.root === "custom" ? `${API}/custom/thumbs` : `${API}/thumbs`;
	const entry = pose.angles?.front ?? Object.values(pose.angles ?? {})[0];
	const name = entry?.thumb;
	if (!name) return "";
	const encoded = encodeURIComponent(name);
	// 自定义图的缩略图紧随原图，加个版本号避免浏览器缓存旧图
	return api.apiURL(`${base}/${encoded}`) + (pose.root === "custom" ? `?v=${pose.mtime ?? 0}` : "");
}

function setup(node) {
	injectCSS();

	const w = (name) => node.widgets?.find((x) => x.name === name);
	const modeWidget = w("模式");
	const poseWidget = w("姿态");
	const angleWidget = w("视角");
	const seriesWidget = w("筛选系列");
	const catWidget = w("筛选分类");
	if (!modeWidget || !poseWidget || !angleWidget || !seriesWidget || !catWidget) return;

	const root = document.createElement("div");
	root.className = "qq-gp";
	root.innerHTML = `
		<div class="qq-gp-tools">
			<select class="qq-gp-series" title="按系列筛选"></select>
			<input class="qq-gp-search" type="text" placeholder="搜索编号 / 名称">
			<button class="qq-gp-btn qq-gp-imp" type="button" title="导入自己的姿态图">导入</button>
			<button class="qq-gp-btn qq-gp-shuffle" type="button" title="随机挑一个（切回固定选中）">随机</button>
		</div>
		<div class="qq-gp-grid"><div class="qq-gp-empty">载入姿态库…</div></div>
		<div class="qq-gp-foot"><span class="qq-gp-count"></span><span class="qq-gp-hint"></span></div>`;

	const seriesSel = root.querySelector(".qq-gp-series");
	const searchInput = root.querySelector(".qq-gp-search");
	const grid = root.querySelector(".qq-gp-grid");
	const countEl = root.querySelector(".qq-gp-count");
	const hintEl = root.querySelector(".qq-gp-hint");

	const gallery = node.addDOMWidget("qq_guli_pose_gallery", "qq_guli_pose_gallery", root, {
		serialize: false,
		hideOnZoom: false,
		getMinHeight: () => MIN_GALLERY_H,
	});

	function chromeHeight() {
		let rows = 0;
		for (const widget of node.widgets ?? []) {
			if (widget === gallery || widget.hidden) continue;
			rows += 1;
		}
		return NODE_CHROME_H + rows * PARAM_ROW_H;
	}

	gallery.computeSize = (width) => [
		width ?? node.size[0],
		Math.max(MIN_GALLERY_H, node.size[1] - chromeHeight()),
	];

	let data = null;
	let filterSeries = ALL;
	let keyword = "";

	const setWidget = (widget, value) => {
		if (!widget || widget.value === value) return;
		widget.value = value;
		widget.callback?.(value, app.canvas, node, null, null);
		node.graph?.setDirtyCanvas(true, true);
	};

	function matches(pose) {
		if (filterSeries !== ALL && pose.series !== filterSeries) return false;
		if (!keyword) return true;
		const hay = `${pose.code ?? ""} ${pose.name ?? ""} ${pose.label ?? ""} ${pose.cat ?? ""}`.toLowerCase();
		return hay.includes(keyword);
	}

	function render() {
		const chosen = poseWidget.value;
		const poses = (data?.poses ?? []).filter(matches);
		grid.replaceChildren();
		if (!poses.length) {
			const empty = document.createElement("div");
			empty.className = "qq-gp-empty";
			empty.textContent = data?.poses?.length
				? "没有符合筛选条件的姿态，换个系列或清空搜索。"
				: "姿态库还是空的。点下面的「导入」放几张文模参考图进来。";
			grid.append(empty);
		}
		const frag = document.createDocumentFragment();
		for (const pose of poses) {
			const cell = document.createElement("button");
			cell.type = "button";
			cell.className = "qq-gp-cell";
			cell.title = `${pose.label}\n分类：${pose.cat ?? ""}｜视角：${Object.keys(pose.angles ?? {}).length}`;
			if (pose.label === chosen) cell.dataset.on = "1";
			const img = document.createElement("img");
			img.loading = "lazy";
			img.decoding = "async";
			img.src = thumbURL(pose);
			img.alt = pose.label;
			const tag = document.createElement("span");
			tag.className = "qq-gp-tag";
			tag.textContent = pose.code || pose.name || "";
			cell.append(img, tag);
			cell.addEventListener("click", () => {
				// 点图 = 固定选中这张；同时把模式和视角拉回确定值，避免"选了却还在随机"
				setWidget(modeWidget, MODE_FIXED);
				setWidget(poseWidget, pose.label);
				const angles = Object.keys(pose.angles ?? {});
				const current = angleWidget.value;
				if (current !== "随机视角" && !angles.includes(labelToAngle(current))) {
					setWidget(angleWidget, "正面");
				}
				render();
			});
			// 自定义图可以右键删除（内置素材只读，删了下次升级也会回来）
			if (pose.root === "custom") {
				cell.addEventListener("contextmenu", async (event) => {
					event.preventDefault();
					const names = Object.values(pose.angles ?? {}).map((x) => x.img).filter(Boolean);
					if (!names.length) return;
					if (!confirm(`删除「${pose.label}」这张自定义图？\n（文件会从用户目录里删掉，不可恢复）`)) return;
					for (const name of names) {
						try {
							await api.fetchApi(`${API}/custom/delete`, {
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({ name }),
							});
						} catch (err) {
							console.error("[QQ-姿态库] 删除失败：", name, err);
						}
					}
					await refresh(true);
				});
			}
			frag.append(cell);
		}
		grid.append(frag);
		countEl.textContent = `共 ${poses.length} / ${data?.poses?.length ?? 0} 个姿态`;
		hintEl.textContent = poseWidget.value === data?.poses?.[0]?.label ? "" : "已选：";
		if (hintEl.textContent) hintEl.textContent += String(chosen).slice(0, 22);
	}

	function labelToAngle(label) {
		const map = { 正面: "front", 俯视: "high", 仰视: "low", 侧面: "side", 斜侧: "diag" };
		return map[label] ?? "front";
	}

	function syncSeriesOptions() {
		const wanted = [ALL, ...(data?.series ?? []).map((s) => s.name)];
		const current = seriesSel.value;
		seriesSel.replaceChildren();
		for (const name of wanted) {
			const opt = document.createElement("option");
			opt.value = name;
			opt.textContent = name;
			seriesSel.append(opt);
		}
		seriesSel.value = wanted.includes(current) ? current : ALL;
		filterSeries = seriesSel.value;
	}

	seriesSel.addEventListener("change", () => {
		filterSeries = seriesSel.value;
		render();
	});

	let searchTimer = null;
	searchInput.addEventListener("input", () => {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			keyword = searchInput.value.trim().toLowerCase();
			render();
		}, 120);
	});

	root.querySelector(".qq-gp-shuffle").addEventListener("click", () => {
		const pool = (data?.poses ?? []).filter(matches);
		if (!pool.length) return;
		const picked = pool[Math.floor(Math.random() * pool.length)];
		setWidget(modeWidget, MODE_FIXED);
		setWidget(poseWidget, picked.label);
		render();
	});

	// ---- 导入：选文件 → 名称/分类/视角 → POST ----
	const fileInput = document.createElement("input");
	fileInput.type = "file";
	fileInput.accept = "image/*";
	fileInput.multiple = true;
	fileInput.style.display = "none";
	root.append(fileInput);

	root.querySelector(".qq-gp-imp").addEventListener("click", () => fileInput.click());

	fileInput.addEventListener("change", async () => {
		const files = [...(fileInput.files ?? [])];
		fileInput.value = "";
		if (!files.length) return;
		hintEl.textContent = `导入中… 0/${files.length}`;
		let ok = 0;
		for (const file of files) {
			const form = new FormData();
			form.append("file", file, file.name);
			form.append("name", "");
			form.append("cat", "");
			form.append("angle", "");
			try {
				const res = await api.fetchApi(`${API}/custom/upload`, { method: "POST", body: form });
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const body = await res.json();
				if (body?.index) data = body.index;
				ok += 1;
			} catch (err) {
				console.error("[QQ-姿态库] 导入失败：", file.name, err);
			}
			hintEl.textContent = `导入中… ${ok}/${files.length}`;
		}
		if (files.length > 1 || ok === 0) {
			await refresh(true);
		} else {
			syncSeriesOptions();
			render();
		}
		hintEl.textContent = ok === files.length ? `已导入 ${ok} 张` : `导入 ${ok}/${files.length} 张，其余失败`;
	});

	async function refresh(force = false) {
		try {
			data = await loadDB(force);
		} catch (err) {
			grid.replaceChildren();
			const empty = document.createElement("div");
			empty.className = "qq-gp-empty";
			empty.textContent = `姿态库读不出来：${err}`;
			grid.append(empty);
			return;
		}
		syncSeriesOptions();
		render();
	}

	// 模式切换到「全库随机 / 范围内随机」时，画廊选中态跟着清掉
	for (const widget of [modeWidget, poseWidget, angleWidget]) {
		const original = widget.callback;
		widget.callback = function (...args) {
			const ret = original?.apply(this, args);
			render();
			return ret;
		};
	}

	refresh();
	node.__qqGuliRefresh = () => refresh(true);
}

app.registerExtension({
	name: "QQ.ComfyUI.GuliPoseGallery",
	beforeRegisterNodeDef(nodeType, nodeData) {
		if (nodeData.name !== NODE_NAME) return;
		if (nodeType.prototype.__qqGuliPatched) return;
		nodeType.prototype.__qqGuliPatched = true;

		const onNodeCreated = nodeType.prototype.onNodeCreated;
		nodeType.prototype.onNodeCreated = function () {
			const r = onNodeCreated?.apply(this, arguments);
			// 画廊装不上也不能影响节点本身可用：只告警，保留控件与输出
			try {
				setup(this);
			} catch (err) {
				console.error("[QQ-姿态库] 画廊初始化失败，节点参数仍可用：", err);
			}
			return r;
		};

		const onExecuted = nodeType.prototype.onExecuted;
		nodeType.prototype.onExecuted = function (message) {
			onExecuted?.apply(this, arguments);
			const picked = message?.picked?.[0];
			if (picked?.label) {
				const poseWidget = this.widgets?.find((x) => x.name === "姿态");
				const angleWidget = this.widgets?.find((x) => x.name === "视角");
				if (poseWidget && poseWidget.value !== picked.label) {
					poseWidget.value = picked.label;
				}
				const label = { front: "正面", high: "俯视", low: "仰视", side: "侧面", diag: "斜侧" }[picked.angle];
				if (angleWidget && label && angleWidget.value !== "随机视角") {
					angleWidget.value = label;
				}
				this.graph?.setDirtyCanvas(true, true);
			}
		};
	},
});
