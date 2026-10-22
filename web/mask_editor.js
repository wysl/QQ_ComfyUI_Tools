/**
 * A small paint-mask editor, shared by the node panel and the phone page.
 *
 * ComfyUI's own MaskEditor is tied to `clipspace` and to a node's image widget,
 * which cannot be driven for a virtual row inside our media loader and does not
 * exist on the phone at all. This is a plain canvas: brush on/off, size, undo,
 * clear, invert, and a save that posts an 8-bit grayscale PNG.
 *
 * Coordinate model: the mask is stored at the image's natural size, while the
 * canvas is laid out to fit the screen. Painting converts through the same
 * transform used to draw the picture, so strokes land where the finger is.
 */

const MASK_API = "/qq_mobile/mask";
const STYLE_ID = "qq-mask-editor-style";

const STYLES = `
.qq-mask-overlay {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, .65);
  padding: 14px;
}
.qq-mask-panel {
  display: flex; flex-direction: column;
  max-width: 760px; width: 100%; max-height: 100%;
  background: #1b1d26; color: #eceef6;
  border: 1px solid #303342; border-radius: 14px;
  overflow: hidden;
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI",
        "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Noto Sans CJK SC",
        "Microsoft YaHei", system-ui, sans-serif;
}
.qq-mask-head {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid #303342;
  font-weight: 600;
}
.qq-mask-head span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qq-mask-close {
  width: 32px; height: 32px; border: 0; border-radius: 8px;
  background: transparent; color: #9aa0b4; font-size: 20px; cursor: pointer;
}
.qq-mask-stage {
  position: relative;
  align-self: center;
  margin: 12px;
  line-height: 0;
  border-radius: 10px;
  overflow: hidden;
  background:
    repeating-conic-gradient(#23252f 0% 25%, #1b1d26 0% 50%) 0 0 / 16px 16px;
}
.qq-mask-picture, .qq-mask-paint {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
}
.qq-mask-picture { position: relative; display: block; }
.qq-mask-paint { cursor: crosshair; touch-action: none; }
.qq-mask-tools {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding: 0 14px 12px;
}
.qq-mask-tools button {
  padding: 6px 12px;
  font: 600 13px/1 inherit;
  color: #eceef6; background: #23252f;
  border: 1px solid #303342; border-radius: 8px;
  cursor: pointer;
}
.qq-mask-tools button.on {
  color: #fff; background: #4d7cfe; border-color: transparent;
}
.qq-mask-size { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #9aa0b4; }
.qq-mask-size input { width: 110px; }
.qq-mask-foot {
  display: flex; gap: 10px;
  padding: 12px 14px;
  border-top: 1px solid #303342;
}
.qq-mask-foot button {
  flex: 1;
  min-height: 40px;
  padding: 0 14px;
  font: 600 14px/1 inherit;
  color: #eceef6; background: #23252f;
  border: 1px solid #303342; border-radius: 10px;
  cursor: pointer;
}
.qq-mask-foot button.primary {
  color: #fff; background: #4d7cfe; border-color: transparent;
}
.qq-mask-foot button:disabled { opacity: .6; }
/* the little paint badge on a media row */
.qq-mask-badge {
  position: absolute; right: 3px; bottom: 3px;
  min-width: 16px; height: 16px; padding: 0 3px;
  display: grid; place-items: center;
  font: 700 10px/1 inherit;
  color: #fff; background: #4d7cfe;
  border-radius: 999px;
  pointer-events: none;
}
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

export function maskUrl(filename) {
  return `${MASK_API}?filename=${encodeURIComponent(filename)}`;
}

async function maskExists(filename) {
  try {
    const response = await fetch(maskUrl(filename), { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

async function loadMaskImage(filename) {
  const response = await fetch(maskUrl(filename));
  if (!response.ok) return null;
  const blob = await response.blob();
  return await new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = URL.createObjectURL(blob);
  });
}

export async function saveMask(filename, canvas) {
  const dataUrl = canvas.toDataURL("image/png");
  const response = await fetch(MASK_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, png: dataUrl }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text.slice(0, 120) || "保存失败");
  }
  return await response.json();
}

export async function clearMask(filename) {
  const response = await fetch(`${MASK_API}?filename=${encodeURIComponent(filename)}`, {
    method: "DELETE",
  });
  return response.ok;
}

/**
 * Open the editor for one image.
 *
 * Resolves to `{ saved: boolean }` so the caller can refresh its thumbnail.
 */
export function openMaskEditor({
  filename,
  source = "input",
  imageUrl,
  title = "画遮罩",
  onSaved,
  onCleared,
}) {
  const overlay = document.createElement("div");
  overlay.className = "qq-mask-overlay";
  ensureStyles();

  const panel = document.createElement("div");
  panel.className = "qq-mask-panel";

  const head = document.createElement("div");
  head.className = "qq-mask-head";
  const heading = document.createElement("span");
  heading.textContent = title;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "qq-mask-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "关闭");
  head.append(heading, close);

  const stage = document.createElement("div");
  stage.className = "qq-mask-stage";
  const picture = document.createElement("canvas");
  picture.className = "qq-mask-picture";
  const paint = document.createElement("canvas");
  paint.className = "qq-mask-paint";
  stage.append(picture, paint);

  const tools = document.createElement("div");
  tools.className = "qq-mask-tools";

  const brushButton = document.createElement("button");
  brushButton.type = "button";
  brushButton.textContent = "画笔";
  const eraseButton = document.createElement("button");
  eraseButton.type = "button";
  eraseButton.textContent = "橡皮";
  const sizeLabel = document.createElement("label");
  sizeLabel.className = "qq-mask-size";
  const sizeInput = document.createElement("input");
  sizeInput.type = "range";
  sizeInput.min = "4";
  sizeInput.max = "120";
  sizeInput.value = "28";
  sizeLabel.append("笔刷", sizeInput);
  const undoButton = document.createElement("button");
  undoButton.type = "button";
  undoButton.textContent = "撤销";
  const invertButton = document.createElement("button");
  invertButton.type = "button";
  invertButton.textContent = "反选";
  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.textContent = "清除";

  const foot = document.createElement("div");
  foot.className = "qq-mask-foot";
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "删除遮罩";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "取消";
  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "primary";
  saveButton.textContent = "保存";
  foot.append(removeButton, cancelButton, saveButton);

  tools.append(brushButton, eraseButton, sizeLabel, undoButton, invertButton, clearButton);
  panel.append(head, stage, tools, foot);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const pictureCtx = picture.getContext("2d");
  const paintCtx = paint.getContext("2d", { willReadFrequently: true });

  const state = {
    naturalWidth: 0,
    naturalHeight: 0,
    drawing: false,
    erasing: false,
    brush: Number(sizeInput.value),
    history: [],
    dirty: false,
  };

  const setBrush = (erasing) => {
    state.erasing = erasing;
    brushButton.classList.toggle("on", !erasing);
    eraseButton.classList.toggle("on", erasing);
  };

  const snapshot = () => {
    try {
      state.history.push(paintCtx.getImageData(0, 0, paint.width, paint.height));
      if (state.history.length > 20) state.history.shift();
    } catch {
      /* a huge canvas may refuse; undo simply stops extending */
    }
    state.dirty = true;
  };

  /** Lay both canvases out to fit, keeping the picture's aspect ratio. */
  const layout = () => {
    const maxWidth = Math.min(window.innerWidth - 28, 720);
    const maxHeight = Math.max(220, window.innerHeight - 240);
    const scale = Math.min(
      maxWidth / state.naturalWidth,
      maxHeight / state.naturalHeight,
      1,
    );
    const width = Math.max(1, Math.round(state.naturalWidth * scale));
    const height = Math.max(1, Math.round(state.naturalHeight * scale));
    for (const canvas of [picture, paint]) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    pictureCtx.clearRect(0, 0, width, height);
    pictureCtx.drawImage(state.image, 0, 0, width, height);
    // The stored mask always covers the whole image; when there is none the
    // layer starts empty, which reads as "keep everything" on save.
    paintCtx.clearRect(0, 0, width, height);
    if (state.maskImage) {
      paintCtx.drawImage(state.maskImage, 0, 0, width, height);
    }
    state.history.length = 0;
    state.dirty = false;
  };

  /** Convert a pointer position into canvas pixels. */
  const pointOf = (event) => {
    const rect = paint.getBoundingClientRect();
    const touch = event.touches?.[0] || event.changedTouches?.[0] || event;
    return {
      x: (touch.clientX - rect.left) * (paint.width / rect.width),
      y: (touch.clientY - rect.top) * (paint.height / rect.height),
    };
  };

  let last = null;
  const strokeTo = (point) => {
    paintCtx.globalCompositeOperation = state.erasing ? "destination-out" : "source-over";
    paintCtx.strokeStyle = "rgba(77, 124, 254, 0.55)";
    paintCtx.fillStyle = "rgba(77, 124, 254, 0.55)";
    paintCtx.lineWidth = state.brush;
    paintCtx.lineCap = "round";
    paintCtx.lineJoin = "round";
    if (last) {
      paintCtx.beginPath();
      paintCtx.moveTo(last.x, last.y);
      paintCtx.lineTo(point.x, point.y);
      paintCtx.stroke();
    }
    paintCtx.beginPath();
    paintCtx.arc(point.x, point.y, state.brush / 2, 0, Math.PI * 2);
    paintCtx.fill();
    last = point;
  };

  const start = (event) => {
    if (event.cancelable) event.preventDefault();
    snapshot();
    state.drawing = true;
    last = null;
    strokeTo(pointOf(event));
  };
  const move = (event) => {
    if (!state.drawing) return;
    if (event.cancelable) event.preventDefault();
    strokeTo(pointOf(event));
  };
  const end = () => {
    state.drawing = false;
    last = null;
  };

  paint.addEventListener("pointerdown", start);
  paint.addEventListener("pointermove", move);
  paint.addEventListener("pointerup", end);
  paint.addEventListener("pointerleave", end);
  paint.addEventListener("pointercancel", end);
  paint.style.touchAction = "none";

  brushButton.addEventListener("click", () => setBrush(false));
  eraseButton.addEventListener("click", () => setBrush(true));
  sizeInput.addEventListener("input", () => {
    state.brush = Number(sizeInput.value);
  });
  undoButton.addEventListener("click", () => {
    const previous = state.history.pop();
    if (!previous) return;
    paintCtx.putImageData(previous, 0, 0);
  });
  invertButton.addEventListener("click", () => {
    snapshot();
    // Invert the painted layer: white where it was transparent.
    const temp = document.createElement("canvas");
    temp.width = paint.width;
    temp.height = paint.height;
    const tempCtx = temp.getContext("2d");
    tempCtx.fillStyle = "#fff";
    tempCtx.fillRect(0, 0, temp.width, temp.height);
    tempCtx.globalCompositeOperation = "destination-out";
    tempCtx.drawImage(paint, 0, 0);
    paintCtx.clearRect(0, 0, paint.width, paint.height);
    paintCtx.drawImage(temp, 0, 0);
  });
  clearButton.addEventListener("click", () => {
    snapshot();
    paintCtx.clearRect(0, 0, paint.width, paint.height);
  });
  close.addEventListener("click", () => overlay.remove());
  cancelButton.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });

  removeButton.addEventListener("click", async () => {
    try {
      await clearMask(filename);
      overlay.remove();
      onCleared?.();
    } catch (error) {
      heading.textContent = `删除失败：${error.message}`;
    }
  });

  saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;
    try {
      // Export at the picture's natural size, on white: the server stores an
      // 8-bit grayscale PNG where white means "keep".
      const out = document.createElement("canvas");
      out.width = state.naturalWidth;
      out.height = state.naturalHeight;
      const outCtx = out.getContext("2d");
      outCtx.fillStyle = "#000";
      outCtx.fillRect(0, 0, out.width, out.height);
      outCtx.fillStyle = "#fff";
      outCtx.fillRect(0, 0, out.width, out.height);
      if (state.dirty || state.maskImage) {
        // Alpha of the paint layer becomes the keep-area.
        const layer = document.createElement("canvas");
        layer.width = paint.width;
        layer.height = paint.height;
        const layerCtx = layer.getContext("2d");
        layerCtx.drawImage(paint, 0, 0);
        const pixels = layerCtx.getImageData(0, 0, layer.width, layer.height).data;
        const grey = outCtx.getImageData(0, 0, out.width, out.height);
        const scaleX = out.width / layer.width;
        const scaleY = out.height / layer.height;
        for (let y = 0; y < out.height; y += 1) {
          for (let x = 0; x < out.width; x += 1) {
            const sx = Math.min(layer.width - 1, Math.floor(x / scaleX));
            const sy = Math.min(layer.height - 1, Math.floor(y / scaleY));
            const alpha = pixels[(sy * layer.width + sx) * 4 + 3];
            const index = (y * out.width + x) * 4;
            // Alpha 255 (painted) -> 0 (drop); nothing painted -> 255 (keep).
            const value = 255 - alpha;
            grey.data[index] = value;
            grey.data[index + 1] = value;
            grey.data[index + 2] = value;
            grey.data[index + 3] = 255;
          }
        }
        outCtx.putImageData(grey, 0, 0);
      }
      const result = await saveMask(filename, out);
      overlay.remove();
      onSaved?.(result);
    } catch (error) {
      heading.textContent = `保存失败：${error.message}`;
      saveButton.disabled = false;
    }
  });

  setBrush(false);

  return (async () => {
    state.image = await new Promise((resolve) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = imageUrl;
    });
    if (!state.image) {
      heading.textContent = "图片加载失败";
      return { saved: false };
    }
    state.naturalWidth = state.image.naturalWidth || 512;
    state.naturalHeight = state.image.naturalHeight || 512;
    state.maskImage = await loadMaskImage(filename);
    layout();
    return { saved: false };
  })();
}

export { maskExists };
