"""QQ-提示词模板/变量 后端契约测试。"""
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "node_modules" / "prompt_template.py"
_spec = importlib.util.spec_from_file_location("qq_prompt_template_test", MODULE_PATH)
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)


class ResolveTests(unittest.TestCase):
    def test_basic_substitution(self):
        text, unresolved = mod.resolve_template("{角色} 在 {场景}", {"角色": "猫", "场景": "屋顶"})
        self.assertEqual(text, "猫 在 屋顶")
        self.assertEqual(unresolved, [])

    def test_default_fallback(self):
        text, unresolved = mod.resolve_template("{x:备用}", {})
        self.assertEqual(text, "备用")
        self.assertEqual(unresolved, [])

    def test_missing_token_kept_and_reported(self):
        text, unresolved = mod.resolve_template("{a} {b} {b}", {"a": "1"})
        self.assertEqual(text, "1 {b} {b}")
        self.assertEqual(unresolved, ["b"])

    def test_brace_escape(self):
        text, _ = mod.resolve_template("{{literal}} {a}", {"a": "X"})
        self.assertEqual(text, "{literal} X")

    def test_unclosed_brace_preserved(self):
        text, _ = mod.resolve_template("ok {abc", {})
        self.assertEqual(text, "ok {abc")

    def test_unicode_value(self):
        text, _ = mod.resolve_template("{角色}", {"角色": "🐱猫"})
        self.assertEqual(text, "🐱猫")

    def test_empty_template(self):
        self.assertEqual(mod.resolve_template("", {}), ("", []))


class ParseTests(unittest.TestCase):
    def test_valid_json(self):
        self.assertEqual(mod.parse_variables('{"a":"1"}'), {"a": "1"})

    def test_broken_json_falls_back(self):
        self.assertEqual(mod.parse_variables("{bad"), {})

    def test_empty(self):
        self.assertEqual(mod.parse_variables(""), {})

    def test_non_dict(self):
        self.assertEqual(mod.parse_variables("[1,2]"), {})

    def test_dict_passthrough(self):
        self.assertEqual(mod.parse_variables({"a": 1}), {"a": "1"})


class NodeTests(unittest.TestCase):
    def test_render_with_vars_and_inline(self):
        out = mod.QQPromptTemplate.render("{角色}::{文本1}", 变量='{"角色":"猫"}', 文本1="尾巴")
        self.assertEqual(out, ("猫::尾巴",))

    def test_render_broken_vars_no_raise(self):
        out = mod.QQPromptTemplate.render("{a:默认}", 变量="{bad")
        self.assertEqual(out, ("默认",))

    def test_variables_emit_passthrough(self):
        self.assertEqual(mod.QQPromptVariables.emit('{"a":"1"}'), ('{"a":"1"}',))

    def test_registration(self):
        self.assertIn("QQPromptTemplate", mod.NODE_CLASS_MAPPINGS)
        self.assertIn("QQPromptVariables", mod.NODE_CLASS_MAPPINGS)
        self.assertEqual(mod.NODE_DISPLAY_NAME_MAPPINGS["QQPromptVariables"], "QQ-提示词变量")
        self.assertEqual(mod.NODE_DISPLAY_NAME_MAPPINGS["QQPromptTemplate"], "QQ-提示词模板")


if __name__ == "__main__":
    unittest.main()
