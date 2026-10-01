import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

// 回归场景来自真实工作流截图：内层「分割」组的左边露出外层组之外，
// 只按矩形完全包含判定会把嵌套关系判丢，导致深度=1 时误绕过内层组节点。

const source = (await fs.readFile(new URL("../web/group_bypass_tag.js", import.meta.url), "utf8"))
    .replace('import { app } from "../../scripts/app.js";', "")
    .replace(
        "export { applyTag, groupDepthForNode, groupForTag, membersAtDepth };",
        "globalThis.__tag = { applyTag, groupDepthForNode, groupForTag, membersAtDepth };",
    );

const ALWAYS = 0;
const BYPASS = 4;
const context = {
    app: { registerExtension() {} },
    LiteGraph: { LGraphEventMode: { ALWAYS, BYPASS } },
    console,
};
vm.runInNewContext(source, context);
const { applyTag, groupDepthForNode, groupForTag } = context.__tag;

function makeGroup(title, x, y, w, h, members) {
    const group = { title, pos: [x, y], size: [w, h], nodes: members, recomputeInsideNodes() {} };
    return group;
}

let nextId = 1;
function makeNode(pos, size, { tag = null, depth = 0 } = {}) {
    const widgets = [];
    if (tag !== null) {
        widgets.push({ name: "模式", value: tag });
        widgets.push({ name: "忽略深度", value: depth });
    }
    return {
        id: nextId++,
        comfyClass: tag === null ? "SomeNode" : "QQGroupBypassTag",
        pos,
        size,
        mode: ALWAYS,
        widgets,
        properties: {},
        setDirtyCanvas() {},
    };
}

function buildGraph({ depth, mode }) {
    const direct = makeNode([430, 80], [220, 120]);
    const nested = makeNode([130, 150], [200, 200]);
    const tag = makeNode([540, 320], [260, 110], { tag: mode, depth });

    const split = makeGroup("分割", 15, 100, 320, 340, [nested]);
    const outer = makeGroup("Depth深度图获取优化", 100, 30, 1290, 430, [direct, nested]);

    const graph = {
        _nodes: [direct, nested, tag],
        _groups: [split, outer],
        setDirtyCanvas() {},
        change() {},
    };
    return { graph, direct, nested, tag, split, outer };
}

// 内层组左边露出外层组（不是严格包含），深度判定仍必须生效
{
    const { graph, direct, nested, outer, split } = buildGraph({ depth: 1, mode: "绕过" });
    assert.ok(split.pos[0] < outer.pos[0], "用例前提：内层组左边露在外层组外");
    assert.equal(groupDepthForNode(outer, direct, graph._groups, graph._nodes), 1);
    assert.equal(groupDepthForNode(outer, nested, graph._groups, graph._nodes), 2);
}

// 组几何完全拿不到的前端版本：必须只靠成员列表也能识别嵌套
{
    const { graph, direct, nested, tag, outer } = buildGraph({ depth: 1, mode: "绕过" });
    // 官方 recomputeInsideNodes 的成员列表本来就会包含组内的魔术贴
    outer.nodes = [direct, nested, tag];
    for (const group of graph._groups) {
        delete group.pos;
        delete group.size;
    }
    applyTag(graph);
    assert.equal(direct.mode, BYPASS, "没有几何信息时也要能绕过第一层");
    assert.equal(nested.mode, ALWAYS, "没有几何信息时内层组节点必须跳过");
}

// 没有几何信息时，深度=2 仍要能放开下一层
{
    const { graph, direct, nested, tag, outer } = buildGraph({ depth: 2, mode: "绕过" });
    outer.nodes = [direct, nested, tag];
    for (const group of graph._groups) {
        delete group.pos;
        delete group.size;
    }
    applyTag(graph);
    assert.equal(nested.mode, BYPASS);
}

// 魔术贴贴在组的下边缘、身体露在组外时也不能失效
{
    const { graph, direct, tag, outer } = buildGraph({ depth: 1, mode: "绕过" });
    tag.pos = [540, 470];
    assert.equal(groupForTag(tag, graph._groups, graph._nodes), outer);
    applyTag(graph);
    assert.equal(direct.mode, BYPASS);
}

