"""QQ-卡面 后端媒体分发与契约测试（保存助手以 mock 隔离）。"""
from __future__ import annotations

import importlib
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import torch

PACKAGE_PARENT = Path(__file__).resolve().parents[2]


def load_module():
    folder_paths = types.ModuleType("folder_paths")
    folder_paths.get_output_directory = lambda: ""
    folder_paths.get_temp_directory = lambda: ""
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
    return package.node_modules.card_preview


class FakeVideo:
    def get_components(self):
        return types.SimpleNamespace(images=torch.rand(2, 8, 8, 3))

    def save_to(self, *args, **kwargs):
        pass


class DispatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load_module()

    def test_none_is_empty(self):
        self.assertEqual(self.mod.build_card_ui(None), {"images": [], "videos": [], "audio": []})

    def test_image_dispatch(self):
        image = torch.rand(1, 8, 8, 3)
        with patch.object(self.mod, "_image_ui", return_value=[{"filename": "a.png"}]) as helper:
            ui = self.mod.build_card_ui(image)
        self.assertEqual(ui["images"], [{"filename": "a.png"}])
        self.assertEqual(ui["videos"], [])
        helper.assert_called_once()

    def test_audio_dispatch(self):
        audio = {"waveform": torch.rand(1, 2, 100), "sample_rate": 48000}
        with patch.object(self.mod, "_audio_ui", return_value=[{"filename": "a.wav"}]):
            ui = self.mod.build_card_ui(audio)
        self.assertEqual(ui["audio"], [{"filename": "a.wav"}])

    def test_video_dispatch(self):
        with patch.object(self.mod, "_video_ui", return_value=[{"filename": "a.mp4"}]):
            ui = self.mod.build_card_ui(FakeVideo())
        self.assertEqual(ui["videos"], [{"filename": "a.mp4"}])

    def test_type_detection(self):
        self.assertTrue(self.mod._is_video(FakeVideo()))
        self.assertFalse(self.mod._is_video(torch.rand(1, 8, 8, 3)))
        self.assertTrue(self.mod._is_audio({"waveform": torch.rand(2, 100)}))
        self.assertFalse(self.mod._is_audio({"waveform": "nope"}))


class ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load_module()

    def test_output_node_contract(self):
        node = self.mod.QQCardPreview
        self.assertTrue(node.OUTPUT_NODE)
        self.assertEqual(node.RETURN_TYPES, ())
        self.assertEqual(node.CATEGORY, "QQ/工具")

    def test_show_empty_media(self):
        self.assertEqual(self.mod.QQCardPreview.show()["ui"], {"images": [], "videos": [], "audio": []})

    def test_display_name(self):
        self.assertEqual(self.mod.NODE_DISPLAY_NAME_MAPPINGS["QQCardPreview"], "QQ-卡面")


if __name__ == "__main__":
    unittest.main()
