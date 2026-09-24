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

assert.match(source, /search\.addEventListener\("submit"/)
assert.match(source, /const layout = searching \? "4"/)
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
