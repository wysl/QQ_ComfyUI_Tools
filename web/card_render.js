// 卡面共享渲染：图像（缩放/批次）· 视频（内联）· 音频（音乐图标+进度条+动态频谱）
// + 生成中实时预览/进度。供 QQ-卡面 输出节点与「卡面模式」子图共用。
// 只显示结果媒体，不显示文件名等信息。事件驱动，频谱 rAF 仅播放时运行。
import { api } from "../../scripts/api.js";

const MEDIA_HEIGHT = 210;

const CSS = `
.qq-card{display:flex;flex-direction:column;gap:6px;padding:6px;font:12px/1.4 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:var(--input-text,#e6e8ee)}
.qq-card-stage{position:relative;width:100%;height:${MEDIA_HEIGHT}px;border-radius:8px;overflow:hidden;background:var(--comfy-input-bg,#12141a);border:1px solid var(--border-color,#4b545b);display:flex;align-items:center;justify-content:center}
.qq-card-stage img.qq-card-photo{max-width:100%;max-height:100%;object-fit:contain;cursor:zoom-in;display:block}
.qq-card-stage video{max-width:100%;max-height:100%;object-fit:contain;display:block;background:#000}
.qq-card-empty{color:var(--descrip-text,#96a0b0);text-align:center;padding:12px;white-space:pre-wrap}
.qq-card-live{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:.92}
.qq-card-shimmer{position:absolute;inset:0;background:linear-gradient(110deg,transparent 30%,rgba(255,255,255,.08) 50%,transparent 70%);background-size:220% 100%;animation:qq-card-sweep 1.4s linear infinite}
@keyframes qq-card-sweep{0%{background-position:120% 0}100%{background-position:-120% 0}}
.qq-card-progress{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(0,0,0,.35)}
.qq-card-progress>div{height:100%;width:0;background:var(--primary,#4f8cff);transition:width .2s ease}
.qq-card-status{position:absolute;top:6px;left:8px;font-size:11px;color:#fff;background:rgba(0,0,0,.45);padding:1px 7px;border-radius:10px}
.qq-card-nav{display:flex;gap:6px;align-items:center;justify-content:center}
.qq-card-nav button{height:22px;min-width:26px;border:1px solid var(--border-color,#4b545b);border-radius:4px;background:var(--comfy-input-bg,#12141a);color:inherit;cursor:pointer;font:inherit}
.qq-card-nav button:hover{border-color:#4f8cff}
.qq-card-audio{display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;width:100%;height:100%;padding:10px;box-sizing:border-box}
.qq-card-audio-top{display:flex;align-items:center;gap:10px;width:100%}
.qq-card-play{flex:0 0 34px;height:34px;border-radius:50%;border:0;background:var(--primary,#4f8cff);color:#fff;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center}
.qq-card-music{flex:0 0 auto;font-size:22px;color:var(--primary,#4f8cff)}
.qq-card-seek{flex:1 1 auto;height:6px;border-radius:3px;background:var(--border-color,#4b545b);cursor:pointer;position:relative}
.qq-card-seek>div{height:100%;width:0;border-radius:3px;background:var(--primary,#4f8cff)}
.qq-card-spectrum{width:100%;height:64px;display:block}
.qq-card-zoom{position:fixed;inset:0;z-index:11400;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;cursor:zoom-out}
.qq-card-zoom img{max-width:94vw;max-height:94vh;object-fit:contain}
`;

export function injectCardCSS() {
    if (document.getElementById("qq-card-css")) return;
    const style = document.createElement("style");
    style.id = "qq-card-css";
    style.textContent = CSS;
    document.head.append(style);
}

export function viewUrl(item) {
    const params = new URLSearchParams({
        filename: item.filename || "", subfolder: item.subfolder || "", type: item.type || "temp",
    });
    return `/view?${params.toString()}`;
}

// ── 共享 WebSocket：采样预览帧 + 进度 ──
const runningCards = new Set();
let cardSocket = null;
let liveUrl = null;

function ensureSocket() {
    if (cardSocket && (cardSocket.readyState === 0 || cardSocket.readyState === 1)) return;
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const clientId = api.clientId || "qq-card";
    try {
        cardSocket = new WebSocket(`${scheme}//${location.host}/ws?clientId=${encodeURIComponent(clientId)}`);
    } catch { cardSocket = null; return; }
    cardSocket.binaryType = "arraybuffer";
    cardSocket.onopen = () => {
        cardSocket.send(JSON.stringify({ type: "feature_flags", data: { supports_preview_metadata: true } }));
    };
    cardSocket.onmessage = (event) => {
        if (typeof event.data === "string") {
            let msg; try { msg = JSON.parse(event.data); } catch { return; }
            if (msg?.type === "progress" || msg?.type === "progress_state") {
                const ratio = progressRatio(msg.data);
                if (ratio != null) for (const card of runningCards) card.setProgress(ratio);
            }
            return;
        }
        if (event.data instanceof ArrayBuffer) {
            const url = previewUrl(event.data);
            if (url) for (const card of runningCards) card.setLive(url);
        }
    };
    cardSocket.onclose = () => { cardSocket = null; };
}

