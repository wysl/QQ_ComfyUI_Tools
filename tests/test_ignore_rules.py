"""Matching checks for bypass rules, including ! exclusions."""

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

    def test_exclusion_prefix_is_detected(self):
        self.assertTrue(self.module.is_exclusion("!保留组"))
        self.assertFalse(self.module.is_exclusion("保留组"))
        self.assertEqual(self.module.strip_exclusion("!保留组"), "保留组")

    def test_include_exclude_are_separated(self):
        include, exclude = self.module.split_include_exclude("^Get_图片, !Get_图片 1, ^预处理")
        self.assertEqual(include, ["^Get_图片", "^预处理"])
        self.assertEqual(exclude, ["Get_图片 1"])

    def test_exclusion_suppresses_include_match(self):
        include, exclude = self.module.split_include_exclude("图像, !图像1")
        self.assertTrue(self.module.any_rule_matches(include, ["图像2"]))
        self.assertTrue(self.module.any_rule_matches(exclude, ["图像1"]))

    def test_inputs_have_node_and_group_boxes(self):
        inputs = self.module.QQIgnoreRules.INPUT_TYPES()["required"]
        self.assertIn("节点", inputs)
        self.assertIn("组", inputs)
        self.assertNotIn("multiline", inputs["节点"][1])
        self.assertNotIn("multiline", inputs["组"][1])

    def test_group_bypass_tag_has_bounded_depth(self):
        inputs = self.module.QQGroupBypassTag.INPUT_TYPES()["required"]
        self.assertEqual(inputs["忽略深度"][0], "INT")
        self.assertEqual(inputs["忽略深度"][1]["default"], 0)
        self.assertEqual(inputs["忽略深度"][1]["min"], 0)
        self.assertEqual(inputs["忽略深度"][1]["max"], 5)
        self.assertEqual(self.module.QQGroupBypassTag.describe("绕过", 8), ("[魔术贴] 绕过 深度=5",))
        self.assertEqual(self.module.QQGroupBypassTag.describe("启用", -2), ("[魔术贴] 启用 深度=0",))


if __name__ == "__main__":
    unittest.main()
