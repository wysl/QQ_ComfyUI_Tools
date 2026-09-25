"""Behavior checks for the `QQLightroomGrain` node (Lightroom Effects -> Grain)."""

from __future__ import annotations

import importlib
import sys
import types
import unittest
from pathlib import Path

import torch


PACKAGE_PARENT = Path(__file__).resolve().parents[2]


def load_lightroom_module():
    """Load `QQ_ComfyUI_Tools.node_modules.lightroom` without ComfyUI install."""
    folder_paths = types.ModuleType("folder_paths")
    folder_paths.get_output_directory = lambda: ""
    sys.modules.setdefault("folder_paths", folder_paths)

    comfy_nodes = types.ModuleType("nodes")
    comfy_nodes.MAX_RESOLUTION = 16384
    comfy_nodes.NODE_CLASS_MAPPINGS = {}
    sys.modules.setdefault("nodes", comfy_nodes)

    comfy = types.ModuleType("comfy")
    comfy.__path__ = []
    sys.modules.setdefault("comfy", comfy)
    cli_args = types.ModuleType("comfy.cli_args")
    cli_args.args = types.SimpleNamespace(disable_metadata=False)
    sys.modules.setdefault("comfy.cli_args", cli_args)

    comfy_api = types.ModuleType("comfy_api")
    comfy_api.__path__ = []
    sys.modules.setdefault("comfy_api", comfy_api)
    latest = types.ModuleType("comfy_api.latest")
    latest.InputImpl = types.SimpleNamespace()
    latest.Types = types.SimpleNamespace()
    sys.modules.setdefault("comfy_api.latest", latest)

    if str(PACKAGE_PARENT) not in sys.path:
        sys.path.insert(0, str(PACKAGE_PARENT))
    package = importlib.import_module("QQ_ComfyUI_Tools")
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

    def test_grain_does_not_create_black_boundary(self):
        rgb = torch.full((1, 3, 32, 32), 0.5, dtype=torch.float32)
        out = self.lr._apply_grain(rgb, amount=80.0, size=100.0, roughness=0.0, seed=7)
        border = torch.cat((out[..., 0, :], out[..., -1, :], out[..., :, 0], out[..., :, -1]), dim=-1)
        self.assertGreater(border.mean().item(), 0.35)
        self.assertLess(border.mean().item(), 0.65)

    def test_larger_size_reduces_high_frequency_noise(self):
        # 整体方差经归一化后近似相同，比较相邻像素才能衡量高频噪声。
        rgb = torch.full((2, 3, 48, 48), 0.5, dtype=torch.float32)
        sharp = self.lr._apply_grain(rgb, amount=80.0, size=0.0, roughness=100.0)
        coarse = self.lr._apply_grain(rgb, amount=80.0, size=100.0, roughness=0.0)
        self.assertGreater(
            sharp.diff(dim=-1).abs().mean().item(),
            coarse.diff(dim=-1).abs().mean().item(),
        )

    def test_kernel_size_helper_is_always_odd_and_at_least_one(self):
        for v in (0.0, 25.0, 50.0, 75.0, 100.0):
            k = self.lr._grain_kernel_size(v)
            self.assertGreaterEqual(k, 1)
            self.assertEqual(k % 2, 1, msg=f"value={v} -> kernel {k} not odd")

    # --- node class metadata ---

    def test_node_class_metadata(self):
        cls = self.lr.QQLightroomGrain
        self.assertEqual(cls.CATEGORY, "QQ/LR 调色")
        self.assertEqual(cls.RETURN_TYPES, ("IMAGE",))
        self.assertEqual(cls.RETURN_NAMES, ("图像",))
        self.assertEqual(cls.FUNCTION, "apply_grain")
        inputs = cls.INPUT_TYPES()["required"]
        self.assertEqual(inputs["image"][0], "IMAGE")
        for name, default in (("amount", 0.0), ("size", 25.0), ("roughness", 50.0)):
            self.assertEqual(inputs[name][1]["default"], default,
                             msg=f"{name} default != Lightroom")
            self.assertEqual(inputs[name][1]["min"], 0.0)
            self.assertEqual(inputs[name][1]["max"], 100.0)
        self.assertEqual(inputs["seed"][0], "INT")
        self.assertEqual(inputs["seed"][1]["default"], 0)

    def test_node_apply_grain_returns_tuple_of_image(self):
        cls = self.lr.QQLightroomGrain
        # ComfyUI IMAGE: [B, H, W, C]，默认三通道
        image = torch.full((1, 8, 8, 3), 0.5, dtype=torch.float32)
        out = cls.apply_grain(image, amount=50.0, size=25.0, roughness=100.0, seed=12)
        self.assertIsInstance(out, tuple)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].shape, image.shape)

    def test_node_preserves_alpha_channel(self):
        cls = self.lr.QQLightroomGrain
        image = torch.full((1, 8, 8, 4), 0.5, dtype=torch.float32)
        image[..., 3] = 0.7  # alpha 通道
        out = cls.apply_grain(image, amount=80.0, size=50.0, roughness=50.0)[0]
        self.assertEqual(out.shape[-1], 4)
        # alpha 通道应保持不变（_apply_grain 只对 RGB 加噪）
        self.assertTrue(torch.allclose(out[..., 3], image[..., 3]))

    def test_seed_makes_grain_reproducible(self):
        cls = self.lr.QQLightroomGrain
        image = torch.full((1, 16, 16, 3), 0.5)
        first = cls.apply_grain(image, 60.0, 25.0, 50.0, seed=123)[0]
        second = cls.apply_grain(image, 60.0, 25.0, 50.0, seed=123)[0]
        other = cls.apply_grain(image, 60.0, 25.0, 50.0, seed=124)[0]
        self.assertTrue(torch.equal(first, second))
        self.assertFalse(torch.equal(first, other))

    def test_node_rejects_wrong_input_shape(self):
        cls = self.lr.QQLightroomGrain
        with self.assertRaises(TypeError):
            cls.apply_grain(torch.rand(3, 16, 16), 50.0, 25.0, 100.0)
        with self.assertRaises(ValueError):
            cls.apply_grain(torch.rand(1, 16, 16, 2), 50.0, 25.0, 100.0)


if __name__ == "__main__":
    unittest.main()
