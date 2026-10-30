"""QQ-姿态库：索引、取图范围、导入删除与用户目录约束。"""

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

_MODULES_DIR = Path(__file__).resolve().parents[1] / "node_modules"
sys.path.insert(0, str(_MODULES_DIR))


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, _MODULES_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


db = _load("wysl_guli_pose_db_test", "guli_pose_db.py")
# guli_poses 内部 `import guli_pose_db as db` 会另建一个模块实例，那样测试改的
# USER_ROOT / LIB_DIRS 对节点不可见；先把它塞进 sys.modules 让两边共用同一份。
sys.modules["guli_pose_db"] = db
poses = _load("wysl_guli_poses_test", "guli_poses.py")
assert poses.db is db


def _write_png(path: Path, colour=(200, 40, 40), size=(32, 48)) -> None:
    from PIL import Image

    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, colour).save(path, "PNG")


class UserDataRootTests(unittest.TestCase):
    """用户素材必须落在 ComfyUI 的 user 目录里，不在插件目录内。"""

    def test_env_override_wins(self):
        with mock.patch.dict(os.environ, {"QQ_GULI_POSES_DIR": str(Path(tempfile.gettempdir()) / "qqgp")}):
            self.assertEqual(db.user_root(), Path(tempfile.gettempdir()) / "qqgp")

    def test_falls_back_under_the_comfy_user_directory(self):
        with mock.patch.dict(os.environ, {"QQ_GULI_POSES_DIR": ""}):
            stub = mock.Mock()
            stub.get_user_directory = lambda: r"C:\ComfyUI\user"
            with mock.patch.dict(sys.modules, {"folder_paths": stub}):
                root = db.user_root()
        self.assertEqual(root, Path(r"C:\ComfyUI\user") / "QQ_ComfyUI_Tools" / "GuliPoses")

    def test_lib_dirs_are_outside_the_plugin(self):
        root = db.custom_dir("pose").resolve()
        saved = db.USER_ROOT
        try:
            db.USER_ROOT = Path("C:/ComfyUI/user/QQ_ComfyUI_Tools/GuliPoses")
            outside = db.custom_dir("pose").resolve()
        finally:
            db.USER_ROOT = saved
        self.assertEqual(outside, Path("C:/ComfyUI/user/QQ_ComfyUI_Tools/GuliPoses/pose/custom").resolve())
        self.assertNotIn(Path("node_modules").resolve(), outside.parents)
        self.assertTrue(root)  # 兜底路径也总能算出来


