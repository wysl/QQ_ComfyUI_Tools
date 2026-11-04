/**
 * QQ-媒体序号输出：端口数量要把「外部图片」算进去。
 *
 * 覆盖：
 *   1. 只连了 multi output、没有外部图片 → 端口数 = 内部图片数
 *   2. external_images 接了线（还没跑过）→ 按 1 张外部图片算
 *   3. 跑过之后按后端回报的 ui.qq_external_images.count 算
 *   4. 外部图片线拔掉后，旧的 count 不再生效
 *   5. media_bundle 连接时，图片组同样带上外部图片
 *
 * 运行：node tests/test_media_index_external.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "web", "media_index_output.js"), "utf8");

const cut = src.indexOf("function syncOutputs(node, force = false)");
const pure = src
    .slice(0, cut)
    .replace(/^import .*$/gm, "")
    .replace(/^export /gm, "");

const factory = new Function(`
  const app = { graph: null };
  ${pure}
  return { descriptorsForConnection, externalImageCount, imageCountForLoader };
`);
const api = factory();

let pass = 0;
let fail = 0;
function check(name, cond) {
    if (cond) { pass += 1; console.log("  ok   " + name); }
    else { fail += 1; console.log("  FAIL " + name); }
}

function makeLoader({ images = [], audios = [], videos = [], externalLink = null, externalInfo = null } = {}) {
    const node = {
        type: "QQMediaLoader",
        widgets: [
            { name: "media_state", value: JSON.stringify({ images, audios, videos }) },
        ],
        inputs: [{ name: "external_images", type: "IMAGE", link: externalLink }],
    };
    if (externalInfo) node.__wyslMediaLoaderExternalInfo = externalInfo;
    return node;
}

function connection(node, sourceSlot) {
    return { sourceNode: node, sourceSlot, link: { id: 1, origin_id: node.id ?? 1, origin_slot: 0 } };
}

const multiOut = { type: "IMAGE", name: "multi output" };
const bundleOut = { type: "MINIMAX_H3_MEDIA_BUNDLE", name: "media_bundle" };

console.log("== 1. 没有外部图片 ==");
{
    const node = makeLoader({ images: ["a.png", "b.png"] });
    const descriptors = api.descriptorsForConnection(connection(node, multiOut));
    check("端口数 = 内部图片数", descriptors.length === 2);
    check("名称按顺序编号", descriptors[1].name === "图片 2");
}

console.log("== 2. external_images 接了线、还没跑过 ==");
{
    const node = makeLoader({ images: ["a.png", "b.png"], externalLink: 9 });
    const descriptors = api.descriptorsForConnection(connection(node, multiOut));
    check("多出一路给外部图片", descriptors.length === 3);
    check("最后一路是 图片 3", descriptors[2].name === "图片 3");
}

console.log("== 3. 跑过之后按后端回报的张数 ==");
{
    const node = makeLoader({
        images: ["a.png"],
        externalLink: 9,
        externalInfo: { count: 2, positions: [2, 3] },
    });
    const descriptors = api.descriptorsForConnection(connection(node, multiOut));
    check("内部 1 + 外部 2 = 3 路", descriptors.length === 3);
}

console.log("== 3b. 跑过之后上游其实没送图 ==");
{
    const node = makeLoader({
        images: ["a.png"],
        externalLink: 9,
        externalInfo: { count: 0, positions: [] },
    });
    const descriptors = api.descriptorsForConnection(connection(node, multiOut));
    check("不凭空多出一路", descriptors.length === 1);
}

console.log("== 4. 外部图片线拔掉后旧的张数不再生效 ==");
{
    const node = makeLoader({
        images: ["a.png", "b.png"],
        externalLink: null,
        externalInfo: { count: 2, positions: [3, 4] },
    });
    const descriptors = api.descriptorsForConnection(connection(node, multiOut));
    check("回到只有内部图片", descriptors.length === 2);
}

console.log("== 5. media_bundle 连接的图片组也带上外部图片 ==");
{
    const node = makeLoader({ images: ["a.png"], videos: ["v.mp4"], externalLink: 9 });
    const descriptors = api.descriptorsForConnection(connection(node, bundleOut));
    const images = descriptors.filter((entry) => entry.type === "IMAGE");
    check("图片组包含外部图片", images.length === 2);
    check("视频组不受影响", descriptors.filter((entry) => entry.type === "VIDEO").length === 1);
}

console.log("");
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
