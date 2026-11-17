"""QQ-LUT调色 / QQ-曲线调色 后端算法与契约测试。"""
from __future__ import annotations

import importlib
import sys
import types
import unittest
from pathlib import Path

import torch

PACKAGE_PARENT = Path(__file__).resolve().parents[2]

IDENTITY_CUBE = """# identity
LUT_3D_SIZE 2
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
"""


def load_module():
    folder_paths = types.ModuleType("folder_paths")
    folder_paths.get_output_directory = lambda: ""
    folder_paths.get_user_directory = lambda: str(PACKAGE_PARENT / "_test_user")
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
    return package.node_modules.lut_grading


class LutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load_module()

    def test_parse_identity_cube(self):
        parsed = self.mod.parse_cube(IDENTITY_CUBE)
        self.assertEqual(parsed["size"], 2)
        self.assertEqual(tuple(parsed["lut"].shape), (2, 2, 2, 3))

    def test_parse_bad_cube_raises(self):
        with self.assertRaises(ValueError):
            self.mod.parse_cube("TITLE nope\n0 0 0\n")

    def test_parse_wrong_count_raises(self):
        with self.assertRaises(ValueError):
            self.mod.parse_cube("LUT_3D_SIZE 3\n0 0 0\n")

    def test_identity_lut_is_noop(self):
        parsed = self.mod.parse_cube(IDENTITY_CUBE)
        rgb = torch.rand(2, 3, 16, 16, dtype=torch.float32)
        out = self.mod.apply_lut3d(rgb, parsed)
        self.assertEqual(out.shape, rgb.shape)
        self.assertLess((out - rgb).abs().max().item(), 1e-4)

    def test_strength_zero_is_noop(self):
        parsed = self.mod.parse_cube(IDENTITY_CUBE)
        image = torch.rand(1, 8, 8, 3, dtype=torch.float32)
        fn = self.mod._lut_image_fn(parsed, 0.0)
        self.assertTrue(torch.equal(fn(image), image))

    def test_alpha_preserved(self):
        parsed = self.mod.parse_cube(IDENTITY_CUBE)
        image = torch.rand(1, 8, 8, 4, dtype=torch.float32)
        fn = self.mod._lut_image_fn(parsed, 100.0)
        out = fn(image)
        self.assertTrue(torch.equal(out[..., 3], image[..., 3]))


class CurveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load_module()

    def test_identity_table(self):
        table = self.mod.curve_lut([[0, 0], [1, 1]])
        self.assertEqual(table.numel(), 256)
        self.assertAlmostEqual(table[0].item(), 0.0, places=5)
        self.assertAlmostEqual(table[-1].item(), 1.0, places=5)
        self.assertTrue(bool((table[1:] >= table[:-1]).all()))

    def test_parse_curve_fallback(self):
        self.assertEqual(self.mod.parse_curve("{bad"), [[0.0, 0.0], [1.0, 1.0]])
        self.assertEqual(self.mod.parse_curve(""), [[0.0, 0.0], [1.0, 1.0]])

    def test_apply_curve_identity_noop(self):
        image = torch.rand(1, 8, 8, 3, dtype=torch.float32)
        out = self.mod.apply_curve(image, "RGB", [[0, 0], [1, 1]])
        self.assertLess((out - image).abs().max().item(), 1.0 / 255 + 1e-4)

    def test_red_channel_only(self):
        image = torch.full((1, 4, 4, 3), 0.5, dtype=torch.float32)
        out = self.mod.apply_curve(image, "红", [[0, 0], [1, 1], [0.5, 0.9]])
        self.assertGreater(out[..., 0].mean().item(), 0.6)
        self.assertAlmostEqual(out[..., 1].mean().item(), 0.5, places=2)
        self.assertAlmostEqual(out[..., 2].mean().item(), 0.5, places=2)

    def test_process_media_image(self):
        image = torch.rand(1, 8, 8, 3, dtype=torch.float32)
        out = self.mod.process_media(image, lambda img: img)
        self.assertTrue(torch.equal(out, image))


class RegistrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load_module()

    def test_names(self):
        self.assertIn("QQLutGrading", self.mod.NODE_CLASS_MAPPINGS)
        self.assertIn("QQCurvesGrading", self.mod.NODE_CLASS_MAPPINGS)
        self.assertEqual(self.mod.NODE_DISPLAY_NAME_MAPPINGS["QQLutGrading"], "QQ-LUT调色")
        self.assertEqual(self.mod.NODE_DISPLAY_NAME_MAPPINGS["QQCurvesGrading"], "QQ-曲线调色")


if __name__ == "__main__":
    unittest.main()
