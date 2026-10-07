"""Backend tests for QQ-图片包加载."""

from __future__ import annotations

import importlib.util
import asyncio
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
import torch

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
        image, index, total, info = output["result"]
        self.assertEqual(image.shape, (1, 4, 4, 3))
        self.assertEqual((index, total), (2, 3))
        self.assertEqual(output["ui"]["qq_image_package"][0]["current"], "img10.png")
        final_output = module.QQImagePackageLoader().load(
            package_state='{"sources":[]}', file_path=self.zip_ref, 当前序号=3,
        )
        self.assertEqual(final_output["result"][1:3], (3, 3))

    def test_state_and_path_input(self):
        state = module.parse_state({"sources": [self.single_ref, self.single_ref]})
        self.assertEqual(state["sources"], [module.normalize_reference(self.single_ref)])
        self.assertEqual(module.parse_path_input(f"{self.single_ref}, {self.zip_ref}"), [module.normalize_reference(self.single_ref), module.normalize_reference(self.zip_ref)])

    def test_rejects_no_source(self):
        self.assertEqual(module.QQImagePackageLoader.VALIDATE_INPUTS(package_state='{"sources":[]}'), "请选择图片/图片包，或在 file_path 输入路径")

    def test_contract(self):
        node = module.QQImagePackageLoader
        self.assertEqual(node.RETURN_TYPES, ("IMAGE", "INT", "INT", "QQ_IMAGE_PACKAGE_INFO"))
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
        output = module.QQImagePackageLoader().load(file_path=str(path))
        self.assertEqual(output["result"][0].shape, (1, 4, 4, 3))
        self.assertEqual(output["ui"]["qq_image_package"][0]["current"], "single.png")

    def test_raw_archive_names_and_no_nested_or_unsafe_files(self):
        path = self.root / "names.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("./pages/image2.png", make_image("red"))
            archive.writestr("pages\\image10.png", make_image("blue"))
            archive.writestr("../bad.png", make_image("red"))
            archive.writestr("/absolute.png", make_image("red"))
            archive.writestr("inner.cbz", b"nested")
        output = module.QQImagePackageLoader().load(file_path=str(path), 当前序号=2)
        self.assertEqual(output["result"][1], 2)
        self.assertEqual(output["ui"]["qq_image_package"][0]["current"], "pages/image10.png")
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
        self.assertEqual(result[1:3], (1, 1))

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
        self.assertEqual(result["result"][2:3], (4,))
        self.assertEqual(result["ui"]["qq_image_package"][0]["current"], "img2.png")

    def test_package_info_contract(self):
        result = module.QQImagePackageLoader().load(
            package_state=json.dumps({"sources": [self.zip_ref, self.tar_ref]}),
            当前序号=4,
        )["result"]
        info = result[3]
        self.assertEqual(info.source_index, 2)
        self.assertEqual(info.entry_index, 1)
        self.assertEqual(info.source_total, 2)
        self.assertEqual(info.global_index, 4)
        self.assertEqual(info.total, 5)
        self.assertEqual(info.ui()["member"], "b/img2.png")
        self.assertEqual(module.QQImagePackageSaver.RETURN_TYPES, ("IMAGE", "STRING"))
        self.assertTrue(module.QQImagePackageSaver.OUTPUT_NODE)

    def test_saver_accumulates_zip_by_original_format(self):
        saver = module.QQImagePackageSaver()
        for index in (2, 3):
            loaded = module.QQImagePackageLoader().load(file_path=self.zip_ref, 当前序号=index)["result"]
            edited = torch.full_like(loaded[0], 0.0)
            edited[:, :, :, 0] = 1.0
            saved = saver.save(edited, loaded[3])
            self.assertEqual(saved["result"][1], "qq_image_packages/package_edited.cbz")
        target = self.root / "output" / "qq_image_packages" / "package_edited.cbz"
        with zipfile.ZipFile(target) as archive:
            self.assertEqual(set(archive.namelist()), {"img2.png", "img10.png", "nested/img1.png", "nested.zip", "__MACOSX/junk.png"})
            for member in ("img10.png", "nested/img1.png"):
                with Image.open(io.BytesIO(archive.read(member))) as image:
                    self.assertGreater(image.getpixel((0, 0))[0], 240)
            with Image.open(io.BytesIO(archive.read("img2.png"))) as image:
                self.assertGreater(image.getpixel((0, 0))[2], 240)
            self.assertEqual(archive.read("nested.zip"), b"not extracted")

    def test_saver_routes_multiple_packages_by_format(self):
        saver = module.QQImagePackageSaver()
        zip_loaded = module.QQImagePackageLoader().load(file_path=self.zip_ref, 当前序号=2)["result"]
        tar_loaded = module.QQImagePackageLoader().load(file_path=self.tar_ref, 当前序号=1)["result"]
        red = torch.zeros_like(zip_loaded[0])
        red[:, :, :, 0] = 1.0
        self.assertEqual(saver.save(red, zip_loaded[3])["result"][1], "qq_image_packages/package_edited.cbz")
        self.assertEqual(saver.save(red, tar_loaded[3])["result"][1], "qq_image_packages/package_edited.tar.gz")
        with tarfile.open(self.root / "output" / "qq_image_packages" / "package_edited.tar.gz", "r:gz") as archive:
            with Image.open(archive.extractfile("b/img2.png")) as image:
                self.assertGreater(image.getpixel((0, 0))[0], 240)

    def test_saver_preserves_direct_image_format(self):
        loaded = module.QQImagePackageLoader().load(file_path=self.single_ref)["result"]
        saver = module.QQImagePackageSaver()
        self.assertEqual(saver.save(loaded[0], loaded[3])["result"][1], "qq_image_packages/single_edited.png")
        with Image.open(self.root / "output" / "qq_image_packages" / "single_edited.png") as image:
            self.assertEqual(image.size, (4, 4))

    def test_saver_does_not_require_relpath_across_mounts(self):
        loaded = module.QQImagePackageLoader().load(file_path=self.single_ref)["result"]
        with patch.object(module.os.path, "relpath", side_effect=ValueError("path is on another mount")):
            saved = module.QQImagePackageSaver().save(
                loaded[0], loaded[3], 输出目录="nested/qq", 输出后缀="_mount")
        self.assertEqual(saved["result"][1], "nested/qq/single_mount.png")

    def test_saver_rejects_bad_info_and_respects_no_overwrite(self):
        loaded = module.QQImagePackageLoader().load(file_path=self.zip_ref)["result"]
        with self.assertRaisesRegex(ValueError, "图包信息"):
            module.QQImagePackageSaver().save(loaded[0], {"source": "bad"})
        saver = module.QQImagePackageSaver()
        saver.save(loaded[0], loaded[3], 输出后缀="_lock_test", 覆盖输出=False)
        with self.assertRaises(FileExistsError):
            saver.save(loaded[0], loaded[3], 输出后缀="_lock_test", 覆盖输出=False)

    def test_saver_preserves_plain_gz_tar_format(self):
        path = self.root / "plain-package.gz"
        with tarfile.open(path, "w:gz") as archive:
            data = make_image("green")
            info = tarfile.TarInfo("page.png")
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
        loaded = module.QQImagePackageLoader().load(file_path=str(path))["result"]
        saver = module.QQImagePackageSaver()
        self.assertEqual(saver.save(loaded[0], loaded[3])["result"][1], "qq_image_packages/plain-package_edited.gz")
        with tarfile.open(self.root / "output" / "qq_image_packages" / "plain-package_edited.gz", "r:gz") as archive:
            self.assertEqual(archive.getnames(), ["page.png"])

    def test_saver_separates_sources_with_identical_names(self):
        first = self.root / "first" / "same.cbz"
        second = self.root / "second" / "same.cbz"
        first.parent.mkdir(exist_ok=True)
        second.parent.mkdir(exist_ok=True)
        for path, color in ((first, "red"), (second, "blue")):
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("page.png", make_image(color))
        state = json.dumps({"sources": [str(first), str(second)]})
        saver = module.QQImagePackageSaver()
        outputs = []
        for index in (1, 2):
            loaded = module.QQImagePackageLoader().load(package_state=state, 当前序号=index)["result"]
            outputs.append(saver.save(loaded[0], loaded[3])["result"][1])
        self.assertNotEqual(outputs[0], outputs[1])
        self.assertTrue(all(name.startswith("qq_image_packages/same-") and name.endswith("_edited.cbz") for name in outputs))

    def test_stream_upload_creates_unique_package_files(self):
        async def run():
            async def stream(*chunks):
                for chunk in chunks:
                    yield chunk
            first = await module._save_uploaded_package("../large package.tar.gz", stream(b"abc", b"def"))
            second = await module._save_uploaded_package("large package.tar.gz", stream(b"xyz"))
            return first, second
        first, second = asyncio.run(run())
        self.assertEqual(first["reference"], "qq_image_packages/large package.tar.gz")
        self.assertEqual(second["reference"], "qq_image_packages/large package-2.tar.gz")
        self.assertEqual((self.root / "qq_image_packages" / "large package.tar.gz").read_bytes(), b"abcdef")
        async def empty_stream():
            return
            yield b""

        with self.assertRaisesRegex(ValueError, "仅支持"):
            asyncio.run(module._save_uploaded_package("video.mp4", empty_stream()))


if __name__ == "__main__":
    unittest.main()
