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
	{ key: "pose", label: "姿态", widget: "姿态", angleWidget: "姿态角度" },
	{ key: "face", label: "脸模", widget: "脸模" },
	{ key: "cloth", label: "服装", widget: "服装" },
];

const CAT_ALL = "/"; // "/" = 全部，按子目录分组展示

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
.qq-gp-sec[data-open="1"] .qq-gp-body{height:190px;min-height:190px;flex:0 0 auto}
.qq-gp-sec[data-open="1"] .qq-gp-body{display:flex}
.qq-gp-tools{display:flex;gap:5px;align-items:center;flex:0 0 auto}
.qq-gp-tools input{flex:1 1 0;min-width:0;height:22px;padding:0 6px;border-radius:4px;
  border:1px solid var(--border-color,#39404d);background:var(--comfy-input-bg,#12141a);
  color:inherit;font:inherit}
.qq-gp-tools select{flex:1 1 0;min-width:0;height:22px;padding:0 4px;border-radius:4px;
  border:1px solid var(--border-color,#39404d);background:var(--comfy-input-bg,#12141a);
  color:var(--input-text,#e6e8ee);font:inherit}
.qq-gp-btn{flex:0 0 auto;height:22px;padding:0 8px;border-radius:4px;cursor:pointer;
  border:1px solid var(--border-color,#39404d);background:var(--comfy-input-bg,#12141a);
  color:inherit;font:inherit}
.qq-gp-btn:hover{border-color:var(--qq-gp-ac,#4f8cff);color:var(--qq-gp-ac,#4f8cff)}
.qq-gp-grid{flex:1 1 auto;min-height:0;overflow-y:auto;display:grid;gap:5px;
  grid-template-columns:repeat(auto-fill,${CELL}px);
  grid-auto-rows:auto;align-content:start}
.qq-gp-group{grid-column:1/-1;align-self:start;padding:4px 2px 2px;border-bottom:1px solid var(--border-color,#39404d);
  color:var(--descrip-text,#96a0b0);font-size:11px;letter-spacing:.02em}

.qq-gp-cell{position:relative;width:${CELL}px;height:${CELL}px;padding:0;
  border:1px solid var(--border-color,#39404d);border-radius:5px;background:#0f1116;
  cursor:pointer;overflow:hidden}
.qq-gp-cell img{width:100%;height:100%;object-fit:cover;display:block}
.qq-gp-cell:hover{border-color:var(--qq-gp-ac,#4f8cff)}
.qq-gp-cell[data-on="1"]{border-color:var(--qq-gp-ac,#4f8cff);
  box-shadow:0 0 0 1px var(--qq-gp-ac,#4f8cff) inset}
.qq-gp-cell .qq-gp-angles{position:absolute;left:2px;top:2px;padding:0 3px;border-radius:6px;
  background:rgba(10,12,16,.78);color:#cfd6e4;font-size:9px;line-height:13px;pointer-events:none}

.qq-gp-cell .qq-gp-order{position:absolute;right:3px;top:2px;min-width:14px;padding:0 3px;
  border-radius:7px;background:var(--qq-gp-ac,#4f8cff);color:#fff;font-size:10px;
  line-height:14px;text-align:center;pointer-events:none}
.qq-gp-angles-panel{position:fixed;z-index:1580;display:flex;flex-direction:column;gap:4px;
  padding:6px;border-radius:8px;background:var(--comfy-menu-bg,#25292d);
  border:1px solid var(--border-color,#39404d);box-shadow:0 10px 28px rgba(0,0,0,.6);
  max-height:72vh;overflow-y:auto}
.qq-gp-angle-item{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:5px;
  border:1px solid transparent;background:transparent;color:var(--input-text,#e6e8ee);
  font:12px/1.3 system-ui,"Microsoft YaHei",sans-serif;cursor:pointer;text-align:left}
.qq-gp-angle-item:hover{background:rgba(79,140,255,.16)}
.qq-gp-angle-item[data-on="1"]{border-color:var(--qq-gp-ac,#4f8cff)}
.qq-gp-angle-item img{width:56px;height:56px;object-fit:cover;border-radius:4px;
  background:#0f1116;flex:0 0 auto}

.qq-gp-menu{position:fixed;z-index:1600;min-width:118px;padding:4px;border-radius:6px;
  background:var(--comfy-menu-bg,#25292d);border:1px solid var(--border-color,#39404d);
  box-shadow:0 8px 24px rgba(0,0,0,.6);font:12px/1.4 system-ui,"Microsoft YaHei",sans-serif}
.qq-gp-menu button{display:block;width:100%;padding:4px 8px;border:0;border-radius:4px;
  background:none;color:var(--input-text,#e6e8ee);text-align:left;cursor:pointer;font:inherit}
.qq-gp-menu button:hover{background:rgba(79,140,255,.18)}
.qq-gp-menu button:disabled{opacity:.4;cursor:default;background:none}
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

// ---- 每条姿态各自的角度（存在隐藏控件「姿态角度」的 JSON 里）----
let anglePicker = null;
let anglePickerDismiss = null;

function closeAnglePicker() {
	if (anglePickerDismiss) {
		document.removeEventListener("pointerdown", anglePickerDismiss, true);
		anglePickerDismiss = null;
	}
	anglePicker?.remove();
	anglePicker = null;
}

// 角度映射在 setup() 里实现：需要访问隐藏控件，不能放模块级


// ---- 右键菜单：上移 / 下移 / 取消 / 删除 ----
let cellMenu = null;

function closeCellMenu() {
	cellMenu?.remove();
	cellMenu = null;
}

function openCellMenu(anchor, entries) {
	closeCellMenu();
	const menu = document.createElement("div");
	menu.className = "qq-gp-menu";
	for (const entry of entries) {
		const button = document.createElement("button");
		button.type = "button";
		button.textContent = entry.label;
		button.disabled = !!entry.disabled;
		button.addEventListener("click", (event) => {
			event.stopPropagation();
			closeCellMenu();
			entry.onClick?.();
		});
		menu.append(button);
	}
	document.body.append(menu);
	const rect = anchor.getBoundingClientRect();
	const menuRect = menu.getBoundingClientRect();
	const left = Math.max(4, Math.min(window.innerWidth - menuRect.width - 4, rect.left));
	const top = Math.max(4, Math.min(window.innerHeight - menuRect.height - 4, rect.top));
	menu.style.left = `${Math.round(left)}px`;
	menu.style.top = `${Math.round(top)}px`;
	cellMenu = menu;
	setTimeout(() => {
		const dismiss = (event) => {
			if (!cellMenu) return;
			if (cellMenu.contains(event.target)) return;
			closeCellMenu();
			document.removeEventListener("pointerdown", dismiss, true);
		};
		document.addEventListener("pointerdown", dismiss, true);
	}, 0);
}


function mediaURL(lib, kind, name) {
	return api.apiURL(`${PREFIX}/${lib}/${kind}?name=${encodeURIComponent(name)}`);
}

function thumbURL(lib, name) {
	return mediaURL(lib, "thumb", name);
}

function imgURL(lib, name) {
	return mediaURL(lib, "img", name);
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
	widget.computeSize = () => [0, 0];
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
		if (lib.angleWidget) {
			const angleWidget = node.widgets?.find((w) => w.name === lib.angleWidget);
			if (angleWidget) {
				widgets[`${lib.key}Angle`] = angleWidget;
				hideWidget(angleWidget);
			}
		}
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
					<select class="qq-gp-cat" title="按子目录筛选"></select>
					<button class="qq-gp-btn qq-gp-rand" type="button" title="随机挑一张（替换当前选择）">随机</button>
					<button class="qq-gp-btn qq-gp-imp" type="button" title="导入图片（存到用户目录）">导入</button>
					<button class="qq-gp-btn qq-gp-refresh" type="button" title="重新扫描图库（外部新增图片后点这里）">刷新</button>
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
			cat: sec.querySelector(".qq-gp-cat"),
			count: sec.querySelector(".qq-gp-count"),
			hint: sec.querySelector(".qq-gp-hint"),
			fileInput,
			keyword: "",
			data: null,
			expanded: false,
		};
	}

	let expandedKey = null;

	// 布局常量：必须与下面 CSS 里的数值一致。
	// 直接算内容高度，而不是量 scrollHeight —— 节点被拉高时内容不再溢出，
	// scrollHeight 会等于可用高度，那样永远缩不回来。
	const ROW_H = 42; // 行头 40 + 上下 1px 边框
	const GAP = 4; // .qq-gp 的 gap
	const PAD = 4; // .qq-gp 的内边距（上下各 4）
	const BODY_H = 190; // 展开区块的 body 高度

	let contentNeed = 0;

	// DOM 控件四周留一点边距，否则它会把节点的圆角边框盖住（看起来像「外框没了」）。
	const MARGIN = 6;

	function contentHeight() {
		const open = expandedKey ? 1 : 0;
		return PAD * 2 + LIBS.length * ROW_H + (LIBS.length - 1) * GAP + open * BODY_H;
	}

	const gallery = node.addDOMWidget("qq_gp_gallery", "qq_gp_gallery", root, {
		serialize: false,
		hideOnZoom: false,
		margin: MARGIN,
		getMinHeight: () => contentHeight(),
	});

	// 收起时的「最小高度」直接问节点自己：把节点拖到最小时停住的那个尺寸，
	// 就是 ComfyUI 按控件算出来的 computeSize，比我们猜常数准。
	// 展开时在此基础上加展开区高度。
	let baseHeight = 0;

	function measureBase() {
		const size = node.computeSize?.();
		if (!Array.isArray(size) || !size[1]) return 0;
		// computeSize 偶尔会带出异常值，用常数估个范围做保护
		const guess = (contentHeight() + MARGIN * 2) / (app.canvas?.ds?.scale || 1);
		if (size[1] < guess * 0.5 || size[1] > guess * 2 + 80) return 0;
		return size[1];
	}

	function fitToContent(attempt = 0) {
		// 刚创建的节点还没挂进 DOM，量不到尺寸；等几帧再试
		if (!root?.isConnected) {
			if (attempt < 40) requestAnimationFrame(() => fitToContent(attempt + 1));
			return;
		}
		// 只在收起状态校准基准：展开时 computeSize 会把展开区也算进去
		if (!baseHeight && !expandedKey) baseHeight = measureBase();
		const scale = app.canvas?.ds?.scale || 1;
		const target = baseHeight
			? baseHeight + (expandedKey ? BODY_H / scale : 0)
			: (contentHeight() + MARGIN * 2) / scale;
		const current = node.size?.[1] ?? 0;
		if (Math.abs(target - current) > 1) {
			node.setSize?.([node.size?.[0] ?? 340, target]);
			node.graph?.setDirtyCanvas(true, true);
		}
		if (attempt < 3) requestAnimationFrame(() => fitToContent(attempt + 1));
	}

	// 只把「太矮」的撑高，用户拉大的尺寸不动
	function growToContent(attempt = 0) {
		if (!root?.isConnected) {
			if (attempt < 40) requestAnimationFrame(() => growToContent(attempt + 1));
			return;
		}
		if (!baseHeight && !expandedKey) baseHeight = measureBase();
		if (!baseHeight) return;
		const scale = app.canvas?.ds?.scale || 1;
		const target = baseHeight + (expandedKey ? BODY_H / scale : 0);
		if ((node.size?.[1] ?? 0) < target - 1) {
			node.setSize?.([node.size?.[0] ?? 340, target]);
			node.graph?.setDirtyCanvas(true, true);
		}
		if (attempt < 3) requestAnimationFrame(() => growToContent(attempt + 1));
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

	// ---- 每条姿态的角度：存在隐藏控件「姿态角度」的 JSON 里 ----
	function readAngleMap() {
		const widget = widgets.poseAngle;
		if (!widget) return {};
		try {
			const data = JSON.parse(widget.value || "{}");
			return data && typeof data === "object" ? data : {};
		} catch {
			return {};
		}
	}

	function writeAngleMap(map) {
		const widget = widgets.poseAngle;
		if (!widget) return;
		const value = JSON.stringify(map);
		if (widget.value === value) return;
		widget.value = value;
		widget.callback?.(value, app.canvas, node, null, null);
		node.graph?.setDirtyCanvas(true, true);
	}

	function angleKeys(item) {
		return Object.keys(item?.angles ?? {});
	}

	// 没记过就用该条自带的第一个角度
	function angleOf(state, item) {
		const keys = angleKeys(item);
		const chosen = readAngleMap()[item.label];
		return keys.includes(chosen) ? chosen : keys[0] ?? "";
	}

	function angleLabel(state, key) {
		const found = (state.data?.angles ?? []).find((entry) => entry.key === key);
		return found?.label ?? key;
	}

	// 点带多视角的缩略图：左侧弹出这一条的全部视角
	function openAnglePicker(state, item, anchor) {
		const label = item.label;
		if (anglePicker?.dataset.label === label) {
			closeAnglePicker();
			return;
		}
		closeAnglePicker();
		const panel = document.createElement("div");
		panel.className = "qq-gp-angles-panel";
		panel.dataset.label = label;
		const current = angleOf(state, item);
		for (const [key, entry] of Object.entries(item.angles ?? {})) {
			if (!entry?.img) continue;
			const button = document.createElement("button");
			button.type = "button";
			button.className = "qq-gp-angle-item";
			if (key === current) button.dataset.on = "1";
			const thumb = document.createElement("img");
			thumb.loading = "lazy";
			thumb.src = thumbURL(state.lib.key, entry.img);
			thumb.alt = angleLabel(state, key);
			const text = document.createElement("span");
			text.textContent = angleLabel(state, key);
			button.append(thumb, text);
			button.addEventListener("click", (event) => {
				event.stopPropagation();
				const list = selected(state);
				if (!list.includes(label)) list.push(label);
				setSelected(state, list);
				const map = readAngleMap();
				map[label] = key;
				writeAngleMap(map);
				closeAnglePicker();
				renderGrid(state);
				renderHeader(state);
			});
			panel.append(button);
		}
		document.body.append(panel);
		// 弹在缩略图左边，放不下就贴窗口左边
		const rect = anchor.getBoundingClientRect();
		const box = panel.getBoundingClientRect();
		const left = Math.max(4, rect.left - box.width - 8);
		const top = Math.max(4, Math.min(window.innerHeight - box.height - 4, rect.top));
		panel.style.left = `${Math.round(left)}px`;
		panel.style.top = `${Math.round(top)}px`;
		anglePicker = panel;
		setTimeout(() => {
			const dismiss = (event) => {
				if (!anglePicker) return;
				if (anglePicker.contains(event.target)) return;
				closeAnglePicker();
			};
			anglePickerDismiss = dismiss;
			document.addEventListener("pointerdown", dismiss, true);
		}, 0);
	}


	function moveSelection(state, from, to) {
		const list = selected(state);
		if (from < 0 || from >= list.length) return;
		if (to < 0 || to >= list.length) return;
		const [moved] = list.splice(from, 1);
		list.splice(to, 0, moved);
		setSelected(state, list);
		renderGrid(state);
		renderHeader(state);
	}

	async function deleteItem(state, item) {
		if (!confirm(`删除「${item.label}」这张图？
文件会从用户目录里删掉，不可恢复。`)) return;
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
	}

	// 角度下拉：只在图库真的有多个视角时出现
	// 分类下拉：全部 / 根目录 "/" / 已存在的子目录
	function renderCatBar(state) {
		const select = state.cat;
		if (!select) return;
		const cats = state.data?.cats ?? [];
		const keep = state.catFilter ?? CAT_ALL;
		select.replaceChildren();
		const add = (value, text, title) => {
			const option = document.createElement("option");
			option.value = value;
			option.textContent = text;
			if (title) option.title = title;
			select.append(option);
		};
		add(CAT_ALL, "/", "全部：按子目录分组显示");
		for (const cat of cats) add(cat, cat, `子目录 ${cat}`);
		select.value = [...select.options].some((opt) => opt.value === keep) ? keep : CAT_ALL;
		state.catFilter = select.value;
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
		const cat = state.catFilter ?? CAT_ALL;
		const shown = items.filter((item) => {
			if (cat && cat !== CAT_ALL && item.cat !== cat) return false;
			if (!keyword) return true;
			return String(item.label).toLowerCase().includes(keyword);
		});
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
		const groups = [];
		const byCat = new Map();
		for (const item of shown) {
			const key = item.cat || "";
			if (!byCat.has(key)) {
				byCat.set(key, []);
				groups.push({ cat: key, items: byCat.get(key) });
			}
			byCat.get(key).push(item);
		}
		// "/" 状态下按子目录分组，组头显示分类名；选了具体分类就平铺
		const grouped = cat === CAT_ALL && groups.length > 1;
		for (const group of groups) {
			if (grouped) {
				const head = document.createElement("div");
				head.className = "qq-gp-group";
				const shots = group.items.reduce(
					(sum, entry) => sum + Object.keys(entry.angles ?? {}).length,
					0
				);
				const name = group.cat || "根目录";
				head.textContent = `${name}（${group.items.length} 组 · ${shots} 张图）`;
				frag.append(head);
			}
			for (const item of group.items) {
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
				const leaf = grouped ? item.label.split("/").pop() : item.label;
				tag.textContent =
					angleKeys(item).length > 1
						? `${leaf} · ${angleLabel(state, angleOf(state, item))}`
						: leaf;
				cell.append(img, tag);
				const angleCount = Object.keys(item.angles ?? {}).length;
				if (angleCount > 1) {
					const anglesTag = document.createElement("span");
					anglesTag.className = "qq-gp-angles";
					anglesTag.textContent = chosen.has(item.label)
						? angleLabel(state, angleOf(state, item))
						: `${angleCount} 视角`;
					anglesTag.title = `这条含 ${angleCount} 个视角，用上方「角度」切换`;
					cell.append(anglesTag);
				}
				const picked = selected(state);
				const order = picked.indexOf(item.label);
				if (order >= 0) {
					const mark = document.createElement("span");
					mark.className = "qq-gp-order";
					mark.textContent = String(order + 1);
					mark.title = `输出顺序第 ${order + 1} 张`;
					cell.append(mark);
				}
				attachHoverPreview(cell, thumbURL(state.lib.key, src), imgURL(state.lib.key, src));
				cell.addEventListener("click", () => {
					if (angleKeys(item).length > 1) {
						openAnglePicker(state, item, cell);
						return;
					}
					const current = selected(state);
					const index = current.indexOf(item.label);
					if (index >= 0) current.splice(index, 1);
					else current.push(item.label);
					setSelected(state, current);
					renderHeader(state);
					renderGrid(state);
				});
				cell.addEventListener("contextmenu", (event) => {
					event.preventDefault();
					const current = selected(state);
					const at = current.indexOf(item.label);
					openCellMenu(cell, [
						{ label: "上移", disabled: at <= 0, onClick: () => moveSelection(state, at, at - 1) },
						{
							label: "下移",
							disabled: at < 0 || at >= current.length - 1,
							onClick: () => moveSelection(state, at, at + 1),
						},
						{
							label: at >= 0 ? "取消选择" : "加入选择",
							onClick: () => {
								const list = selected(state);
								const index = list.indexOf(item.label);
								if (index >= 0) list.splice(index, 1);
								else list.push(item.label);
								setSelected(state, list);
								renderGrid(state);
								renderHeader(state);
							},
						},
						{ label: "删除图片", onClick: () => deleteItem(state, item) },
					]);
				});
				frag.append(cell);
			}
		}
		state.grid.append(frag);

		const totalShots = items.reduce(
			(sum, entry) => sum + Object.keys(entry.angles ?? {}).length,
			0
		);
		const countText =
			totalShots === items.length
				? `共 ${items.length} 张`
				: `共 ${items.length} 组 · ${totalShots} 张图`;
		state.count.textContent = keyword ? `匹配 ${shown.length} / ${items.length}` : countText;
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
			renderCatBar(state);
			if (state.expanded) renderGrid(state);
		}
	}

	function collapseAll(exceptKey = null) {
		closeAnglePicker();
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
		renderCatBar(state);
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

		state.cat?.addEventListener("change", () => {
			state.catFilter = state.cat.value;
			renderGrid(state);
		});

		state.search.addEventListener("input", () => {
			state.keyword = state.search.value;
			renderGrid(state);
		});


		state.sec.querySelector(".qq-gp-refresh").addEventListener("click", async () => {
			state.hint.textContent = "重新扫描…";
			try {
				const res = await api.fetchApi(`${PREFIX}/${lib.key}/rescan`, { method: "POST" });
				if (res.ok) {
					const body = await res.json();
					libData.set(lib.key, body);
					state.data = body;
				} else {
					await reload(lib.key, true);
				}
			} catch (err) {
				console.error("[QQ-预制图像参考] 刷新失败", err);
				await reload(lib.key, true);
			}
			renderCatBar(state);
			renderHeader(state);
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
			// 随机一个并替换掉当前选择，不做累加
			const picked = items[Math.floor(Math.random() * items.length)];
			setSelected(state, [picked.label]);
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
				if (state.catFilter && state.catFilter !== CAT_ALL) {
					form.append("cat", state.catFilter);
				}
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
	// 兜底：首帧布局在某些前端版本会晚一拍，再补一次
	setTimeout(refreshGallerySize, 120);
	Promise.all(LIBS.map((lib) => reload(lib.key))).then(() => {
		syncAll();
		refreshGallerySize();
	});
	node.__qqGpSync = syncAll;
	node.__qqGpFit = refreshGallerySize;
	// 只长不缩：用户手动拉小时用它把内容撑回来，不会反过来夺走用户拉大的尺寸
	node.__qqGpGrow = () => requestAnimationFrame(() => growToContent());
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

		// 手动拖小到装不下时拉回来：内容永远不被裁掉
		const onResize = nodeType.prototype.onResize;
		nodeType.prototype.onResize = function () {
			const result = onResize?.apply(this, arguments);
			try {
				this.__qqGpGrow?.();
			} catch (err) {
				console.error("[QQ-预制图像参考] 尺寸校正失败：", err);
			}
			return result;
		};

		const onRemoved = nodeType.prototype.onRemoved;
		nodeType.prototype.onRemoved = function () {
			try {
				closeHoverPreview();
				closeAnglePicker();
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
