"""QQ-图像卷轴合成：合并卷轴+合成、列表口逐张成行、字体兜底、偶数尺寸。

用真实 torch / numpy / Pillow 跑图像数学；若其它测试模块把 torch 换成桩，这里恢复真实模块。
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import torch

if not hasattr(torch, "zeros"):  # test_registration 的桩可能泄漏，恢复真实 torch
    for _name in ("torch", "torch.nn", "torch.nn.functional"):
        sys.modules.pop(_name, None)
    import torch

from PIL import Image  # noqa: E402

MODULE_PATH = Path(__file__).resolve().parents[1] / "node_modules" / "image_reel.py"


def _load():
    spec = importlib.util.spec_from_file_location("qq_image_reel_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _solid(color, width=40, height=60, frames=1):
    arr = torch.zeros((frames, height, width, 3), dtype=torch.float32)
    arr[:, :, :, 0] = color[0] / 255
    arr[:, :, :, 1] = color[1] / 255
    arr[:, :, :, 2] = color[2] / 255
    return arr


class HelperTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = _load()

    def test_adjust_levels_matches_original_math(self):
        # 128 灰，midtones=0.5、output_white=54 → 54*(128/255)^2 ≈ 13.6 → 13
        image = Image.new("L", (4, 4), 128)
        out = self.mod._adjust_levels(image, 0, 255, 0.5, 0, output_white=54)
        self.assertEqual(out.getpixel((0, 0)), 13)

    def test_adjust_levels_degenerate_returns_gray(self):
        image = Image.new("L", (4, 4), 10)
        out = self.mod._adjust_levels(image, 5, 5, 1.0, 0, 255)
        self.assertEqual(out.getpixel((0, 0)), 128)

    def test_resize_to_height_keeps_aspect(self):
        image = Image.new("RGB", (200, 300))
        out = self.mod._resize_to_height(image, 150)
        self.assertEqual(out.size, (100, 150))

    def test_tensor_to_pil_batch_handles_3d_and_4d(self):
        batch = self.mod._tensor_to_pil_batch(_solid((10, 20, 30), frames=3), 30)
        self.assertEqual(len(batch), 3)
        self.assertEqual(batch[0].height, 30)
        single = self.mod._tensor_to_pil_batch(_solid((10, 20, 30))[0], 30)
        self.assertEqual(len(single), 1)
        self.assertEqual(self.mod._tensor_to_pil_batch(None, 30), [])

    def test_draw_reel_image_dimensions(self):
        imgs = [Image.new("RGB", (100, 150)), Image.new("RGB", (80, 150))]
        reel = self.mod._draw_reel_image(imgs, border=20, reel_height=150)
        # 宽 = (100+20)+(80+20) = 220；高 = 150+20 = 170
        self.assertEqual(reel.size, (220, 170))

    def test_load_font_falls_back_without_path(self):
        font = self.mod._load_font(None, 12)
        self.assertTrue(hasattr(font, "getbbox"))
        fallback = self.mod._load_font("/no/such/font.ttf", 12)
        self.assertTrue(hasattr(fallback, "getbbox"))

    def test_first_unwraps_list_inputs(self):
        self.assertEqual(self.mod._first([7], 0), 7)
        self.assertEqual(self.mod._first([], 9), 9)
        self.assertEqual(self.mod._first(None, 9), 9)
        self.assertEqual(self.mod._first(5, 0), 5)

    def test_nth_picks_positional_item_from_list(self):
        a, b = object(), object()
        self.assertIs(self.mod._nth([a, b], 0), a)
        self.assertIs(self.mod._nth([a, b], 1), b)
        # 单元素列表（普通图 / batch 接线）索引越界时退回第一个
        self.assertIs(self.mod._nth([a], 1), a)
        self.assertIs(self.mod._nth([], 0), None)
        self.assertIs(self.mod._nth(None, 0), None)
        self.assertIs(self.mod._nth(a, 0), a)

    def test_labels_apply_positionally_to_list_images(self):
        a, b, c, d, e = (object() for _ in range(5))
        labels = ["111", "222", "image3", "image4"]
        # 只接列表：第 1 张用 image1_text，第 2 张用 image2_text
        pairs = self.mod._labelled_images([None, None, None, None], [a, b], labels)
        self.assertEqual([lab for _, lab in pairs], ["111", "222"])
        # image1 + 列表混合：按顺序对应 text
        pairs2 = self.mod._labelled_images([a, None, None, None], [b, c], ["T1", "T2", "T3", "T4"])
        self.assertEqual([lab for _, lab in pairs2], ["T1", "T2", "T3"])
        # 超过 4 张自动编号
        pairs3 = self.mod._labelled_images([None] * 4, [a, b, c, d, e], ["1", "2", "3", "4"])
        self.assertEqual([lab for _, lab in pairs3], ["1", "2", "3", "4", "图 5"])
        # 空输入返回空
        self.assertEqual(self.mod._labelled_images([None] * 4, [], labels), [])


class CombineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = _load()

    def _combine(self, **kwargs):
        params = dict(
            image1=[_solid((220, 80, 80))],
            reel_height=[64], border=[8], font_size=[12],
            font_file=["default"], color_theme=["light"],
        )
        params.update(kwargs)
        with patch.object(self.mod, "_font_dict", return_value={"default": ""}):
            return self.mod.QQImageReelCombine().combine(**params)[0]

    def test_single_frame_even_dimensions(self):
        out = self._combine()
        self.assertEqual(out.shape[0], 1)
        self.assertEqual(out.shape[1] % 2, 0)
        self.assertEqual(out.shape[2] % 2, 0)
        self.assertEqual(out.shape[3], 3)

    def test_list_images_join_horizontal_row(self):
        one = self._combine()
        three = self._combine(image_list=[_solid((1, 2, 3)), _solid((4, 5, 6)), _solid((7, 8, 9))])
        # 列表图片横向并入同一条卷轴 → 更宽，但仍是单行（高度不变）
        self.assertGreater(three.shape[2], one.shape[2])
        self.assertEqual(three.shape[1], one.shape[1])
        self.assertEqual(three.shape[0], 1)

    def test_list_batch_is_flattened_into_row(self):
        # 一个列表项里含 2 帧 batch，也逐张展开横向并排
        out = self._combine(image_list=[_solid((1, 2, 3), frames=2)])
        single = self._combine(image_list=[_solid((1, 2, 3))])
        self.assertGreater(out.shape[2], single.shape[2])

    def test_image1_batch_produces_multiple_frames(self):
        out = self._combine(image1=[_solid((220, 80, 80), frames=2)])
        self.assertEqual(out.shape[0], 2)

    def test_same_list_to_image1_and_image2_unpacks_positionally(self):
        # multi output 是列表，分别接 image1/image2 应取第 1/第 2 张，而非都取第一张
        red = _solid((220, 0, 0))
        blue = _solid((0, 0, 220))
        out = self._combine(image1=[red, blue], image2=[red, blue])
        h, w = out.shape[1], out.shape[2]
        # 左半应是红图、右半应是蓝图（两张不同的图并排）
        self.assertGreater(float(out[0, h // 2, w // 4, 0]), 0.5)
        self.assertLess(float(out[0, h // 2, w // 4, 2]), 0.5)
        self.assertGreater(float(out[0, h // 2, 3 * w // 4, 2]), 0.5)
        self.assertLess(float(out[0, h // 2, 3 * w // 4, 0]), 0.5)

    def test_no_images_returns_empty_batch(self):
        with patch.object(self.mod, "_font_dict", return_value={"default": ""}):
            out = self.mod.QQImageReelCombine().combine(
                image1=None, reel_height=[64], border=[8], font_size=[12],
                font_file=["default"], color_theme=["light"],
            )[0]
        self.assertEqual(out.shape[0], 0)

    def test_list_only_without_image1(self):
        # 只接 image_list、不接 image1 也要能出图（image1 已改为可选）
        with patch.object(self.mod, "_font_dict", return_value={"default": ""}):
            out = self.mod.QQImageReelCombine().combine(
                image1=None,
                image_list=[_solid((1, 2, 3)), _solid((4, 5, 6))],
                reel_height=[64], border=[8], font_size=[12],
                font_file=["default"], color_theme=["light"],
            )[0]
        self.assertEqual(out.shape[0], 1)
        self.assertGreater(out.shape[1], 0)
        self.assertEqual(out.shape[1] % 2, 0)

    def test_theme_changes_background(self):
        light = self._combine(color_theme=["light"])
        dark = self._combine(color_theme=["dark"])
        # 左上角是背景色：浅色明显亮于深色
        self.assertGreater(float(light[0, 0, 0, 0]), float(dark[0, 0, 0, 0]))

    def test_font_size_zero_hides_text(self):
        # font_size=0 不显示文字，也不留字距 → 比有文字时更矮，且正常出图
        with_text = self._combine(font_size=[20])
        no_text = self._combine(font_size=[0])
        self.assertLess(no_text.shape[1], with_text.shape[1])
        self.assertEqual(no_text.shape[0], 1)
        self.assertEqual(no_text.shape[1] % 2, 0)
        self.assertEqual(no_text.shape[2] % 2, 0)

    def test_batch_frames_have_uniform_shape(self):
        # 多帧 batch 逐帧输出，每帧一条横向卷轴，宽高统一且为偶数
        out = self._combine(image1=[_solid((220, 80, 80), frames=3)])
        self.assertEqual(out.shape[0], 3)
        self.assertEqual(out.shape[1] % 2, 0)
        self.assertEqual(out.shape[2] % 2, 0)
        self.assertEqual(out.shape[3], 3)


class ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = _load()

    def test_list_input_and_output_contract(self):
        node = self.mod.QQImageReelCombine
        self.assertTrue(node.INPUT_IS_LIST)
        self.assertEqual(node.OUTPUT_IS_LIST, (False,))
        self.assertEqual(node.RETURN_TYPES, ("IMAGE",))
        self.assertEqual(node.FUNCTION, "combine")
        self.assertEqual(node.CATEGORY, "QQ/工具")

    def test_inputs_merge_reel_and_composit_plus_list(self):
        with patch.object(self.mod, "_font_dict", return_value={"default": ""}):
            inputs = self.mod.QQImageReelCombine.INPUT_TYPES()
        required = inputs["required"]
        for key in ("image1_text", "image2_text", "image3_text", "image4_text",
                    "reel_height", "border", "font_file", "font_size", "color_theme"):
            self.assertIn(key, required)
        # image1 可选：只接 image_list 也能跑
        self.assertNotIn("image1", required)
        optional = inputs["optional"]
        for key in ("image1", "image2", "image3", "image4", "image_list"):
            self.assertIn(key, optional)
        self.assertEqual(optional["image_list"][0], "IMAGE")
        self.assertEqual(required["color_theme"][0], ["light", "dark"])
        self.assertTrue(len(required["font_file"][0]) >= 1)
        self.assertEqual(required["reel_height"][1]["default"], 1024)
        self.assertEqual(required["border"][1]["default"], 24)
        self.assertEqual(required["font_size"][1]["default"], 42)
        self.assertEqual(required["font_size"][1]["min"], 0)

    def test_display_name(self):
        self.assertEqual(
            self.mod.NODE_DISPLAY_NAME_MAPPINGS["QQImageReelCombine"], "QQ-图像卷轴合成"
        )


if __name__ == "__main__":
    unittest.main()
