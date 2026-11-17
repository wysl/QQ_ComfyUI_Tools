/**
 * QQ-提示词模板/变量 前端纯函数测试（与后端同语义）。
 * 运行：node tests/test_prompt_template.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
let src = readFileSync(join(here, "..", "web", "prompt_template.js"), "utf8");
src = src.replace(/^import .*$/gm, "");
src = src.slice(0, src.indexOf("app.registerExtension"));
const factory = new Function(src + "\nreturn { resolveTemplate, parseVars };");
const { resolveTemplate, parseVars } = factory();

let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log("  ok   " + name); }
    else { fail++; console.log("  FAIL " + name); }
}

check("基础替换", resolveTemplate("{角色} 在 {场景}", { 角色: "猫", 场景: "屋顶" }).text === "猫 在 屋顶");
check("缺省回退", resolveTemplate("{x:备用}", {}).text === "备用");
{
    const r = resolveTemplate("{a} {b}", { a: "1" });
    check("未解析保留", r.text === "1 {b}");
    check("未解析上报", JSON.stringify(r.unresolved) === JSON.stringify(["b"]));
}
check("花括号转义", resolveTemplate("{{literal}} {a}", { a: "X" }).text === "{literal} X");
check("未闭合保留", resolveTemplate("ok {abc", {}).text === "ok {abc");
check("unicode", resolveTemplate("{角色}", { 角色: "🐱猫" }).text === "🐱猫");
check("空模板", resolveTemplate("", {}).text === "");

check("parseVars 正常", JSON.stringify(parseVars('{"a":"1"}')) === JSON.stringify({ a: "1" }));
check("parseVars 损坏回退", JSON.stringify(parseVars("{bad")) === "{}");
check("parseVars 空", JSON.stringify(parseVars("")) === "{}");
check("parseVars 非对象", JSON.stringify(parseVars("[1,2]")) === "{}");

console.log(fail === 0 ? "Prompt template frontend tests passed." : `${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
