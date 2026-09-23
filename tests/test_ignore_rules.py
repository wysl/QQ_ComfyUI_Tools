"""Matching checks for configurable ignore rules."""

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

    def test_plain_name_matches_contained_text(self):
        self.assertTrue(self.module.rule_matches("图像", "图像放大"))

    def test_regex_matches_prefix(self):
        self.assertTrue(self.module.rule_matches("^图像", "图像加载"))
        self.assertFalse(self.module.rule_matches("^图像", "参考图像"))

    def test_invalid_regex_does_not_match(self):
        self.assertFalse(self.module.rule_matches("[", "图像"))

    def test_node_defaults(self):
        inputs = self.module.WyslIgnoreRules.INPUT_TYPES()["required"]
        self.assertEqual(inputs["名称"][1]["default"], "忽略所有图像")
        self.assertFalse(inputs["启用"][1]["default"])
        self.assertEqual(inputs["规则"][1]["default"], "^图像")


if __name__ == "__main__":
    unittest.main()
