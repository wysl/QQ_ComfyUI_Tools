"""QQ-图像对比：后端存图上报 + 前端 DOM 控件（兼容 Nodes 1.0 / 2.0）。"""

from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parents[1] / "node_modules" / "image_comparer.py"
WEB_PATH = Path(__file__).resolve().parents[1] / "web" / "image_comparer.js"


def _ensure_preview_image():
    # 只用桩，绝不 import 真实 nodes（真实 nodes 会带入整套 comfy 运行时副作用，
    # 污染后续测试对 QQ_ComfyUI_Tools 包的导入）。
    nodes = sys.modules.get("nodes")
    if nodes is None:
        nodes = types.ModuleType("nodes")
        sys.modules["nodes"] = nodes
    if not hasattr(nodes, "PreviewImage"):
        class PreviewImage:
            RETURN_TYPES = ("IMAGE",)
            OUTPUT_NODE = True

            def save_images(self, images, filename_prefix="ComfyUI", prompt=None, extra_pnginfo=None):
                return {"ui": {"images": []}}

        nodes.PreviewImage = PreviewImage
        nodes.SaveImage = PreviewImage
    return nodes


def _load():
    _ensure_preview_image()
    spec = importlib.util.spec_from_file_location("qq_image_comparer_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = _load()

    def _node(self, saved):
        node = self.mod.QQImageComparer()
        node.save_images = lambda images, *a, **k: {
            "ui": {"images": [{"filename": f"f{i}.png"} for i in range(len(images))]}
        }
        return node

    def test_saves_both_sides_and_passes_a_through(self):
        node = self._node(None)
        result = node.compare_images(image_a=[1, 2], image_b=[3])
        self.assertEqual(len(result["ui"]["a_images"]), 2)
        self.assertEqual(len(result["ui"]["b_images"]), 1)
        self.assertEqual(result["result"], ([1, 2],))

    def test_result_falls_back_to_b_without_a(self):
        node = self._node(None)
        result = node.compare_images(image_a=None, image_b=[9])
        self.assertEqual(result["ui"]["a_images"], [])
        self.assertEqual(len(result["ui"]["b_images"]), 1)
        self.assertEqual(result["result"], ([9],))

    def test_no_inputs_reports_empty(self):
        node = self._node(None)
        result = node.compare_images()
        self.assertEqual(result["ui"], {"a_images": [], "b_images": []})
        self.assertEqual(result["result"], (None,))

    def test_empty_batch_is_not_saved(self):
        node = self._node(None)
        result = node.compare_images(image_a=[], image_b=[1])
        self.assertEqual(result["ui"]["a_images"], [])
        self.assertEqual(len(result["ui"]["b_images"]), 1)

    def test_contract(self):
        node = self.mod.QQImageComparer
        self.assertEqual(node.RETURN_TYPES, ("IMAGE",))
        self.assertEqual(node.FUNCTION, "compare_images")
        self.assertEqual(node.CATEGORY, "QQ/工具")
        inputs = node.INPUT_TYPES()
        self.assertEqual(inputs["required"], {})
        self.assertIn("image_a", inputs["optional"])
        self.assertIn("image_b", inputs["optional"])
        self.assertEqual(inputs["optional"]["image_a"][0], "IMAGE")
        self.assertEqual(inputs["hidden"]["prompt"], "PROMPT")
        self.assertEqual(inputs["hidden"]["extra_pnginfo"], "EXTRA_PNGINFO")
        self.assertEqual(
            self.mod.NODE_DISPLAY_NAME_MAPPINGS["QQImageComparer"], "QQ-图像对比"
        )


class FrontendWiringTests(unittest.TestCase):
    """前端必须用 DOM 控件（画布控件在 Nodes 2.0 不显示）。"""

    @classmethod
    def setUpClass(cls):
        cls.source = WEB_PATH.read_text(encoding="utf-8")

    def test_uses_dom_widget_not_canvas_widget(self):
        self.assertIn("addDOMWidget", self.source)
        self.assertNotIn("addCustomWidget(", self.source)
        self.assertNotIn("draw(ctx", self.source)
        self.assertIn('const NODE_TYPE = "QQImageComparer";', self.source)

    def test_preview_logic_matches_original(self):
        # 滑动 / 点击两种模式 + 批量标签 + 默认选择
        self.assertIn("MODE_SLIDE", self.source)
        self.assertIn("MODE_CLICK", self.source)
        self.assertIn("export function buildComparerImages", self.source)
        self.assertIn("export function defaultSelection", self.source)
        self.assertIn("clipPath", self.source)
        self.assertIn("qq-compare-divider", self.source)
        self.assertIn("qq-compare-label", self.source)

    def test_persists_via_properties_and_restores_on_configure(self):
        self.assertIn("qq_compare_images", self.source)
        self.assertIn("comparer_mode", self.source)
        self.assertIn("node.onExecuted", self.source)
        self.assertIn("onConfigure", self.source)

    def test_registers_extension_for_the_node(self):
        self.assertIn('name: "QQ.ImageComparer"', self.source)
        self.assertIn("beforeRegisterNodeDef", self.source)


if __name__ == "__main__":
    unittest.main()
