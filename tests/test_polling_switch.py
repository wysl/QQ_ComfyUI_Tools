"""Behaviour checks for the polling switch node (优先取第一个有内容的输入)."""

from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "node_modules" / "utilities.py"


def load_module():
    # utilities.py 依赖 ComfyUI 的 nodes 模块，这里给一个最小替身
    if "nodes" not in sys.modules:
        stub = types.ModuleType("nodes")
        stub.MAX_RESOLUTION = 16384
        stub.NODE_CLASS_MAPPINGS = {}
        sys.modules["nodes"] = stub
    spec = importlib.util.spec_from_file_location("wysl_utilities_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FakeTensor:
    """只带 shape 的假张量，避免依赖 torch。"""

    def __init__(self, shape):
        self.shape = tuple(shape)


class PollingSwitchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()
        cls.node = cls.module.QQPollingSwitch

    # ---------- _is_blank ----------

    def test_none_is_blank(self):
        self.assertTrue(self.module._is_blank(None))

    def test_empty_containers_are_blank(self):
        self.assertTrue(self.module._is_blank([]))
        self.assertTrue(self.module._is_blank(()))
        self.assertTrue(self.module._is_blank({}))

    def test_zero_batch_tensor_is_blank(self):
        self.assertTrue(self.module._is_blank(FakeTensor((0, 64, 64, 3))))

    def test_tensor_with_content_is_not_blank(self):
        self.assertFalse(self.module._is_blank(FakeTensor((1, 64, 64, 3))))

    def test_plain_values_are_not_blank(self):
        # 空字符串与 0 视为有内容，避免误伤合法取值
        self.assertFalse(self.module._is_blank(0))
        self.assertFalse(self.module._is_blank(""))
        self.assertFalse(self.module._is_blank("x"))

    # ---------- pick_first ----------

    def test_picks_first_non_blank(self):
        self.assertEqual(self.node.pick_first(input1=None, input2="B", input3="C"), ("B",))

    def test_first_wins_when_several_present(self):
        self.assertEqual(self.node.pick_first(input1="A", input2="B"), ("A",))

    def test_all_blank_returns_none(self):
        got = self.node.pick_first(input1=None, input2=[], input3=FakeTensor((0, 4)))
        self.assertEqual(got, (None,))

    def test_no_inputs_at_all(self):
        self.assertEqual(self.node.pick_first(), (None,))

    def test_skips_empty_container_to_next(self):
        self.assertEqual(self.node.pick_first(input1=[], input2=[1, 2]), ([1, 2],))

    def test_only_first_connected_is_used(self):
        self.assertEqual(self.node.pick_first(input2="B"), ("B",))

    def test_image_like_batch_prefers_first(self):
        empty = FakeTensor((0, 64, 64, 3))
        original = FakeTensor((1, 64, 64, 3))
        fine = FakeTensor((1, 64, 64, 3))
        # 微调为空 → 用原版
        self.assertIs(self.node.pick_first(input1=empty, input2=original)[0], original)
        # 微调有内容 → 用微调
        self.assertIs(self.node.pick_first(input1=fine, input2=original)[0], fine)

    # ---------- 节点契约 ----------

    def test_declares_optional_inputs(self):
        inputs = self.node.INPUT_TYPES()
        self.assertIn("optional", inputs)
        self.assertEqual(len(inputs["optional"]), self.module.MAX_POLL_INPUTS)
        self.assertIn("input1", inputs["optional"])
        self.assertIn(f"input{self.module.MAX_POLL_INPUTS}", inputs["optional"])

    def test_single_image_output(self):
        self.assertEqual(len(self.node.RETURN_TYPES), 1)
        # 必须是具体类型：通配 "*" 会让被绕过节点的解析走到不安全的短路分支
        self.assertEqual(self.node.RETURN_TYPES, ("IMAGE",))
        self.assertEqual(self.node.RETURN_NAMES, ("图像",))

    def test_inputs_are_typed_image(self):
        inputs = self.node.INPUT_TYPES()["optional"]
        for name, spec in inputs.items():
            self.assertEqual(spec[0], "IMAGE", msg=f"{name} 应为 IMAGE")

    def test_registered_in_both_mappings(self):
        self.assertIn("QQPollingSwitch", self.module.NODE_CLASS_MAPPINGS)
        self.assertEqual(
            self.module.NODE_DISPLAY_NAME_MAPPINGS["QQPollingSwitch"],
            "QQ-图像轮询切换",
        )


JS_PATH = Path(__file__).resolve().parents[1] / "web" / "polling_switch.js"


class PollingSwitchFrontendTests(unittest.TestCase):
    """前端只负责「显示几个输入口」：初始 2 个，接一个加一个。"""

    @classmethod
    def setUpClass(cls):
        cls.source = JS_PATH.read_text(encoding="utf-8")

    def test_min_and_max(self):
        self.assertIn("const MIN_INPUTS = 2;", self.source)
        self.assertIn("const MAX_INPUTS = 8;", self.source)

    def test_targets_the_right_node(self):
        self.assertIn('const NODE_TYPE = "QQPollingSwitch";', self.source)

    def test_has_dynamic_helpers(self):
        for name in ("function inputName", "function targetCount",
                     "function ensureInputs", "function normalizeInputs",
                     "function initializeSwitch"):
            self.assertIn(name, self.source)

    def test_input_names_match_backend(self):
        # 与后端 f"input{index + 1}" 一致
        self.assertIn("return `input${slot + 1}`;", self.source)
        # 前端补的口也必须是 IMAGE，保持与后端一致
        self.assertIn('node.addInput(inputName(node.inputs?.length || 0), "IMAGE");', self.source)

    def test_hooks_connection_and_configure(self):
        self.assertIn("prototype.onConnectionsChange", self.source)
        self.assertIn("prototype.onConfigure", self.source)
        self.assertIn("prototype.onAfterGraphConfigured", self.source)
        self.assertIn("prototype.onNodeCreated", self.source)

    def test_never_removes_connected_inputs(self):
        # 回收前必须检查 link，避免删掉已连线的口
        self.assertIn("if (last?.link != null) break;", self.source)

    def test_skips_while_graph_is_configuring(self):
        self.assertIn("app?.configuringGraph", self.source)


if __name__ == "__main__":
    unittest.main()
