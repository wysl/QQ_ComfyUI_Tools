/**
 * Regression tests for the bypass rule module (web/ignore_rules.js).
 *
 * 覆盖两个已修复的缺陷：
 *   1. 「关闭」无法恢复（原状态没被序列化）
 *   2. 节点本来就是 BYPASS 时无法正确记录/恢复
 *
 * 运行：node tests/test_bypass_rules.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'web', 'ignore_rules.js'), 'utf8')

// 从源码中裁出纯函数部分（到 applyRules 之前），去掉 import 行，便于在 Node 里求值
const cut = src.indexOf('function applyRules')
const pure = src
  .slice(0, cut)
  .replace(/^import .*$/m, '')
  .replace(/const NODE_TYPE[\s\S]*?const PROP_PREV_MODE = "wyslPrevMode";/, '')

const factory = new Function(`
  const globalThis = {};
  const NODE_TYPE = "WyslIgnoreRules";
  const EXCLUDE_PREFIX = "!";
  const PROP_PREV_MODE = "wyslPrevMode";
  ${pure}
  return { enums, setBypassed, readPrevMode, writePrevMode, clearPrevMode, splitRules, textMatches };
`)

const api = factory()
const { setBypassed, readPrevMode } = api

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass += 1; console.log('  ok  ' + name) }
  else { fail += 1; console.log('  FAIL ' + name) }
}

// 模拟官方 LGraphNode：mode 存在 _state，properties 会参与序列化
function makeNode(mode = 0, props = {}) {
  const state = { mode, properties: { ...props } }
  return {
    _state: state,
    get mode() { return this._state.mode },
    set mode(v) { this._state.mode = v },
    get properties() { return this._state.properties },
  }
}

console.log('== 1. 基本绕过 / 恢复 ==')
{
  const n = makeNode(0)
  check('初始为 ALWAYS', n.mode === 0)
  check('绕过返回 true', setBypassed(n, true) === true)
  check('已是 BYPASS', n.mode === 4)
  check('原状态记进 properties', readPrevMode(n) === 0)
  check('重复绕过返回 false', setBypassed(n, true) === false)
  check('取消绕过返回 true', setBypassed(n, false) === true)
  check('恢复为 ALWAYS', n.mode === 0)
  check('记录已清除', readPrevMode(n) === undefined)
}

console.log('== 2. 保存/加载后仍能恢复（旧版 bug 1）==')
{
  const n1 = makeNode(0)
  setBypassed(n1, true)
  // 模拟保存再加载：只保留会被序列化的字段（mode + properties）
  const saved = JSON.parse(JSON.stringify({ mode: n1.mode, properties: n1.properties }))
  const n2 = makeNode(saved.mode, saved.properties)
  check('加载后 mode=BYPASS', n2.mode === 4)
  check('加载后仍能读到原状态', readPrevMode(n2) === 0)
  check('关闭可恢复', setBypassed(n2, false) === true)
  check('恢复为 ALWAYS', n2.mode === 0)
}

console.log('== 3. 节点本来就是 BYPASS（旧版 bug 2）==')
{
  const n = makeNode(4)  // 用户手动绕过的节点
  check('初始已是 BYPASS', n.mode === 4)
  check('未记录原状态时不写脏数据', readPrevMode(n) === undefined)
  check('不重复改模式', setBypassed(n, true) === false)
  check('mode 仍是 BYPASS', n.mode === 4)
  // 规则不再命中该节点时，兜底恢复为 ALWAYS
  check('关闭时兜底恢复', setBypassed(n, false) === true)
  check('兜底为 ALWAYS', n.mode === 0)
}

console.log('== 4. 兼容旧字段 _wyslPrevMode ==')
{
  const n = makeNode(4)
  n._wyslPrevMode = 1  // 旧版本留下的记录
  check('能读到旧字段', readPrevMode(n) === 1)
  check('关闭时恢复旧值', setBypassed(n, false) === true)
  check('mode 恢复为 1', n.mode === 1)
}

console.log('== 5. 规则解析（含 ! 排除）==')
{
  const r = api.splitRules(['^Get_图片', '!Get_图片 1', '^预处理'])
  check('命中两条', r.include.length === 2)
  check('排除一条', r.exclude.length === 1)
  check('排除内容正确', r.exclude[0] === 'Get_图片 1')
  check('正则匹配', api.textMatches('^Get_图片', 'Get_图片 8') === true)
  check('包含匹配', api.textMatches('图像', '图像放大') === true)
  check('不误匹配', api.textMatches('^Get_图片', 'Get_CLIP') === false)
}

console.log('')
console.log(`通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)


