import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "web", "qwen_pe_images.js"), "utf8")
  .replace(/^import .*$/m, "");

const app = { registerExtension(extension) { this.extension = extension; }, configuringGraph: false };
globalThis.LiteGraph = { INPUT: 1, OUTPUT: 2 };
new Function("app", source)(app);

const NODE_TYPE = "QQQwenImage21PromptEnhancer";
const MAX_IMAGES = 9;

function makeNodeType() {
  const NodeType = function NodeType() {
    this.inputs = [];
    this.graph = {};
    this.size = [220, 100];
  };
  NodeType.prototype.addInput = function addInput(name, type) {
    const input = { name, type, link: null };
    this.inputs.push(input);
    return input;
  };
  NodeType.prototype.removeInput = function removeInput(index) {
    this.inputs.splice(index, 1);
  };
  NodeType.prototype.setSize = function setSize(size) { this.size = size; };
  NodeType.prototype.computeSize = function computeSize() { return [220, 100]; };
  NodeType.prototype.setDirtyCanvas = function setDirtyCanvas() {};
  return NodeType;
}

function backendNode(NodeType) {
  // 后端 INPUT_TYPES 会先给出 9 个可选 IMAGE 口
  const node = new NodeType();
  for (let index = 0; index < MAX_IMAGES; index += 1) node.addInput(`图片${index + 1}`, "IMAGE");
  return node;
}

function names(node) { return node.inputs.map((input) => input.name); }
function linkCount(node) { return node.inputs.filter((input) => input.link != null).length; }

async function settle(node) {
  node.onConnectionsChange(globalThis.LiteGraph.INPUT);
  await Promise.resolve();
  await Promise.resolve();
}

function check(name, condition) {
  if (!condition) throw new Error(`FAIL ${name}`);
  console.log(`ok   ${name}`);
}

const NodeType = makeNodeType();
await app.extension.beforeRegisterNodeDef(NodeType, { name: NODE_TYPE });

const created = backendNode(NodeType);
created.onNodeCreated();
check("新节点只保留一个参考图口", names(created).join(",") === "图片1");
check("输入口类型固定为 IMAGE", created.inputs[0].type === "IMAGE");
check("输入口保持列表语义，接 multi output 不会被拆成多次执行", created.inputs[0].isList === true);

created.inputs[0].link = 1;
await settle(created);
check("接满一个自动多出下一个", names(created).join(",") === "图片1,图片2");

created.inputs[1].link = 2;
await settle(created);
check("继续接线继续补口", names(created).join(",") === "图片1,图片2,图片3");

created.inputs[1].link = null;
await settle(created);
check("尾部空闲口自动收回，已连线的口不动", names(created).join(",") === "图片1,图片2");
check("收回后连线数量不变", linkCount(created) === 1);

for (let index = 0; index < MAX_IMAGES + 4; index += 1) {
  if (index < created.inputs.length) created.inputs[index].link = index + 1;
  await settle(created);
}
check("最多扩展到 9 个口", created.inputs.length === MAX_IMAGES);
check("口名按序号排列", names(created).join(",") === Array.from({ length: MAX_IMAGES }, (_, i) => `图片${i + 1}`).join(","));
await settle(created);
check("超过上限后不再继续扩展", created.inputs.length === MAX_IMAGES);

const OtherType = makeNodeType();
await app.extension.beforeRegisterNodeDef(OtherType, { name: "QQPollingSwitch" });
const other = new OtherType();
other.addInput("input1", "IMAGE");
other.onNodeCreated?.();
check("其它节点类型不受影响", names(other).join(",") === "input1");

const restored = backendNode(NodeType);
restored.onConfigure({ inputs: [
  { name: "图片1", type: "IMAGE", link: 11 },
  { name: "图片2", type: "IMAGE", link: null },
  { name: "图片3", type: "IMAGE", link: 12 },
] });
check("恢复工作流时先按保存的口数落位", restored.inputs.length >= 3);
restored.inputs[0].link = 11;
restored.inputs[2].link = 12;
restored.onAfterGraphConfigured();
check("恢复后收敛到最后一个连线口的下一个", names(restored).join(",") === "图片1,图片2,图片3,图片4");
check("恢复后连线全部保留", linkCount(restored) === 2);
