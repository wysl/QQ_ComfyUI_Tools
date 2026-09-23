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

    def test_regex_matches_get_node_title(self):
        self.assertTrue(self.module.rule_matches("^Get_图片", "Get_图片 8"))
        self.assertFalse(self.module.rule_matches("^Get_图片", "Get_CLIP"))

    def test_node_can_be_created_with_a_status_output(self):
        node = self.module.WyslIgnoreRules
        self.assertEqual(node.RETURN_TYPES, ("STRING",))
        self.assertTrue(node.OUTPUT_NODE)
        inputs = node.INPUT_TYPES()["required"]
        self.assertNotIn("multiline", inputs["节点"][1])
        self.assertNotIn("multiline", inputs["选框"][1])


if __name__ == "__main__":
    unittest.main()
