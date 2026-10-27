"""Contract checks for the condition dispatch node (一个输入，按条件送一个输出)."""

from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "node_modules" / "route_dispatch.py"
JS_PATH = Path(__file__).resolve().parents[1] / "web" / "route_dispatch.js"


class FakeBlocker:
    def __init__(self, message=None):
        self.message = message

    def __repr__(self):
        return "ExecutionBlocker(%r)" % (self.message,)


def install_execution_stub():
    """提供 comfy_execution.graph.ExecutionBlocker 的最小替身。"""
    if "comfy_execution" in sys.modules:
        return
    graph_module = types.ModuleType("comfy_execution.graph")
    graph_module.ExecutionBlocker = FakeBlocker
    package = types.ModuleType("comfy_execution")
    package.graph = graph_module
    package.__path__ = []
    sys.modules["comfy_execution"] = package
    sys.modules["comfy_execution.graph"] = graph_module


def load_module():
    install_execution_stub()
    spec = importlib.util.spec_from_file_location("wysl_route_dispatch_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def workflow_with_labels(node_id=5, labels=()):
    """构造 extra_pnginfo：输出口按顺序带 label，模拟用户改过名字的工作流。"""
    outputs = []
    for index, name in enumerate(labels):
        entry = {"name": name, "type": "*", "links": []}
        if name:
            entry["label"] = name
            entry["localized_name"] = name
        outputs.append(entry)
    return {"workflow": {"nodes": [{"id": node_id, "type": "QQRouteDispatch", "outputs": outputs}]}}


class RouteDispatchContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()
        cls.node = cls.module.QQRouteDispatch

    # ---------- 节点契约 ----------

    def test_one_input_many_outputs(self):
        inputs = self.node.INPUT_TYPES()
        self.assertEqual(list(inputs["optional"]), ["value"])
        self.assertEqual(inputs["optional"]["value"][0], "*")
        self.assertTrue(inputs["optional"]["value"][1].get("forceInput"))
        self.assertEqual(len(self.node.RETURN_TYPES), self.module.MAX_OUTPUTS)
        self.assertTrue(all(item == "*" for item in self.node.RETURN_TYPES))
        self.assertEqual(self.node.RETURN_NAMES[0], "输出1")
        self.assertEqual(len(self.node.OUTPUT_IS_LIST), self.module.MAX_OUTPUTS)
        self.assertFalse(any(self.node.OUTPUT_IS_LIST))

    def test_select_defaults_to_first_output(self):
        select = self.node.INPUT_TYPES()["required"]["select"]
        self.assertEqual(select[0], ["输出1"])
        self.assertEqual(select[1]["default"], "输出1")

    def test_validate_inputs_accepts_any_renamed_port(self):
        self.assertIs(self.node.VALIDATE_INPUTS("我的优化器A"), True)
        self.assertIs(self.node.VALIDATE_INPUTS("3"), True)

    def test_polling_switch_defaults_off(self):
        spec = self.node.INPUT_TYPES()["required"]["轮询输出"]
        self.assertEqual(spec[0], "BOOLEAN")
        self.assertIs(spec[1]["default"], False)

    def test_polling_does_not_change_dispatch_contract(self):
        # 轮询由前端每次排队前改写 select 驱动，后端仍只有一个口带值
        outputs = self.node.dispatch("输出2", value="t", 轮询输出=True)
        self.assertEqual(outputs[1], "t")
        self.assertEqual(sum(1 for item in outputs if item is not outputs[1] and not isinstance(item, FakeBlocker)), 0)

    def test_registered(self):
        self.assertIn("QQRouteDispatch", self.module.NODE_CLASS_MAPPINGS)
        self.assertEqual(self.module.NODE_DISPLAY_NAME_MAPPINGS["QQRouteDispatch"], "QQ-条件分发")

    # ---------- 分发行为 ----------

    def test_only_the_chosen_port_carries_the_value(self):
        outputs = self.node.dispatch("输出2", value="hello")
        self.assertEqual(len(outputs), self.module.MAX_OUTPUTS)
        self.assertEqual(outputs[1], "hello")
        for index, item in enumerate(outputs):
            if index != 1:
                self.assertIsInstance(item, FakeBlocker, msg=f"输出{index + 1} 应被阻塞")

    def test_blockers_are_silent(self):
        outputs = self.node.dispatch("输出1", value="x")
        silent = [item for item in outputs[1:] if isinstance(item, FakeBlocker)]
        self.assertTrue(silent)
        self.assertTrue(all(item.message is None for item in silent))

    def test_renamed_label_wins(self):
        workflow = workflow_with_labels(labels=["提示词优化A", "提示词优化B", "提示词优化C"])
        outputs = self.node.dispatch("提示词优化B", value="text", unique_id=5, extra_pnginfo=workflow)
        self.assertEqual(outputs[1], "text")

    def test_bare_number_selects_the_same_port(self):
        outputs = self.node.dispatch("3", value="text")
        self.assertEqual(outputs[2], "text")

    def test_output_prefix_number_selects_the_same_port(self):
        self.assertEqual(self.module.resolve_output_index("输出3"), 2)
        self.assertEqual(self.module.resolve_output_index("output3"), 2)

    def test_unknown_choice_falls_back_to_first_port(self):
        outputs = self.node.dispatch("已经不存在的老名字", value="text")
        self.assertEqual(outputs[0], "text")

    def test_image_value_passes_through_untouched(self):
        image = object()
        outputs = self.node.dispatch("输出1", value=image)
        self.assertIs(outputs[0], image)

    def test_unconnected_input_blocks_every_port(self):
        outputs = self.node.dispatch("输出1")
        self.assertEqual(len(outputs), self.module.MAX_OUTPUTS)
        self.assertTrue(all(isinstance(item, FakeBlocker) for item in outputs))

    def test_explicit_none_value_still_routes(self):
        # 接了线但值是 None 属于合法取值，不该被当成「没接线」
        outputs = self.node.dispatch("输出2", value=None)
        self.assertIsNone(outputs[1])
        self.assertIsInstance(outputs[0], FakeBlocker)

    def test_resolver_tolerates_missing_workflow_info(self):
        self.assertEqual(self.module.resolve_output_index("输出1", None, None), 0)
        self.assertEqual(self.module.resolve_output_index("输出4", 1, {}), 3)
        self.assertEqual(self.module.resolve_output_index("输出9"), 0)


class RouteDispatchFrontendTests(unittest.TestCase):
    """前端负责输出口数量与选择框名称，这里只做静态契约检查。"""

    @classmethod
    def setUpClass(cls):
        cls.source = JS_PATH.read_text(encoding="utf-8")

    def test_targets_the_right_node(self):
        self.assertIn('const NODE_TYPE = "QQRouteDispatch";', self.source)
        self.assertIn('const SELECT_WIDGET = "select";', self.source)

    def test_min_and_max_outputs(self):
        self.assertIn("const MIN_OUTPUTS = 2;", self.source)
        self.assertIn("const MAX_OUTPUTS = 8;", self.source)

    def test_names_come_from_output_labels(self):
        self.assertIn("output.label", self.source)
        self.assertIn("function outputNames(node)", self.source)
        self.assertIn("widget.options.values = names", self.source)

    def test_never_overwrites_an_existing_label(self):
        # 只在 addOutput 之后写一次 label，之后同步不再赋值
        self.assertEqual(self.source.count("output.label = name;"), 1)
        self.assertIn("if (label) return label;", self.source)

    def test_never_removes_connected_outputs(self):
        self.assertIn("if (connected(last)) break;", self.source)

    def test_hooks_lifecycle(self):
        for hook in (
            "prototype.onNodeCreated",
            "prototype.onAdded",
            "prototype.onConfigure",
            "prototype.onAfterGraphConfigured",
            "prototype.onConnectionsChange",
            "prototype.onRemoved",
        ):
            self.assertIn(hook, self.source)

    def test_skips_while_graph_is_configuring(self):
        self.assertIn("app?.configuringGraph", self.source)

    def test_keeps_selection_when_a_port_is_renamed(self):
        self.assertIn("function remapValue", self.source)
        self.assertIn("previousNames.indexOf(value)", self.source)

    def test_polling_switch_disables_the_combo(self):
        self.assertIn('const POLLING_WIDGET = "轮询输出";', self.source)
        self.assertIn("function applyPollingState(node)", self.source)
        self.assertIn("widget.disabled = polling", self.source)

    def test_polling_rotates_over_connected_ports_only(self):
        self.assertIn("function connectedIndexes(node)", self.source)
        self.assertIn("function resolveTargetIndex(node)", self.source)
        self.assertIn("function pollingFinished(node)", self.source)
        self.assertIn("function setPollingIndex(node, index)", self.source)

    def test_polling_queues_next_run_after_success(self):
        self.assertIn('api.addEventListener("execution_success"', self.source)
        self.assertIn("app.queuePrompt(0, 1)", self.source)
        # 中止条件要覆盖报错与取消
        self.assertIn('"execution_interrupted", "execution_error"', self.source)


if __name__ == "__main__":
    unittest.main()
