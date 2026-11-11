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
        self.assertEqual(
            data["groups"][0]["loras"][0],
            {"name": "a.safetensors", "strength": 0.8, "off": False},
        )
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
        self.assertEqual(
            data["groups"][0]["loras"],
            [{"name": "keep.safetensors", "strength": 1.0, "off": False}],
        )
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

    def test_off_entries_and_tiny_strength_are_skipped(self):
        data = lora.normalise_data(json.dumps({
            "groups": [{"name": "A", "loras": [
                {"name": "a.safetensors", "strength": 1},
                {"name": "b.safetensors", "strength": 1, "off": True},
                {"name": "c.safetensors", "strength": 0.0000001},
            ]}],
        }))
        self.assertEqual(lora.plan_loras(data, True), [("a.safetensors", 1.0)])

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

    def test_switch_widget_turns_everything_off(self):
        data = _data(("写实", [("a.safetensors", 1)]))
        self.assertEqual(self.node.load("model", False, data), ("model",))
        self.assertEqual(self.loaded, [])
        self.node.load("model", True, data)
        self.assertEqual(self.loaded, ["a.safetensors"])

    def test_group_dropdown_picks_the_group(self):
        """「生效分组」下拉选哪组就只跑哪组；默认跟随面板。"""
        data = _data(("写实", [("a.safetensors", 1)]), ("二次元", [("c.safetensors", 1)]), active=0)
        self.node.load("model", True, data, "二次元")
        self.assertEqual(self.loaded, ["c.safetensors"])
        self.loaded.clear()
        self.node.load("model", True, data, lora.FOLLOW_PANEL)
        self.assertEqual(self.loaded, ["a.safetensors"])
        self.loaded.clear()
        self.node.load("model", True, data, "")
        self.assertEqual(self.loaded, ["a.safetensors"])

    def test_saved_choice_is_used_when_the_dropdown_resets(self):
        """动态下拉读档时可能被重置成「跟随面板」，数据里存的选择要顶上来。"""
        data = json.loads(
            _data(("写实", [("a.safetensors", 1)]), ("二次元", [("c.safetensors", 1)]), active=0)
        )
        data["select"] = "二次元"
        payload = json.dumps(data)
        self.node.load("model", True, payload, lora.FOLLOW_PANEL)
        self.assertEqual(self.loaded, ["c.safetensors"])
        # 下拉明确选了别的组时以控件为准
        self.loaded.clear()
        self.node.load("model", True, payload, "写实")
        self.assertEqual(self.loaded, ["a.safetensors"])

    def test_unknown_group_choice_falls_back_to_the_panel(self):
        data = _data(("写实", [("a.safetensors", 1)]), ("二次元", [("c.safetensors", 1)]), active=0)
        self.node.load("model", True, data, "已经删掉的组")
        self.assertEqual(self.loaded, ["a.safetensors"])

    def test_switch_accepts_text_values_from_the_phone_or_api(self):
        data = _data(("A", [("a.safetensors", 1)]))
        self.assertEqual(self.node.load("model", "停用", data), ("model",))
        self.node.load("model", "启用", data)
        self.assertEqual(self.loaded, ["a.safetensors"])

    def test_lora_cache_keeps_a_few_entries(self):
        self.assertEqual(lora.LORA_CACHE_SIZE, 3)
        node = self.node
        for name in ("a", "b", "c", "d"):
            node._loaded[name] = (name, {})
            while len(node._loaded) > lora.LORA_CACHE_SIZE:
                node._loaded.pop(next(iter(node._loaded)))
        self.assertEqual(list(node._loaded), ["b", "c", "d"])

    def test_failures_are_reported_once(self, capsys=None):
        import contextlib
        import io

        data = _data(("A", [("bad1.safetensors", 1), ("bad2.safetensors", 1)]))

        def boom(name):
            raise ValueError("坏文件")

        self.node._load_lora = boom
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            self.node.load("model", True, data)
        output = buffer.getvalue()
        self.assertIn("2/2 个 LoRA 未加载", output)
        self.assertIn("bad1.safetensors", output)
        self.assertIn("bad2.safetensors", output)

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
        self.assertIn('widget: "启用开关"', source)
        self.assertIn('widget: "生效分组"', source)
        self.assertIn("function syncGroupChoices(node, data)", source)
        self.assertIn("widget.options.values = values", source)
        self.assertIn("function syncExternalInputs(node)", source)
        self.assertIn("source.isVirtualNode", source)
        self.assertIn("installPromptHook", source)
        self.assertIn("__h3MultiPrimitiveSlot", source)
        # 排队前统一抄一遍，子图也要覆盖
        self.assertIn("function installPromptHook()", source)
        self.assertIn("app.graphToPrompt = async function wrappedGraphToPrompt", source)
        self.assertIn("syncAllExternalInputs(app.canvas?.graph || app.graph)", source)
        self.assertIn("if (node?.subgraph) syncAllExternalInputs(node.subgraph, seen);", source)

    def test_panel_width_is_fixed_and_labels_are_unified(self):
        source = (Path(__file__).resolve().parents[1] / "web" / "lora_groups.js").read_text(
            encoding="utf-8"
        )
        # 最小宽度 262，且选完 LoRA 之后内容不能再把最小宽度顶大
        self.assertIn("const MIN_NODE_WIDTH = 262;", source)
        self.assertIn("node.computeSize = function qqLoraComputeSize", source)
        self.assertIn("return [MIN_NODE_WIDTH, height];", source)
        # 标题栏整行都不要（既无提示也无「Lora 分组」标题）
        self.assertNotIn("qq-lora-hint", source)
        self.assertNotIn("qq-lora-title", source)
        self.assertIn("root.append(groups, rows, foot);", source)
        # 输入口 model 与输出口 模型 统一显示
        self.assertIn('modelInput.label = "模型";', source)

    def test_panel_features_are_wired(self):
        source = (Path(__file__).resolve().parents[1] / "web" / "lora_groups.js").read_text(
            encoding="utf-8"
        )
        # 拖拽排序、右键换组、复制分组、临时停用、缺失提示、刷新、缩略图、行数上限
        self.assertIn('row.addEventListener("dragstart"', source)
        self.assertIn("reorderLora(target.loras, from, to)", source)
        self.assertIn("function openRowMenu(event, index, lora)", source)
        self.assertIn("moveLoraToGroup(next, data.active, index, targetIndex)", source)
        self.assertIn("复制这一组", source)
        self.assertIn("target.loras[index].off = !enabledBox.checked", source)
        self.assertIn('enabledBox.className = "qq-lora-on"', source)
        self.assertIn("text-decoration:line-through", source)
        self.assertIn("isMissingLora(lora.name, loraNames)", source)
        self.assertIn("refreshLoraNames()", source)
        self.assertIn("const MAX_POPUP_ROWS = 400;", source)
        self.assertIn("function attachLoraPreview(node, anchor, name)", source)
        self.assertIn('const LORA_PREVIEW_URL = "/qq_lora/preview";', source)
        self.assertIn("strength.addEventListener(\"dblclick\", () => commitStrength(1));", source)


class ContractTests(unittest.TestCase):
    def test_contract(self):
        node = lora.QQLoraGroupLoader
        self.assertEqual(node.RETURN_TYPES, ("MODEL",))
        self.assertEqual(node.CATEGORY, "QQ/工具")
        self.assertEqual(lora.NODE_DISPLAY_NAME_MAPPINGS["QQLoraGroupLoader"], "QQ-Lora分组加载")
        inputs = node.INPUT_TYPES()
        # 启用是开关控件，生效分组是下拉；都做成控件，多值输入才能写入
        self.assertEqual(
            list(inputs["required"]),
            ["model", "启用开关", "分组数据", "生效分组"],
        )
        self.assertNotIn("optional", inputs)
        self.assertEqual(inputs["required"]["启用开关"][0], "BOOLEAN")
        self.assertEqual(inputs["required"]["启用开关"][1]["default"], True)
        self.assertEqual(inputs["required"]["生效分组"][0], [lora.FOLLOW_PANEL])


if __name__ == "__main__":
    unittest.main()
