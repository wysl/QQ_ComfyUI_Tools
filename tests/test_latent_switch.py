"""Contract checks for the name-based latent switch."""

from __future__ import annotations

import ast
import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "node_modules" / "latent_switch.py"
JS_PATH = Path(__file__).resolve().parents[1] / "web" / "latent_switch.js"


def load_module():
    spec = importlib.util.spec_from_file_location("wysl_latent_switch_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class LatentSwitchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def test_combo_default_is_the_first_input_name(self):
        select = self.module.QQLatentSwitch.INPUT_TYPES()["required"]["select"]
        self.assertEqual(select[0], ["latent1"])
        self.assertEqual(select[1]["default"], "latent1")

    def test_selection_uses_input_name(self):
        first = {"samples": "one"}
        second = {"samples": "two"}
        node = self.module.QQLatentSwitch
        self.assertIs(node.select_latent("latent2", latent1=first, latent2=second)[0], second)

    def test_renamed_label_resolves_back_to_the_input_slot(self):
        first = {"samples": "one"}
        second = {"samples": "two"}
        workflow = {
            "workflow": {
                "nodes": [
                    {
                        "id": 7,
                        "inputs": [
                            {"name": "select"},
                            {"name": "latent1", "label": "原图潜空间"},
                            {"name": "latent2", "label": "放大潜空间"},
                        ],
                    }
                ]
            }
        }
        selected = self.module.QQLatentSwitch.select_latent(
            "放大潜空间",
            unique_id=7,
            extra_pnginfo=workflow,
            latent1=first,
            latent2=second,
        )[0]
        self.assertIs(selected, second)

    def test_numeric_select_from_multiprimitive_uses_connected_order(self):
        first = {"samples": "one"}
        second = {"samples": "two"}
        selected = self.module.QQLatentSwitch.select_latent("2", latent1=first, latent2=second)[0]
        self.assertIs(selected, second)

    def test_frontend_builds_combo_from_input_labels(self):
        source = JS_PATH.read_text(encoding="utf-8")
        self.assertIn("function displayName(input)", source)
        self.assertIn("input.label || input.name", source)
        self.assertIn("widget.options.values = choices", source)
        ast.parse(MODULE_PATH.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
