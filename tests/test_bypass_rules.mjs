/**
 * Regression tests for the bypass rule module (web/ignore_rules.js).
 *
 * 已修复缺陷的回归：
 *   1. 「关闭」无法恢复 —— 原状态没被序列化
 *   2. 节点本来就是 BYPASS 时无法正确记录/恢复
 *   3. 启动时把「用户手动绕过」的节点强制启用（本次修复）
 *
 * 运行：node tests/test_bypass_rules.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'web', 'ignore_rules.js'), 'utf8')

// 裁出纯函数部分（到 applyRules 之前），去掉 import 与常量声明，在求值上下文里补回
const cut = src.indexOf('function applyRules')
const pure = src
  .slice(0, cut)
  .replace(/^import .*$/m, '')
  // 去掉源码里的常量声明，避免与下方求值上下文重复
  .replace(/^const (NODE_TYPE|TAG|EXCLUDE_PREFIX|PROP_PREV_MODE) = .*$/gm, '')

const factory = new Function(`
  const globalThis = {};
  const NODE_TYPE = "QQIgnoreRules";
  const EXCLUDE_PREFIX = "!";
  const PROP_PREV_MODE = "wyslPrevMode";
  ${pure}
  return { enums, setBypassed, readPrevMode, hasOwnRecord, splitRules, textMatches };
`)

const api = factory()
const { setBypassed, readPrevMode, hasOwnRecord } = api

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass += 1; console.log('  ok   ' + name) }
  else { fail += 1; console.log('  FAIL ' + name) }
}

// 模拟官方 LGraphNode：mode 存在 _state；properties 参与序列化
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
  check('标记已建立', hasOwnRecord(n) === true)
  check('重复绕过返回 false', setBypassed(n, true) === false)
  check('取消绕过返回 true', setBypassed(n, false) === true)
  check('恢复为 ALWAYS', n.mode === 0)
  check('记录已清除', readPrevMode(n) === undefined)
  check('标记已清除', hasOwnRecord(n) === false)
}

console.log('== 2. 保存 / 加载后仍能恢复（缺陷 1）==')
{
  const n1 = makeNode(0)
  setBypassed(n1, true)
  // 模拟保存再加载：只保留会被序列化的字段
  const saved = JSON.parse(JSON.stringify({ mode: n1.mode, properties: n1.properties }))
  const n2 = makeNode(saved.mode, saved.properties)
  check('加载后 mode=BYPASS', n2.mode === 4)
  check('加载后仍读到原状态', readPrevMode(n2) === 0)
  check('标记仍在', hasOwnRecord(n2) === true)
  check('关闭可恢复', setBypassed(n2, false) === true)
  check('恢复为 ALWAYS', n2.mode === 0)
}

console.log('== 3. 用户手动绕过的节点必须原样保留（缺陷 3）==')
{
  const n = makeNode(4)  // 用户自己右键绕过的节点，没有任何标记
  check('初始已是 BYPASS', n.mode === 4)
  check('没有任何标记', hasOwnRecord(n) === false)
  check('绕过时不动它', setBypassed(n, true) === false)
  check('mode 仍是 BYPASS', n.mode === 4)
  check('取消绕过不动它', setBypassed(n, false) === false)
  check('mode 保持 BYPASS（关键）', n.mode === 4)
}

console.log('== 4. 用户手动改为 NEVER 的节点不被我们改 ==')
{
  const n = makeNode(2)  // NEVER
  check('初始为 NEVER', n.mode === 2)
  check('无标记', hasOwnRecord(n) === false)
  check('取消绕过不动它', setBypassed(n, false) === false)
  check('mode 保持 NEVER', n.mode === 2)
}

console.log('== 5. 绕过非 ALWAYS 的节点，恢复时还原原值 ==')
{
  const n = makeNode(2)  // NEVER
  setBypassed(n, true)
  check('改为 BYPASS', n.mode === 4)
  check('记录了原值 2', readPrevMode(n) === 2)
  setBypassed(n, false)
  check('恢复为 NEVER', n.mode === 2)
}

console.log('== 6. 仅剩旧字段（无 properties）时不擅自恢复 ==')
{
  const n = makeNode(4)
  n._wyslPrevMode = 1  // 旧版本残留
  check('旧字段可读', readPrevMode(n) === 1)
  check('但不视为我们的标记', hasOwnRecord(n) === false)
  check('取消绕过不动它', setBypassed(n, false) === false)
  check('mode 保持 BYPASS', n.mode === 4)
}

console.log('== 7. 规则解析（含 ! 排除）==')
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
