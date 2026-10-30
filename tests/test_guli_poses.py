"""QQ-预制图像参考：用户目录约束、目录即索引、多选拼批次与导入删除。"""

from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path

MODULE_DIR = Path(__file__).resolve().parents[1] / "node_modules"
sys.path.insert(0, str(MODULE_DIR))


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, MODULE_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


db = _load("guli_db_under_test", "guli_pose_db.py")
# guli_poses 里 `import guli_pose_db as db` 会再建一个实例；塞进 sys.modules 让它复用同一份
sys.modules["guli_pose_db"] = db
poses = _load("guli_nodes_under_test", "guli_poses.py")
assert poses.db is db


def _write_png(path: Path, colour=(200, 40, 40), size=(32, 48)) -> None:
    from PIL import Image

    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, colour).save(path, "PNG")


class _Sandbox(unittest.TestCase):
    """每个用例一份独立的用户目录（用环境变量换根，模拟真实部署）。"""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name) / "GuliPoses"
        self._old = os.environ.get("QQ_GULI_POSES_DIR")
        os.environ["QQ_GULI_POSES_DIR"] = str(self.root)
        for lib in db.LIB_KEYS:
            db.invalidate(lib)

    def tearDown(self):
        if self._old is None:
            os.environ.pop("QQ_GULI_POSES_DIR", None)
        else:
            os.environ["QQ_GULI_POSES_DIR"] = self._old
        for lib in db.LIB_KEYS:
            db.invalidate(lib)


class UserDirectoryTests(_Sandbox):
    def test_three_libraries_are_pose_face_cloth(self):
        self.assertEqual(db.LIB_KEYS, ("pose", "face", "cloth"))

    def test_root_follows_the_env_override(self):
        self.assertEqual(db.root(), self.root)

    def test_every_library_lives_under_the_user_directory(self):
        node_dir = MODULE_DIR.resolve()
        for lib in db.LIB_KEYS:
            path = db.img_dir(lib)
            self.assertTrue(str(path).startswith(str(self.root)), msg=lib)
            self.assertFalse(str(path.resolve()).startswith(str(node_dir)), msg=lib)

    def test_no_index_file_is_written(self):
        _write_png(db.img_dir("pose") / "p1.png")
        db.scan("pose")
        self.assertFalse((db.lib_dir("pose") / "index.json").exists())

    def test_no_inbox_or_custom_directories_are_created(self):
        _write_png(db.img_dir("face") / "f1.png")
        db.scan("face")
        for unwanted in ("inbox", "custom", "png"):
            self.assertFalse((db.lib_dir("face") / unwanted).exists(), msg=unwanted)


