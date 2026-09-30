"""Tests for geometric depth viewpoint transforms."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import torch


MODULE_PATH = Path(__file__).resolve().parents[1] / "node_modules" / "depth_view.py"
_spec = importlib.util.spec_from_file_location("qq_depth_view_test", MODULE_PATH)
assert _spec and _spec.loader
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)


class DepthViewTests:
    def test_identity_preserves_depth(self):
        depth = torch.full((1, 12, 16, 3), 2.0)
        output, valid, holes = _module.transform_depth(depth)
        assert output.shape == depth.shape
        assert torch.allclose(output, depth, atol=1e-5)
        assert torch.all(valid == 1)
        assert torch.all(holes == 0)

    def test_yaw_produces_valid_output_and_holes(self):
        depth = torch.full((1, 32, 32, 3), 2.0)
        output, valid, holes = _module.transform_depth(depth, yaw=30.0)
        assert output.shape == depth.shape
        assert valid.shape == depth.shape
        assert holes.shape == depth.shape
        assert torch.any(valid[..., 0] == 1)
        assert torch.any(holes[..., 0] == 1)
        assert torch.all(output[holes == 1] == 0)

    def test_zero_depth_is_not_valid(self):
        depth = torch.zeros((1, 8, 8, 3))
        output, valid, holes = _module.transform_depth(depth)
        assert torch.all(output == 0)
        assert torch.all(valid == 0)
        assert torch.all(holes == 1)

    def test_node_metadata(self):
        node = _module.QQDepthViewTransform
        assert node.CATEGORY == "QQ/工具"
        assert node.FUNCTION == "transform"
        assert node.RETURN_TYPES == ("IMAGE", "IMAGE", "IMAGE")
        assert node.RETURN_NAMES == ("视角深度", "有效区域", "空洞区域")