class _Sandbox(unittest.TestCase):
    """把用户数据根目录与内置库都指到临时目录，避免碰到真实环境。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self._saved_root = db.USER_ROOT
        self._saved_libs = {lib: dict(cfg) for lib, cfg in db.LIB_DIRS.items()}
        db.USER_ROOT = self.root
        base = self.root / "builtin"
        db.LIB_DIRS["pose"].update(
            {
                "builtin": base / "img",
                "index": base / "index.json",
                "thumb": base / "thumbs",
            }
        )
        base.mkdir(parents=True, exist_ok=True)
        self._poses = []
        db._builtin_cache.pop("pose", None)
        db._custom_cache.pop("pose", None)

    def tearDown(self):
        db.USER_ROOT = self._saved_root
        db.LIB_DIRS.clear()
        db.LIB_DIRS.update(self._saved_libs)
        db._builtin_cache.clear()
        db._custom_cache.clear()
        self.tmp.cleanup()

    def add_builtin_pose(self, stem="P001", angles=("front", "side"), cat="站立"):
        """往内置库加一条姿态；多次调用是累加，不是覆盖。"""
        cfg = db._cfg("pose")
        entries = {}
        for angle in angles:
            img = f"{stem}_{angle}.webp"
            _write_png(cfg["builtin"] / img)
            entries[angle] = {"img": img, "thumb": f"{stem}_{angle}.jpg"}
        poses_list = list(self._poses)
        poses_list.append(
            {
                "no": f"S1/{stem}",
                "root": "builtin",
                "series": "S1",
                "code": stem,
                "cat": cat,
                "name": stem,
                "angles": entries,
                "label": f"系列一 {stem}",
            }
        )
        self.write_index(poses_list, series=[{"key": "S1", "name": "系列一", "short": "一", "count": len(poses_list)}])

    def write_index(self, poses_list, series):
        self._poses = list(poses_list)
        cfg = db._cfg("pose")
        cfg["index"].parent.mkdir(parents=True, exist_ok=True)
        cfg["index"].write_text(
            json.dumps(
                {
                    "generated": "2026-01-01 00:00:00",
                    "series": series,
                    "angles": [{"key": k, "label": v} for k, v in db.ANGLE_LABELS.items()],
                    "poses": poses_list,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        db._builtin_cache.pop("pose", None)


class IndexTests(_Sandbox):
    def test_empty_library_still_answers(self):
        data = db.index("pose")
        self.assertEqual(data["poses"], [])
        self.assertEqual(db.pose_labels("pose"), [])

    def test_builtin_poses_are_listed(self):
        self.add_builtin_pose()
        self.assertEqual(db.pose_labels("pose"), ["系列一 P001"])
        self.assertEqual(db.series_options("pose"), [db.ALL, "系列一"])
        self.assertEqual(db.category_options("pose"), [db.ALL, "站立"])
    def test_custom_poses_come_first(self):
        self.add_builtin_pose()
        _write_png(self.root / "pose" / "custom" / "mine.png")
        labels = db.pose_labels("pose")
        self.assertEqual(labels[0], f"{db.CUSTOM_SERIES_NAME} · mine")
        self.assertIn("系列一 P001", labels)

    def test_missing_index_is_not_fatal(self):
        cfg = db.LIB_DIRS["pose"]
        cfg["index"].unlink(missing_ok=True)
        db._builtin_cache.clear()
        self.assertEqual(db.index("pose")["poses"], [])


class PickTests(_Sandbox):
    def test_fixed_mode_reads_the_chosen_angle(self):
        self.add_builtin_pose()
        out = poses.QQGuliPosePicker().pick("固定选中", "系列一 P001", "侧面", db.ALL, db.ALL)
        image = out["result"][0]
        self.assertEqual(tuple(image.shape[-3:-1]), (48, 32))
        self.assertEqual(out["ui"]["picked"][0]["angle"], "side")

    def test_random_angle_stays_inside_the_pose(self):
        self.add_builtin_pose()
        seen = set()
        for _ in range(24):
            out = poses.QQGuliPosePicker().pick("固定选中", "系列一 P001", db.RANDOM_ANGLE, db.ALL, db.ALL)
            seen.add(out["ui"]["picked"][0]["angle"])
        self.assertTrue(seen <= {"front", "side"})
        self.assertTrue(seen)

    def test_range_random_only_uses_the_filter(self):
        self.add_builtin_pose()
        self.add_builtin_pose(stem="P002")
        cfg = db.LIB_DIRS["pose"]
        data = json.loads(cfg["index"].read_text(encoding="utf-8"))
        data["poses"][1]["cat"] = "坐姿"
        data["poses"][1]["label"] = "系列一 P002"
        cfg["index"].write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        db._builtin_cache.pop("pose", None)
        for _ in range(8):
            out = poses.QQGuliPosePicker().pick("范围内随机", "系列一 P001", "正面", db.ALL, "坐姿")
            self.assertEqual(out["ui"]["picked"][0]["label"], "系列一 P002")

    def test_empty_library_raises_a_clear_error(self):
        with self.assertRaises(db.PoseDBMissing) as ctx:
            poses.QQGuliPosePicker().pick("全库随机", db.EMPTY_HINT, "正面", db.ALL, db.ALL)
        self.assertIn("空的", str(ctx.exception))

    def test_is_changed_forces_reroll_only_when_random(self):
        changed = poses.QQGuliPosePicker.IS_CHANGED
        self.assertEqual(changed(模式="固定选中", 视角="正面"), "")
        self.assertNotEqual(changed(模式="全库随机", 视角="正面"),
                            changed(模式="全库随机", 视角="正面"))  # NaN
        nan = changed(模式="固定选中", 视角=db.RANDOM_ANGLE)
        self.assertNotEqual(nan, nan)

    def test_duplicate_labels_are_collapsed_per_angle(self):
        custom = db.custom_dir("pose")
        _write_png(custom / "mine_front.png")
        _write_png(custom / "mine_side.png")
        poses_list = db._scan_custom("pose")
        self.assertEqual(len(poses_list), 1)
        self.assertEqual(set(poses_list[0]["angles"]), {"front", "side"})


class ImportTests(_Sandbox):
    def test_save_writes_into_the_user_directory_and_indexes(self):
        from PIL import Image

        buffer = __import__("io").BytesIO()
        Image.new("RGB", (20, 30), (10, 200, 90)).save(buffer, "PNG")
        name = db.save_custom("照片.png", buffer.getvalue(), "我的姿态", "站姿", "side")
        self.assertTrue((db.custom_dir("pose") / name).is_file())
        labels = db.pose_labels("pose")  # 读索引时按需生成缩略图
        self.assertTrue((db.custom_dir("pose") / "thumbs" / f"{Path(name).stem}.jpg").is_file())
        self.assertIn(f"{db.CUSTOM_SERIES_NAME} · 我的姿态", labels)

    def test_filename_is_sanitised_and_deduplicated(self):
        data = b"\x89PNG\r\n\x1a\n"
        first = db.save_custom("../../evil.png", data)
        second = db.save_custom("../../evil.png", data)
        for name in (first, second):
            self.assertEqual(Path(name).parent, Path("."))
            self.assertNotIn("..", name)
        self.assertNotEqual(first, second)

    def test_delete_removes_image_thumb_and_meta(self):
        data = b"\x89PNG\r\n\x1a\n"
        name = db.save_custom("gone.png", data, "要删的")
        self.assertTrue(db.delete_custom(name))
        self.assertFalse((db.custom_dir("pose") / name).exists())
        self.assertNotIn(f"{db.CUSTOM_SERIES_NAME} · 要删的", db.pose_labels("pose"))

    def test_delete_refuses_paths_outside_custom(self):
        self.assertFalse(db.delete_custom("../png/whatever.png"))
        self.assertFalse(db.delete_custom(""))

    def test_missing_angle_falls_back_to_front(self):
        self.add_builtin_pose(angles=("front",))
        out = poses.QQGuliPosePicker().pick("固定选中", "系列一 P001", "俯视", db.ALL, db.ALL)
        self.assertEqual(out["ui"]["picked"][0]["angle"], "front")


class RegistrationTests(unittest.TestCase):
    def test_node_is_registered_under_the_qq_namespace(self):
        self.assertIn("QQGuliPosePicker", poses.NODE_CLASS_MAPPINGS)
        self.assertEqual(poses.NODE_DISPLAY_NAME_MAPPINGS["QQGuliPosePicker"], "QQ-姿态库")
        self.assertEqual(poses.QQGuliPosePicker.CATEGORY, "QQ/图库")

    def test_inputs_are_all_chinese_and_well_formed(self):
        required = poses.QQGuliPosePicker.INPUT_TYPES()["required"]
        self.assertEqual(
            list(required), ["模式", "姿态", "视角", "筛选系列", "筛选分类"]
        )
        modes, opts = required["模式"]
        self.assertEqual(modes, poses.MODES)
        self.assertEqual(opts["default"], poses.MODE_FIXED)
        self.assertIn(db.RANDOM_ANGLE, required["视角"][0])
        # 空库也必须给一个占位项，否则节点注册失败
        self.assertTrue(required["姿态"][0])


if __name__ == "__main__":
    unittest.main()
