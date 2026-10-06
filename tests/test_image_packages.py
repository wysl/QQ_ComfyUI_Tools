"""Backend tests for QQ-图片包加载."""

from __future__ import annotations

import importlib.util
import gzip
import io
import json
import os
import sys
import tarfile
import tempfile
import types
import unittest
import zipfile
from pathlib import Path
from PIL import Image
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]
paths = types.ModuleType("folder_paths")
server = types.ModuleType("server")

spec = importlib.util.spec_from_file_location("qq_image_packages_test", REPO / "node_modules" / "image_packages.py")
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = module
with patch.dict(sys.modules, {"folder_paths": paths, "server": server}):
    spec.loader.exec_module(module)


def make_image(color: str, size=(4, 4)) -> bytes:
    image = Image.new("RGB", size, color)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class ImagePackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        (root / "single.png").write_bytes(make_image("red"))
        zip_path = root / "package.cbz"
        with zipfile.ZipFile(zip_path, "w") as archive:
            archive.writestr("img10.png", make_image("green"))
            archive.writestr("img2.png", make_image("blue"))
            archive.writestr("nested/img1.png", make_image("yellow"))
            archive.writestr("__MACOSX/junk.png", b"junk")
            archive.writestr("nested.zip", b"not extracted")
        tar_path = root / "package.tar.gz"
        with tarfile.open(tar_path, "w:gz") as archive:
            for name, color in (("b/img10.png", "purple"), ("b/img2.png", "orange")):
                data = make_image(color)
                info = tarfile.TarInfo(name)
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
        cls.root = root
        paths.get_input_directory = lambda: str(root)
        paths.get_output_directory = lambda: str(root / "output")
        paths.get_temp_directory = lambda: str(root / "temp")
        (root / "output").mkdir()
        (root / "output" / "single.png").write_bytes(make_image("blue"))
        cls.zip_ref = str(zip_path)
        cls.tar_ref = str(tar_path)
        cls.single_ref = str(root / "single.png")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_supported_types(self):
        self.assertEqual(module.package_kind("a.PNG"), "image")
        self.assertEqual(module.package_kind("a.cbz"), "archive")
        self.assertEqual(module.package_kind("a.tar.gz"), "archive")
        self.assertEqual(module.package_kind("a.mp4"), None)

    def test_manifest_and_natural_order(self):
        manifest = module.manifest_for(self.zip_ref)
        self.assertEqual(manifest["kind"], "archive")
        self.assertEqual(
            manifest["members"],
            ["img2.png", "img10.png", "nested/img1.png"],
        )
        self.assertEqual(module.manifest_for(self.single_ref)["kind"], "image")

    def test_tar_gz_manifest(self):
        manifest = module.manifest_for(self.tar_ref)
        self.assertEqual(manifest["members"], ["b/img2.png", "b/img10.png"])

    def test_package_entries_and_execution(self):
        entries = module.package_entries([self.zip_ref, self.single_ref])
        self.assertEqual(len(entries), 4)
        output = module.QQImagePackageLoader().load(
            package_state='{"sources":["' + self.zip_ref.replace("\\", "\\\\") + '"]}',
            当前序号=2,
            unique_id=77,
        )
        self.assertIn("result", output)
        self.assertIn("ui", output)
        self.assertEqual(output["ui"]["qq_image_package"][0]["node_id"], "77")
        image, index, total, path, done = output["result"]
        self.assertEqual(image.shape, (1, 4, 4, 3))
        self.assertEqual((index, total, path, done), (2, 3, "img10.png", False))
        final_output = module.QQImagePackageLoader().load(
            package_state='{"sources":[]}', file_path=self.zip_ref, 当前序号=3,
        )
        self.assertTrue(final_output["result"][4])

    def test_state_and_path_input(self):
        state = module.parse_state({"sources": [self.single_ref, self.single_ref]})
        self.assertEqual(state["sources"], [module.normalize_reference(self.single_ref)])
        self.assertEqual(module.parse_path_input(f"{self.single_ref}, {self.zip_ref}"), [module.normalize_reference(self.single_ref), module.normalize_reference(self.zip_ref)])

    def test_rejects_no_source(self):
        self.assertEqual(module.QQImagePackageLoader.VALIDATE_INPUTS(package_state='{"sources":[]}'), "请选择图片/图片包，或在 file_path 输入路径")

    def test_contract(self):
        node = module.QQImagePackageLoader
        self.assertEqual(node.RETURN_TYPES, ("IMAGE", "INT", "INT", "STRING", "BOOLEAN"))
        self.assertIn("file_path", node.INPUT_TYPES()["optional"])
        self.assertTrue(node.INPUT_TYPES()["optional"]["file_path"][1]["forceInput"])

    def test_output_reference_and_containment(self):
        reference = module._list_payload(source="output")["files"][0]["path"]
        self.assertEqual(reference, "output::single.png")
        self.assertEqual(module.parse_state({"sources": [reference]})["sources"], [reference])
        self.assertEqual(module.manifest_for(reference)["path"], str(self.root / "output" / "single.png"))
        with self.assertRaises(ValueError):
            module.resolve_reference("../outside.png")
        with self.assertRaises(ValueError):
            module._list_payload("../")

    def test_gzip_image(self):
        path = self.root / "single.png.gz"
        with gzip.open(path, "wb") as handle:
            handle.write(make_image("red"))
        result = module.QQImagePackageLoader().load(file_path=str(path))["result"]
        self.assertEqual(result[0].shape, (1, 4, 4, 3))
        self.assertEqual(result[3], "single.png")

    def test_raw_archive_names_and_no_nested_or_unsafe_files(self):
        path = self.root / "names.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("./pages/image2.png", make_image("red"))
            archive.writestr("pages\\image10.png", make_image("blue"))
            archive.writestr("../bad.png", make_image("red"))
            archive.writestr("/absolute.png", make_image("red"))
            archive.writestr("inner.cbz", b"nested")
        output = module.QQImagePackageLoader().load(file_path=str(path), 当前序号=2)
        self.assertEqual(output["result"][2:4], (2, "pages/image10.png"))
        self.assertEqual(float(output["result"][0][0, 0, 0, 2]), 1.0)

    def test_tar_cache_does_not_decompress_for_each_image(self):
        manifest = module.manifest_for(self.tar_ref)
        self.assertTrue(Path(manifest["data_path"]).exists())
        with patch.object(module.tarfile, "open", side_effect=AssertionError("should use seek cache")):
            for member in manifest["members"]:
                with module.read_entry_image(manifest, member) as image:
                    self.assertEqual(image.size, (4, 4))

    def test_linked_path_validates_without_panel_and_bounds(self):
        self.assertIs(module.QQImagePackageLoader.VALIDATE_INPUTS(input_types={"file_path": "STRING"}), True)
        with self.assertRaisesRegex(ValueError, "当前序号超出范围"):
            module.QQImagePackageLoader().load(file_path=self.zip_ref, 当前序号=4)

    def test_path_input_overrides_invalid_panel_state(self):
        self.assertIs(module.QQImagePackageLoader.VALIDATE_INPUTS(
            package_state="invalid JSON", file_path=self.single_ref), True)
        result = module.QQImagePackageLoader().load(
            package_state="invalid JSON", file_path=self.single_ref)["result"]
        self.assertEqual(result[1:4], (1, 1, "single.png"))

    def test_rgba_returns_rgb_and_corrupt_cover_falls_back(self):
        rgba = Image.new("RGBA", (3, 2), (20, 30, 40, 100))
        self.assertEqual(module.tensor_from_image(rgba).shape, (1, 2, 3, 3))
        path = self.root / "cover.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("1.png", b"bad image")
            archive.writestr("2.png", make_image("blue"))
        thumb = module._thumbnail_bytes(str(path))
        self.assertEqual(Image.open(io.BytesIO(thumb)).size, (4, 4))

    def test_thumbnail_index_and_clamp(self):
        thumb = module._thumbnail_bytes(self.zip_ref, 64, 1)
        image = Image.open(io.BytesIO(thumb)).convert("RGB")
        r, g, b = image.getpixel((image.width // 2, image.height // 2))
        self.assertGreater(g, r + 20)
        self.assertGreater(g, b + 20)
        clamped = module._thumbnail_bytes(self.zip_ref, 64, 9)
        image = Image.open(io.BytesIO(clamped)).convert("RGB")
        r, g, b = image.getpixel((image.width // 2, image.height // 2))
        self.assertGreater(r, 120)
        self.assertGreater(g, 120)
        self.assertLess(b, 120)

    def test_multiple_manifests_are_retained_and_sources_ordered(self):
        first = module.manifest_for(self.zip_ref)
        module.manifest_for(self.tar_ref)
        self.assertIs(module.manifest_for(self.zip_ref), first)
        result = module.QQImagePackageLoader().load(
            package_state=json.dumps({"sources": [self.single_ref, self.zip_ref]}), 当前序号=2)
        self.assertEqual(result["result"][2:4], (4, "img2.png"))


if __name__ == "__main__":
    unittest.main()
