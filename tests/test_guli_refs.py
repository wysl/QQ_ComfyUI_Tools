"""共享的「选择令牌 → 图片批次」实现（QQ-预制图像参考 与 QQ-多媒体加载 共用）。"""

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


db = _load("guli_db_refs_test", "guli_pose_db.py")
sys.modules["guli_pose_db"] = db


def _write_png(path: Path, colour=(200, 40, 40), size=(32, 48)) -> None:
    from PIL import Image

    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, colour).save(path, "PNG")


class _Sandbox(unittest.TestCase):
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


class TokenTests(_Sandbox):
    def test_split_tokens_dedupes_and_keeps_order(self):
        self.assertEqual(db.split_tokens("甲|乙|甲| |未使用"), ["甲", "乙"])
        self.assertEqual(db.split_tokens(""), [])
        self.assertEqual(db.split_tokens(None), [])

    def test_split_token_carries_the_view(self):
        self.assertEqual(db.split_token("站姿/A::side"), ("站姿/A", "side"))
        self.assertEqual(db.split_token("站姿/A"), ("站姿/A", None))
        self.assertEqual(db.split_token("站姿/A::"), ("站姿/A", None))


class CollectTests(_Sandbox):
    def test_empty_selection_returns_none(self):
        self.assertIsNone(db.collect_references({"pose": "", "face": "", "cloth": ""}))
        self.assertIsNone(db.collect_references({}))

    def test_lane_order_is_pose_face_cloth(self):
        _write_png(db.img_dir("pose") / "p.png", colour=(255, 0, 0), size=(8, 8))
        _write_png(db.img_dir("face") / "f.png", colour=(0, 255, 0), size=(8, 8))
        _write_png(db.img_dir("cloth") / "c.png", colour=(0, 0, 255), size=(8, 8))
        batch = db.collect_references({"pose": "p", "face": "f", "cloth": "c"})
        self.assertEqual(tuple(batch.shape), (3, 8, 8, 3))
        self.assertAlmostEqual(float(batch[0, 0, 0, 0]), 1.0, places=2)

    def test_mismatched_sizes_scale_to_the_first(self):
        _write_png(db.img_dir("pose") / "大.png", size=(40, 20))
        _write_png(db.img_dir("pose") / "小.png", size=(10, 10))
        batch = db.collect_references({"pose": "大|小"})
        self.assertEqual(tuple(batch.shape), (2, 20, 40, 3))

    def test_broken_token_is_skipped(self):
        _write_png(db.img_dir("pose") / "站立.png")
        batch = db.collect_references({"pose": "不存在|站立"})
        self.assertEqual(tuple(batch.shape), (1, 48, 32, 3))

    def test_missing_view_falls_back_to_the_first_angle(self):
        _write_png(db.img_dir("pose") / "只有正面_front.png", colour=(255, 0, 0), size=(8, 8))
        batch = db.collect_references({"pose": "只有正面::俯视"})
        self.assertAlmostEqual(float(batch[0, 0, 0, 0]), 1.0, places=2)

    def test_pose_views_can_be_selected_separately(self):
        _write_png(db.img_dir("pose") / "甲_front.png", colour=(255, 0, 0), size=(8, 8))
        _write_png(db.img_dir("pose") / "甲_side.png", colour=(0, 0, 255), size=(8, 8))
        batch = db.collect_references({"pose": "甲::front|甲::side"})
        self.assertEqual(tuple(batch.shape), (2, 8, 8, 3))


if __name__ == "__main__":
    unittest.main()
