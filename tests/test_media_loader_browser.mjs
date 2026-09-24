import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'web', 'media_loader.js'), 'utf8')
const pathHelpers = source.slice(source.indexOf('function normalizePath('), source.indexOf('function readState('))
const urlHelpers = source.slice(source.indexOf('function mediaUrl('), source.indexOf('function closeHoverPreview('))
const helpers = new Function(`${pathHelpers}\n${urlHelpers}\nreturn { splitReference, mediaReference, normalizeReference, mediaUrl, thumbnailUrl }`)()
const titleHelper = source.slice(source.indexOf('function cardTitle('), source.indexOf('function measurePanelHeight('))
const { cardTitle } = new Function(`${pathHelpers}\n${titleHelper}\nreturn { cardTitle }`)()
const hoverHelpers = source.slice(source.indexOf('function closeHoverPreview('), source.indexOf('function cancelHoverPreviewClose('))
const { closeDetachedHoverPreview } = new Function(`${hoverHelpers}\nreturn { closeDetachedHoverPreview }`)()
const previewSizing = source.slice(source.indexOf('function hoverPreviewDimensions('), source.indexOf('function attachImageHoverPreview('))
const { hoverPreviewDimensions } = new Function(`${previewSizing}\nreturn { hoverPreviewDimensions }`)()
const modalSizing = source.slice(source.indexOf('function modalThumbnailSize('), source.indexOf('function updateModalThumbnails('))
const { modalThumbnailSize } = new Function('THUMB_TILE', 'window', `${modalSizing}\nreturn { modalThumbnailSize }`)(128, { devicePixelRatio: 1.5 })
const layoutHelper = source.slice(source.indexOf('function setModalLayout('), source.indexOf('function selectedCount('))
let thumbnailUpdates = 0
const { setModalLayout } = new Function('updateModalThumbnails', `${layoutHelper}\nreturn { setModalLayout }`)(() => { thumbnailUpdates += 1 })

assert.deepEqual(helpers.splitReference('folder/picture.png'), { source: 'input', path: 'folder/picture.png' })
assert.deepEqual(helpers.splitReference('output::sub/clip.mp4'), { source: 'output', path: 'sub/clip.mp4' })
assert.equal(helpers.mediaReference('output', 'sub/picture.png'), 'output::sub/picture.png')
assert.equal(helpers.normalizeReference('output::sub\\picture.png'), 'output::sub/picture.png')

const outputUrl = new URL(helpers.mediaUrl('output::sub/picture.png'), 'http://localhost')
assert.equal(outputUrl.searchParams.get('type'), 'output')
assert.equal(outputUrl.searchParams.get('subfolder'), 'sub')
assert.equal(outputUrl.searchParams.get('filename'), 'picture.png')

const thumbUrl = new URL(helpers.thumbnailUrl('output::sub/picture.png', 128), 'http://localhost')
assert.equal(thumbUrl.searchParams.get('filename'), 'output::sub/picture.png')
assert.equal(thumbUrl.searchParams.get('size'), '128')
assert.equal(cardTitle('output::sub/picture.png'), 'picture.png')

let removed = 0
const detachedNode = {
    __wyslMediaLoaderHoverPreview: {
        __wyslMediaLoaderHoverAnchor: { isConnected: false },
        remove() { removed += 1 },
    },
}
closeDetachedHoverPreview(detachedNode)
assert.equal(removed, 1)
assert.equal(detachedNode.__wyslMediaLoaderHoverPreview, null)

const attachedPreview = {
    __wyslMediaLoaderHoverAnchor: { isConnected: true },
    remove() { removed += 1 },
}
const attachedNode = { __wyslMediaLoaderHoverPreview: attachedPreview }
closeDetachedHoverPreview(attachedNode)
assert.equal(removed, 1)
assert.equal(attachedNode.__wyslMediaLoaderHoverPreview, attachedPreview)

