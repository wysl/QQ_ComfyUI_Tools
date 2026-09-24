"""Regression tests for mixed-aspect-ratio image composition."""

from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path

import torch


def _load_media_module():
    """Load the composition helper without requiring a full ComfyUI server."""
    root_name = "_wysl_media_composition_test"
    module_name = f"{root_name}.node_modules.media"
    for name in tuple(sys.modules):
        if name == root_name or name.startswith(f"{root_name}."):
            sys.modules.pop(name, None)

    root = types.ModuleType(root_name)
    root.__path__ = []
    node_modules = types.ModuleType(f"{root_name}.node_modules")
    node_modules.__path__ = []
    core = types.ModuleType(f"{root_name}.core")
    core.__path__ = []
    video_api = types.ModuleType(f"{root_name}.core.video_api")
    video_api.make_video_components = lambda *args, **kwargs: (args, kwargs)
    sys.modules[root_name] = root
    sys.modules[node_modules.__name__] = node_modules
    sys.modules[core.__name__] = core
    sys.modules[video_api.__name__] = video_api

    path = Path(__file__).resolve().parents[1] / "node_modules" / "media.py"
    spec = importlib.util.spec_from_file_location(module_name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


MEDIA = _load_media_module()


def _solid_image(height: int, width: int, value: float) -> torch.Tensor:
    return torch.full((1, height, width, 3), value, dtype=torch.float32)


class MixedAspectCompositionTests(unittest.TestCase):
    def test_directional_strip_preserves_entire_landscape_after_two_portraits(self):
        """A 16:9 image must retain its full width beside 9:16 images."""
        portrait_one = _solid_image(1920, 1080, 0.1)
        portrait_two = _solid_image(1920, 1080, 0.2)
        landscape = _solid_image(1080, 1920, 0.3)

        output = MEDIA._compose_images(
            [portrait_one, portrait_two, landscape],
            max_edge=1920,
            layout="从左向右",
        )

        self.assertIsNotNone(output)
        self.assertEqual(tuple(output.shape), (1, 1920, 4100, 3))
        torch.testing.assert_close(output[:, :, :1080, :], portrait_one)
        torch.testing.assert_close(output[:, :, 1090:2170, :], portrait_two)
        torch.testing.assert_close(output[:, :1080, 2180:4100, :], landscape)
        self.assertTrue(torch.equal(output[:, :, 1080:1090, :], torch.zeros_like(output[:, :, 1080:1090, :])))
        self.assertTrue(torch.equal(output[:, :, 2170:2180, :], torch.zeros_like(output[:, :, 2170:2180, :])))
        self.assertTrue(torch.equal(output[:, 1080:, 2180:4100, :], torch.zeros_like(output[:, 1080:, 2180:4100, :])))

    def test_right_to_left_reverses_order_without_cropping_landscape(self):
        portrait_one = _solid_image(1920, 1080, 0.1)
        portrait_two = _solid_image(1920, 1080, 0.2)
        landscape = _solid_image(1080, 1920, 0.3)

        output = MEDIA._compose_images(
            [portrait_one, portrait_two, landscape],
            max_edge=1920,
            layout="从右向左",
        )

        self.assertIsNotNone(output)
        self.assertEqual(tuple(output.shape), (1, 1920, 4100, 3))
        torch.testing.assert_close(output[:, :1080, :1920, :], landscape)
        torch.testing.assert_close(output[:, :, 1930:3010, :], portrait_two)
        torch.testing.assert_close(output[:, :, 3020:4100, :], portrait_one)

    def test_splitter_accepts_upstream_style_bundle_without_cropping_landscape(self):
        """The native H3 bundle shape must follow the same no-crop path."""
        portrait_one = _solid_image(1920, 1080, 0.1)
        portrait_two = _solid_image(1920, 1080, 0.2)
        landscape = _solid_image(1080, 1920, 0.3)
        upstream_bundle = types.SimpleNamespace(
            items=(
                types.SimpleNamespace(input_index=1, media_type="image", value=portrait_one),
                types.SimpleNamespace(input_index=2, media_type="image", value=portrait_two),
                types.SimpleNamespace(input_index=3, media_type="image", value=landscape),
            )
        )

        _images, _audios, _videos, output = MEDIA.QQMediaAutoSplitter.split(
            media_bundle=[upstream_bundle],
            组合图片长边=[1920],
            组合排列=["从左向右"],
        )

        self.assertEqual(tuple(output.shape), (1, 1920, 4100, 3))
        torch.testing.assert_close(output[:, :1080, 2180:4100, :], landscape)

    def test_splitter_consumes_a_full_multi_output_list_in_one_combination(self):
        """A Wysl media loader IMAGE list must not be mapped one item at a time."""
        portrait_one = _solid_image(1920, 1080, 0.1)
        portrait_two = _solid_image(1920, 1080, 0.2)
        landscape = _solid_image(1080, 1920, 0.3)

        images, _audios, _videos, output = MEDIA.QQMediaAutoSplitter.split(
            image=[portrait_one, portrait_two, landscape],
            组合图片长边=[1920],
            组合排列=["从左向右"],
        )

        self.assertTrue(MEDIA.QQMediaAutoSplitter.INPUT_IS_LIST)
        self.assertEqual(len(images), 3)
        self.assertEqual(tuple(output.shape), (1, 1920, 4100, 3))
        torch.testing.assert_close(output[:, :1080, 2180:4100, :], landscape)


if __name__ == "__main__":
    unittest.main()