// 深度 1：只绕过外层组的直接节点，内层「分割」组节点保持原状
{
    const { graph, direct, nested, tag } = buildGraph({ depth: 1, mode: "绕过" });
    const result = applyTag(graph);
    assert.equal(direct.mode, BYPASS);
    assert.equal(nested.mode, ALWAYS, "深度=1 不应绕过内层组节点");
    assert.equal(tag.mode, ALWAYS, "魔术贴自己永不被绕过");
    assert.match(result.report.join(" "), /深度 1 成员 1/);
}

// 深度 2：把下一层嵌套组也纳入
{
    const { graph, direct, nested } = buildGraph({ depth: 2, mode: "绕过" });
    applyTag(graph);
    assert.equal(direct.mode, BYPASS);
    assert.equal(nested.mode, BYPASS);
}

// 深度 0：保持原来的递归行为
{
    const { graph, nested } = buildGraph({ depth: 0, mode: "绕过" });
    applyTag(graph);
    assert.equal(nested.mode, BYPASS);
}

// 切回「启用」：恢复被魔术贴记录过的节点
{
    const { graph, direct, nested } = buildGraph({ depth: 0, mode: "启用" });
    applyTag(graph);
    assert.equal(direct.mode, ALWAYS);
    assert.equal(nested.mode, ALWAYS);
    assert.equal(direct.properties.wyslTagOwned, undefined);
}

// 用户手动绕过的节点在「启用」时不应被恢复
{
    const { graph, direct } = buildGraph({ depth: 2, mode: "绕过" });
    direct.mode = BYPASS;
    direct.properties.wyslPrevMode = undefined;
    applyTag(graph);
    assert.equal(direct.mode, BYPASS);
}

// 深度从 0 调到 1：已接管的内层组节点必须放回，不能永远停在绕过
{
    const { graph, nested, tag } = buildGraph({ depth: 0, mode: "绕过" });
    applyTag(graph);
    assert.equal(nested.mode, BYPASS);
    tag.widgets.find((w) => w.name === "忽略深度").value = 1;
    const result = applyTag(graph);
    assert.equal(nested.mode, ALWAYS, "深度调小后内层组节点必须被释放");
    assert.match(result.report.join(" "), /释放 1/);
}

// 深度调小后再切「启用」，也不能留下卡住的节点
{
    const { graph, nested, tag } = buildGraph({ depth: 0, mode: "绕过" });
    applyTag(graph);
    tag.widgets.find((w) => w.name === "忽略深度").value = 1;
    tag.widgets.find((w) => w.name === "模式").value = "启用";
    applyTag(graph);
    assert.equal(nested.mode, ALWAYS);
    assert.equal(nested.properties.wyslTagOwned, undefined);
}

// 节点被移出组之后同样要释放
{
    const { graph, direct, outer } = buildGraph({ depth: 1, mode: "绕过" });
    applyTag(graph);
    assert.equal(direct.mode, BYPASS);
    direct.pos = [5000, 5000];
    outer.nodes = outer.nodes.filter((node) => node !== direct);
    applyTag(graph);
    assert.equal(direct.mode, ALWAYS, "移出组后必须释放");
}

// 深度判定本身：直接成员=1，内层组成员=2
{
    const { graph, direct, nested, split, outer } = buildGraph({ depth: 1, mode: "绕过" });
    const nodes = graph._nodes;
    const groups = graph._groups;
    assert.equal(groupDepthForNode(outer, direct, groups, nodes), 1);
    assert.equal(groupDepthForNode(outer, nested, groups, nodes), 2);
    assert.equal(groupDepthForNode(outer, nested, groups, nodes) <= 1, false);
    assert.ok(split.nodes.includes(nested));
}

console.log("Group bypass depth tests passed: partial-overlap nesting, depth 0/1/2, restore, manual bypass.");
