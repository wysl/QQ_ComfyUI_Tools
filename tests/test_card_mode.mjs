/**
 * QQ-卡面模式 前端纯函数测试。运行：node tests/test_card_mode.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
let src = readFileSync(join(here, "..", "web", "card_mode.js"), "utf8");
src = src.replace(/^import .*$/gm, "");
src = src.slice(0, src.indexOf("app.registerExtension"));
const factory = new Function(src + "\nreturn { cardEventMatches };");
const { cardEventMatches } = factory();

let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log("  ok   " + name); }
    else { fail++; console.log("  FAIL " + name); }
}

check("宿主自身匹配", cardEventMatches("3", "3") === true);
check("嵌套内部节点匹配", cardEventMatches("3:2", "3") === true);
check("深层嵌套匹配", cardEventMatches("3:2:1", "3") === true);
check("其他节点不匹配", cardEventMatches("4", "3") === false);
check("前缀相似不误匹配", cardEventMatches("30:2", "3") === false);
check("空事件不匹配", cardEventMatches(undefined, "3") === false);
check("数字 id 兼容", cardEventMatches(3, 3) === true);

console.log(fail === 0 ? "Card mode frontend tests passed." : `${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