class ScanTests(_Sandbox):
    def test_empty_library_is_not_fatal(self):
        self.assertEqual(db.scan("pose")["items"], [])

    def test_images_are_listed(self):
        _write_png(db.img_dir("pose") / "站立.png")
        self.assertEqual([item["label"] for item in db.scan("pose")["items"]], ["站立"])

    def test_scan_picks_up_new_files_without_restart(self):
        _write_png(db.img_dir("cloth") / "外套.png")
        self.assertEqual(len(db.scan("cloth")["items"]), 1)
        _write_png(db.img_dir("cloth") / "裤子.png", colour=(20, 90, 200))
        self.assertEqual(len(db.scan("cloth")["items"]), 2)

    def test_angle_suffix_groups_into_one_item(self):
        _write_png(db.img_dir("pose") / "姿势A_front.png")
        _write_png(db.img_dir("pose") / "姿势A_side.png", colour=(10, 200, 10))
        items = db.scan("pose")["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(set(items[0]["angles"]), {"front", "side"})

    def test_single_angle_library_keeps_whole_name(self):
        _write_png(db.img_dir("face") / "face_side.png")
        self.assertEqual([item["label"] for item in db.scan("face")["items"]], ["face_side"])

    def test_duplicate_names_get_a_suffix(self):
        _write_png(db.img_dir("face") / "同名_front.png")
        _write_png(db.img_dir("face") / "同名_正面.png")
        self.assertEqual(len(db.scan("face")["items"]), 2)

    def test_non_image_files_are_ignored(self):
        db.img_dir("pose").mkdir(parents=True, exist_ok=True)
        (db.img_dir("pose") / "notes.txt").write_text("x", encoding="utf-8")
        self.assertEqual(db.scan("pose")["items"], [])


class RenameTests(_Sandbox):
    """garment/ 这个旧库名要能并进 cloth/。"""

    def test_old_garment_directory_is_merged_into_cloth(self):
        legacy = self.root / "garment" / "img"
        legacy.mkdir(parents=True)
        (legacy / "外套.png").write_bytes(b"x")

        labels = [item["label"] for item in db.scan("cloth")["items"]]

        self.assertEqual(labels, ["外套"])
        self.assertTrue((db.img_dir("cloth") / "外套.png").is_file())
        self.assertFalse((self.root / "garment").exists())

    def test_merge_does_not_overwrite(self):
        (db.img_dir("cloth") / "同名.png").parent.mkdir(parents=True)
        (db.img_dir("cloth") / "同名.png").write_bytes(b"new")
        legacy = self.root / "garment" / "img"
        legacy.mkdir(parents=True)
        (legacy / "同名.png").write_bytes(b"old")

        db.scan("cloth")

        self.assertEqual((db.img_dir("cloth") / "同名.png").read_bytes(), b"new")
        self.assertTrue((db.img_dir("cloth") / "同名 (2).png").is_file())


class MigrationTests(_Sandbox):
    """旧版 custom/ 与 png/ 也要能并入 img/。"""

    def test_legacy_custom_is_moved_into_img(self):
        legacy = db.lib_dir("pose") / "custom"
        legacy.mkdir(parents=True)
        (legacy / "旧姿态.png").write_bytes(b"x")
        (legacy / "thumbs").mkdir()
        (legacy / "thumbs" / "旧姿态.jpg").write_bytes(b"y")

        db.scan("pose")

        self.assertTrue((db.img_dir("pose") / "旧姿态.png").is_file())
        self.assertFalse(legacy.exists())


class PickTests(_Sandbox):
    def _is_blocked(self, value) -> bool:
        return value is None or type(value).__name__ == "ExecutionBlocker"

    def test_empty_selection_blocks_the_single_output(self):
        out = poses.QQGuliPosePicker().pick("", "", "")
        self.assertEqual(len(out), 1)
        self.assertTrue(self._is_blocked(out[0]))

    def test_one_type_returns_a_batch_of_one(self):
        _write_png(db.img_dir("pose") / "站立.png")
        out = poses.QQGuliPosePicker().pick("站立", "", "")
        self.assertEqual(tuple(out[0].shape), (1, 48, 32, 3))

    def test_multiple_selections_are_stacked_in_click_order(self):
        _write_png(db.img_dir("pose") / "甲.png", size=(16, 16))
        _write_png(db.img_dir("pose") / "乙.png", size=(16, 16))
        out = poses.QQGuliPosePicker().pick("乙|甲", "", "")
        self.assertEqual(tuple(out[0].shape), (2, 16, 16, 3))

    def test_lane_order_is_pose_face_cloth(self):
        _write_png(db.img_dir("pose") / "p.png", colour=(255, 0, 0), size=(8, 8))
        _write_png(db.img_dir("face") / "f.png", colour=(0, 255, 0), size=(8, 8))
        _write_png(db.img_dir("cloth") / "c.png", colour=(0, 0, 255), size=(8, 8))
        batch = poses.QQGuliPosePicker().pick("p", "f", "c")[0]
        self.assertEqual(tuple(batch.shape), (3, 8, 8, 3))
        reds = [float(batch[index, 0, 0, 0]) for index in range(3)]
        self.assertAlmostEqual(reds[0], 1.0, places=2)
        self.assertAlmostEqual(reds[1], 0.0, places=2)
        self.assertAlmostEqual(reds[2], 0.0, places=2)

    def test_mismatched_sizes_are_scaled_to_the_first_image(self):
        _write_png(db.img_dir("pose") / "大.png", size=(40, 20))
        _write_png(db.img_dir("pose") / "小.png", size=(10, 10))
        batch = poses.QQGuliPosePicker().pick("大|小", "", "")
        self.assertEqual(tuple(batch[0].shape), (2, 20, 40, 3))

    def test_stale_label_is_skipped_without_killing_the_batch(self):
        _write_png(db.img_dir("pose") / "站立.png")
        batch = poses.QQGuliPosePicker().pick("已经删掉的条目|站立", "", "")
        self.assertEqual(tuple(batch[0].shape), (1, 48, 32, 3))

    def test_duplicates_in_the_value_collapse(self):
        _write_png(db.img_dir("pose") / "站立.png")
        batch = poses.QQGuliPosePicker().pick("站立|站立", "", "")
        self.assertEqual(tuple(batch[0].shape), (1, 48, 32, 3))

    def test_pose_angle_is_honoured(self):
        _write_png(db.img_dir("pose") / "姿势A_front.png", colour=(255, 0, 0), size=(8, 8))
        _write_png(db.img_dir("pose") / "姿势A_side.png", colour=(0, 0, 255), size=(8, 8))
        batch = poses.QQGuliPosePicker().pick("姿势A", "", "", "侧面")
        self.assertAlmostEqual(float(batch[0][0, 0, 0, 2]), 1.0, places=2)

    def test_missing_angle_falls_back_to_front(self):
        _write_png(db.img_dir("pose") / "只有正面_front.png", colour=(255, 0, 0), size=(8, 8))
        batch = poses.QQGuliPosePicker().pick("只有正面", "", "", "俯视")
        self.assertAlmostEqual(float(batch[0][0, 0, 0, 0]), 1.0, places=2)

    def test_angle_key_accepts_chinese_and_english(self):
        self.assertEqual(db.angle_key("pose", "侧面"), "side")
        self.assertEqual(db.angle_key("pose", "side"), "side")
        self.assertIsNone(db.angle_key("pose", "不存在"))
        self.assertIsNone(db.angle_key("pose", ""))

    def test_contract_is_a_single_image_output(self):
        node = poses.QQGuliPosePicker
        self.assertEqual(node.RETURN_TYPES, ("IMAGE",))
        self.assertEqual(node.RETURN_NAMES, ("参考图",))
        self.assertEqual(node.CATEGORY, "QQ/图库")
        self.assertEqual(
            list(node.INPUT_TYPES()["required"]), ["姿态", "脸模", "服装", "姿态角度"]
        )


class ImportTests(_Sandbox):
    def test_upload_lands_in_the_user_directory(self):
        name = db.save_upload("pose", "my pose.png", b"fake-bytes")
        self.assertTrue((db.img_dir("pose") / name).is_file())

    def test_upload_rejects_unknown_extension(self):
        with self.assertRaises(ValueError):
            db.save_upload("pose", "a.exe", b"x")

    def test_upload_never_overwrites(self):
        first = db.save_upload("face", "same.png", b"1")
        second = db.save_upload("face", "same.png", b"2")
        self.assertNotEqual(first, second)

    def test_delete_removes_image_and_thumb(self):
        from PIL import Image

        name = db.save_upload("cloth", "coat.png", b"x")
        path = db.img_dir("cloth") / name
        Image.new("RGB", (8, 8), (1, 2, 3)).save(path, "PNG")
        thumb = db.ensure_thumb("cloth", name)
        self.assertIsNotNone(thumb)
        self.assertTrue(db.delete("cloth", name))
        self.assertFalse(path.exists())
        self.assertFalse(thumb.exists())

    def test_delete_refuses_paths_outside_the_library(self):
        self.assertFalse(db.delete("pose", "../escape.png"))
        self.assertFalse(db.delete("pose", ""))


class RegistrationTests(unittest.TestCase):
    def test_node_is_registered_under_the_qq_namespace(self):
        self.assertIn("QQGuliPosePicker", poses.NODE_CLASS_MAPPINGS)
        self.assertEqual(
            poses.NODE_DISPLAY_NAME_MAPPINGS["QQGuliPosePicker"], "QQ-预制图像参考"
        )

    def test_routes_cover_every_library(self):
        routes = _load("guli_api_reg", "guli_api.py")
        self.assertTrue(routes.PREFIX.startswith("/qq_gulipose"))
        # 注册函数必须吞掉所有异常（导入期不能炸）
        routes.register()


if __name__ == "__main__":
    unittest.main()