export function progressRatio(data) {
    if (data?.nodes) {
        let best = null;
        for (const node of Object.values(data.nodes)) {
            if (node.state !== "running") continue;
            const max = Number(node.max) || 0;
            if (max <= 1) continue;
            if (!best || max > best.max) best = { value: Number(node.value) || 0, max };
        }
        return best ? Math.max(0, Math.min(1, best.value / best.max)) : null;
    }
    const max = Number(data?.max) || 0;
    if (max <= 1) return null;
    return Math.max(0, Math.min(1, (Number(data?.value) || 0) / max));
}

function previewUrl(buffer) {
    if (buffer.byteLength < 4) return null;
    const event = new DataView(buffer).getUint32(0, false);
    let bytes = null;
    if (event === 1) bytes = buffer.slice(4);
    else if (event === 4) {
        const metaLen = new DataView(buffer).getUint32(4, false);
        const start = 8 + metaLen;
        if (buffer.byteLength > start) bytes = buffer.slice(start);
    }
    if (!bytes) return null;
    if (liveUrl) URL.revokeObjectURL(liveUrl);
    liveUrl = URL.createObjectURL(new Blob([bytes]));
    return liveUrl;
}

// 创建一个卡面表面，返回控制接口。node 用于持久化与事件归属。
export function createCardSurface(node, { emptyText = "运行后在此呈现结果" } = {}) {
    injectCardCSS();
    node.properties ||= {};
    const root = document.createElement("div");
    root.className = "qq-card";
    const stage = document.createElement("div");
    stage.className = "qq-card-stage";
    const empty = document.createElement("div");
    empty.className = "qq-card-empty";
    empty.textContent = emptyText;
    const live = document.createElement("img");
    live.className = "qq-card-live";
    live.style.display = "none";
    const shimmer = document.createElement("div");
    shimmer.className = "qq-card-shimmer";
    shimmer.style.display = "none";
    const status = document.createElement("div");
    status.className = "qq-card-status";
    status.style.display = "none";
    const progress = document.createElement("div");
    progress.className = "qq-card-progress";
    progress.style.display = "none";
    const progressFill = document.createElement("div");
    progress.append(progressFill);
    stage.append(empty, live, shimmer, status, progress);
    const nav = document.createElement("div");
    nav.className = "qq-card-nav";
    nav.style.display = "none";
    root.append(stage, nav);

    let audioCleanup = null;
    let images = [];
    let imageIndex = 0;

    function clearStage() {
        if (audioCleanup) { audioCleanup(); audioCleanup = null; }
        stage.querySelectorAll("img.qq-card-photo,video,.qq-card-audio").forEach((el) => el.remove());
        nav.style.display = "none";
        nav.replaceChildren();
    }
    function showEmpty() { clearStage(); empty.style.display = "block"; }

    function openZoom(src) {
        const overlay = document.createElement("div");
        overlay.className = "qq-card-zoom";
        const img = document.createElement("img");
        img.src = src;
        overlay.append(img);
        overlay.addEventListener("click", () => overlay.remove());
        document.body.append(overlay);
    }

    function renderImage(list, index) {
        clearStage();
        images = list; imageIndex = index;
        empty.style.display = "none";
        const img = document.createElement("img");
        img.className = "qq-card-photo";
        img.src = viewUrl(list[index]);
        img.addEventListener("click", () => openZoom(img.src));
        stage.append(img);
        if (list.length > 1) {
            nav.style.display = "flex";
            const prev = document.createElement("button");
            prev.textContent = "‹";
            const label = document.createElement("span");
            label.textContent = `${index + 1} / ${list.length}`;
            const next = document.createElement("button");
            next.textContent = "›";
            prev.addEventListener("click", () => renderImage(images, (imageIndex - 1 + images.length) % images.length));
            next.addEventListener("click", () => renderImage(images, (imageIndex + 1) % images.length));
            nav.append(prev, label, next);
        }
    }

    function renderVideo(item) {
        clearStage();
        empty.style.display = "none";
        const video = document.createElement("video");
        video.src = viewUrl(item);
        video.controls = true;
        video.loop = true;
        video.playsInline = true;
        stage.append(video);
    }

    function renderAudio(item) {
        clearStage();
        empty.style.display = "none";
        const box = document.createElement("div");
        box.className = "qq-card-audio";
        const top = document.createElement("div");
        top.className = "qq-card-audio-top";
        const music = document.createElement("span");
        music.className = "qq-card-music";
        music.textContent = "♪";
        const play = document.createElement("button");
        play.className = "qq-card-play";
        play.textContent = "▶";
        const seek = document.createElement("div");
        seek.className = "qq-card-seek";
        const seekFill = document.createElement("div");
        seek.append(seekFill);
        top.append(music, play, seek);
        const canvas = document.createElement("canvas");
        canvas.className = "qq-card-spectrum";
        box.append(top, canvas);
        stage.append(box);

        const audio = new Audio(viewUrl(item));
        let ctx = null, analyser = null, raf = null, freq = null;
        function ensureGraph() {
            if (ctx) return;
            const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
            if (!AC) return;
            ctx = new AC();
            const src = ctx.createMediaElementSource(audio);
            analyser = ctx.createAnalyser();
            analyser.fftSize = 128;
            src.connect(analyser);
            analyser.connect(ctx.destination);
            freq = new Uint8Array(analyser.frequencyBinCount);
        }
        function draw() {
            const dpr = globalThis.devicePixelRatio || 1;
            const w = canvas.clientWidth || 240, h = 64;
            canvas.width = w * dpr; canvas.height = h * dpr;
            const c = canvas.getContext("2d");
            c.setTransform(dpr, 0, 0, dpr, 0, 0);
            c.clearRect(0, 0, w, h);
            if (analyser) analyser.getByteFrequencyData(freq);
            const accent = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#4f8cff";
            const bars = freq ? freq.length : 32;
            const bw = w / bars;
            c.fillStyle = accent;
            for (let i = 0; i < bars; i++) {
                const v = freq ? freq[i] / 255 : 0;
                const bh = Math.max(2, v * h);
                c.globalAlpha = 0.35 + v * 0.65;
                c.fillRect(i * bw + 1, h - bh, bw - 2, bh);
            }
            c.globalAlpha = 1;
            raf = requestAnimationFrame(draw);
        }
        function stopDraw() { if (raf) { cancelAnimationFrame(raf); raf = null; } }
        play.addEventListener("click", () => {
            ensureGraph();
            if (audio.paused) { ctx?.resume?.(); audio.play(); } else audio.pause();
        });
        audio.addEventListener("play", () => { play.textContent = "❚❚"; if (!raf) draw(); });
        audio.addEventListener("pause", () => { play.textContent = "▶"; stopDraw(); });
        audio.addEventListener("ended", () => { play.textContent = "▶"; stopDraw(); seekFill.style.width = "0%"; });
        audio.addEventListener("timeupdate", () => {
            if (audio.duration) seekFill.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
        });
        seek.addEventListener("click", (e) => {
            const rect = seek.getBoundingClientRect();
            if (audio.duration) audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
        });
        audioCleanup = () => { stopDraw(); audio.pause(); ctx?.close?.(); };
    }

    function renderResult(ui) {
        node.properties.qq_card_ui = ui;
        const vids = ui?.videos || [];
        const auds = ui?.audio || [];
        const imgs = ui?.images || [];
        if (vids.length) renderVideo(vids[0]);
        else if (auds.length) renderAudio(auds[0]);
        else if (imgs.length) renderImage(imgs, 0);
        else showEmpty();
    }

    const surface = {
        root,
        renderResult,
        showEmpty,
        setLive(url) {
            if (!url) return;
            live.src = url; live.style.display = "block";
            shimmer.style.display = "none"; empty.style.display = "none";
        },
        setProgress(ratio) {
            progressFill.style.width = `${Math.round(ratio * 100)}%`;
            status.textContent = `渲染中 ${Math.round(ratio * 100)}%`;
        },
        enterRunning() {
            clearStage();
            empty.style.display = "none";
            live.style.display = "none"; live.removeAttribute("src");
            shimmer.style.display = "block";
            status.style.display = "block"; status.textContent = "渲染中…";
            progress.style.display = "block"; progressFill.style.width = "0%";
            runningCards.add(surface);
            ensureSocket();
        },
        exitRunning() {
            runningCards.delete(surface);
            shimmer.style.display = "none";
            status.style.display = "none";
            progress.style.display = "none";
            live.style.display = "none";
        },
        destroy() {
            runningCards.delete(surface);
            if (audioCleanup) audioCleanup();
        },
    };

    root.addEventListener("pointerdown", (e) => e.stopPropagation());
    root.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

    const saved = node.properties.qq_card_ui;
    if (saved && (saved.images?.length || saved.videos?.length || saved.audio?.length)) renderResult(saved);
    else showEmpty();

    return surface;
}

export const CARD_MEDIA_HEIGHT = MEDIA_HEIGHT;
