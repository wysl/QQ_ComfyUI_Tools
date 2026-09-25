import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "web", "ignore_rules_controller.js"), "utf8")
  .replace(/^import .*$/m, "");
const app = {
  registerExtension(extension) { this.extension = extension; },
  canvas: { graph: null },
};
new Function("app", source)(app);

const extension = app.extension;
const NodeType = function NodeType() {
  this.widgets = [];
  this.properties = {};
  this.size = [280, 110];
};
NodeType.prototype.addWidget = function addWidget(type, name, value, callback, options) {
  const widget = { type, name, value, callback, options };
  this.widgets.push(widget);
  return widget;
};
NodeType.prototype.setSize = function setSize(size) { this.size = size; };
NodeType.prototype.setDirtyCanvas = () => {};

await extension.beforeRegisterNodeDef(NodeType, { name: "QQIgnoreRulesController" });
const created = new NodeType();
created.onNodeCreated();

function check(name, condition) {
  if (!condition) throw new Error(`FAIL ${name}`);
  console.log(`ok   ${name}`);
}

check("new node creates exactly two complete rows", created.widgets.length === 4);
check("new node starts at expected compact height", created.size[1] === 110);

const restored = new NodeType();
restored.onNodeCreated();
const savedInfo = {
  properties: {
    qqIgnoreRuleRowCount: 4,
    qqIgnoreRuleRows: [
      { name: "A", enabled: true },
      { name: "B", enabled: false },
      { name: "C", enabled: true },
      { name: "D", enabled: false },
    ],
    qqIgnoreRuleBindings: ["11", "12", "13", "14"],
  },
  widgets_values: ["wrong-1", false, "wrong-2", false],
};
restored.properties = structuredClone(savedInfo.properties);
restored.onConfigure(savedInfo);
check("saved row count restores all four rows", restored.widgets.length === 8);
check("custom saved rows take precedence over legacy widget values", restored.widgets[0].value === "A");
check("second saved row remains in position", restored.widgets[2].value === "B");
check("third row does not shift into first slot", restored.widgets[4].value === "C");
check("fourth saved enabled state restores", restored.widgets[7].value === false);
check("node height is derived from exactly four rows", restored.size[1] === 178);

restored.onAfterGraphConfigured();
const rowNames = restored.widgets.filter((widget) => widget.name.startsWith("规则名称_"));
check("refresh keeps saved rows in order and adds one empty slot", rowNames.map((widget) => widget.value).join(",") === "A,B,C,D,");
check("refresh adds only the expected empty slot", restored.size[1] === 212);

const legacy = new NodeType();
legacy.onNodeCreated();
legacy.onConfigure({
  properties: { qqIgnoreRuleRowCount: 2 },
  widgets_values: ["legacy-1", true, "legacy-2", false],
});
check("legacy workflows migrate first row", legacy.widgets[0].value === "legacy-1");
check("legacy workflows migrate second row", legacy.widgets[2].value === "legacy-2");
check("legacy migration persists explicit row records", legacy.properties.qqIgnoreRuleRows.length === 2);