assert.deepEqual(hoverPreviewDimensions(56, 56, 1200, 900), { width: 168, height: 168 })
assert.deepEqual(hoverPreviewDimensions(56, 40, 1200, 900), { width: 168, height: 120 })
assert.deepEqual(hoverPreviewDimensions(56, 56, 160, 120), { width: 144, height: 104 })
assert.equal(modalThumbnailSize({ clientWidth: 860 }, '3'), 384)
assert.equal(modalThumbnailSize({ clientWidth: 860 }, '4'), 256)
assert.equal(modalThumbnailSize({ clientWidth: 860 }, '5'), 256)
assert.equal(modalThumbnailSize({ clientWidth: 860 }, 'list'), 128)
const modal = { dataset: { layout: '4' }, __wyslSearching: false }
const anchor = { getBoundingClientRect: () => ({ top: modal.dataset.layout === '3' ? 110 : 60, bottom: 120 }) }
const body = { scrollTop: 200, getBoundingClientRect: () => ({ top: 50 }), querySelectorAll: () => [anchor] }
const buttons = ['3', '4'].map((layout) => ({ dataset: { layout }, classList: { toggle() {} }, setAttribute() {} }))
modal.querySelector = () => body
modal.querySelectorAll = () => buttons
setModalLayout(modal, '3')
assert.equal(modal.dataset.layout, '3')
assert.equal(body.scrollTop, 250)
assert.equal(thumbnailUpdates, 1)
assert.equal(buttons[0].disabled, false)
setModalLayout(modal, '4', false)
assert.equal(thumbnailUpdates, 1)

assert.match(source, /search\.addEventListener\("submit"/)
assert.match(source, /const layout = searching \? "4"/)
assert.match(source, /node\.__wyslMediaLoaderLayout = value;\s*setModalLayout\(modal, value\);/)
assert.match(source, /\.wysl-media-file-thumb \.wysl-media-thumb img\{object-fit:contain\}/)
assert.match(source, /if \(group\.type === "image"\) attachImageHoverPreview\(node, card, path\)/)
const fileRow = source.slice(source.indexOf('function createFileRow('), source.indexOf('function renderModalFiles('))
assert.doesNotMatch(fileRow, /attachImageHoverPreview\(/)
assert.match(source, /function openModal\(node\)\s*\{\s*registerModalCleanup\(\);\s*closeHoverPreview\(node\);/)
assert.match(source, /data-layout="3"\] \.wysl-media-file-list\{[^}]*--wysl-file-thumb-size:200px/)
assert.match(source, /\.wysl-media-file-list\{[^}]*--wysl-file-thumb-size:128px/)
assert.match(source, /data-layout="5"\] \.wysl-media-file-list\{[^}]*--wysl-file-thumb-size:90px/)
assert.match(source, /data-layout="list"\] \.wysl-media-file-list\{[^}]*--wysl-file-thumb-size:68px/)
assert.match(source, /\.wysl-media-file-row\{[^}]*grid-template-columns:15px var\(--wysl-file-thumb-size\) minmax\(0,1fr\)/)
assert.match(source, /\.wysl-media-file-row\{[^}]*gap:2px 3px/)
assert.match(source, /\.wysl-media-file-row input\{position:static/)
assert.match(source, /\.wysl-media-file-thumb\{[^}]*width:var\(--wysl-file-thumb-size\);height:var\(--wysl-file-thumb-size\)/)
assert.doesNotMatch(source, /\.wysl-media-file-thumb\{[^}]*border:1px/)
assert.match(source, /qq-media-loader-modal-v2 \.wysl-media-file-thumb\{[^}]*border-radius:3px!important;border:0!important/)
assert.match(source, /qq-media-loader-modal-v2 \.wysl-media-file-row\{display:grid!important;grid-template-columns:15px var\(--wysl-file-thumb-size\) minmax\(0,1fr\)!important;column-gap:3px!important\}/)
assert.match(source, /qq-media-loader-modal-v2 \.wysl-media-file-meta\{margin-left:2px\}/)
assert.match(source, /qq-media-loader-modal-v2 \.wysl-media-file-thumb \.wysl-media-thumb\{background:transparent\}/)
assert.match(source, /qq-media-loader-modal-v2 \.wysl-media-file-thumb \.wysl-media-thumb img\{object-fit:cover\}/)
assert.match(source, /\.wysl-media-file-thumb \.wysl-media-thumb,.wysl-media-file-thumb \.wysl-media-thumb img\{border-radius:inherit\}/)
assert.match(source, /new IntersectionObserver\(/)
assert.match(source, /const MODAL_RENDER_CHUNK = 24;/)
assert.match(source, /loadFolder\(node, node\.__wyslMediaLoaderFolder \|\| "", node\.__wyslMediaLoaderSource \|\| "input"\);/)
assert.match(source, /selectAll\.disabled = node\.__wyslMediaLoaderFolderLoading/)
assert.match(source, /input\.multiple = true;/)
assert.match(source, /closeDetachedHoverPreview\(node\);\s*if \(groups\) groups\.scrollTop/)
assert.match(source, /body\.replaceChildren\(\);\s*closeDetachedHoverPreview\(node\);/)
assert.match(source, /modal\.remove\(\);\s*closeDetachedHoverPreview\(node\);/)
assert.doesNotMatch(source, /input\.webkitdirectory\s*=/)
console.log('Media browser source, URLs, search and lazy loading: OK')
