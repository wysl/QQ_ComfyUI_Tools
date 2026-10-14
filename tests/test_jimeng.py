"""QQ-即梦AI出图 节点的离线测试（pytest 兼容，也可直接 python 运行）。"""

import base64
import importlib.util
import io
import json
import os
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image

MODULE_PATH = Path(__file__).resolve().parents[1] / "node_modules" / "jimeng.py"
spec = importlib.util.spec_from_file_location("qq_jimeng_under_test", MODULE_PATH)
jimeng = importlib.util.module_from_spec(spec)
spec.loader.exec_module(jimeng)


def _png_bytes(width=64, height=32, color=(10, 200, 30)):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, format="PNG")
    return buffer.getvalue()


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def read(self):
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class _Recorder:
    def __init__(self, payloads):
        self.payloads = list(payloads)
        self.calls = []

    def __call__(self, request, timeout=None):
        body = json.loads(request.data.decode("utf-8"))
        self.calls.append({
            "url": request.full_url,
            "headers": dict(request.headers),
            "body": body,
        })
        return _FakeResponse(json.dumps(self.payloads.pop(0)).encode("utf-8"))


def _patch_urlopen(recorder):
    original = jimeng.urlrequest.urlopen
    jimeng.urlrequest.urlopen = recorder
    return original


def test_sync_request_and_decode():
    png = _png_bytes()
    recorder = _Recorder([{"code": 10000, "data": {"binary_data_base64": [base64.b64encode(png).decode()]}}])
    original = _patch_urlopen(recorder)
    try:
        (image,) = jimeng.QQJimengImage().run(
            api_key="k1", req_key="jimeng_high_aes_general_v21_L", prompt="猫",
            width=512, height=512, seed=7, sync=True,
        )
    finally:
        jimeng.urlrequest.urlopen = original
    assert tuple(image.shape) == (1, 32, 64, 3)
    assert len(recorder.calls) == 1
    call = recorder.calls[0]
    assert call["url"] == jimeng.BASE_URL + jimeng.PATH_PROCESS
    assert call["headers"].get("Authorization") == "Bearer k1"
    assert call["body"]["req_key"] == "jimeng_high_aes_general_v21_L"
    assert call["body"]["prompt"] == "猫"
    assert call["body"]["width"] == 512 and call["body"]["height"] == 512 and call["body"]["seed"] == 7


def test_async_poll_flow():
    png = _png_bytes()
    recorder = _Recorder([
        {"code": 10000, "data": {"task_id": "t-1"}},
        {"code": 10000, "data": {"status": "generating"}},
        {"code": 10000, "data": {"status": "done", "binary_data_base64": [base64.b64encode(png).decode()]}},
    ])
    original = _patch_urlopen(recorder)
    try:
        (image,) = jimeng.QQJimengImage().run(
            api_key="k1", req_key="high_aes_general_v30l_zt2i", prompt="狗",
            width=512, height=512, seed=1, sync=False, poll_s=0.01,
        )
    finally:
        jimeng.urlrequest.urlopen = original
    assert tuple(image.shape) == (1, 32, 64, 3)
    urls = [call["url"] for call in recorder.calls]
    assert urls == [
        jimeng.BASE_URL + jimeng.PATH_SUBMIT,
        jimeng.BASE_URL + jimeng.PATH_RESULT,
        jimeng.BASE_URL + jimeng.PATH_RESULT,
    ]
    assert recorder.calls[1]["body"]["task_id"] == "t-1"


def test_error_code_raises():
    recorder = _Recorder([{"code": 50411, "message": "参数不合法"}])
    original = _patch_urlopen(recorder)
    try:
        try:
            jimeng.QQJimengImage().run(api_key="k1", prompt="x", sync=True)
        except RuntimeError as exc:
            assert "50411" in str(exc) and "参数不合法" in str(exc)
        else:
            raise AssertionError("should raise")
    finally:
        jimeng.urlrequest.urlopen = original


def test_env_key_fallback():
    png = _png_bytes()
    recorder = _Recorder([{"code": 10000, "data": {"binary_data_base64": [base64.b64encode(png).decode()]}}])
    os.environ[jimeng.ENV_API_KEY] = "env-key"
    original = _patch_urlopen(recorder)
    try:
        jimeng.QQJimengImage().run(api_key="", prompt="x", sync=True)
    finally:
        jimeng.urlrequest.urlopen = original
        del os.environ[jimeng.ENV_API_KEY]
    assert recorder.calls[0]["headers"].get("Authorization") == "Bearer env-key"


def test_image_frames_to_base64():
    png = _png_bytes()
    frames = torch.zeros(2, 8, 8, 3)
    recorder = _Recorder([{"code": 10000, "data": {"binary_data_base64": [base64.b64encode(png).decode()]}}])
    original = _patch_urlopen(recorder)
    try:
        jimeng.QQJimengImage().run(api_key="k1", prompt="x", image=frames, sync=True)
    finally:
        jimeng.urlrequest.urlopen = original
    assert len(recorder.calls[0]["body"]["binary_data_base64"]) == 2


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("ok  ", name)
            except AssertionError as exc:
                failures += 1
                print("FAIL", name, exc)
    print("done, failures =", failures)
    sys.exit(1 if failures else 0)
