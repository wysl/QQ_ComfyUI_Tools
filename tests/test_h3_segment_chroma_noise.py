"""Behavior checks for the H3 segment chroma-noise bridge."""

from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from dataclasses import dataclass
from pathlib import Path

import torch


MODULE_PATH = Path(__file__).resolve().parents[1] / "node_modules" / "h3_segments.py"


def load_module():
    comfy_nodes = types.ModuleType("nodes")

    class FakeDecoder:
        @staticmethod
        def decode(_vae, latent):
            video = latent["samples"]
            return (video.squeeze(0).permute(1, 2, 3, 0).contiguous(),)

    comfy_nodes.VAEDecode = FakeDecoder
    sys.modules["nodes"] = comfy_nodes
    spec = importlib.util.spec_from_file_location("wsl_h3_segment_test_module", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FakeVAE:
    @staticmethod
    def encode(images):
        return images.permute(3, 0, 1, 2).unsqueeze(0).contiguous()


@dataclass(frozen=True)
class FakeBundle:
    video_vae: object


@dataclass(frozen=True)
class FakeSample:
    video_latent: torch.Tensor
    audio_latent: object
    head_frames: int
    delivery_frames: int
    output_frames: int | None = None
    prompt: str | None = None
    media: tuple = ()


@dataclass(frozen=True)
class FakeSegments:
    plan: dict
    samples: tuple[FakeSample, ...]


class H3SegmentChromaNoiseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def test_luminance_protection_keeps_per_pixel_brightness(self):
        images = torch.linspace(0.05, 0.95, 10 * 8 * 6 * 3).reshape(10, 8, 6, 3)
        noisy = images.clone()
        self.module._apply_h3_chroma_noise(noisy, 0.2, 0.0, 3, 123, True)
        before = self.module._h3_luminance(images)
        after = self.module._h3_luminance(noisy)
        self.assertLess((after - before).abs().max().item(), 1e-5)
        self.assertGreater((noisy - images).abs().mean().item(), 0.001)

    def test_bridge_preserves_transport_and_only_changes_delivery_frames(self):
        source = torch.linspace(0.1, 0.9, 1 * 3 * 6 * 4 * 4).reshape(1, 3, 6, 4, 4)
        audio = object()
        sample = FakeSample(source.clone(), audio, head_frames=2, delivery_frames=4, output_frames=4)
        segments = FakeSegments({"bundle": FakeBundle(FakeVAE())}, (sample,))

        output = self.module.QQH3SegmentChromaNoise.add_chroma_noise(
            segments,
            start_alpha=0.4,
            end_alpha=0.0,
            taper_frames=2,
            seed=99,
            preserve_luminance=False,
        )[0]

        self.assertIsInstance(output, FakeSegments)
        self.assertIs(output.plan, segments.plan)
        self.assertIs(output.samples[0].audio_latent, audio)
        self.assertTrue(torch.equal(output.samples[0].video_latent[:, :, :2], source[:, :, :2]))
        self.assertFalse(torch.equal(output.samples[0].video_latent[:, :, 2:5], source[:, :, 2:5]))
        self.assertTrue(torch.equal(output.samples[0].video_latent[:, :, 5:], source[:, :, 5:]))
        self.assertTrue(torch.equal(sample.video_latent, source))

    def test_zero_strength_is_a_noop_without_vae_work(self):
        marker = object()
        output = self.module.QQH3SegmentChromaNoise.add_chroma_noise(
            marker,
            start_alpha=0.0,
            end_alpha=0.0,
        )[0]
        self.assertIs(output, marker)


if __name__ == "__main__":
    unittest.main()

