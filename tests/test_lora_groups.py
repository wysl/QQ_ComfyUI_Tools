"""QQ-Lora分组加载（仅模型）：分组数据、生效分组与 LoRA 叠加顺序。"""

from __future__ import annotations

import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

MODULE_DIR = Path(__file__).resolve().parents[1] / "node_modules"


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, MODULE_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


lora = _load("qq_lora_groups_test", "lora_groups.py")


def _data(*groups, active=0):
    return json.dumps(
        {
            "version": 1,
            "active": active,
            "groups": [
                {"name": name, "loras": [{"name": lora_name, "strength": strength} for lora_name, strength in entries]}
                for name, entries in groups
            ],
        }
    )


class NormaliseTests(unittest.TestCase):
    def test_broken_json_falls_back_to_empty(self):
        self.assertEqual(lora.normalise_data("{not json"), lora._empty_data())
        self.assertEqual(lora.normalise_data(None), lora._empty_data())
        self.assertEqual(lora.normalise_data(123), lora._empty_data())

    def test_groups_and_loras_are_kept_in_order(self):
        data = lora.normalise_data(
            _data(("写实", [("a.safetensors", 0.8), ("b.safetensors", 1.2)]), ("二次元", []), active=1)
        )
        self.assertEqual([group["name"] for group in data["groups"]], ["写实", "二次元"])
        self.assertEqual(data["groups"][0]["loras"][0], {"name": "a.safetensors", "strength": 0.8})
        self.assertEqual(data["active"], 1)

    def test_active_is_clamped_into_range(self):
        data = lora.normalise_data(_data(("A", []), active=9))
        self.assertEqual(data["active"], 0)
        data = lora.normalise_data(_data(("A", []), ("B", []), active=-3))
        self.assertEqual(data["active"], 0)

    def test_unnamed_and_empty_entries_are_cleaned(self):
        raw = json.dumps(
            {
                "active": 3,
                "groups": [
                    {"name": "  ", "loras": [{"name": "", "strength": 1}, {"name": "keep.safetensors"}]},
                    "not a group",
                ],
            }
        )
        data = lora.normalise_data(raw)
        self.assertEqual(data["groups"][0]["name"], "分组 1")
        self.assertEqual(data["groups"][0]["loras"], [{"name": "keep.safetensors", "strength": 1.0}])
        self.assertEqual(data["active"], 0)

    def test_strength_is_clamped_and_nan_rejected(self):
        raw = json.dumps({"groups": [{"name": "A", "loras": [
            {"name": "big.safetensors", "strength": 500},
            {"name": "nan.safetensors", "strength": "NaN"},
        ]}]})
        data = lora.normalise_data(raw)
        self.assertEqual(data["groups"][0]["loras"][0]["strength"], 100.0)
        self.assertEqual(data["groups"][0]["loras"][1]["strength"], 1.0)


class EnabledTests(unittest.TestCase):
    def test_recognised_values(self):
        for value in (True, 1, "1", "true", "on", "启用", "开", "yes"):
            self.assertTrue(lora.coerce_enabled(value, default=False), msg=value)
        for value in (False, 0, "0", "false", "off", "停用", "关", "no"):
            self.assertFalse(lora.coerce_enabled(value, default=True), msg=value)

    def test_unknown_or_missing_keeps_the_panel_value(self):
        self.assertTrue(lora.coerce_enabled(None, default=True))
        self.assertFalse(lora.coerce_enabled(None, default=False))
        self.assertTrue(lora.coerce_enabled("随便写的", default=True))
        self.assertFalse(lora.coerce_enabled("随便写的", default=False))


