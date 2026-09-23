"""Matching checks for widget ignore rules."""

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
        self.assertEqual(self.module.split_rules("提示词, ^图像"), ["提示词", "^图像"])

    def test_regex_matches_widget_prefix(self):
        self.assertTrue(self.module.rule_matches("^图像", "图像1"))
        self.assertFalse(self.module.rule_matches("^图像", "参考图像"))

    def test_plain_text_matches_by_contains(self):
        self.assertTrue(self.module.rule_matches("提示词", "正向提示词"))

    def test_both_boxes_are_optional_and_separate(self):
        inputs = self.module.WyslIgnoreRules.INPUT_TYPES()["required"]
        self.assertEqual(inputs["节点"][1]["default"], "")
        self.assertEqual(inputs["选框"][1]["default"], "")
        self.assertFalse(inputs["启用"][1]["default"])
        self.assertNotIn("multiline", inputs["节点"][1])
        self.assertNotIn("multiline", inputs["选框"][1])


if __name__ == "__main__":
    unittest.main()
