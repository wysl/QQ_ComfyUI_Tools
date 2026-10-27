"""Contract checks for the lazy collector (越过阻塞信号，只执行选中那一路)."""

from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "node_modules" / "route_collect.py"
JS_PATH = Path(__file__).resolve().parents[1] / "web" / "route_collect.js"


class FakeBlocker:
    def __init__(self, message=None):
        self.message = message


def install_execution_stub():
    """提供 comfy_execution.graph.ExecutionBlocker 的最小替身。

    与 test_route_dispatch 共用同一个桩模块：谁先装谁生效，后装的一方复用，
    否则两个测试文件会各自拿到不同名的类，断言互相打架。
    """
    if "comfy_execution" in sys.modules:
        return
    graph_module = types.ModuleType("comfy_execution.graph")
    graph_module.ExecutionBlocker = FakeBlocker
    package = types.ModuleType("comfy_execution")
    package.graph = graph_module
    package.__path__ = []
    sys.modules["comfy_execution"] = package
    sys.modules["comfy_execution.graph"] = graph_module


def real_blocker_class():
    """拿到当前实际生效的 ExecutionBlocker 类，避免跨模块类对象不一致。"""
    return sys.modules["comfy_execution.graph"].ExecutionBlocker


def load_module():
    install_execution_stub()
    spec = importlib.util.spec_from_file_location("wysl_route_collect_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def workflow_with_labels(node_id=5, labels=()):
    inputs = []
    for name in labels:
        entry = {"name": name, "type": "*"}
        if name:
            entry["label"] = name
            entry["localized_name"] = name
        inputs.append(entry)
    return {"workflow": {"nodes": [{"id": node_id, "type": "QQRouteCollect", "inputs": inputs}]}}


class RouteCollectContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()
        cls.node = cls.module.QQRouteCollect

    # ---------- 契约 ----------

    def test_many_lazy_inputs_one_output(self):
        inputs = self.node.INPUT_TYPES()
        optional = inputs["optional"]
        self.assertEqual(len(optional), self.module.MAX_INPUTS)
        for name, spec in optional.items():
            self.assertEqual(spec[0], "*", msg=f"{name} 应为通配口")
            self.assertTrue(spec[1].get("lazy"), msg=f"{name} 必须是惰性输入")
        self.assertEqual(self.node.RETURN_TYPES, ("*",))
        self.assertEqual(self.node.RETURN_NAMES, ("value",))

    def test_select_defaults_to_first_input(self):
        spec = self.node.INPUT_TYPES()["required"]["select"]
        self.assertEqual(spec[0], ["输入1"])
        self.assertEqual(spec[1]["default"], "输入1")

    def test_validate_inputs_accepts_renamed_ports(self):
        self.assertIs(self.node.VALIDATE_INPUTS("我的增强器B"), True)

    def test_registered(self):
        self.assertIn("QQRouteCollect", self.module.NODE_CLASS_MAPPINGS)
        self.assertEqual(self.module.NODE_DISPLAY_NAME_MAPPINGS["QQRouteCollect"], "QQ-条件收集")

    # ---------- 惰性求值：核心行为 ----------

    def test_asks_only_for_the_selected_input(self):
        # 只请求一路 → 其余分支根本不会被求值 → 不会产生 blocker
        self.assertEqual(self.node.check_lazy_status("输入2"), ["value2"])
        self.assertEqual(self.node.check_lazy_status("输入1"), ["value1"])
        self.assertEqual(self.node.check_lazy_status("输入8"), ["value8"])

    def test_renamed_label_selects_the_right_slot(self):
        workflow = workflow_with_labels(labels=["增强器A", "增强器B", "增强器C"])
        self.assertEqual(
            self.node.check_lazy_status("增强器B", unique_id=5, extra_pnginfo=workflow),
            ["value2"],
        )

    def test_bare_number_selects_the_same_slot(self):
        self.assertEqual(self.node.check_lazy_status("3"), ["value3"])
        self.assertEqual(self.module.resolve_input_index("输入3"), 2)

    def test_unknown_choice_falls_back_to_first(self):
        self.assertEqual(self.module.resolve_input_index("不存在的老名字"), 0)
        self.assertEqual(self.module.resolve_input_index("", None, None), 0)

    # ---------- 取值 ----------

    def test_returns_the_selected_value(self):
        got = self.node.collect("输入2", value1="A", value2="B", value3="C")
        self.assertEqual(got, ("B",))

    def test_image_value_passes_through_untouched(self):
        image = object()
        self.assertIs(self.node.collect("输入1", value1=image)[0], image)

    def test_unselected_ports_do_not_matter(self):
        # 只有选中那一路的键存在（其它分支没被求值），也必须正常返回
        self.assertEqual(self.node.collect("输入3", value3="C"), ("C",))

    def test_selected_port_without_value_blocks(self):
        got = self.node.collect("输入4", value1="A")
        self.assertIsInstance(got[0], FakeBlocker)
        self.assertIsNone(got[0].message)

    def test_existing_blocker_on_selected_port_is_blocked(self):
        got = self.node.collect("输入1", value1=FakeBlocker())
        self.assertIsInstance(got[0], FakeBlocker)

    def test_empty_string_is_still_a_value(self):
        # 空串是合法内容，不能当成「没接」
        self.assertEqual(self.node.collect("输入1", value1=""), ("",))


class RouteCollectFrontendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = JS_PATH.read_text(encoding="utf-8")

    def test_targets_both_nodes(self):
        self.assertIn('const NODE_TYPE = "QQRouteCollect";', self.source)
        self.assertIn('const DISPATCH_TYPE = "QQRouteDispatch";', self.source)

    def test_marks_inputs_lazy_on_the_frontend(self):
        # 少了这句，ComfyUI 会把全部分支都求值，惰性等于没做
        self.assertIn("input.lazy = true;", self.source)

    def test_names_come_from_input_labels(self):
        self.assertIn("function inputLabel(input, index)", self.source)
        self.assertIn("input.label", self.source)
        self.assertIn("input.name", self.source)
        self.assertIn("widget.options.values = names", self.source)

    def test_never_removes_connected_inputs(self):
        self.assertIn("if (connected(last)) break;", self.source)

    def test_syncs_both_ways_with_the_dispatch_node(self):
        self.assertIn("function syncFromDispatch(node)", self.source)
        self.assertIn("function syncToDispatch(node)", self.source)
        self.assertIn("function linkedDispatch(node)", self.source)
        # 防回环
        self.assertIn("SYNC_GUARD", self.source)

    def test_skips_while_graph_is_configuring(self):
        self.assertIn("app?.configuringGraph", self.source)


if __name__ == "__main__":
    unittest.main()
