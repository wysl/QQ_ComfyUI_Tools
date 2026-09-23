"""Matching checks for separate node and widget ignore rules."""

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

    def test_single_line_rules_are_split_by_commas(self):
        self.assertEqual(self.module.split_rules("^图像, ^分辨率"), ["^图像", "^分辨率"])

    def test_regex_matches_node_prefix(self):
        self.assertTrue(self.module.rule_matches("^图像", "图像加载"))
        self.assertFalse(self.module.rule_matches("^图像", "参考图像"))

    def test_two_boxes_add_their_matches(self):
        module = self.module
        node_rules = module.split_rules("^图像")
        widget_rules = module.split_rules("^分辨率")
        self.assertTrue(module.any_rule_matches(node_rules, ["图像加载"]))
        self.assertTrue(module.any_rule_matches(widget_rules, ["分辨率选择器"]))
        self.assertFalse(module.any_rule_matches(node_rules, ["分辨率选择器"]))

    def test_node_inputs_are_single_line_and_have_no_output(self):
        node = self.module.WyslIgnoreRules
        inputs = node.INPUT_TYPES()["required"]
        self.assertEqual(node.RETURN_TYPES, ())
        self.assertNotIn("multiline", inputs["节点"][1])
        self.assertNotIn("multiline", inputs["选框"][1])
        self.assertEqual(inputs["节点"][1]["default"], "^图像")


if __name__ == "__main__":
    unittest.main()
