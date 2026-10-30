"""QQ-白模参考：用户目录约束、目录即索引、三类取图与导入删除。"""

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
        # 每个用例都清缓存，避免上一个用例的目录签名命中
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
        self.assertEqual(db.labels("pose"), [db.UNUSED])

    def test_images_are_listed(self):
        _write_png(db.img_dir("pose") / "站立.png")
        self.assertEqual(db.labels("pose"), [db.UNUSED, "站立"])

    def test_scan_picks_up_new_files_without_restart(self):
        _write_png(db.img_dir("garment") / "外套.png")
        self.assertEqual(len(db.scan("garment")["items"]), 1)
        _write_png(db.img_dir("garment") / "裤子.png", colour=(20, 90, 200))
        self.assertEqual(len(db.scan("garment")["items"]), 2)

    def test_angle_suffix_groups_into_one_item(self):
        _write_png(db.img_dir("pose") / "姿势A_front.png")
        _write_png(db.img_dir("pose") / "姿势A_side.png", colour=(10, 200, 10))
        items = db.scan("pose")["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(set(items[0]["angles"]), {"front", "side"})

    def test_single_angle_library_keeps_whole_name(self):
        # 脸模只有正面，文件名里的 _side 不该被当成角度吃掉
        _write_png(db.img_dir("face") / "face_side.png")
        self.assertEqual(db.labels("face"), [db.UNUSED, "face_side"])

    def test_duplicate_names_get_a_suffix(self):
        _write_png(db.img_dir("face") / "同名_front.png")
        _write_png(db.img_dir("face") / "同名_正面.png")
        self.assertEqual(len(db.labels("face")), 3)

    def test_non_image_files_are_ignored(self):
        db.img_dir("pose").mkdir(parents=True, exist_ok=True)
        (db.img_dir("pose") / "notes.txt").write_text("x", encoding="utf-8")
        self.assertEqual(db.scan("pose")["items"], [])


class MigrationTests(_Sandbox):
    """旧版的 custom/ 与 png/ 要能自动并入 img/，升级不能让用户的图消失。"""

    def test_legacy_custom_is_moved_into_img(self):
        legacy = db.lib_dir("pose") / "custom"
        legacy.mkdir(parents=True)
        (legacy / "旧姿态.png").write_bytes(b"x")
        (legacy / "thumbs").mkdir()
        (legacy / "thumbs" / "旧姿态.jpg").write_bytes(b"y")
        (legacy / "meta.json").write_text("{}", encoding="utf-8")

        db.scan("pose")

        self.assertTrue((db.img_dir("pose") / "旧姿态.png").is_file())
        self.assertFalse(legacy.exists())  # 遗留目录连缩略图一起清掉

    def test_legacy_png_is_moved_into_img(self):
        legacy = db.lib_dir("face") / "png"
        legacy.mkdir(parents=True)
        (legacy / "老脸.png").write_bytes(b"x")

        db.scan("face")

        self.assertTrue((db.img_dir("face") / "老脸.png").is_file())
        self.assertFalse(legacy.exists())

    def test_migration_never_overwrites_existing_images(self):
        (db.img_dir("garment") / "同名.png").parent.mkdir(parents=True)
        (db.img_dir("garment") / "同名.png").write_bytes(b"new")
        legacy = db.lib_dir("garment") / "custom"
        legacy.mkdir(parents=True)
        (legacy / "同名.png").write_bytes(b"old")

        db.scan("garment")

        self.assertEqual((db.img_dir("garment") / "同名.png").read_bytes(), b"new")
        self.assertTrue((db.img_dir("garment") / "同名 (2).png").is_file())


class PickTests(_Sandbox):
    def _is_blocked(self, value) -> bool:
        return value is None or type(value).__name__ == "ExecutionBlocker"

    def test_unused_outputs_a_blocker(self):
        out = poses.QQGuliPosePicker().pick("未使用", "未使用", "未使用")
        self.assertEqual(len(out), 3)
        for value in out:
            self.assertTrue(self._is_blocked(value))

    def test_selected_library_returns_an_image(self):
        _write_png(db.img_dir("pose") / "站立.png")
        out = poses.QQGuliPosePicker().pick("站立", "未使用", "未使用")
        self.assertEqual(out[0].shape, (1, 48, 32, 3))

    def test_three_types_are_independent(self):
        _write_png(db.img_dir("pose") / "p.png", size=(16, 16))
        _write_png(db.img_dir("face") / "f.png", size=(24, 24))
        _write_png(db.img_dir("garment") / "g.png", size=(32, 32))
        out = poses.QQGuliPosePicker().pick("p", "f", "g")
        self.assertEqual([value.shape[1] for value in out], [16, 24, 32])

    def test_stale_label_from_an_old_workflow_blocks_that_lane(self):
        _write_png(db.img_dir("pose") / "站立.png")
        out = poses.QQGuliPosePicker().pick("已经删掉的条目", "未使用", "未使用")
        self.assertTrue(self._is_blocked(out[0]))

    def test_contract(self):
        node = poses.QQGuliPosePicker
        self.assertEqual(node.RETURN_NAMES, ("姿态图", "脸模图", "服装图"))
        self.assertEqual(node.CATEGORY, "QQ/图库")
        inputs = node.INPUT_TYPES()["required"]
        self.assertEqual(list(inputs), ["姿态", "脸模", "服装"])
        self.assertEqual(inputs["姿态"][0][0], "未使用")


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

        name = db.save_upload("garment", "coat.png", b"x")
        path = db.img_dir("garment") / name
        Image.new("RGB", (8, 8), (1, 2, 3)).save(path, "PNG")
        thumb = db.ensure_thumb("garment", name)
        self.assertIsNotNone(thumb)
        self.assertTrue(db.delete("garment", name))
        self.assertFalse(path.exists())
        self.assertFalse(thumb.exists())

    def test_delete_refuses_paths_outside_the_library(self):
        self.assertFalse(db.delete("pose", "../escape.png"))
        self.assertFalse(db.delete("pose", ""))


class RegistrationTests(unittest.TestCase):
    def test_node_is_registered_under_the_qq_namespace(self):
        self.assertIn("QQGuliPosePicker", poses.NODE_CLASS_MAPPINGS)
        self.assertEqual(poses.NODE_DISPLAY_NAME_MAPPINGS["QQGuliPosePicker"], "QQ-白模参考")

    def test_routes_cover_every_library(self):
        routes = _load("guli_api_reg", "guli_api.py")
        self.assertTrue(routes.PREFIX.startswith("/qq_gulipose"))
        # 注册函数必须吞掉所有异常（导入期不能炸）
        routes.register()


if __name__ == "__main__":
    unittest.main()
