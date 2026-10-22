"""Tests for the per-image paint mask store."""

import importlib.util
import io
import pathlib
import sys
import tempfile
import unittest

from PIL import Image

_MODULES = pathlib.Path(__file__).resolve().parent.parent / "node_modules"


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PaintMaskTests(unittest.TestCase):
    """Masks are keyed by image path and default to "keep everything"."""

    def setUp(self):
        self.mask = _load("paint_mask_test", _MODULES / "paint_mask.py")
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.input_dir = self.root / "input"
        self.user_dir = self.root / "user"
        self.temp_dir = self.root / "temp"
        for directory in (self.input_dir, self.user_dir, self.temp_dir):
            directory.mkdir(parents=True, exist_ok=True)

        stub = type(sys)("folder_paths")
        stub.get_input_directory = lambda: str(self.input_dir)
        stub.get_user_directory = lambda: str(self.user_dir)
        stub.get_temp_directory = lambda: str(self.temp_dir)
        self._previous = sys.modules.get("folder_paths")
        sys.modules["folder_paths"] = stub

    def tearDown(self):
        if self._previous is not None:
            sys.modules["folder_paths"] = self._previous
        else:
            sys.modules.pop("folder_paths", None)
        self.temp.cleanup()

    def _png(self, size=(6, 4), left_white=True):
        image = Image.new("L", size, 0)
        if left_white:
            for x in range(size[0] // 2):
                for y in range(size[1]):
                    image.putpixel((x, y), 255)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()

    # -- defaults ---------------------------------------------------------
    def test_no_mask_keeps_everything(self):
        tensor = self.mask.load_mask_tensor("a.png", 4, 6)
        self.assertEqual(tuple(tensor.shape), (1, 4, 6))
        self.assertEqual(float(tensor.min()), 1.0)
        self.assertEqual(float(tensor.max()), 1.0)

    def test_a_key_is_stable_and_path_based(self):
        self.assertEqual(self.mask.mask_key("a.png"), self.mask.mask_key("a.png"))
        self.assertNotEqual(self.mask.mask_key("a.png"), self.mask.mask_key("b.png"))
        # Backslashes and a leading slash describe the same file.
        self.assertEqual(self.mask.mask_key("/a.png"), self.mask.mask_key("a.png"))
        self.assertEqual(
            self.mask.mask_key("sub\\a.png"),
            self.mask.mask_key("sub/a.png"),
        )

    # -- round trip -------------------------------------------------------
    def test_save_then_load(self):
        self.assertTrue(self.mask.save_mask_png("a.png", self._png()))
        self.assertTrue(self.mask.mask_exists("a.png"))
        tensor = self.mask.load_mask_tensor("a.png", 4, 6)
        self.assertEqual(float(tensor[0][0][0]), 1.0)
        self.assertEqual(float(tensor[0][0][5]), 0.0)

    def test_a_size_mismatch_is_resized(self):
        self.mask.save_mask_png("a.png", self._png())
        tensor = self.mask.load_mask_tensor("a.png", 8, 12)
        self.assertEqual(tuple(tensor.shape), (1, 8, 12))

    def test_delete(self):
        self.mask.save_mask_png("a.png", self._png())
        self.assertTrue(self.mask.delete_mask("a.png"))
        self.assertFalse(self.mask.mask_exists("a.png"))
        self.assertFalse(self.mask.delete_mask("a.png"))

    def test_a_broken_upload_is_refused(self):
        self.assertIsNone(self.mask.save_mask_png("a.png", b"not a png"))

    def test_traversal_is_refused(self):
        self.assertIsNone(self.mask.mask_path("../outside.png"))
        self.assertIsNone(self.mask.mask_path("../../etc/passwd"))
        self.assertIsNone(self.mask.mask_path(""))

    # -- the alpha copy for a plain LoadImage -----------------------------
    def test_the_masked_copy_carries_the_layer_as_alpha(self):
        Image.new("RGB", (6, 4), (255, 0, 0)).save(self.input_dir / "b.png")
        self.mask.save_mask_png("b.png", self._png())
        reference = self.mask.write_masked_copy("b.png")
        self.assertIsNotNone(reference)
        # The widget value must point at temp, or LoadImage looks in input.
        self.assertTrue(reference.endswith(" [temp]"), reference)
        name = reference[: -len(" [temp]")]
        self.assertIn("_qqmask_", name)
        self.assertTrue((self.temp_dir / name).is_file())
        # Nothing was written into the user's input directory.
        self.assertEqual(
            sorted(p.name for p in self.input_dir.iterdir()),
            ["b.png"],
        )
        with Image.open(self.temp_dir / name) as made:
            self.assertEqual(made.mode, "RGBA")
            self.assertEqual(made.size, (6, 4))
            # Left half kept opaque, right half cut away.
            self.assertEqual(made.getpixel((0, 0))[3], 255)
            self.assertEqual(made.getpixel((5, 0))[3], 0)

    def test_the_original_file_is_never_touched(self):
        Image.new("RGB", (6, 4), (255, 0, 0)).save(self.input_dir / "b.png")
        before = (self.input_dir / "b.png").read_bytes()
        self.mask.save_mask_png("b.png", self._png())
        self.mask.write_masked_copy("b.png")
        self.assertEqual((self.input_dir / "b.png").read_bytes(), before)

    def test_a_masked_copy_of_a_missing_file_is_none(self):
        self.assertIsNone(self.mask.write_masked_copy("nope.png"))

    def test_generated_copies_can_be_swept(self):
        Image.new("RGB", (6, 4), (255, 0, 0)).save(self.input_dir / "b.png")
        self.mask.save_mask_png("b.png", self._png())
        self.mask.write_masked_copy("b.png")
        self.assertEqual(len(list(self.temp_dir.glob("*_qqmask_*.png"))), 1)
        self.assertEqual(self.mask.clear_masked_copies(), 1)
        self.assertEqual(list(self.temp_dir.glob("*_qqmask_*.png")), [])

    def test_sweeping_one_picture_leaves_the_others(self):
        for name in ("b.png", "c.png"):
            Image.new("RGB", (6, 4), (255, 0, 0)).save(self.input_dir / name)
            self.mask.save_mask_png(name, self._png())
            self.mask.write_masked_copy(name)
        self.assertEqual(self.mask.clear_masked_copies("b.png"), 1)
        left = [path.name for path in self.temp_dir.glob("*_qqmask_*.png")]
        self.assertEqual(left, [self.mask.masked_image_filename("c.png")])

    def test_the_mask_store_lives_outside_input(self):
        self.mask.save_mask_png("b.png", self._png())
        stored = pathlib.Path(self.mask.mask_path("b.png"))
        self.assertTrue(stored.is_file())
        self.assertNotIn(str(self.input_dir), str(stored))
        self.assertIn(str(self.user_dir), str(stored))

    # -- change detection -------------------------------------------------
    def test_the_signature_changes_when_the_mask_changes(self):
        self.assertIsNone(self.mask.mask_signature("a.png"))
        self.mask.save_mask_png("a.png", self._png())
        first = self.mask.mask_signature("a.png")
        self.assertIsNotNone(first)
        self.mask.save_mask_png("a.png", self._png(left_white=False))
        second = self.mask.mask_signature("a.png")
        self.assertNotEqual(first, second)


if __name__ == "__main__":
    unittest.main()
