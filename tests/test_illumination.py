"""Behavior checks for QQ-照度均衡 and QQ-深度融合."""

from __future__ import annotations

import importlib
import sys
import types
import unittest
from pathlib import Path

import torch


PACKAGE_PARENT = Path(__file__).resolve().parents[2]


def load_module():
    folder_paths = types.ModuleType("folder_paths")
    folder_paths.get_output_directory = lambda: ""
    folder_paths.get_save_image_path = lambda *args: ("", "qq", 1, "", "")
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
    return package.node_modules.illumination


def gradient_image(height=64, width=64, batch=1, top=0.85, bottom=0.25):
    """Horizontal-band lighting gradient: bright at the top, dark at the bottom."""
    rows = torch.linspace(top, bottom, height).view(1, height, 1, 1)
    image = rows.expand(batch, height, width, 1) * torch.ones(batch, height, width, 3)
    return image.contiguous()


def row_means(image):
    """Per-row mean luminance, so a vertical lighting gradient is measurable."""
    return image[..., :3].mean(dim=(0, 3))


class IlluminationBalanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load_module()
        cls.node = cls.mod.QQIlluminationBalance

    def test_node_metadata(self):
        self.assertEqual(self.node.CATEGORY, "QQ/工具")
        self.assertEqual(self.node.FUNCTION, "balance")
        self.assertEqual(self.node.RETURN_TYPES, ("IMAGE", "INT"))
        self.assertEqual(self.node.RETURN_NAMES, ("图像", "档位数"))

    def test_default_strengths_are_three_variants_including_identity(self):
        strengths = self.mod._parse_strengths(self.mod.DEFAULT_VARIANT_STRENGTHS)
        self.assertEqual(strengths, [0.0, 50.0, 100.0])

    def test_strength_parsing_accepts_chinese_and_newlines(self):
        self.assertEqual(self.mod._parse_strengths("0，50\n100"), [0.0, 50.0, 100.0])
        self.assertEqual(self.mod._parse_strengths(""), [50.0])

    def test_too_many_variants_is_rejected(self):
        with self.assertRaises(ValueError):
            self.mod._parse_strengths(",".join(str(i) for i in range(self.mod.MAX_VARIANTS + 1)))

    def test_zero_strength_variant_matches_input(self):
        image = gradient_image()
        out, count = self.node().balance(image, 档位强度="0", 暗部细节=0.0, 最大修正幅度=1.0, 滤波半径=16)
        self.assertEqual(count, 1)
        self.assertTrue(torch.allclose(out, image, atol=1e-5))

    def test_batch_and_strength_expansion_shape(self):
        image = gradient_image(batch=2)
        out, count = self.node().balance(image, 档位强度="0,50,100", 滤波半径=16)
        self.assertEqual(count, 3)
        self.assertEqual(out.shape, (6, 64, 64, 3))

    def test_illumination_gradient_is_flattened(self):
        image = gradient_image()
        original_spread = row_means(image).std().item()
        out, _ = self.node().balance(image, 档位强度="0,100", 滤波半径=16)
        balanced_spread = row_means(out[1:2]).std().item()
        self.assertLess(
            balanced_spread,
            original_spread,
            msg=f"照度梯度未被压平: {balanced_spread:.4f} vs {original_spread:.4f}",
        )

    def test_global_median_brightness_is_preserved(self):
        image = gradient_image()
        out, _ = self.node().balance(image, 档位强度="0,100", 滤波半径=16)
        self.assertAlmostEqual(
            out[1:2].median().item(), image.median().item(), places=2,
            msg="全局中位亮度应保持不变，避免带偏 Depth Pro 的焦距预测",
        )

    def test_detail_layer_is_not_destroyed(self):
        image = gradient_image()
        noise = (torch.rand_like(image) - 0.5) * 0.02
        image = (image + noise).clamp(0.0, 1.0)

        def detail_strength(tensor):
            planes = tensor[..., :3].movedim(-1, 1)
            low = self.mod._box_filter(planes, 4)
            return (planes - low).std().item()

        before = detail_strength(image)
        out, _ = self.node().balance(image, 档位强度="0,100", 滤波半径=16)
        after = detail_strength(out[1:2])
        self.assertGreater(
            after, before * 0.6,
            msg=f"细节层被过度抹平：{after:.4f} vs {before:.4f}",
        )

    def test_correction_is_soft_limited(self):
        # A hard white-to-black ramp would demand a huge correction; the soft
        # limit must keep the result from collapsing to a flat plane.
        rows = torch.linspace(1.0, 0.0, 64).view(1, 64, 1, 1)
        image = (rows * torch.ones(1, 64, 64, 3)).contiguous()
        out, _ = self.node().balance(image, 档位强度="0,100", 最大修正幅度=1.0, 滤波半径=16)
        self.assertGreater(out[1:2].std().item(), 0.0)
        self.assertTrue(((out >= 0.0) & (out <= 1.0)).all())

    def test_soft_limit_function_bounds_output(self):
        values = torch.tensor([-10.0, -1.0, 0.0, 1.0, 10.0])
        limited = self.mod._soft_limit(values, 1.0)
        self.assertTrue((limited.abs() <= 1.0).all())
        self.assertAlmostEqual(limited[2].item(), 0.0, places=6)

    def test_alpha_channel_is_preserved(self):
        image = torch.cat((gradient_image(), torch.full((1, 64, 64, 1), 0.7)), dim=-1)
        out, _ = self.node().balance(image, 档位强度="0,50,100", 滤波半径=16)
        self.assertEqual(out.shape[-1], 4)
        self.assertTrue(torch.allclose(out[..., 3], torch.full((3, 64, 64), 0.7), atol=1e-5))

    def test_global_exposure_normalisation_aligns_batch(self):
        bright = gradient_image(top=1.0, bottom=0.6)
        dark = gradient_image(top=0.4, bottom=0.05)
        image = torch.cat((bright, dark), dim=0)
        out, _ = self.node().balance(
            image, 档位强度="0", 全局曝光归一=True, 滤波半径=16
        )
        ratio = out[0].median().item() / out[1].median().item()
        self.assertLess(ratio, 3.0, msg="批内全局曝光未被拉近")

    def test_rejects_non_image_tensor(self):
        with self.assertRaises(TypeError):
            self.node().balance(torch.rand(64, 64, 3), 档位强度="50")
        with self.assertRaises(ValueError):
            self.node().balance(torch.rand(1, 64, 64, 2), 档位强度="50")


class DepthFusionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load_module()
        cls.node = cls.mod.QQDepthFusion

    def test_node_metadata(self):
        self.assertEqual(self.node.CATEGORY, "QQ/工具")
        self.assertEqual(self.node.FUNCTION, "fuse")
        self.assertEqual(self.node.RETURN_TYPES, ("IMAGE", "IMAGE"))
        self.assertEqual(self.node.RETURN_NAMES, ("融合深度", "一致性"))

    def test_identical_variants_are_perfectly_consistent(self):
        # Depth Pro 把同一个深度值重复写入三个通道，所以先取通道均值再比较。
        raw = torch.rand(1, 32, 32, 3) + 0.5
        depth = torch.cat((raw, raw, raw), dim=0)
        fused, consistency = self.node().fuse(depth, 每图档位数=3)
        self.assertEqual(fused.shape, (1, 32, 32, 3))
        expected = raw.mean(dim=-1, keepdim=True).repeat(1, 1, 1, 3)
        self.assertTrue(torch.allclose(fused, expected, atol=1e-4))
        self.assertGreater(consistency.min().item(), 0.99)

    def test_outlier_variant_is_rejected_by_median(self):
        base = torch.full((1, 32, 32, 3), 2.0)
        outlier = torch.full((1, 32, 32, 3), 40.0)
        depth = torch.cat((base, outlier, base), dim=0)
        fused, _ = self.node().fuse(depth, 每图档位数=3, 融合方式="中值")
        self.assertTrue(torch.allclose(fused, base, atol=1e-4), fused.mean().item())

    def test_mean_fusion_would_be_pulled_by_outlier(self):
        # 尺度归一会把每个变体自身拉到同一尺度，所以均值与中值在这种设定下
        # 等价；这里关闭归一，才能看出均值本身对离群变体不设防。
        base = torch.full((1, 16, 16, 3), 2.0)
        outlier = torch.full((1, 16, 16, 3), 40.0)
        depth = torch.cat((base, outlier, base), dim=0)
        fused, _ = self.node().fuse(depth, 每图档位数=3, 融合方式="均值", 尺度归一=False)
        self.assertGreater(fused.mean().item(), base.mean().item() * 3)

    def test_inconsistent_variants_lower_consistency_scores(self):
        # 只有整体缩放差异的变体在归一后应当视为一致；真正的结构分歧
        # 才能拉低一致性分数。
        plane = torch.full((1, 32, 32, 3), 2.0)
        ramp = torch.linspace(1.0, 3.0, 32).view(1, 1, 32, 1).expand(1, 32, 32, 3)
        stable = torch.cat((plane, plane * 1.02, plane * 0.98), dim=0)
        scaled_only = torch.cat((plane, plane * 4.0, plane * 0.25), dim=0)
        divergent = torch.cat((plane, ramp * 3.0, plane * 0.5), dim=0)
        _, stable_score = self.node().fuse(stable, 每图档位数=3)
        _, scaled_score = self.node().fuse(scaled_only, 每图档位数=3)
        _, divergent_score = self.node().fuse(divergent, 每图档位数=3)
        self.assertGreater(stable_score.mean().item(), 0.99)
        self.assertGreater(scaled_score.mean().item(), 0.99)
        self.assertLess(divergent_score.mean().item(), 0.99)

    def test_pure_scale_difference_counts_as_agreement(self):
        # Three variants that differ only by a global scale factor describe the
        # same geometry, so they must score as fully consistent and fuse back
        # onto the group's median scale.
        one = torch.full((1, 32, 32, 3), 2.0)
        doubled = torch.full((1, 32, 32, 3), 4.0)
        depth = torch.cat((one, doubled, one), dim=0)
        fused, consistency = self.node().fuse(depth, 每图档位数=3, 尺度归一=True)
        self.assertGreater(consistency.min().item(), 0.99)
        self.assertAlmostEqual(fused.mean().item(), 2.0, places=3)

    def test_multiple_images_grouped_correctly(self):
        image_a = torch.full((1, 16, 16, 3), 1.0)
        image_b = torch.full((1, 16, 16, 3), 5.0)
        depth = torch.cat((image_a, image_a, image_a, image_b, image_b, image_b), dim=0)
        fused, consistency = self.node().fuse(depth, 每图档位数=3)
        self.assertEqual(fused.shape[0], 2)
        self.assertAlmostEqual(fused[0].mean().item(), 1.0, places=3)
        self.assertAlmostEqual(fused[1].mean().item(), 5.0, places=3)
        self.assertEqual(consistency.shape[0], 2)

    def test_single_channel_depth_is_accepted(self):
        depth = torch.full((3, 16, 16, 1), 2.0)
        fused, consistency = self.node().fuse(depth, 每图档位数=3)
        self.assertEqual(fused.shape, (1, 16, 16, 3))
        self.assertEqual(consistency.shape, (1, 16, 16, 3))

    def test_mismatched_grouping_reports_error(self):
        depth = torch.rand(5, 16, 16, 3)
        with self.assertRaises(ValueError):
            self.node().fuse(depth, 每图档位数=3)

    def test_rejects_non_depth_tensor(self):
        with self.assertRaises(TypeError):
            self.node().fuse(torch.rand(16, 16, 3), 每图档位数=3)

    def test_registered_under_expected_ids(self):
        package = importlib.import_module("QQ_ComfyUI_Tools")
        self.assertIn("QQIlluminationBalance", package.NODE_CLASS_MAPPINGS)
        self.assertIn("QQDepthFusion", package.NODE_CLASS_MAPPINGS)
        self.assertEqual(
            package.NODE_DISPLAY_NAME_MAPPINGS["QQIlluminationBalance"], "QQ-照度均衡"
        )
        self.assertEqual(
            package.NODE_DISPLAY_NAME_MAPPINGS["QQDepthFusion"], "QQ-深度融合"
        )


if __name__ == "__main__":
    unittest.main()
