"""Matching checks for node and group ignore rules."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "node_modules" / "ignore_rules.py"


def load_module():
    spec = importlib.util.spec_from_file_location("wysl_ignore_rules_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class IgnoreRuleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def test_rules_split_on_commas(self):
        self.assertEqual(self.module.split_rules("^Get_图片, 提示词"), ["^Get_图片", "提示词"])

    def test_regex_matches_node_title(self):
        self.assertTrue(self.module.rule_matches("^Get_图片", "Get_图片 8"))
        self.assertFalse(self.module.rule_matches("^Get_图片", "Get_CLIP"))

    def test_regex_matches_group_title(self):
        self.assertTrue(self.module.rule_matches("^预处理", "预处理组"))
        self.assertFalse(self.module.rule_matches("^预处理", "后处理组"))

    def test_plain_text_matches_by_contains(self):
        self.assertTrue(self.module.rule_matches("图像", "图像放大"))

    def test_inputs_have_node_and_group_boxes(self):
        inputs = self.module.WyslIgnoreRules.INPUT_TYPES()["required"]
        self.assertIn("节点", inputs)
        self.assertIn("组", inputs)
        self.assertEqual(inputs["节点"][1]["default"], "")
        self.assertEqual(inputs["组"][1]["default"], "")
        self.assertFalse(inputs["启用"][1]["default"])
        self.assertNotIn("multiline", inputs["节点"][1])
        self.assertNotIn("multiline", inputs["组"][1])


if __name__ == "__main__":
    unittest.main()
