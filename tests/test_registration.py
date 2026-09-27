"""Registration and pure-contract checks that do not require a ComfyUI install."""

from __future__ import annotations

import importlib
import json
import os
import sys
import tempfile
import types
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch


class FakeTensor:
    pass


def install_comfy_stubs():
    torch = types.ModuleType("torch")
    torch.Tensor = FakeTensor
    torch.nn = types.SimpleNamespace(functional=types.SimpleNamespace())
    torch.float16 = object()
    torch.float32 = object()
    torch.float64 = object()
    sys.modules["torch"] = torch
    sys.modules["torch.nn"] = torch.nn
    sys.modules["torch.nn.functional"] = torch.nn.functional

    folder_paths = types.ModuleType("folder_paths")
    folder_paths.get_save_image_path = lambda *args: ("", "wsl", 1, "", "")
    folder_paths.get_output_directory = lambda: ""
    sys.modules["folder_paths"] = folder_paths

    comfy_nodes = types.ModuleType("nodes")
    comfy_nodes.MAX_RESOLUTION = 16384
    comfy_nodes.NODE_CLASS_MAPPINGS = {}
    sys.modules["nodes"] = comfy_nodes

    comfy = types.ModuleType("comfy")
    comfy_cli_args = types.ModuleType("comfy.cli_args")
    comfy_cli_args.args = types.SimpleNamespace(disable_metadata=False)
    comfy.__path__ = []
    sys.modules["comfy"] = comfy
    sys.modules["comfy.cli_args"] = comfy_cli_args

    comfy_api = types.ModuleType("comfy_api")
    latest = types.ModuleType("comfy_api.latest")
    latest.InputImpl = types.SimpleNamespace()
    latest.Types = types.SimpleNamespace()
    comfy_api.__path__ = []
    sys.modules["comfy_api"] = comfy_api
    sys.modules["comfy_api.latest"] = latest


class RegistrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        install_comfy_stubs()
        sys.path.insert(0, str(Path(__file__).resolve().parents[1].parent))
        cls.package = importlib.import_module("QQ_ComfyUI_Tools")

    def test_all_requested_nodes_are_registered_with_unique_qq_ids(self):
        mappings = self.package.NODE_CLASS_MAPPINGS
        self.assertEqual(len(mappings), 28)
        self.assertTrue(all(name.startswith("QQ") for name in mappings))
        self.assertEqual(len(mappings), len(set(mappings)))
        self.assertNotIn("QQLightroomImage", mappings)
        self.assertNotIn("QQLightroomVideo", mappings)
        self.assertIn("QQ-多值输入", mappings)
        self.assertNotIn("QQMultiPrimitive", mappings)
        self.assertIn("QQIgnoreRulesController", mappings)

    def test_display_names_match_requested_names(self):
        display = self.package.NODE_DISPLAY_NAME_MAPPINGS
        self.assertEqual(set(display), set(self.package.NODE_CLASS_MAPPINGS))
        self.assertTrue(all(name.startswith("QQ-") for name in display.values()))
        self.assertTrue(all(any("\u4e00" <= char <= "\u9fff" for char in name) for name in display.values()))
        self.assertEqual(display["QQVideoBlackIntro"], "QQ-视频开头黑屏")
        self.assertEqual(display["QQVfiX2"], "QQ-视频补帧×2")
        self.assertEqual(display["QQSaveVideo"], "QQ-保存视频")
        self.assertEqual(display["QQLightroomHSLWarm"], "QQ-LR-暖色调色")
        self.assertEqual(display["QQLightroomHSLCool"], "QQ-LR-冷色调色")
        self.assertEqual(display["QQMediaLoader"], "QQ-多媒体加载")
        self.assertEqual(display["QQMediaIndexOutput"], "QQ-媒体序号输出")
        self.assertEqual(display["QQMediaAutoSplitter"], "QQ-自动拆分媒体")
        self.assertEqual(display["QQH3SegmentChromaNoise"], "QQ-H3 分段彩噪")
        self.assertEqual(display["QQGrokImagineImage"], "QQ-Grok图像生成")
        self.assertEqual(display["QQLightroomGrain"], "QQ-LR-颗粒效果")
        self.assertEqual(display["QQLatentSwitch"], "QQ-潜空间切换")
        self.assertEqual(display["QQPollingSwitch"], "QQ-图像轮询切换")
        self.assertEqual(display["QQ-多值输入"], "QQ-多值输入")
        self.assertEqual(display["QQIgnoreRules"], "QQ-绕过规则")
        self.assertEqual(display["QQIgnoreRulesController"], "QQ-绕过规则开关")
        self.assertEqual(display["QQTextPollingSwitch"], "QQ-文本轮询切换")
        self.assertEqual(
            display["QQQwenImage21PromptEnhancer"],
            "QQ-Qwen Image 2.1 AI提示词增强(PE or API)",
        )
        self.assertEqual(
            display["QQQwenImage21AllInOne"],
            "QQ-Qwen Image 2.1 一键出图(编码+K采样+VAE解码)",
        )

    def test_ignore_rules_controller_is_frontend_only_and_keeps_stable_bindings(self):
        controller = self.package.NODE_CLASS_MAPPINGS["QQIgnoreRulesController"]
        self.assertEqual(controller.RETURN_TYPES, ())
        self.assertEqual(controller.INPUT_TYPES(), {"optional": {}})
        source = (Path(__file__).resolve().parents[1] / "web" / "ignore_rules_controller.js").read_text(
            encoding="utf-8",
        )
        self.assertIn('const NODE_TYPE = "QQIgnoreRulesController";', source)
        self.assertIn('const RULE_NODE_TYPE = "QQIgnoreRules";', source)
        self.assertIn("qqIgnoreRuleBindings", source)
        self.assertIn("function ensureRuleBindings(node, rules)", source)
        self.assertIn("function boundRule(node, index, rules, bindings)", source)
        self.assertIn("不建立执行连线", controller.DESCRIPTION)

    def test_grok_image_node_has_profile_only_endpoint_selector(self):
        node = self.package.NODE_CLASS_MAPPINGS["QQGrokImagineImage"]
        controls = node.INPUT_TYPES()["required"]
        self.assertEqual(controls["endpoint_profile"][0], ["未配置 Grok endpoint"])
        self.assertEqual(controls["model"][0], ["grok-imagine-image-2.0"])
        self.assertEqual(node.RETURN_TYPES, ("IMAGE",))

    def test_grok_config_prefers_renamed_directory_with_legacy_fallback(self):
        from QQ_ComfyUI_Tools.core.grok_config import config_candidates

        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ, {"QQ_GROK_IMAGE_CONFIG": "", "WYSL_GROK_IMAGE_CONFIG": ""}
        ), patch.object(
            sys.modules["folder_paths"], "get_user_directory", return_value=directory, create=True
        ):
            candidates = config_candidates()
            self.assertEqual(candidates[0], Path(directory) / "QQ_ComfyUI_Tools" / "grok_image_endpoints.json")
            self.assertEqual(candidates[1], Path(directory) / "Wysl_ComfyUI_Tools" / "grok_image_endpoints.json")

            configured = Path(directory) / "custom.json"
            with patch.dict(os.environ, {"QQ_GROK_IMAGE_CONFIG": str(configured)}):
                self.assertEqual(config_candidates()[0], configured)

    def test_grok_image_payload_omits_auto_quality(self):
        from QQ_ComfyUI_Tools.node_modules.grok_image import _build_payload

        payload = _build_payload(
            "grok-imagine-image-2.0",
            "a studio portrait",
            1,
            "自动",
            "自动",
            "1k",
            "auto",
            "b64_json",
            "跟随配置",
            False,
            None,
        )
        self.assertNotIn("quality", payload)
        self.assertNotIn("aspect_ratio", payload)
        self.assertNotIn("size", payload)
        self.assertFalse(payload["enable_nsfw"])

    def test_grok_image_ratio_wins_over_conflicting_legacy_size(self):
        from QQ_ComfyUI_Tools.node_modules.grok_image import _build_payload

        payload = _build_payload(
            "grok-imagine-image-2.0",
            "a studio portrait",
            1,
            "16:9",
            "1024x1536",
            "2k",
            "auto",
            "b64_json",
            "跟随配置",
            False,
            None,
        )
        self.assertEqual(payload["aspect_ratio"], "16:9")
        self.assertNotIn("size", payload)

    def test_grok_image_legacy_size_still_controls_ratio_when_ratio_is_auto(self):
        from QQ_ComfyUI_Tools.node_modules.grok_image import _build_payload

        payload = _build_payload(
            "grok-imagine-image-2.0",
            "a studio portrait",
            1,
            "自动",
            "1024x1536",
            "1k",
            "auto",
            "b64_json",
            "跟随配置",
            False,
            None,
        )
        self.assertEqual(payload["aspect_ratio"], "2:3")
        self.assertNotIn("size", payload)

    def test_h3_segment_chroma_noise_uses_upstream_segment_transport(self):
        node = self.package.NODE_CLASS_MAPPINGS["QQH3SegmentChromaNoise"]
        controls = node.INPUT_TYPES()["required"]
        self.assertEqual(controls["segments"][0], "MINIMAX_H3_SEGMENTS")
        self.assertEqual(node.RETURN_TYPES, ("MINIMAX_H3_SEGMENTS",))
        self.assertEqual(controls["start_alpha"][1]["default"], 0.20)
        self.assertEqual(controls["end_alpha"][1]["default"], 0.0)
        self.assertEqual(controls["taper_frames"][1]["default"], 8)
        self.assertTrue(controls["preserve_luminance"][1]["default"])

    def test_swap_and_prompt_contracts(self):
        swap = self.package.NODE_CLASS_MAPPINGS["QQSwapDimensions"]
        self.assertEqual(swap.swap(640, 480, False), (640, 480))
        self.assertEqual(swap.swap(640, 480, True), (480, 640))
        prompt = self.package.NODE_CLASS_MAPPINGS["QQMiniMaxH3EasyPrompt"]
        self.assertEqual(prompt.get_prompt("hello"), ("hello",))

    def test_h3_segment_timing_normalizes_duration_input(self):
        timing = self.package.NODE_CLASS_MAPPINGS["QQMiniMaxH3EasySegmentTiming"]
        self.assertEqual(timing.calculate("4， 4\n2", 24), ("4,4,2", 10.0, 24, 243))

    def test_h3_segment_timing_accepts_units_labels_and_brackets(self):
        timing = self.package.NODE_CLASS_MAPPINGS["QQMiniMaxH3EasySegmentTiming"]
        self.assertEqual(
            timing.calculate("第1段：6秒\n第2段：6.5s", 24),
            ("6,6.5", 12.5, 24, 311),
        )
        self.assertEqual(timing.calculate("[6, 6]", 24), ("6,6", 12.0, 24, 294))

    def test_h3_segment_timing_uses_h3_temporal_grid(self):
        timing = self.package.NODE_CLASS_MAPPINGS["QQMiniMaxH3EasySegmentTiming"]
        self.assertEqual(timing.calculate("5,5,5,5,5", 24)[-1], 600)

    def test_h3_segment_timing_uses_a_compact_single_line_input(self):
        timing = self.package.NODE_CLASS_MAPPINGS["QQMiniMaxH3EasySegmentTiming"]
        options = timing.INPUT_TYPES()["required"]["segment_seconds"][1]
        self.assertFalse(options["multiline"])

    def test_prompt_bridge_restores_linked_h3_segment_seconds(self):
        source = (Path(__file__).resolve().parents[1] / "web" / "prompt_bridge.js").read_text(
            encoding="utf-8",
        )
        self.assertIn('const H3_CONTEXT_NODE = "MiniMaxH3EasyContextSegments";', source)
        self.assertIn(
            'const segmentSecondsLink = linkedInputReference(node, "segment_seconds");',
            source,
        )
        self.assertIn("promptNode.inputs.segment_seconds = segmentSecondsLink;", source)

    def test_wysl_prompt_editor_discovers_downstream_h3_media(self):
        source = (Path(__file__).resolve().parents[1] / "web" / "prompt_editor.js").read_text(
            encoding="utf-8",
        )
        self.assertIn('const NODE_TYPE = "QQMiniMaxH3EasyPrompt";', source)
        self.assertIn('"MiniMaxH3EasyContextSegments"', source)
        self.assertIn('const LINKS_PROP = "minimax_h3_virtual_media_links";', source)
        self.assertIn('const MEDIA_LOADER_TYPE = "MiniMaxH3EasyMediaLoader";', source)
        self.assertIn("function downstreamH3Targets(promptNode)", source)
        self.assertIn("function mentionOptions(promptNode)", source)
        self.assertIn("function mediaLoaderState(loader)", source)

    def test_wysl_prompt_editor_defaults_to_structured_official_tags(self):
        source = (Path(__file__).resolve().parents[1] / "web" / "prompt_editor.js").read_text(
            encoding="utf-8",
        )
        self.assertIn('const STRUCTURED = "structured";', source)
        self.assertIn('structured.textContent = "结构化";', source)
        self.assertIn('return `<${TYPE_INFO[type].tag} ${ordinal}>`;', source)
        self.assertIn("function patchCanvasKeyHandling()", source)
        self.assertIn("function teardownPromptEditor(node)", source)

    def test_wysl_prompt_editor_matches_upstream_media_labels_and_paste_format(self):
        source = (Path(__file__).resolve().parents[1] / "web" / "prompt_editor.js").read_text(
            encoding="utf-8",
        )
        self.assertIn('image: { label: "图片", tag: "Picture"', source)
        self.assertIn('["图片", "图像", "Image", "Picture"]', source)
        self.assertIn("function pastedMentionCandidates(node)", source)
        self.assertIn("function pastedMentionMatch(node, value, cursor, candidates)", source)
        self.assertIn("function insertTextWithMentionChips(node, editor, text)", source)
        self.assertIn("else insertTextWithMentionChips(node, editor, text);", source)

    def test_prompt_bridge_supports_all_h3_prompt_targets_and_audio_mentions(self):
        source = (Path(__file__).resolve().parents[1] / "web" / "prompt_bridge.js").read_text(
            encoding="utf-8",
        )
        self.assertIn('"MiniMaxH3EasySelectedVideoContext"', source)
        self.assertIn("H3_PROMPT_TARGETS.has(nodeType)", source)
        self.assertIn("audio|音频", source)
        self.assertIn("function mediaLoaderRuntimeIndex(targetNode, mediaType, ordinal)", source)

    def test_h3_segment_timing_rejects_invalid_duration(self):
        timing = self.package.NODE_CLASS_MAPPINGS["QQMiniMaxH3EasySegmentTiming"]
        with self.assertRaises(ValueError):
            timing.calculate("4,not-a-number", 24)
        with self.assertRaises(ValueError):
            timing.calculate("nan,6", 24)

    def test_video_sampling_uses_the_first_frame_of_each_second(self):
        video = importlib.import_module("QQ_ComfyUI_Tools.node_modules.video")
        self.assertEqual(video._frame_indices(3.0, 24.0, 100), [0, 24, 48])
        self.assertEqual(video._frame_indices(3.0, 30.0, 50), [0, 30])

    def test_video_sampling_supports_custom_frame_positions(self):
        video = importlib.import_module("QQ_ComfyUI_Tools.node_modules.video")
        self.assertEqual(video._custom_frame_indices("48, 0,48，120", 100), [48, 0])
        self.assertEqual(video._custom_frame_indices("", 100), [])
        self.assertEqual(video._custom_frame_indices("100,101", 100), [])
        with self.assertRaises(ValueError):
            video._custom_frame_indices("0,nope", 100)
        with self.assertRaises(ValueError):
            video._custom_frame_indices("-1", 100)

        controls = video.QQSaveVideo.INPUT_TYPES()["required"]
        self.assertEqual(video.QQSaveVideo.RETURN_TYPES, ("VIDEO", "IMAGE", "IMAGE", "IMAGE"))
        self.assertEqual(video.QQSaveVideo.RETURN_NAMES[-1], "自定义帧")
        self.assertFalse(controls["自定义帧位置"][1]["multiline"])
        self.assertEqual(controls["自定义帧位置"][1]["default"], "")

    def test_vfi_chunks_overlap_once_and_cover_every_frame_pair(self):
        video = importlib.import_module("QQ_ComfyUI_Tools.node_modules.video")
        ranges = video._vfi_chunk_ranges(12, 5)
        self.assertEqual(ranges, [(0, 5), (4, 9), (8, 12)])
        pairs = [pair for start, stop in ranges for pair in range(start, stop - 1)]
        self.assertEqual(pairs, list(range(11)))

    def test_vfi_defaults_to_chunked_fp16_low_memory_mode(self):
        vfi = self.package.NODE_CLASS_MAPPINGS["QQVfiX2"]
        controls = vfi.INPUT_TYPES()["required"]
        self.assertEqual(controls["memory_mode"][1]["default"], "低内存（FP16）")
        self.assertEqual(controls["chunk_frames"][1]["default"], 96)

        source = (Path(__file__).resolve().parents[1] / "node_modules" / "video.py").read_text(
            encoding="utf-8",
        )
        vfi_source = source[source.index("class QQVfiX2") : source.index("class QQSaveVideo")]
        self.assertIn("for start, stop in ranges:", vfi_source)
        self.assertIn("interpolated[-2:].copy_", vfi_source)
        self.assertNotIn("torch.cat", vfi_source)

    def test_save_video_uses_comfyui_legacy_video_preview_protocol(self):
        source = (Path(__file__).resolve().parents[1] / "node_modules" / "video.py").read_text(
            encoding="utf-8",
        )
        self.assertIn('"images": [', source)
        self.assertIn('"animated": (True,)', source)
        self.assertNotIn('"wsl_saved_video"', source)

    def test_save_video_time_format_defaults_to_the_existing_counter_name(self):
        video = importlib.import_module("QQ_ComfyUI_Tools.node_modules.video")
        controls = video.QQSaveVideo.INPUT_TYPES()["required"]
        self.assertEqual(
            controls["time_format"][1]["default"],
            video.SAVE_TIME_DISABLED,
        )
        self.assertEqual(
            video._save_video_filename("Wsl", 3, "mp4", video.SAVE_TIME_DISABLED),
            "Wsl_00003_.mp4",
        )

    def test_save_video_supports_selectable_local_time_formats(self):
        video = importlib.import_module("QQ_ComfyUI_Tools.node_modules.video")
        now = datetime(2026, 9, 4, 8, 7, 6)
        expected = {
            video.SAVE_TIME_DATE_TIME: "Wsl_2026-09-04_08-07-06_00003_.mp4",
            video.SAVE_TIME_COMPACT: "Wsl_20260904_080706_00003_.mp4",
            video.SAVE_TIME_DATE: "Wsl_2026-09-04_00003_.mp4",
            video.SAVE_TIME_CLOCK: "Wsl_08-07-06_00003_.mp4",
        }
        for selected_format, filename in expected.items():
            with self.subTest(selected_format=selected_format):
                self.assertEqual(
                    video._save_video_filename("Wsl", 3, "mp4", selected_format, now),
                    filename,
                )

    def test_save_video_supports_compact_minute_time_with_collision_only_suffix(self):
        video = importlib.import_module("QQ_ComfyUI_Tools.node_modules.video")
        now = datetime(2026, 1, 2, 17, 30, 59)
        controls = video.QQSaveVideo.INPUT_TYPES()["required"]
        self.assertIn(video.SAVE_TIME_MINUTE, controls["time_format"][0])

        with tempfile.TemporaryDirectory() as output_folder:
            first = video._save_video_filename(
                "Wsl",
                37,
                "mp4",
                video.SAVE_TIME_MINUTE,
                now,
                output_folder,
            )
            self.assertEqual(first, "Wsl_20260102-1730.mp4")
            Path(output_folder, first).touch()
            Path(output_folder, "Wsl_20260102-1730-2.mp4").touch()
            third = video._save_video_filename(
                "Wsl",
                38,
                "mp4",
                video.SAVE_TIME_MINUTE,
                now,
                output_folder,
            )
            self.assertEqual(third, "Wsl_20260102-1730-3.mp4")

    def test_save_video_preview_keeps_native_layout_and_resizing(self):
        source = (Path(__file__).resolve().parents[1] / "web" / "save_video_preview.js").read_text(
            encoding="utf-8",
        )
        self.assertIn('this.resizable = true;', source)
        self.assertIn('objectFit: "contain"', source)
        self.assertIn("minHeight: MIN_LAYOUT_HEIGHT", source)
        self.assertIn("minWidth: 0", source)
        self.assertNotIn("widget.computeSize =", source)
        self.assertNotIn("MIN_PREVIEW_WIDTH", source)
        self.assertNotIn("MIN_PREVIEW_HEIGHT", source)

    def test_multi_line_text_node_contract(self):
        node = self.package.NODE_CLASS_MAPPINGS["QQMultiLineText"]
        self.assertEqual(node.RETURN_TYPES, ("STRING",))
        self.assertEqual(node.RETURN_NAMES, ("文本",))
        controls = node.INPUT_TYPES()["required"]
        self.assertEqual(
            list(controls),
            ["隐藏提示词", "系统提示词", "自由文本", "分隔符"],
        )
        self.assertEqual(controls["隐藏提示词"][0], "BOOLEAN")
        self.assertTrue(controls["系统提示词"][1]["multiline"])
        self.assertTrue(controls["自由文本"][1]["multiline"])
        self.assertFalse(controls["分隔符"][1].get("multiline", False))
        self.assertTrue(controls["系统提示词"][1]["default"])
        instance = node()
        self.assertEqual(
            instance.compose(系统提示词="A", 自由文本="C", 分隔符="B"),
            ("A\n\nB\n\nC",),
        )
        self.assertEqual(instance.compose(), ("\n\n\n\n",))
        source = (Path(__file__).resolve().parents[1] / "web" / "multi_line_text.js").read_text(
            encoding="utf-8",
        )
        self.assertIn('const NODE_TYPE = "QQMultiLineText";', source)
        self.assertIn('const TOGGLE_WIDGET = "隐藏提示词";', source)
        self.assertIn("function repairWidgetOrder(node)", source)
        self.assertIn("function applySystemVisibility(node)", source)
        self.assertNotIn("addDOMWidget", source)
        self.assertNotIn("onDrawForeground", source)
        self.assertNotIn("node.widgets.unshift(domWidget);", source)
        self.assertNotIn("node.widgets.splice(index, 1);", source)

    def test_qwen_pe_node_contract(self):
        node = self.package.NODE_CLASS_MAPPINGS["QQQwenImage21PromptEnhancer"]
        self.assertEqual(node.RETURN_TYPES, ("STRING",))
        self.assertEqual(node.RETURN_NAMES, ("增强提示词",))
        self.assertTrue(node.INPUT_IS_LIST)
        self.assertTrue(node.OUTPUT_NODE)
        self.assertEqual(node.CATEGORY, "QQ/工具")
        self.assertEqual(node.FUNCTION, "enhance_prompt")
        inputs = node.INPUT_TYPES()
        controls = inputs["required"]
        self.assertEqual(controls["任务模式"][0], ["自动", "文生图", "图生图"])
        self.assertEqual(controls["任务模式"][1]["default"], "自动")
        self.assertEqual(controls["增强方式"][0], ["本地官方PE", "API"])
        self.assertEqual(controls["增强方式"][1]["default"], "本地官方PE")
        self.assertEqual(controls["输出语言"][0], ["中文", "英文"])
        self.assertEqual(controls["输出语言"][1]["default"], "中文")
        self.assertEqual(controls["最大生成token"][1]["default"], 4096)
        self.assertEqual(controls["最大生成token"][1]["min"], 256)
        self.assertEqual(controls["最大生成token"][1]["max"], 32768)
        self.assertEqual(controls["最大生成token"][1]["step"], 256)
        self.assertEqual(controls["api_url"][1]["default"], "https://api.deepseek.com")
        self.assertEqual(controls["model"][1]["default"], "deepseek-flash")
        # api_url 在 api_key 前面
        order = list(controls)
        self.assertLess(order.index("api_url"), order.index("api_key"))
        self.assertEqual(controls["api_key"][1]["default"], "")
        self.assertEqual(controls["seed"][1]["control_after_generate"], True)
        # 旧的「本地」通用 LLaMA 通路连同它的专属控件一起去掉
        for removed in ("主模型", "mmproj", "上下文长度"):
            self.assertNotIn(removed, controls)
        # 单个列表口 + media_bundle 口，不再自动扩展编号口
        self.assertEqual(list(inputs["optional"]), ["参考图"])
        self.assertEqual(inputs["optional"]["参考图"][0], "IMAGE")
        module = importlib.import_module("QQ_ComfyUI_Tools.node_modules.qwen_pe")
        self.assertEqual(module.MAX_REFERENCE_IMAGES, 9)

    def test_qwen_pe_drops_the_legacy_local_llama_path(self):
        source = (Path(__file__).resolve().parents[1] / "node_modules" / "qwen_pe.py").read_text(
            encoding="utf-8",
        )
        self.assertIn("comfy.sd.load_clip", source)
        self.assertIn("comfy.sd.CLIPType.QWEN_IMAGE", source)
        self.assertIn("clip.tokenize(text, images=list(images), thinking=bool(thinking))", source)
        self.assertIn("Image.BICUBIC", source)
        self.assertIn("progressive=True", source)
        self.assertNotIn("llama_cpp", source)
        self.assertNotIn("mmproj", source)
        self.assertNotIn("AutoModelForCausalLM", source)

    def test_qwen_pe_prompt_templates_follow_the_official_rules(self):
        module = importlib.import_module("QQ_ComfyUI_Tools.node_modules.qwen_pe")
        self.assertIn("# Image Prompt Rewriting Expert", module.QWEN_T2I_SYSTEM_PROMPT)
        self.assertIn("# Edit Prompt Enhancer", module.QWEN_EDIT_SYSTEM_PROMPT)
        for mode in ("文生图", "图生图"):
            cleaned = module._clean_base_prompt(mode)
            self.assertNotIn("one long English paragraph", cleaned)
            self.assertNotIn("## Language", cleaned)
            self.assertNotIn("## Output format", cleaned)
            self.assertNotIn("## Output Format", cleaned)
            self.assertNotIn("there are TWO separate language decisions", cleaned)
        api = module._build_api_instructions("文生图", "中文")
        self.assertTrue(api.startswith(module._clean_base_prompt("文生图")))
        self.assertIn("## Node output controls", api)
        self.assertIn("最终语言规则（优先级最高）：节点选择的输出语言是“中文”。", api)
        self.assertTrue(api.endswith("当前为 API 模式：只输出最终增强后的提示词纯文本，不要输出 JSON、字段名、代码块、分析或解释。"))
        self.assertNotIn("## Official PE output protocol", api)
        pe_zh = module._build_official_pe_system("文生图", "中文")
        pe_en = module._build_official_pe_system("图生图", "英文")
        self.assertIn("## Official PE output protocol", pe_zh)
        self.assertIn("节点选择的输出语言是中文。", pe_zh)
        self.assertNotIn("## Node output controls", pe_zh)
        self.assertIn("The selected output language is English", pe_en)
        self.assertTrue(pe_en.startswith(module._clean_base_prompt("图生图")))
        text = module._build_official_pe_text("SYS", "用户需求：\nhello", has_images=False)
        self.assertEqual(
            text,
            "<start_of_turn>system\nSYS<end_of_turn>\n<start_of_turn>user\n"
            "User Raw Input Prompt: 用户需求：\nhello.<end_of_turn>\n<start_of_turn>model\n",
        )
        with_image = module._build_official_pe_text("SYS", "U", has_images=True)
        self.assertIn("<start_of_turn>user\n\n<image_soft_token>\n\nUser Raw Input Prompt: U.", with_image)

    def test_qwen_pe_parses_model_output_like_the_original(self):
        module = importlib.import_module("QQ_ComfyUI_Tools.node_modules.qwen_pe")
        self.assertEqual(module._parse_result('{"rewritten_prompt": "abc", "wh_ratio": "3:2"}'), "abc")
        fenced = "```json" + chr(10) + '{"rewritten_prompt": "abc"}' + chr(10) + "```"
        self.assertEqual(module._parse_result(fenced), "abc")
        self.assertEqual(
            module._parse_result("前缀说明" + chr(10) + '{"rewritten_prompt":"abc"}' + chr(10) + "后缀"),
            "abc",
        )
        self.assertEqual(module._parse_result("plain prompt"), "plain prompt")
        self.assertEqual(module._parse_result('{"rewritten_prompt":  "  spaced  "}'), "spaced")
        self.assertEqual(module._parse_result('{"rewritten_prompt":123}'), "123")
        # 截断的 JSON 原样返回，和原节点一致
        self.assertEqual(module._parse_result('{"rewritten_prompt":"截断"'), '{"rewritten_prompt":"截断"')
        with self.assertRaisesRegex(ValueError, "模型返回为空"):
            module._parse_result("   ")
        think_close = "<" + "/think>"
        self.assertEqual(module._clean_think_blocks("<think>a" + think_close + "b"), "b")
        self.assertEqual(module._clean_think_blocks("<思考>z</思考>w"), "w")
        self.assertEqual(
            module._clean_think_blocks("```thought" + chr(10) + "x" + chr(10) + "```" + chr(10) + "y"),
            "y",
        )
        self.assertEqual(module._clean_think_blocks("garbage" + think_close + "tail"), "tail")
        self.assertEqual(module._clean_think_blocks("no think"), "no think")

    def test_qwen_pe_api_url_and_payload_shape(self):
        module = importlib.import_module("QQ_ComfyUI_Tools.node_modules.qwen_pe")
        self.assertEqual(module._resolve_api_url("https://teynex.com"), "https://teynex.com/v1/responses")
        self.assertEqual(module._resolve_api_url("https://x.com/v1"), "https://x.com/v1/responses")
        self.assertEqual(
            module._resolve_api_url("https://x.com/v1/chat/completions"),
            "https://x.com/v1/chat/completions",
        )
        self.assertEqual(module._resolve_api_url("https://api.deepseek.com"), "https://api.deepseek.com/responses")
        with self.assertRaisesRegex(ValueError, "未配置有效的 API URL"):
            module._resolve_api_url("  ")
        self.assertEqual(module._build_api_input("u", []), "u")
        self.assertEqual(
            module._build_api_input("u", ["AAA"]),
            [{
                "role": "user",
                "content": [
                    {"type": "input_text", "text": "u"},
                    {"type": "input_image", "image_url": "data:image/jpeg;base64,AAA"},
                ],
            }],
        )
        self.assertEqual(module._extract_response_text({"output_text": "B"}), "B")
        self.assertEqual(
            module._extract_response_text(
                {"output": [{"type": "message", "content": [{"type": "output_text", "text": "A"}]}]},
            ),
            "A",
        )
        self.assertEqual(module._extract_response_text({"choices": [{"message": {"content": "C"}}]}), "C")
        self.assertEqual(module._extract_response_text({"error": {"message": "boom"}}), "")
        self.assertEqual(module._normalize_seed(-1), None)
        self.assertEqual(module._normalize_seed(0), 0)
        self.assertEqual(module._normalize_seed(42), 42)

    def test_qwen_pe_collects_images_by_port_index(self):
        module = importlib.import_module("QQ_ComfyUI_Tools.node_modules.qwen_pe")

        class FakeImage(FakeTensor):
            def __init__(self, frames=1):
                self.frames = frames
                self.shape = (frames, 8, 8, 3)

            def detach(self):
                return self

            @property
            def ndim(self):
                return 4

            def __getitem__(self, item):
                return FakeImage(1)

        fake_torch = types.SimpleNamespace(Tensor=FakeImage)
        with patch.object(module, "torch", fake_torch):
            # 列表顺序即 <imageN> 序号，和加载器面板一致
            self.assertEqual(
                len(module._collect_reference_images({"参考图": [FakeImage(), FakeImage(), FakeImage()]})),
                3,
            )
            # 一个口接 QQ-多媒体加载 的 multi output（列表套列表）时按顺序整组展开
            self.assertEqual(
                len(module._collect_reference_images({"参考图": [[FakeImage(), FakeImage()], FakeImage()]})),
                3,
            )
            # 普通 batch 张量按 batch 维展平
            self.assertEqual(len(module._collect_reference_images({"参考图": [FakeImage(4)]})), 4)
            self.assertEqual(module._collect_reference_images({}), [])
            with self.assertRaisesRegex(ValueError, "最多支持 9 张参考图，当前 10 张"):
                module._collect_reference_images({"参考图": [FakeImage(10)]})
            with self.assertRaisesRegex(ValueError, "只接受 IMAGE 张量"):
                module._collect_reference_images({"参考图": ["not a tensor"]})


    def test_qwen_pe_enhance_prompt_modes(self):
        module = importlib.import_module("QQ_ComfyUI_Tools.node_modules.qwen_pe")
        node = module.QQQwenImage21PromptEnhancer

        class FakeImage(FakeTensor):
            def __init__(self, frames=1):
                self.frames = frames
                self.shape = (frames, 8, 8, 3)

            def detach(self):
                return self

            @property
            def ndim(self):
                return 4

            def __getitem__(self, item):
                return FakeImage(1)

        fake_torch = types.SimpleNamespace(Tensor=FakeImage)
        api_base = {
            "输入提示词": ["两个人站在海边"], "任务模式": ["自动"], "输出语言": ["中文"],
            "增强方式": ["API"], "api_url": ["https://example.test"], "api_key": ["key"],
            "model": ["qwen-image"], "最大生成token": [4096],
        }
        self.assertEqual(node().enhance_prompt(**{"输入提示词": ["   "]}), ("",))
        with patch.object(module, "torch", fake_torch), patch.object(module, "_request_api", return_value='{"rewritten_prompt":"api result"}') as request:
            self.assertEqual(node().enhance_prompt(**api_base), ("api result",))
            kwargs = request.call_args.kwargs
            self.assertEqual(kwargs["api_base_url"], "https://example.test")
            self.assertEqual(kwargs["user_prompt"], "用户需求：" + chr(10) + "两个人站在海边")
            self.assertEqual(kwargs["image_base64_list"], [])
            self.assertIn("## Node output controls", kwargs["instructions"])
            self.assertIn("# Image Prompt Rewriting Expert", kwargs["instructions"])

        with patch.object(module, "torch", fake_torch), \
                patch.object(module, "_request_api", return_value="plain") as request, \
                patch.object(module, "_images_to_jpeg_base64", return_value=["B64"]):
            node().enhance_prompt(**{**api_base, "任务模式": ["自动"], "参考图": [FakeImage()]})
            self.assertEqual(request.call_args.kwargs["image_base64_list"], ["B64"])
            self.assertIn("# Edit Prompt Enhancer", request.call_args.kwargs["instructions"])

        # 显式文生图忽略参考图，和原节点一致
        with patch.object(module, "torch", fake_torch), \
                patch.object(module, "_request_api", return_value="plain") as request:
            node().enhance_prompt(**{**api_base, "任务模式": ["文生图"], "参考图": [FakeImage()]})
            self.assertEqual(request.call_args.kwargs["image_base64_list"], [])

        with self.assertRaisesRegex(ValueError, "图生图模式需要连接图片输入"):
            node().enhance_prompt(**{"输入提示词": ["x"], "任务模式": ["图生图"], "增强方式": ["API"]})

        with patch.object(module, "_request_api", side_effect=ValueError("未配置有效的 API URL")):
            with self.assertRaisesRegex(RuntimeError, "QQ Qwen Image 2.1 提示词增强失败：未配置有效的 API URL"):
                node().enhance_prompt(**api_base)

        pe_base = {
            "输入提示词": ["汉服少女"], "任务模式": ["文生图"], "增强方式": ["本地官方PE"],
            "输出语言": ["英文"], "文生图PE模型": ["pe.safetensors"], "图生图PE模型": ["edit.safetensors"],
            "最大生成token": [2048], "seed": [7], "启用思考": [True],
        }
        with patch.object(module, "_request_official_pe", return_value='{"rewritten_prompt":"pe result"}') as request:
            self.assertEqual(node().enhance_prompt(**pe_base), ("pe result",))
            kwargs = request.call_args.kwargs
            self.assertEqual(kwargs["model_name"], "pe.safetensors")
            self.assertEqual(kwargs["max_output_tokens"], 2048)
            self.assertEqual(kwargs["seed"], 7)
            self.assertTrue(kwargs["thinking"])
            self.assertEqual(kwargs["images"], [])
            self.assertIn("## Official PE output protocol", kwargs["system_prompt"])
            self.assertIn("The selected output language is English", kwargs["system_prompt"])

        with patch.object(module, "torch", fake_torch), \
                patch.object(module, "_request_official_pe", return_value="plain") as request:
            node().enhance_prompt(**{**pe_base, "任务模式": ["自动"], "参考图": [FakeImage()]})
            self.assertEqual(request.call_args.kwargs["model_name"], "edit.safetensors")
            self.assertEqual(len(request.call_args.kwargs["images"]), 1)

        with patch.object(module, "_request_official_pe", return_value="plain"), \
                patch.object(module, "_OfficialPEStorage") as storage:
            node().enhance_prompt(**{**pe_base, "生成后自动卸载模型": [True]})
            storage.unload.assert_called_once_with()

        with patch.object(module, "_request_official_pe", return_value="plain"):
            with self.assertRaisesRegex(RuntimeError, "请选择本地官方PE模型"):
                node().enhance_prompt(**{**pe_base, "文生图PE模型": [module.MISSING_MODEL_PLACEHOLDER]})

    def test_qwen_pe_longest_edge_scaling(self):
        module = importlib.import_module("QQ_ComfyUI_Tools.node_modules.qwen_pe")
        controls = module.QQQwenImage21PromptEnhancer.INPUT_TYPES()["required"]
        spec = controls["最大边长"][1]
        self.assertEqual(controls["最大边长"][0], "INT")
        self.assertEqual(spec["default"], 1024)
        self.assertEqual(spec["step"], 32)
        self.assertEqual(spec["min"], 32)
        self.assertEqual(list(controls)[-1], "最大边长")
        self.assertEqual(module._round_to_multiple(1651.6), 1664)
        self.assertEqual(module._round_to_multiple(10), 32)

        class FakeImage:
            def __init__(self, height, width):
                self.shape = (1, height, width, 3)

        small = FakeImage(64, 64)
        # 低于阈值不执行任何操作
        self.assertIs(module._scale_longest_edge(small, 1024), small)
        with patch.object(module, "_resize_tensor_to", return_value="resized") as resize:
            # 超过阈值直接等比缩到阈值
            self.assertEqual(module._scale_longest_edge(FakeImage(2048, 2048), 1024), "resized")
            self.assertEqual(resize.call_args.args[1:], (1024, 1024))
            self.assertEqual(module._scale_longest_edge(FakeImage(1000, 2000), 1024), "resized")
            self.assertEqual(resize.call_args.args[1:], (512, 1024))
            # 非 32 倍数的结果对齐到 32 的倍数
            self.assertEqual(module._scale_longest_edge(FakeImage(1500, 1000), 1024), "resized")
            self.assertEqual(resize.call_args.args[1:], (1024, 672))
        # 阈值非法（<=0）时也不动
        huge = FakeImage(4000, 4000)
        self.assertIs(module._scale_longest_edge(huge, 0), huge)

    def test_qwen_pe_validate_inputs(self):
        module = importlib.import_module("QQ_ComfyUI_Tools.node_modules.qwen_pe")
        node = self.package.NODE_CLASS_MAPPINGS["QQQwenImage21PromptEnhancer"]
        self.assertEqual(
            node.VALIDATE_INPUTS(**{"增强方式": ["API"], "api_url": [""], "api_key": ["k"], "model": ["m"]}),
            "API 方式需要填写 api_url",
        )
        self.assertEqual(
            node.VALIDATE_INPUTS(**{"增强方式": ["API"], "api_url": ["https://x"], "api_key": [""], "model": ["m"]}),
            "API 方式需要填写 api_key（或在本机 TE MAN 的 config.ini 中配置）",
        )
        self.assertEqual(
            node.VALIDATE_INPUTS(**{"增强方式": ["API"], "api_url": ["https://x"], "api_key": ["k"], "model": [""]}),
            "API 方式需要填写 model",
        )
        self.assertTrue(node.VALIDATE_INPUTS(**{
            "增强方式": ["API"], "api_url": ["https://x"], "api_key": ["k"], "model": ["m"],
        }))
        self.assertIn(
            "safetensors PE 模型",
            node.VALIDATE_INPUTS(**{
                "增强方式": ["本地官方PE"], "任务模式": ["文生图"],
                "文生图PE模型": [module.MISSING_MODEL_PLACEHOLDER],
            }),
        )
        # 自动模式要等执行时才知道有没有参考图，交给运行期报错
        self.assertTrue(node.VALIDATE_INPUTS(**{
            "增强方式": ["本地官方PE"], "任务模式": ["自动"],
            "文生图PE模型": [module.MISSING_MODEL_PLACEHOLDER],
        }))

    def test_qwen_pe_has_no_auto_expanding_image_ports(self):
        web_dir = Path(__file__).resolve().parents[1] / "web"
        self.assertFalse((web_dir / "qwen_pe_images.js").exists())
        source = (Path(__file__).resolve().parents[1] / "node_modules" / "qwen_pe.py").read_text(
            encoding="utf-8",
        )
        self.assertIn('REFERENCE_INPUT = "参考图"', source)
        self.assertNotIn("media_bundle", source)
        self.assertNotIn("IMAGE_INPUT_NAMES", source)

    def test_qwen_encode21_pure_encode_node_is_removed(self):
        self.assertNotIn("QQTextEncodeQwenImage21", self.package.NODE_CLASS_MAPPINGS)
        self.assertNotIn("QQTextEncodeQwenImage21", self.package.NODE_DISPLAY_NAME_MAPPINGS)
        module = importlib.import_module("QQ_ComfyUI_Tools.node_modules.qwen_encode21")
        self.assertFalse(hasattr(module, "QQTextEncodeQwenImage21"))
        self.assertEqual(module.MAX_ENCODE_REFERENCE_IMAGES, 16)

    def test_qwen_encode21_flattens_batches_and_caps(self):
        module = importlib.import_module("QQ_ComfyUI_Tools.node_modules.qwen_encode21")

        class FakeImage(FakeTensor):
            def __init__(self, frames=1):
                self.shape = (frames, 8, 8, 3)

            def detach(self):
                return self

            @property
            def ndim(self):
                return 4

            def __getitem__(self, item):
                return FakeImage(1)

        with patch.object(module, "torch", types.SimpleNamespace(Tensor=FakeImage)):
            self.assertEqual(len(module._collect_images([FakeImage(3)])), 3)
            self.assertEqual(len(module._collect_images([[FakeImage(), FakeImage()]])), 2)
            self.assertEqual(module._collect_images([]), [])
            with self.assertRaisesRegex(ValueError, "最多支持 16 张参考图，当前 17 张"):
                module._collect_images([FakeImage(17)])

    def test_qwen_encode21_execute_wiring(self):
        module = importlib.import_module("QQ_ComfyUI_Tools.node_modules.qwen_encode21")

        class FakeImage(FakeTensor):
            def __init__(self, frames=1):
                self.shape = (frames, 8, 8, 3)

            def detach(self):
                return self

            @property
            def ndim(self):
                return 4

            def __getitem__(self, item):
                return FakeImage(1)

        class FakeRGB:
            shape = (1, 64, 64, 3)

            def __getitem__(self, item):
                return FakeRGB()

        class FakeClip:
            def __init__(self):
                self.calls = []

            def tokenize(self, prompt, **kwargs):
                self.calls.append((prompt, {k: (len(v) if isinstance(v, list) else v) for k, v in kwargs.items()}))
                return ("tokens", prompt)

            def encode_from_tokens_scheduled(self, tokens):
                return [[tokens[1], {"pooled": None}]]

        class FakeVAE:
            def __init__(self):
                self.encodes = []

            def encode(self, tensor):
                self.encodes.append(tensor)
                return ("latent", len(self.encodes))

        recorded = {}

        def fake_set_values(conditioning, values={}, append=False):
            recorded["values"] = {k: len(v) if isinstance(v, list) else v for k, v in values.items()}
            return [[cond, {**extra, **values}] for cond, extra in conditioning]

        fake_node_helpers = types.SimpleNamespace(conditioning_set_values=fake_set_values)
        fake_model_management = types.SimpleNamespace(intermediate_device=lambda: "cpu")
        fake_utils = types.SimpleNamespace(common_upscale=lambda *a, **k: None)
        fake_torch = types.SimpleNamespace(
            Tensor=FakeTensor,
            zeros=lambda shape, device=None: ("zeros", tuple(shape), device),
        )
        with patch.dict(sys.modules, {
            "node_helpers": fake_node_helpers,
            "comfy.model_management": fake_model_management,
            "comfy.utils": fake_utils,
        }), patch.object(module, "torch", fake_torch), \
                patch.object(module, "_resize_reference", lambda image, resolution: (FakeRGB(), 64, 64)):
            clip, vae = FakeClip(), FakeVAE()
            positive, negative, latent = module._encode_references(
                clip, "P", "N", vae, 1024, [object(), object()],
            )
            # 两张参考图：视觉槽和 reference_latents 都是 2
            self.assertEqual(clip.calls[0][1]["images"], 2)
            self.assertEqual(clip.calls[0][1]["keep_vision"], False)
            self.assertEqual(clip.calls[0][1]["prevent_empty_text"], True)
            self.assertEqual(len(vae.encodes), 2)
            self.assertEqual(recorded["values"], {"reference_latents": 2})
            self.assertEqual(positive[0][0], "P")
            self.assertEqual(negative[0][0], "N")
            self.assertIn("reference_latents", positive[0][1])
            self.assertIn("reference_latents", negative[0][1])
            self.assertEqual(latent, {"samples": ("zeros", (1, 64, 4, 4), "cpu")})

            # 没接 vae、没接图时 keep_vision=True、不写 reference_latents，latent 用 resolution
            recorded.clear()
            clip2 = FakeClip()
            positive2, _, latent2 = module._encode_references(clip2, "P", "N", None, 1024, [])
            self.assertEqual(clip2.calls[0][1]["keep_vision"], True)
            self.assertEqual(clip2.calls[0][1]["images"], 0)
            self.assertNotIn("reference_latents", positive2[0][1])
            self.assertEqual(latent2, {"samples": ("zeros", (1, 64, 64, 64), "cpu")})

    def test_qwen_encode21_all_in_one_contract(self):
        node = self.package.NODE_CLASS_MAPPINGS["QQQwenImage21AllInOne"]
        self.assertEqual(node.RETURN_TYPES, ("IMAGE",))
        self.assertEqual(node.RETURN_NAMES, ("图像",))
        self.assertTrue(node.INPUT_IS_LIST)
        inputs = node.INPUT_TYPES()
        controls = inputs["required"]
        for key in ("model", "clip", "vae", "prompt", "negative_prompt", "resolution",
                    "seed", "steps", "cfg", "sampler_name", "scheduler", "denoise"):
            self.assertIn(key, controls)
        self.assertEqual(controls["steps"][1]["default"], 20)
        self.assertEqual(controls["cfg"][1]["default"], 8.0)
        self.assertEqual(controls["denoise"][1]["default"], 1.0)
        self.assertEqual(controls["seed"][1]["control_after_generate"], True)
        self.assertEqual(list(inputs["optional"]), ["参考图", "latent_image"])
        self.assertEqual(inputs["optional"]["latent_image"][0], "LATENT")

    def test_qwen_encode21_all_in_one_runs_sampler_and_decoder(self):
        module = importlib.import_module("QQ_ComfyUI_Tools.node_modules.qwen_encode21")
        calls = []

        class FakeKSampler:
            def sample(self, **kwargs):
                calls.append(("ksampler", kwargs))
                return ({"samples": "denoised"},)

        class FakeVAEDecode:
            def decode(self, vae, samples):
                calls.append(("decode", vae, samples))
                return ("image",)

        fake_nodes = types.SimpleNamespace(KSampler=FakeKSampler, VAEDecode=FakeVAEDecode)
        with patch.dict(sys.modules, {"nodes": fake_nodes}), patch.object(
            module, "_encode_references", return_value=("pos", "neg", {"samples": "empty"})
        ):
            (image,) = module.QQQwenImage21AllInOne().run(
                model=["M"], clip=["C"], vae=["V"], prompt=["P"], negative_prompt=["N"],
                resolution=[1024], seed=[7], steps=[28], cfg=[4.5],
                sampler_name=["euler"], scheduler=["simple"], denoise=[0.9],
                **{module.REFERENCE_INPUT: []},
            )
        self.assertEqual(image, "image")
        kind, kwargs = calls[0]
        self.assertEqual(kind, "ksampler")
        self.assertEqual(kwargs["model"], "M")
        self.assertEqual(kwargs["seed"], 7)
        self.assertEqual(kwargs["steps"], 28)
        self.assertEqual(kwargs["cfg"], 4.5)
        self.assertEqual(kwargs["sampler_name"], "euler")
        self.assertEqual(kwargs["scheduler"], "simple")
        self.assertEqual(kwargs["positive"], "pos")
        self.assertEqual(kwargs["negative"], "neg")
        self.assertEqual(kwargs["latent_image"], {"samples": "empty"})
        self.assertEqual(kwargs["denoise"], 0.9)
        self.assertEqual(calls[1], ("decode", "V", {"samples": "denoised"}))

        # 接了 latent_image 时采样画布完全由它决定
        calls.clear()
        with patch.dict(sys.modules, {"nodes": fake_nodes}), patch.object(
            module, "_encode_references", return_value=("pos", "neg", {"samples": "empty"})
        ):
            module.QQQwenImage21AllInOne().run(
                model=["M"], clip=["C"], vae=["V"], prompt=["P"], negative_prompt=["N"],
                resolution=[1024], seed=[0], steps=[20], cfg=[8.0],
                sampler_name=["euler"], scheduler=["normal"], denoise=[1.0],
                latent_image=[{"samples": "custom"}],
            )
        self.assertEqual(calls[0][1]["latent_image"], {"samples": "custom"})

    def test_lightroom_controls_default_to_zero(self):
        lightroom = self.package.NODE_CLASS_MAPPINGS["QQLightroomColor"]
        controls = lightroom.INPUT_TYPES()["required"]
        self.assertEqual(controls["temperature"][1]["default"], 0.0)
        self.assertEqual(controls["tint"][1]["default"], 0.0)
        self.assertEqual(controls["saturation"][1]["default"], 0.0)

    def test_multi_primitive_is_registered_as_a_frontend_virtual_node(self):
        source = (Path(__file__).resolve().parents[1] / "web" / "multi_primitive.js").read_text(
            encoding="utf-8",
        )
        self.assertIn('const NODE_TYPE = "QQ-多值输入";', source)
        self.assertIn('const LEGACY_NODE_TYPE = "QQMultiPrimitive";', source)
        self.assertIn('title: "QQ-多值输入"', source)
        self.assertIn('beforeRegisterNodeDef(nodeType, nodeData)', source)
        self.assertIn('installVirtualNode(existingNodeType)', source)
        self.assertIn('multiPrimitiveSourcePrototype = MultiPrimitiveNode.prototype;', source)
        self.assertIn('skip_list: true', source)
        self.assertIn('function liveComboValues(widget)', source)
        self.assertIn('name: "QQ.MultiPrimitive"', source)
        self.assertIn('category: "QQ/工具"', source)
        self.assertIn('const name = `value_${slot + 1}`;', source)
        self.assertIn('function inputDisplayName(info, fallback)', source)
        self.assertIn('/^value_\\d+$/i.test(displayName)', source)
        self.assertIn('widget.label = inputDisplayName(info, `输入 ${slot + 1}`);', source)

    def test_media_auto_splitter_contract(self):
        splitter = self.package.NODE_CLASS_MAPPINGS["QQMediaAutoSplitter"]
        self.assertEqual(splitter.RETURN_NAMES, ("图像", "音频", "视频", "图片组合"))
        self.assertEqual(splitter.OUTPUT_IS_LIST, (True, True, True, False))
        self.assertTrue(splitter.INPUT_IS_LIST)
        inputs = splitter.INPUT_TYPES()
        self.assertEqual(inputs["optional"]["media_bundle"][0], "MINIMAX_H3_MEDIA_BUNDLE")
        self.assertEqual(inputs["optional"]["image"][0], "IMAGE")
        controls = inputs["optional"]
        self.assertEqual(controls["组合排列"][1]["default"], "从左向右")
        self.assertEqual(
            controls["组合排列"][0],
            ["从左向右", "从右向左", "单元居中排列"],
        )
        source = (Path(__file__).resolve().parents[1] / "node_modules" / "media.py").read_text(
            encoding="utf-8",
        )
        self.assertIn('ordered = normalized if layout == "从左向右" else list(reversed(normalized))', source)
        self.assertIn('sum(int(image.shape[2]) for image in ordered)', source)
        self.assertIn('MEDIA_COMPOSE_GAP = 10', source)
        self.assertIn('layout == "单元居中排列"', source)
        self.assertIn('columns = len(normalized)', source)
        self.assertIn('rows = 1', source)
        self.assertIn('elif image is not None:', source)
        self.assertIn('if media_bundle is not None:', source)

    def test_media_loader_contract_and_three_separate_outputs(self):
        loader = self.package.NODE_CLASS_MAPPINGS["QQMediaLoader"]
        self.assertEqual(loader.RETURN_TYPES, ("IMAGE", "AUDIO", "VIDEO", "MINIMAX_H3_MEDIA_BUNDLE"))
        self.assertEqual(loader.RETURN_NAMES, ("multi output", "audio output", "video output", "media_bundle"))
        self.assertEqual(loader.OUTPUT_IS_LIST, (True, True, True, False))
        empty_result = loader.load("")
        self.assertEqual(set(empty_result), {"ui", "result"})
        self.assertEqual(
            empty_result["ui"]["qq_external_images"],
            {"count": 0, "positions": []},
        )
        empty_outputs = empty_result["result"]
        self.assertEqual(empty_outputs[:3], ([], [], []))
        self.assertEqual(empty_outputs[3].items, ())
        splitter = self.package.NODE_CLASS_MAPPINGS["QQMediaAutoSplitter"]
        self.assertEqual(splitter.INPUT_TYPES()["optional"]["media_bundle"][0], loader.RETURN_TYPES[3])
        media = importlib.import_module("QQ_ComfyUI_Tools.node_modules.media")
        self.assertEqual(media._media_loader_kind("folder/a.png"), "image")
        self.assertEqual(media._media_loader_kind("folder/a.mp3"), "audio")
        self.assertEqual(media._media_loader_kind("folder/a.mp4"), "video")
        self.assertEqual(media._media_loader_kind("folder/a.txt"), None)
        self.assertEqual(media._media_loader_thumbnail_max_edge(230), 256)
        self.assertEqual(media._media_loader_thumbnail_max_edge(350), 384)

        source = (Path(__file__).resolve().parents[1] / "web" / "media_loader.js").read_text(
            encoding="utf-8",
        )
        self.assertIn('const NODE_TYPE = "QQMediaLoader";', source)
        self.assertIn('makeButton("添加媒体", "wysl-media-add"', source)
        self.assertIn('makeButton("选择媒体文件", "wysl-media-modal-files"', source)
        self.assertIn('makeButton("output 根目录"', source)
        self.assertIn('[["list", "列表"], ["3", "3 列"], ["4", "4 列"], ["5", "5 列"]]', source)
        self.assertIn('const DEFAULT_SORT = "created_desc";', source)
        self.assertIn("function sortModalFiles(files, sort)", source)
        self.assertIn('sort.className = "wysl-media-modal-sort";', source)
        self.assertIn("options.append(layout, sort, search);", source)
        self.assertIn('["created_desc", "创建时间 近→远"]', source)
        self.assertIn('["created_asc", "创建时间 远→近"]', source)
        self.assertIn('["name_asc", "文件名 A-Z"]', source)
        self.assertIn('["name_desc", "文件名 Z-A"]', source)
        self.assertIn('["size_desc", "文件大小 大→小"]', source)
        self.assertIn('["size_asc", "文件大小 小→大"]', source)
        self.assertIn('const EXTERNAL_WIDGET = "external_positions";', source)
        self.assertIn('const EXTERNAL_INPUT_NAME = "external_images";', source)
        self.assertIn("function syncExternalRow(node)", source)
        self.assertIn("function parseExternalPositions(spec, count)", source)
        self.assertIn("function externalDisplayModel(node, count)", source)
        self.assertIn("function commitExternalSpec(node)", source)
        self.assertIn("function scheduleExternalCommit(node)", source)
        self.assertIn("if (positions && positions.length === 1 && info && info.count > 1) {", source)
        self.assertIn('makeButton("提交", "wysl-media-external-submit"', source)
        self.assertIn(".wysl-media-card.is-external{", source)
        self.assertIn("ordered.sort((a, b) => a.number - b.number);", source)
        self.assertIn(".wysl-media-toolbar button,.wysl-media-modal button,.wysl-media-external-submit{", source)
        self.assertIn('panel.addEventListener("click", (event) => {', source)
        self.assertNotIn("已连接，未收到外部图片", source)
        self.assertIn("const shown = numbers ? numbers[index] : index + 1;", source)
        self.assertIn('externalInput.addEventListener("keydown"', source)
        self.assertIn('if (event.key !== "Enter") return;', source)
        self.assertIn('api.addEventListener("executed"', source)
        self.assertIn("panel.append(toolbar, external, groups, status);", source)
        self.assertIn(".wysl-media-external-input{", source)
        self.assertIn('const layout = searching ? "4"', source)
        self.assertNotIn('input.webkitdirectory = true', source)
        self.assertIn("当前目录全选", source)
        self.assertIn('makeButton("取消所选", "wysl-media-modal-clear-selection"', source)
        self.assertIn("function clearCurrentFolder(node)", source)
        self.assertIn("const clearSelected = modal.querySelector(\".wysl-media-modal-clear-selection\")", source)
        self.assertIn("wysl-media-modal-overlay", source)
        self.assertIn("is-reorder-target", source)
        self.assertIn("function clearPanelDropTarget(node)", source)
        self.assertIn("if (node.__wyslMediaLoaderDrag) return;", source)
        self.assertIn("clearPanelDropTarget(node);", source)
        self.assertIn("addDroppedFiles(node, files)", source)
        self.assertIn("/wysl/media-loader/list", source)
        self.assertNotIn("currentFolderFiles(node", source)
        self.assertIn("function hoverPreviewDimensions(width, height, viewportWidth, viewportHeight)", source)
        self.assertIn("width: Math.round(Math.min(width * 3, viewportWidth - 16))", source)
        self.assertIn("height: Math.round(Math.min(height * 3, viewportHeight - 16))", source)
        self.assertIn("const HOVER_PREVIEW_CLOSE_DELAY = 180", source)
        self.assertIn("function attachImageHoverPreview(node, anchor, path)", source)
        self.assertIn("function scheduleHoverPreviewClose(node, preview)", source)
        self.assertIn("preview.href = mediaUrl(path);", source)
        self.assertIn('preview.target = "_blank";', source)
        self.assertIn('preview.rel = "noopener noreferrer";', source)
        self.assertIn('preview.addEventListener("pointerenter"', source)
        self.assertIn('preview.addEventListener("pointerleave"', source)
        self.assertIn("pointer-events:auto", source)
        self.assertIn("section.hidden = group.type !== \"image\"", source)
        self.assertIn("wysl-media-hover-preview", source)

    def test_media_loader_external_image_positions(self):
        media = importlib.import_module("QQ_ComfyUI_Tools.node_modules.media")
        node = self.package.NODE_CLASS_MAPPINGS["QQMediaLoader"]
        self.assertTrue(node.INPUT_IS_LIST)
        optional = node.INPUT_TYPES()["optional"]
        self.assertEqual(optional["external_images"][0], "IMAGE")
        self.assertIn("external_positions", optional)
        self.assertEqual(media._media_loader_parse_positions("", 2), None)
        self.assertEqual(media._media_loader_parse_positions("0", 2), None)
        self.assertEqual(media._media_loader_parse_positions("2", 3), [2, 3, 4])
        self.assertEqual(media._media_loader_parse_positions("2,5", 2), [2, 5])
        self.assertEqual(media._media_loader_parse_positions("2-3", 2), [2, 3])
        with self.assertRaises(ValueError):
            media._media_loader_parse_positions("3-2", 2)
        with self.assertRaises(ValueError):
            media._media_loader_parse_positions("1-100", 100)
        with self.assertRaises(ValueError):
            media._media_loader_parse_positions("2,5", 3)
        with self.assertRaises(ValueError):
            media._media_loader_parse_positions("2,2", 2)
        with self.assertRaises(ValueError):
            media._media_loader_parse_positions("0,2", 2)
        with self.assertRaises(ValueError):
            media._media_loader_parse_positions("a", 2)
        merged, positions = media._media_loader_merge_images(["a", "b", "c"], ["x", "y"], "2")
        self.assertEqual(merged, ["a", "x", "y", "b", "c"])
        self.assertEqual(positions, [2, 3])
        merged, positions = media._media_loader_merge_images(["a", "b", "c"], ["x", "y"], "")
        self.assertEqual(merged, ["a", "b", "c", "x", "y"])
        self.assertEqual(positions, [4, 5])
        merged, positions = media._media_loader_merge_images(["a", "b", "c"], ["x", "y"], "5,2")
        self.assertEqual(merged, ["a", "y", "b", "c", "x"])
        self.assertEqual(positions, [5, 2])
        merged, positions = media._media_loader_merge_images(["a"], [], "2")
        self.assertEqual(merged, ["a"])
        self.assertEqual(positions, [])

        class FakeBatch:
            """Minimal IMAGE-batch stand-in for the flatten helper."""

            def __init__(self, frames):
                self.frames = list(frames)

            def detach(self):
                return self

            @property
            def ndim(self):
                return 4

            @property
            def shape(self):
                return (len(self.frames), 1, 1, 1)

            def __getitem__(self, index):
                return self.frames[index]

        fake_torch = types.SimpleNamespace(Tensor=FakeBatch)
        with patch.object(media, "torch", fake_torch):
            self.assertEqual(media._media_loader_flatten_images(None), [])
            self.assertEqual(media._media_loader_flatten_images(FakeBatch(["x", "y"])), ["x", "y"])
            self.assertEqual(
                media._media_loader_flatten_images([FakeBatch(["x"]), FakeBatch(["y", "z"])]),
                ["x", "y", "z"],
            )
            with self.assertRaises(ValueError):
                media._media_loader_flatten_images(["not-a-tensor"])
            # Validation runs before upstream nodes execute, so linked inputs
            # arrive as unresolved placeholders and must be skipped there.
            self.assertEqual(media._media_loader_flatten_images([[213, 0]], strict=False), [])
            self.assertEqual(
                media._media_loader_flatten_images([FakeBatch(["x"]), [213, 0]], strict=False),
                ["x"],
            )

    def test_media_loader_output_directory_and_legacy_input_references(self):
        media = importlib.import_module("QQ_ComfyUI_Tools.node_modules.media")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "input"
            output_root = root / "custom-output"
            input_root.mkdir()
            (output_root / "sub").mkdir(parents=True)
            (input_root / "same.png").write_bytes(b"input")
            (output_root / "same.png").write_bytes(b"output")
            (output_root / "sub" / "clip.mp4").write_bytes(b"video")
            (output_root / "sub" / "ignore.txt").write_bytes(b"text")
            with patch.object(sys.modules["folder_paths"], "get_input_directory", return_value=str(input_root), create=True), patch.object(
                sys.modules["folder_paths"], "get_output_directory", return_value=str(output_root)
            ):
                state = media._media_loader_normalize_state(
                    '{"images":["same.png","output::same.png"],"videos":["output::sub/clip.mp4"]}'
                )
                self.assertEqual(state["images"], ["same.png", "output::same.png"])
                self.assertEqual(media._media_loader_input_path("same.png"), str(input_root / "same.png"))
                self.assertEqual(media._media_loader_input_path("output::same.png"), str(output_root / "same.png"))
                self.assertEqual(media.QQMediaLoader.VALIDATE_INPUTS(json.dumps(state)), True)
                self.assertIn("output::same.png", media.QQMediaLoader.IS_CHANGED(json.dumps(state)))
                folder, directories, files = media._media_loader_list_folder("", "output")
                self.assertEqual(folder, "")
                self.assertEqual(directories, [{"name": "sub", "path": "sub"}])
                self.assertEqual([item["name"] for item in files], ["same.png"])
                self.assertIn("created", files[0])
                self.assertIsInstance(files[0]["created"], float)
                self.assertEqual(
                    [item["name"] for item in media._media_loader_list_folder("sub", "output")[2]],
                    ["clip.mp4"],
                )
                with self.assertRaises(ValueError):
                    media._media_loader_list_folder("../input", "output")
                with self.assertRaises(ValueError):
                    media._media_loader_input_path("output::../input/same.png")
                with self.assertRaises(ValueError):
                    media._media_loader_list_folder("", "invalid")

    def test_media_index_output_splits_image_lists_and_bundles(self):
        node = self.package.NODE_CLASS_MAPPINGS["QQMediaIndexOutput"]
        self.assertTrue(node.INPUT_IS_LIST)
        self.assertEqual(len(node.RETURN_TYPES), 64)
        self.assertEqual(node.INPUT_TYPES()["required"]["media"][0], "*")
        controls = node.INPUT_TYPES()["required"]
        self.assertEqual(controls["缩放模式"][1]["default"], "关闭")
        self.assertEqual(controls["缩放算法"][1]["default"], "lanczos")
        self.assertEqual(controls["缩放基准"][1]["default"], "不缩放")
        self.assertIn("总像素(万像素)", controls["缩放基准"][0])
        self.assertEqual(controls["自定义宽度"][1]["default"], 1)
        self.assertEqual(controls["自定义高度"][1]["default"], 1)
        image_values = [object(), object(), object()]
        outputs = node.split(image_values)
        self.assertEqual(outputs[:3], tuple(image_values))
        self.assertTrue(all(value is None for value in outputs[3:]))
        list_widget_outputs = node.split(
            image_values,
            缩放模式=["关闭"],
            宽高比=["原图"],
            自定义宽度=[1],
            自定义高度=[1],
            适配方式=["留白"],
            缩放算法=["lanczos"],
            对齐倍数=["不对齐"],
            缩放基准=["不缩放"],
            缩放长度=[1024],
            背景颜色=["#000000"],
        )
        self.assertEqual(list_widget_outputs[:3], tuple(image_values))
        bundle = {
            "items": [
                {"media_type": "image", "value": "image-1"},
                {"media_type": "image", "value": "image-2"},
                {"media_type": "video", "value": "video-1"},
            ]
        }
        bundle_outputs = node.split(bundle)
        self.assertEqual(bundle_outputs[:3], ("image-1", "image-2", "video-1"))
        wrapped_bundle_outputs = node.split([bundle])
        self.assertEqual(wrapped_bundle_outputs[:3], ("image-1", "image-2", "video-1"))
        duck_bundle = types.SimpleNamespace(items=[
            types.SimpleNamespace(media_type="image", value="image-1"),
            types.SimpleNamespace(media_type="video", value="video-1"),
        ])
        duck_outputs = node.split([duck_bundle])
        self.assertEqual(duck_outputs[:2], ("image-1", "video-1"))
        source = (Path(__file__).resolve().parents[1] / "web" / "media_index_output.js").read_text(
            encoding="utf-8",
        )
        self.assertIn('const NODE_TYPE = "QQMediaIndexOutput";', source)
        self.assertIn('const MEDIA_BUNDLE_TYPE = "MINIMAX_H3_MEDIA_BUNDLE";', source)
        self.assertIn("function descriptorsForConnection(connection)", source)
        self.assertIn("function syncOutputs(node, force = false)", source)
        self.assertIn('const SCALE_MODE_WIDGET = "缩放模式";', source)
        self.assertIn("function syncScaleWidgetVisibility(node)", source)
        self.assertIn("const MIN_NODE_HEIGHT = 90;", source)
        self.assertIn("let pointerHeld = false;", source)
        self.assertIn("this.properties.wysl_media_index_user_resized = true;", source)
        self.assertIn("compact legacy oversized nodes", source)

    def test_media_index_scaling_matches_v2_target_size_rules(self):
        media = importlib.import_module("QQ_ComfyUI_Tools.node_modules.media")
        self.assertEqual(
            media._media_index_target_size(640, 480, "16:9", 1, 1, "长边", 1024, "不对齐"),
            (1024, 576),
        )
        self.assertEqual(
            media._media_index_target_size(640, 480, "自定义", 1, 1, "不缩放", 1024, "8"),
            (480, 480),
        )
        self.assertEqual(
            media._media_index_target_size(1, 1, "原图", 1, 1, "总像素(万像素)", 100, "不对齐"),
            (1000, 1000),
        )
        self.assertEqual(
            media._media_index_target_size(1, 1, "原图", 1, 1, "总像素(kilo pixel)", 100, "不对齐"),
            (316, 316),
        )
        landscape = FakeTensor()
        landscape.ndim = 3
        landscape.shape = (480, 640, 3)
        portrait = FakeTensor()
        portrait.ndim = 3
        portrait.shape = (640, 480, 3)
        with patch.object(
            media,
            "_media_index_resize_image",
            side_effect=lambda value, target_width, target_height, *_args: (target_width, target_height),
        ), patch.object(media.torch, "Tensor", FakeTensor):
            scaled = media._media_index_scale_items(
                [("image", landscape), ("image", portrait)],
                "按宽高比缩放",
                "原图",
                1,
                1,
                "留白",
                "lanczos",
                "不对齐",
                "长边",
                768,
                "#000000",
            )
        self.assertEqual(scaled[0][1], (768, 576))
        self.assertEqual(scaled[1][1], (576, 768))
        source = (Path(__file__).resolve().parents[1] / "web" / "media_index_output.js").read_text(
            encoding="utf-8",
        )
        self.assertIn('const HIDDEN_SCALE_WIDGETS = ["自定义宽度", "自定义高度"];', source)

if __name__ == "__main__":
    unittest.main()
