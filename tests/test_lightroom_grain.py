"""Behavior checks for the `WyslLightroomGrain` node (Lightroom Effects -> Grain)."""

from __future__ import annotations

import importlib
import sys
import unittest
from pathlib import Path

import torch


PACKAGE_PARENT = Path(__file__).resolve().parents[2]


def load_lightroom_module():
    """Load `Wysl_ComfyUI_Tools.node_modules.lightroom` without ComfyUI install."""
    if str(PACKAGE_PARENT) not in sys.path:
        sys.path.insert(0, str(PACKAGE_PARENT))
    package = importlib.import_module("Wysl_ComfyUI_Tools")
    return package.node_modules.lightroom


class LightroomGrainTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lr = load_lightroom_module()

    # --- algorithm: _apply_grain ---

    def test_amount_zero_is_a_noop(self):
        rgb = torch.rand(2, 3, 16, 16, dtype=torch.float32)
        out = self.lr._apply_grain(rgb, amount=0.0, size=25.0, roughness=100.0)
        self.assertTrue(torch.equal(out, rgb))

    def test_amount_positive_creates_visible_difference(self):
        rgb = torch.full((1, 3, 32, 32), 0.5, dtype=torch.float32)
        out = self.lr._apply_grain(rgb, amount=50.0, size=25.0, roughness=100.0)
        diff = (out - rgb).abs().mean().item()
        self.assertGreater(diff, 0.001, msg=f"颗粒过弱 mean abs diff={diff:.6f}")

    def test_output_shape_matches_input(self):
        rgb = torch.rand(1, 3, 24, 24, dtype=torch.float32)
        out = self.lr._apply_grain(rgb, amount=80.0, size=50.0, roughness=50.0)
        self.assertEqual(out.shape, rgb.shape)

    def test_values_stay_in_unit_range(self):
        # 即使 amount=100, size=100, roughness=0 输出也应被 clamp
        rgb = torch.full((1, 3, 32, 32), 0.5, dtype=torch.float32)
        out = self.lr._apply_grain(rgb, amount=100.0, size=100.0, roughness=0.0)
        self.assertTrue((out >= 0.0).all(), msg="输出有 <0 的像素")
        self.assertTrue((out <= 1.0).all(), msg="输出有 >1 的像素")

    def test_larger_size_reduces_high_frequency_noise(self):
        # size=0 锐利，size=100 应该是大斑块 → 与原图差异的方差更小
        rgb = torch.full((2, 3, 48, 48), 0.5, dtype=torch.float32)
        sharp = self.lr._apply_grain(rgb, amount=80.0, size=0.0, roughness=100.0)
        coarse = self.lr._apply_grain(rgb, amount=80.0, size=100.0, roughness=0.0)
        # sharp 的局部方差应明显大于 coarse
        self.assertGreater(sharp.var().item(), coarse.var().item())

    def test_kernel_size_helper_is_always_odd_and_at_least_one(self):
        for v in (0.0, 25.0, 50.0, 75.0, 100.0):
            k = self.lr._grain_kernel_size(v)
            self.assertGreaterEqual(k, 1)
            self.assertEqual(k % 2, 1, msg=f"value={v} -> kernel {k} not odd")

    # --- node class metadata ---

    def test_node_class_metadata(self):
        cls = self.lr.WyslLightroomGrain
        self.assertEqual(cls.CATEGORY, "Wysl/Lightroom 调色")
        self.assertEqual(cls.RETURN_TYPES, ("IMAGE",))
        self.assertEqual(cls.RETURN_NAMES, ("图像",))
        self.assertEqual(cls.FUNCTION, "apply_grain")
        inputs = cls.INPUT_TYPES()["required"]
        self.assertEqual(inputs["image"][0], "IMAGE")
        for name, default in (("amount", 20.0), ("size", 0.0), ("roughness", 0.0)):
            self.assertEqual(inputs[name][1]["default"], default,
                             msg=f"{name} default != Lightroom")
            self.assertEqual(inputs[name][1]["min"], 0.0)
            self.assertEqual(inputs[name][1]["max"], 100.0)

    def test_node_apply_grain_returns_tuple_of_image(self):
        cls = self.lr.WyslLightroomGrain
        # ComfyUI IMAGE: [B, H, W, C]，默认三通道
        image = torch.full((1, 8, 8, 3), 0.5, dtype=torch.float32)
        out = cls.apply_grain(image, amount=50.0, size=25.0, roughness=100.0)
        self.assertIsInstance(out, tuple)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].shape, image.shape)

    def test_node_preserves_alpha_channel(self):
        cls = self.lr.WyslLightroomGrain
        image = torch.full((1, 8, 8, 4), 0.5, dtype=torch.float32)
        image[..., 3] = 0.7  # alpha 通道
        out = cls.apply_grain(image, amount=80.0, size=50.0, roughness=50.0)[0]
        self.assertEqual(out.shape[-1], 4)
        # alpha 通道应保持不变（_apply_grain 只对 RGB 加噪）
        self.assertTrue(torch.allclose(out[..., 3], image[..., 3]))

    def test_node_rejects_wrong_input_shape(self):
        cls = self.lr.WyslLightroomGrain
        with self.assertRaises(TypeError):
            cls.apply_grain(torch.rand(3, 16, 16), 50.0, 25.0, 100.0)
        with self.assertRaises(ValueError):
            cls.apply_grain(torch.rand(1, 16, 16, 2), 50.0, 25.0, 100.0)


if __name__ == "__main__":
    unittest.main()
