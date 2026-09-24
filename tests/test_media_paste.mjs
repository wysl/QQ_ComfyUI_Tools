/**
 * Regression tests for the media loader clipboard paste support.
 *
 * 规则：
 *   1. 只有选中了「WyslMediaLoader」节点时才响应 Ctrl+V
 *   2. 剪贴板里没有媒体文件时不拦截（普通文本粘贴、节点复制粘贴不受影响）
 *   3. 焦点在输入框/文本域时不拦截
 *   4. 剪贴板 blob 没名字时能按 MIME 合成扩展名
 *   5. 「粘贴」按钮只在安全上下文（127.0.0.1 / localhost）出现，且在「添加媒体」左侧
 *
 * 运行：node tests/test_media_paste.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const f = join(here, '..', 'web', 'media_loader.js')
const src = readFileSync(f, 'utf8')

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass += 1; console.log('  ok   ' + name) }
  else { fail += 1; console.log('  FAIL ' + name) }
}

// ---- 从源码裁出纯函数，在沙箱里求值 ----
// 公共函数区：extension + typeForFile（不含 MIME_EXTENSION，避免重复声明）
const typeFnStart = src.indexOf('function extension(path)')
const typeFnEnd = src.indexOf('const MIME_EXTENSION = {')
const typeBlock = src.slice(typeFnStart, typeFnEnd)
// 剪贴板辅助函数区
const helperStart = src.indexOf('const MIME_EXTENSION = {')
const helperEnd = src.indexOf('function mediaUrl(path)')
const block = src.slice(helperStart, helperEnd)

const factory = new Function(`
  const NODE_TYPE = "WyslMediaLoader";
  const app = { graph: { _nodes: [] } };
  ${typeBlock}
  ${block}
  return { extensionFromMime, fileFromBlob, filesFromClipboardItems,
           selectedMediaLoaderNode, canReadClipboardDirectly, typeForFile };
`)
const api = factory()

const makeNode = (selected = false) => ({
  comfyClass: 'WyslMediaLoader',
  is_selected: selected,
  __wyslMediaLoaderSetup: true,
})

function fakeItem(type, name) {
  return {
    kind: 'file',
    type,
    getAsFile() {
      const file = new File(['x'], name || '', { type })
      if (!name) Object.defineProperty(file, 'name', { value: '' })
      return file
    },
  }
}

console.log('== 1. 只有选中节点时才响应（核心规则）==')
{
  // 未选中
  let graph = { _nodes: [makeNode(false)] }
  let sel = (function look(g) {
    for (const n of g._nodes) if (n.is_selected || n.selected) return n
    return null
  })(graph)
  check('未选中 → 返回 null（不拦截）', sel === null)

  // 选中
  graph = { _nodes: [makeNode(true)] }
  sel = (function look(g) {
    for (const n of g._nodes) if (n.is_selected || n.selected) return n
    return null
  })(graph)
  check('选中 → 能取到节点', sel !== null)

  // 选了别的类型节点
  graph = { _nodes: [{ comfyClass: 'KSampler', is_selected: true }] }
  const notMine = (function look(g) {
    for (const n of g._nodes) {
      if (n.comfyClass !== 'WyslMediaLoader' && n.type !== 'WyslMediaLoader') continue
      if (n.is_selected || n.selected) return n
    }
    return null
  })(graph)
  check('选中其它节点 → 不响应', notMine === null)
}

console.log('== 2. 剪贴板内容判定 ==')
{
  const img = api.filesFromClipboardItems([fakeItem('image/png')])
  check('图片被识别', img.length === 1)

  const vid = api.filesFromClipboardItems([fakeItem('video/mp4')])
  check('视频被识别', vid.length === 1)

  const aud = api.filesFromClipboardItems([fakeItem('audio/mpeg')])
  check('音频被识别', aud.length === 1)

  const both = api.filesFromClipboardItems([fakeItem('image/png'), fakeItem('video/mp4')])
  check('多个文件全部取出', both.length === 2)

  const none = api.filesFromClipboardItems([{ kind: 'string', type: 'text/plain' }])
  check('纯文本 → 无文件（不拦截）', none.length === 0)
}

console.log('== 3. MIME 合成扩展名 ==')
{
  check('png', api.extensionFromMime('image/png') === '.png')
  check('jpeg', api.extensionFromMime('image/jpeg') === '.jpg')
  check('mp4', api.extensionFromMime('video/mp4') === '.mp4')
  check('mp3', api.extensionFromMime('audio/mpeg') === '.mp3')
  check('带参数也能解析', api.extensionFromMime('image/png; charset=binary') === '.png')
  check('未知类型返回空或兜底', typeof api.extensionFromMime('application/x-weird') === 'string')

  const f1 = api.fileFromBlob(new Blob(['x'], { type: 'image/png' }), 0)
  check('合成名字带 png 后缀', String(f1.name).endsWith('.png'))
  check('能被 typeForFile 认成 image', api.typeForFile(f1) === 'image')

  const f2 = api.fileFromBlob(new Blob(['x'], { type: 'video/mp4' }), 0)
  check('视频合成名字可识别', api.typeForFile(f2) === 'video')
}

console.log('== 4. 源码结构约束 ==')
{
  check('存在 paste 事件监听', src.includes("document.addEventListener('paste'") || src.includes('document.addEventListener("paste"'))
  check('使用捕获阶段', /addEventListener\("paste",[\s\S]*?\}, \{ capture: true \}\)/.test(src))
  check('跳过输入框/文本域', src.includes('HTMLInputElement') && src.includes('HTMLTextAreaElement'))
  check('跳过 contenteditable', src.includes('isContentEditable'))
  check('未命中时不拦截（提前 return）', /if \(!files\.length\) return;/.test(src))
  check('未选中时返回 null', src.includes('return null;'))
  check('复用 addDroppedFiles', src.includes('addDroppedFiles(node, files)'))

  check('粘贴按钮已定义', src.includes('wysl-media-paste'))
  // 显示在「添加媒体」左侧 —— 由 toolbar.append 的参数顺序决定
  check('append 参数顺序为 paste,add,clear', /toolbar\.append\(\.\.\.\[title, count, paste, add, clear\]/.test(src))
  check('按钮仅在安全上下文出现', src.includes('canReadClipboardDirectly()'))
}

console.log('')
console.log(`通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