class GroupResolutionTests(unittest.TestCase):
    def setUp(self):
        self.data = lora.normalise_data(_data(("写实", []), ("二次元", []), ("测试", []), active=0))

    def test_panel_choice_is_used_without_override(self):
        self.assertEqual(lora.resolve_group(self.data)["name"], "写实")

    def test_one_based_number_and_name_both_work(self):
        self.assertEqual(lora.resolve_group(self.data, 2)["name"], "二次元")
        self.assertEqual(lora.resolve_group(self.data, "2")["name"], "二次元")
        self.assertEqual(lora.resolve_group(self.data, "二次元")["name"], "二次元")
        self.assertEqual(lora.resolve_group(self.data, "第3组")["name"], "测试")

    def test_unknown_override_falls_back_to_the_panel_choice(self):
        self.assertEqual(lora.resolve_group(self.data, "不存在的组")["name"], "写实")
        self.assertEqual(lora.resolve_group(self.data, 99)["name"], "写实")

    def test_empty_data_has_no_group(self):
        self.assertIsNone(lora.resolve_group(lora._empty_data()))


class PlanTests(unittest.TestCase):
    def test_disabled_means_no_lora(self):
        data = lora.normalise_data(_data(("A", [("a.safetensors", 1)])))
        self.assertEqual(lora.plan_loras(data, False), [])

    def test_zero_strength_is_dropped(self):
        data = lora.normalise_data(_data(("A", [("a.safetensors", 0), ("b.safetensors", 0.5)])))
        self.assertEqual(lora.plan_loras(data, True), [("b.safetensors", 0.5)])

    def test_order_is_preserved(self):
        data = lora.normalise_data(_data(("A", [("first.safetensors", 0.6), ("second.safetensors", 1.0)])))
        self.assertEqual(
            [name for name, _strength in lora.plan_loras(data, True)],
            ["first.safetensors", "second.safetensors"],
        )


class LoadTests(unittest.TestCase):
    """节点执行：只叠加选中分组的 LoRA，关掉时原样透传。"""

    def setUp(self):
        self.calls = []
        self.loaded = []

        def fake_load(name):
            self.loaded.append(name)
            return ("lora-blob", {"name": name})

        def fake_apply(model, clip, lora_blob, strength_model, strength_clip, lora_metadata=None):
            self.calls.append((model, strength_model, lora_metadata.get("name")))
            return (f"{model}+{lora_metadata['name']}@{strength_model}", None)

        comfy = types.ModuleType("comfy")
        sd = types.ModuleType("comfy.sd")
        sd.load_lora_for_models = fake_apply
        comfy.sd = sd
        utils = types.ModuleType("comfy.utils")
        utils.load_torch_file = lambda *args, **kwargs: ("lora-blob", {})
        comfy.utils = utils
        self._saved = {name: sys.modules.get(name) for name in ("comfy", "comfy.sd", "comfy.utils")}
        sys.modules["comfy"] = comfy
        sys.modules["comfy.sd"] = sd
        sys.modules["comfy.utils"] = utils
        self.node = lora.QQLoraGroupLoader()
        self.node._load_lora = fake_load

    def tearDown(self):
        for name, module in self._saved.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module

    def test_selected_group_is_applied_in_order(self):
        data = _data(("写实", [("a.safetensors", 0.7), ("b.safetensors", 1.1)]), ("二次元", []), active=0)
        (result,) = self.node.load("model", True, data)
        self.assertEqual(self.loaded, ["a.safetensors", "b.safetensors"])
        self.assertEqual(self.calls[0][1], 0.7)
        self.assertEqual(result, "model+a.safetensors@0.7+b.safetensors@1.1")

    def test_only_the_chosen_group_runs(self):
        data = _data(("写实", [("a.safetensors", 1)]), ("二次元", [("c.safetensors", 0.5)]), active=1)
        self.node.load("model", True, data)
        self.assertEqual(self.loaded, ["c.safetensors"])

    def test_disabled_passes_the_model_through(self):
        data = _data(("A", [("a.safetensors", 1)]))
        self.assertEqual(self.node.load("model", False, data), ("model",))
        self.assertEqual(self.loaded, [])

    def test_mirrored_external_values_are_used(self):
        """虚拟节点（QQ-多值输入）的接线不会进 prompt，值走隐藏控件。"""
        data = _data(("写实", [("a.safetensors", 1)]), ("二次元", [("c.safetensors", 1)]), active=0)
        # 隐藏控件说停用 → 透传
        self.assertEqual(self.node.load("model", True, data, "停用", ""), ("model",))
        self.assertEqual(self.loaded, [])
        # 隐藏控件说启用 → 即使面板关着也生效
        self.node.load("model", False, data, "启用", "")
        self.assertEqual(self.loaded, ["a.safetensors"])
        # 隐藏控件指定分组
        self.node.load("model", True, data, "", "二次元")
        self.assertEqual(self.loaded, ["a.safetensors", "c.safetensors"])

    def test_real_wired_value_beats_the_mirrored_one(self):
        """接的是真节点时，连线值优先于隐藏控件里的残值。"""
        data = _data(("写实", [("a.safetensors", 1)]))
        self.node.load("model", True, data, "停用", "", "启用")
        self.assertEqual(self.loaded, ["a.safetensors"])

    def test_external_switch_beats_the_panel(self):
        data = _data(("A", [("a.safetensors", 1)]))
        self.assertEqual(self.node.load("model", True, data, "停用"), ("model",))
        self.assertEqual(self.loaded, [])
        self.node.load("model", False, data, "启用")
        self.assertEqual(self.loaded, ["a.safetensors"])

    def test_external_group_beats_the_panel(self):
        data = _data(("写实", [("a.safetensors", 1)]), ("二次元", [("c.safetensors", 1)]), active=0)
        self.node.load("model", True, data, None, "二次元")
        self.assertEqual(self.loaded, ["c.safetensors"])

    def test_empty_group_or_broken_lora_is_safe(self):
        data = _data(("空组", []))
        self.assertEqual(self.node.load("model", True, data), ("model",))

        def boom(name):
            raise ValueError("坏文件")

        self.node._load_lora = boom
        data = _data(("A", [("bad.safetensors", 1)]))
        self.assertEqual(self.node.load("model", True, data), ("model",))


