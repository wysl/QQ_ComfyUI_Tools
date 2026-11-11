"""QQ-Lora分组加载 的预览图查找与路由载荷。"""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path

MODULE_DIR = Path(__file__).resolve().parents[1] / "node_modules"


class PreviewTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.loras = self.root / "loras"
        (self.loras / "sub").mkdir(parents=True)
        (self.loras / "sub" / "a.safetensors").write_bytes(b"x")
        (self.loras / "b.safetensors").write_bytes(b"x")
        (self.root / "previews" / "loras").mkdir(parents=True)

        folder_paths = types.ModuleType("folder_paths")
        folder_paths.get_folder_paths = lambda kind: [str(self.loras)]
        folder_paths.get_full_path = lambda kind, name: (
            str(self.loras / name) if (self.loras / name).is_file() else None
        )
        folder_paths.get_previews_directory = lambda: str(self.root / "previews")
        self._saved = sys.modules.get("folder_paths")
        sys.modules["folder_paths"] = folder_paths

        spec = importlib.util.spec_from_file_location("lora_preview_api_test", MODULE_DIR / "lora_preview_api.py")
        self.module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        sys.modules["lora_preview_api_test"] = self.module
        spec.loader.exec_module(self.module)
        self.module._cache.clear()

    def tearDown(self):
        if self._saved is None:
            sys.modules.pop("folder_paths", None)
        else:
            sys.modules["folder_paths"] = self._saved

    def _write(self, relative: str, data: bytes = b"png") -> None:
        path = self.loras / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def test_sidecar_next_to_the_model(self):
        self._write("sub/a.safetensors.preview.png")
        self.assertEqual(self.module.find_preview("sub/a.safetensors").name, "a.safetensors.preview.png")

    def test_stem_variants_and_case(self):
        self._write("b.preview.WEBP")
        self.assertEqual(self.module.preview_payload("b.safetensors")[1], "image/webp")
        self.assertEqual(self.module.preview_payload("b.safetensors")[0], b"png")

    def test_plain_name_image(self):
        self._write("b.png")
        self.assertEqual(self.module.find_preview("b.safetensors").name, "b.png")

    def test_previews_directory_fallback(self):
        self._write("sub/a.safetensors")
        preview = self.root / "previews" / "loras" / "sub" / "a.preview.jpg"
        preview.parent.mkdir(parents=True, exist_ok=True)
        preview.write_bytes(b"jpg")
        self.assertEqual(self.module.find_preview("sub/a.safetensors"), preview)

    def test_missing_model_or_preview(self):
        self.assertIsNone(self.module.find_preview("nope.safetensors"))
        self.assertIsNone(self.module.preview_payload("b.safetensors"))

    def test_register_is_silent_without_server(self):
        self.module.register()  # 没有 aiohttp/server 也不能抛


if __name__ == "__main__":
    unittest.main()