class FrontendWiringTests(unittest.TestCase):
    """虚拟节点（QQ-多值输入）的接线值靠前端抄进隐藏控件。"""

    def test_frontend_mirrors_virtual_values_before_queueing(self):
        source = (Path(__file__).resolve().parents[1] / "web" / "lora_groups.js").read_text(
            encoding="utf-8"
        )
        self.assertIn('const EXTERNAL_INPUTS = [', source)
        self.assertIn('{ input: "启用开关", widget: "外部开关" }', source)
        self.assertIn('{ input: "生效分组", widget: "外部分组" }', source)
        self.assertIn("function syncExternalInputs(node)", source)
        self.assertIn("source.isVirtualNode", source)
        self.assertIn("__h3MultiPrimitiveSlot", source)
        # 排队前统一抄一遍，子图也要覆盖
        self.assertIn("function installPromptHook()", source)
        self.assertIn("app.graphToPrompt = async function wrappedGraphToPrompt", source)
        self.assertIn("syncAllExternalInputs(app.canvas?.graph || app.graph)", source)
        self.assertIn("if (node?.subgraph) syncAllExternalInputs(node.subgraph, seen);", source)


class ContractTests(unittest.TestCase):
    def test_contract(self):
        node = lora.QQLoraGroupLoader
        self.assertEqual(node.RETURN_TYPES, ("MODEL",))
        self.assertEqual(node.CATEGORY, "QQ/工具")
        self.assertEqual(lora.NODE_DISPLAY_NAME_MAPPINGS["QQLoraGroupLoader"], "QQ-Lora分组加载")
        inputs = node.INPUT_TYPES()
        self.assertEqual(
            list(inputs["required"]),
            ["model", "启用", "分组数据", "外部开关", "外部分组"],
        )
        # 两个可选口给 QQ-多值输入 用；值由前端抄进「外部开关 / 外部分组」
        self.assertEqual(list(inputs["optional"]), ["启用开关", "生效分组"])
        self.assertEqual(inputs["optional"]["启用开关"][0], "STRING")
        self.assertEqual(inputs["optional"]["生效分组"][0], "STRING")


if __name__ == "__main__":
    unittest.main()
