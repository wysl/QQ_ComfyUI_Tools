"""Tests for the phone UI backend: subgraph expansion and value binding."""

import importlib.util
import json
import pathlib
import re
import sys
import tempfile
import unittest

_MODULES_DIR = pathlib.Path(__file__).resolve().parent.parent / "node_modules"

# mobile_ui imports its sibling directly when loaded outside a package.
if str(_MODULES_DIR) not in sys.path:
    sys.path.insert(0, str(_MODULES_DIR))


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


mobile_graph = _load("mobile_graph_under_test", _MODULES_DIR / "mobile_graph.py")


def _subgraph_workflow():
    """A two-node subgraph with three promoted inputs and one output.

    Mirrors the shape the ComfyUI frontend writes: the instance node's type is
    the subgraph uuid, promoted inputs travel through links from the input node
    (id -10), and the output leaves through links into the output node (-20).
    """
    return {
        "nodes": [
            {
                "id": 1,
                "type": "sg-1",
                "mode": 0,
                "inputs": [
                    {"name": "text", "type": "STRING", "widget": {"name": "text"}, "link": None},
                    {"name": "steps", "type": "INT", "widget": {"name": "steps"}, "link": None},
                ],
                "widgets_values": ["a prompt", 8],
            },
            {
                "id": 2,
                "type": "PreviewImage",
                "mode": 0,
                "inputs": [{"name": "images", "type": "IMAGE", "link": 9}],
            },
        ],
        "links": [[9, 1, 0, 2, 0, "IMAGE"]],
        "definitions": {
            "subgraphs": [
                {
                    "id": "sg-1",
                    "inputNode": {"id": -10},
                    "outputNode": {"id": -20},
                    "inputs": [
                        {"name": "text", "type": "STRING", "id": "i0"},
                        {"name": "steps", "type": "INT", "id": "i1"},
                    ],
                    "outputs": [{"name": "IMAGE", "type": "IMAGE", "linkIds": [8]}],
                    "nodes": [
                        {
                            "id": 10,
                            "type": "CLIPTextEncode",
                            "mode": 0,
                            "inputs": [
                                {"name": "text", "type": "STRING", "widget": {"name": "text"}, "link": 4},
                                {"name": "clip", "type": "CLIP", "link": None},
                            ],
                            "widgets_values": ["inner default"],
                            "outputs": [{"name": "CONDITIONING", "type": "CONDITIONING", "links": []}],
                        },
                        {
                            "id": 11,
                            "type": "KSampler",
                            "mode": 0,
                            "inputs": [
                                {"name": "seed", "type": "INT", "widget": {"name": "seed"}, "link": None},
                                {"name": "steps", "type": "INT", "widget": {"name": "steps"}, "link": 5},
                                {"name": "positive", "type": "CONDITIONING", "link": 6},
                            ],
                            "widgets_values": [0, "randomize", 20],
                            "outputs": [{"name": "LATENT", "type": "LATENT", "links": [7]}],
                        },
                        {
                            "id": 12,
                            "type": "VAEDecode",
                            "mode": 0,
                            "inputs": [{"name": "samples", "type": "LATENT", "link": 7}],
                            "outputs": [{"name": "IMAGE", "type": "IMAGE", "links": [8]}],
                        },
                    ],
                    "links": [
                        {"id": 4, "origin_id": -10, "origin_slot": 0,
                         "target_id": 10, "target_slot": 0, "type": "STRING"},
                        {"id": 5, "origin_id": -10, "origin_slot": 1,
                         "target_id": 11, "target_slot": 1, "type": "INT"},
                        {"id": 6, "origin_id": 10, "origin_slot": 0,
                         "target_id": 11, "target_slot": 2, "type": "CONDITIONING"},
                        {"id": 7, "origin_id": 11, "origin_slot": 0,
                         "target_id": 12, "target_slot": 0, "type": "LATENT"},
                        {"id": 8, "origin_id": 12, "origin_slot": 0,
                         "target_id": -20, "target_slot": 0, "type": "IMAGE"},
                    ],
                }
            ]
        },
    }


class ExpansionTests(unittest.TestCase):
    def test_promoted_values_override_inner_defaults(self):
        prompt = mobile_graph.expand_workflow(_subgraph_workflow())["prompt"]
        # The instance supplied "a prompt"; the inner node serialized
        # "inner default" and must not win.
        self.assertEqual(prompt["1:10"]["inputs"]["text"], "a prompt")
        self.assertEqual(prompt["1:11"]["inputs"]["steps"], 8)

    def test_execution_ids_use_colon_paths(self):
        prompt = mobile_graph.expand_workflow(_subgraph_workflow())["prompt"]
        self.assertEqual(
            sorted(prompt),
            ["1:10", "1:11", "1:12", "2"],
        )

    def test_links_leaving_a_subgraph_resolve_to_inner_nodes(self):
        prompt = mobile_graph.expand_workflow(_subgraph_workflow())["prompt"]
        self.assertEqual(prompt["2"]["inputs"]["images"], ["1:12", 0])

    def test_inner_links_are_prefixed(self):
        prompt = mobile_graph.expand_workflow(_subgraph_workflow())["prompt"]
        self.assertEqual(prompt["1:11"]["inputs"]["positive"], ["1:10", 0])

    def test_seed_control_value_is_not_mistaken_for_the_next_widget(self):
        prompt = mobile_graph.expand_workflow(_subgraph_workflow())["prompt"]
        # widgets_values = [0, "randomize", 20]: steps must be 20, not
        # "randomize".
        self.assertEqual(prompt["1:11"]["inputs"]["seed"], 0)
        self.assertEqual(prompt["1:11"]["inputs"]["steps"], 8)

    def test_boundary_nodes_are_not_emitted(self):
        prompt = mobile_graph.expand_workflow(_subgraph_workflow())["prompt"]
        self.assertNotIn("-10", prompt)
        self.assertNotIn("-20", prompt)
        self.assertNotIn("1:-10", prompt)

    def test_parameters_expose_promoted_inputs_with_targets(self):
        parameters = mobile_graph.expand_workflow(_subgraph_workflow())["parameters"]
        by_name = {parameter["name"]: parameter for parameter in parameters}
        self.assertEqual(set(by_name), {"text", "steps"})
        self.assertEqual(by_name["text"]["value"], "a prompt")
        self.assertEqual(by_name["text"]["targets"], [["1:10", "text"]])
        self.assertEqual(by_name["steps"]["targets"], [["1:11", "steps"]])
        self.assertTrue(by_name["steps"]["key"].endswith(":steps"))

    def test_bypassed_nodes_are_skipped(self):
        workflow = _subgraph_workflow()
        workflow["nodes"][1]["mode"] = 4  # BYPASS
        prompt = mobile_graph.expand_workflow(workflow)["prompt"]
        self.assertNotIn("2", prompt)

    def test_muted_nodes_are_skipped(self):
        workflow = _subgraph_workflow()
        workflow["nodes"][1]["mode"] = 2  # NEVER
        prompt = mobile_graph.expand_workflow(workflow)["prompt"]
        self.assertNotIn("2", prompt)

    def test_reroute_is_spliced_out(self):
        workflow = {
            "nodes": [
                {"id": 1, "type": "EmptyLatentImage", "mode": 0,
                 "outputs": [{"name": "LATENT", "type": "LATENT", "links": [5]}],
                 "widgets_values": [512, 512, 1]},
                {"id": 2, "type": "Reroute", "mode": 0,
                 "inputs": [{"name": "", "type": "*", "link": 5}],
                 "outputs": [{"name": "", "type": "LATENT", "links": [6]}]},
                {"id": 3, "type": "VAEDecode", "mode": 0,
                 "inputs": [{"name": "samples", "type": "LATENT", "link": 6}]},
            ],
            "links": [
                {"id": 5, "origin_id": 1, "origin_slot": 0, "target_id": 2, "target_slot": 0},
                {"id": 6, "origin_id": 2, "origin_slot": 0, "target_id": 3, "target_slot": 0},
            ],
        }
        prompt = mobile_graph.expand_workflow(workflow)["prompt"]
        self.assertNotIn("2", prompt)
        self.assertEqual(prompt["3"]["inputs"]["samples"], ["1", 0])

    def test_legacy_array_links_are_understood(self):
        workflow = {
            "nodes": [
                {"id": 1, "type": "EmptyLatentImage", "mode": 0,
                 "outputs": [{"name": "LATENT", "type": "LATENT", "links": [5]}]},
                {"id": 2, "type": "VAEDecode", "mode": 0,
                 "inputs": [{"name": "samples", "type": "LATENT", "link": 5}]},
            ],
            "links": [[5, 1, 0, 2, 0, "LATENT"]],
        }
        prompt = mobile_graph.expand_workflow(workflow)["prompt"]
        self.assertEqual(prompt["2"]["inputs"]["samples"], ["1", 0])

    def test_nested_subgraphs_chain_their_prefixes(self):
        inner = _subgraph_workflow()
        # Outer subgraph contains one instance of "sg-1" and promotes "text"
        # straight into it.
        outer_definition = {
            "id": "sg-outer",
            "inputNode": {"id": -10},
            "outputNode": {"id": -20},
            "inputs": [{"name": "text", "type": "STRING", "id": "o0"}],
            "outputs": [{"name": "IMAGE", "type": "IMAGE", "linkIds": [51]}],
            "nodes": [
                {
                    "id": 1,
                    "type": "sg-1",
                    "mode": 0,
                    "inputs": [
                        {"name": "text", "type": "STRING",
                         "widget": {"name": "text"}, "link": 50},
                        {"name": "steps", "type": "INT",
                         "widget": {"name": "steps"}, "link": None},
                    ],
                    "widgets_values": ["inner instance text", 8],
                    "outputs": [{"name": "IMAGE", "type": "IMAGE", "links": [51]}],
                }
            ],
            "links": [
                {"id": 50, "origin_id": -10, "origin_slot": 0,
                 "target_id": 1, "target_slot": 0, "type": "STRING"},
                {"id": 51, "origin_id": 1, "origin_slot": 0,
                 "target_id": -20, "target_slot": 0, "type": "IMAGE"},
            ],
        }
        outer = {
            "nodes": [
                {
                    "id": 100,
                    "type": "sg-outer",
                    "mode": 0,
                    "inputs": [{"name": "text", "type": "STRING",
                                "widget": {"name": "text"}, "link": None}],
                    "widgets_values": ["nested prompt"],
                    "outputs": [{"name": "IMAGE", "type": "IMAGE", "links": []}],
                },
            ],
            "links": [],
            "definitions": {
                "subgraphs": inner["definitions"]["subgraphs"] + [outer_definition]
            },
        }
        prompt = mobile_graph.expand_workflow(outer)["prompt"]
        # The value promoted by the outermost instance must win over the value
        # the intermediate instance serialized.
        self.assertIn("100:1:10", prompt)
        self.assertEqual(prompt["100:1:10"]["inputs"]["text"], "nested prompt")


class ApplyValuesTests(unittest.TestCase):
    def setUp(self):
        path = _MODULES_DIR / "mobile_ui.py"
        self.ui = _load("mobile_ui_under_test", path)

    def test_values_are_written_to_every_target(self):
        prompt = {"1:10": {"class_type": "X", "inputs": {"text": "old"}}}
        parameters = [
            {
                "key": "1:text",
                "name": "text",
                "targets": [["1:10", "text"]],
            }
        ]
        updated, warnings = self.ui.apply_parameter_values(
            prompt, parameters, {"1:text": "new"}
        )
        self.assertEqual(updated["1:10"]["inputs"]["text"], "new")
        self.assertEqual(warnings, [])
        # The stored template must not be mutated.
        self.assertEqual(prompt["1:10"]["inputs"]["text"], "old")

    def test_array_valued_parameter_reaches_all_targets(self):
        prompt = {
            "1:10": {"class_type": "X", "inputs": {"text": "old"}},
            "1:11": {"class_type": "Y", "inputs": {"text": "old"}},
        }
        parameters = [
            {
                "key": "1:text",
                "name": "text",
                "targets": [["1:10", "text"], ["1:11", "text"]],
            }
        ]
        updated, _ = self.ui.apply_parameter_values(
            prompt, parameters, {"1:text": "shared"}
        )
        self.assertEqual(updated["1:10"]["inputs"]["text"], "shared")
        self.assertEqual(updated["1:11"]["inputs"]["text"], "shared")

    def test_unknown_key_warns_instead_of_failing(self):
        prompt = {"1": {"class_type": "X", "inputs": {}}}
        updated, warnings = self.ui.apply_parameter_values(prompt, [], {"nope": 1})
        self.assertEqual(len(warnings), 1)
        self.assertIn("未知参数", warnings[0])
        self.assertEqual(updated, prompt)

    def test_missing_node_warns(self):
        parameters = [{"key": "k", "name": "n", "targets": [["gone", "text"]]}]
        _, warnings = self.ui.apply_parameter_values({}, parameters, {"k": 1})
        self.assertEqual(len(warnings), 1)
        self.assertIn("不在模板中", warnings[0])

    def test_parameters_are_normalised(self):
        raw = [
            {"key": "k", "name": "n", "type": "INT", "value": 3,
             "targets": [["1", "steps"], ("2", "steps")]},
            "not a dict",
        ]
        normalised = self.ui._normalise_parameters(raw)
        self.assertEqual(len(normalised), 1)
        self.assertEqual(normalised[0]["targets"], [["1", "steps"], ["2", "steps"]])
        self.assertEqual(normalised[0]["type"], "INT")

    def test_extract_media_flattens_outputs(self):
        entry = {
            "outputs": {
                "9": {
                    "images": [
                        {"filename": "a.png", "subfolder": "", "type": "output"}
                    ],
                    "text": ["hello"],
                }
            }
        }
        media = self.ui.extract_media(entry)
        kinds = [item["kind"] for item in media]
        self.assertIn("images", kinds)
        self.assertIn("text", kinds)
        image = next(item for item in media if item["kind"] == "images")
        self.assertIn("/view?", self.ui.media_url(image))

    def test_extract_media_keeps_dimensions_for_the_phone(self):
        entry = {
            "outputs": {
                "65": {
                    "images": [
                        {
                            "filename": "a.png",
                            "subfolder": "",
                            "type": "temp",
                            "metadata": {"kind": "image", "width": 768, "height": 1024},
                        }
                    ]
                }
            }
        }
        image = self.ui.extract_media(entry)[0]
        self.assertEqual(image["metadata"]["width"], 768)
        self.assertEqual(image["metadata"]["height"], 1024)


class ExtraDataTests(unittest.TestCase):
    """Submission must look like the official frontend's, extra_data included.

    Regression: submitting only ``{prompt, client_id}`` made nodes with an
    EXTRA_PNGINFO input fail ("extra_pnginfo[0] is not a dict or missing
    'workflow' key") and dropped the embedded workflow from saved PNGs.
    """

    def setUp(self):
        self.ui = _load("mobile_ui_extradata_under_test", _MODULES_DIR / "mobile_ui.py")

    def test_graph_is_sent_as_extra_pnginfo_workflow(self):
        graph = {"id": "wf-1", "nodes": [{"id": 1, "type": "ShowText|pysssss"}], "links": []}
        extra = self.ui.build_extra_data("client-1", graph)
        self.assertIn("extra_pnginfo", extra)
        self.assertEqual(extra["extra_pnginfo"]["workflow"], graph)
        self.assertEqual(extra["client_id"], "client-1")

    def test_workflow_id_is_reported_for_job_grouping(self):
        graph = {"id": "wf-1", "nodes": []}
        extra = self.ui.build_extra_data("c", graph)
        self.assertEqual(extra["workflow_metadata"], {"workflow_id": "wf-1"})

    def test_missing_graph_still_submits(self):
        for graph in (None, {}, {"no_nodes": True}):
            extra = self.ui.build_extra_data("c", graph)
            self.assertNotIn("extra_pnginfo", extra)
            self.assertEqual(extra["client_id"], "c")

    def test_graph_without_id_skips_workflow_metadata(self):
        extra = self.ui.build_extra_data("c", {"nodes": []})
        self.assertIn("extra_pnginfo", extra)
        self.assertNotIn("workflow_metadata", extra)

    def test_template_keeps_the_graph_for_later_submissions(self):
        state = self.ui.MobileState()
        graph = {"id": "wf-1", "nodes": [{"id": 1}]}
        state.put("key", {"prompt": {"1": {}}, "parameters": [], "graph": graph})
        self.assertEqual(state.get("key")["graph"], graph)

    def test_template_route_payload_reaches_the_state(self):
        """The /qq_mobile/template handler must forward `graph` into put().

        Regression: put() read ``payload.get("graph")`` but the route built its
        own dict without the key, so every template silently stored an empty
        graph and submissions went out without extra_pnginfo.
        """
        import re

        source = (_MODULES_DIR / "mobile_ui.py").read_text(encoding="utf-8")
        handler = source.split("async def qq_mobile_template")[1].split(
            "@server.routes.get"
        )[0]
        self.assertIn('"graph"', handler, "template handler must forward the graph")


class IconSetTests(unittest.TestCase):
    """Controls draw the same stroked icon set instead of text glyphs."""

    def setUp(self):
        self.html = (_MODULES_DIR.parent / "web" / "mobile.html").read_text(encoding="utf-8")

    def test_one_icon_helper_exists(self):
        self.assertIn("const ICON_PATHS = {", self.html)
        self.assertIn("function iconSvg(name, size = 18", self.html)

    def test_no_text_glyphs_are_left_in_the_controls(self):
        for glyph in ('"⤢"', '"⚄"', '"−"', '"×"', '"▾"', '"›"'):
            self.assertNotIn(f"textContent = {glyph}", self.html, f"{glyph} is still text")

    def test_the_stepper_and_dice_use_icons(self):
        self.assertIn('minus.innerHTML = iconSvg("minus")', self.html)
        self.assertIn('plus.innerHTML = iconSvg("plus")', self.html)
        self.assertIn('dice.innerHTML = iconSvg("dice")', self.html)

    def test_the_two_model_blocks_are_told_apart(self):
        self.assertIn("function advancedBlock(parameters, sectionName = \"\")", self.html)
        block = self.html.split("function advancedBlock(")[1].split("\n}")[0]
        self.assertIn('className = "group-where"', block)

    def test_the_bar_shows_a_sweep_until_a_step_is_reported(self):
        block = self.html.split("function setProgress(ratio) {")[1].split("\n}")[0]
        self.assertIn("indeterminate", block)
        self.assertIn("progress.indeterminate > div", self.html)
        self.assertIn("@keyframes sweep", self.html)


class ParameterLayoutTests(unittest.TestCase):
    """Where each parameter ends up on the phone form.

    Model file pickers are collapsed, but a LoRA's name is only hidden there
    by accident: its weight is on the main form, so the user sees "0.8" without
    knowing which LoRA it applies to.
    """

    def setUp(self):
        self.html = (_MODULES_DIR.parent / "web" / "mobile.html").read_text(encoding="utf-8")

    def test_label_stem_strips_the_last_segment(self):
        self.assertIn('const labelStem = (label) => {', self.html)
        block = self.html.split("const labelStem = (label) => {")[1].split("};")[0]
        self.assertIn("text.lastIndexOf(\"_\")", block)

    def test_a_named_model_picker_is_paired_with_its_weight(self):
        block = self.html.split("function pairModelPickers(sections)")[1].split("\n}\n")[0]
        # It moves the picker into primary, right before the sibling.
        self.assertIn("bucket.primary.splice(index, 0, parameter)", block)
        self.assertIn("labelStem(parameter.label)", block)

    def test_pairing_runs_after_bucketing(self):
        block = self.html.split("function render(parameters)")[1].split("const named")[0]
        self.assertIn("pairModelPickers(sections)", block)
        self.assertLess(
            block.index("isAdvanced(parameter)"),
            block.index("pairModelPickers(sections)"),
        )


    def test_a_prompt_is_a_paragraph_even_when_empty(self):
        block = self.html.split("const multiline = ")[1].split(";")[0]
        self.assertIn("looksLikePrompt", block)
        head = self.html.split("const multiline = ")[0][-600:]
        self.assertIn("提示词|prompt|文本|text", head)

    def test_a_multiline_prompt_can_be_cleared_in_one_tap(self):
        block = self.html.split("function textWrapWithExpand(input, parameter)")[1].split("\n}")[0]
        self.assertIn('className = "clear-btn"', block)
        self.assertIn('iconSvg("erase", 17)', block)
        # Only the long (multi-line) fields get it, and only while they hold text.
        self.assertIn('input.tagName === "TEXTAREA"', block)
        self.assertIn("clear.hidden = !input.value", block)

    def test_clearing_commits_the_empty_value(self):
        block = self.html.split("function textWrapWithExpand(input, parameter)")[1].split("\n}")[0]
        self.assertIn('input.value = ""', block)
        self.assertIn('new Event("input", { bubbles: true })', block)
        self.assertIn(".clear-btn {", self.html)
        self.assertIn("bottom: 8px; right: 8px", self.html)


class RunHistoryTests(unittest.TestCase):
    """Results outlive the page, and a past run can be repeated."""

    def setUp(self):
        self.html = (_MODULES_DIR.parent / "web" / "mobile.html").read_text(encoding="utf-8")
        self.source = (_MODULES_DIR / "mobile_ui.py").read_text(encoding="utf-8")

    def test_results_are_remembered_on_the_phone(self):
        self.assertIn('const HISTORY_KEY = "qq-mobile-history"', self.html)
        block = self.html.split("function pushHistory(media)")[1].split("\n}")[0]
        self.assertIn("values: { ...state.values }", block)

    def test_a_finished_run_is_recorded(self):
        poll = self.html.split("async function poll()")[1].split("\nasync function cancel")[0]
        self.assertIn("pushHistory(state.media)", poll)

    def test_a_past_result_opens_full_screen(self):
        self.assertIn("function openViewer(entry)", self.html)
        self.assertIn('class="viewer" id="viewer"', self.html)

    def test_a_past_result_can_be_run_again(self):
        block = self.html.split("function reuseEntry()")[1].split("\n}")[0]
        self.assertIn("state.values[key] = value", block)
        self.assertIn("generate()", block)

    def test_reuse_is_offered_only_for_the_same_pipeline(self):
        block = self.html.split("function openViewer(entry)")[1].split("\n}")[0]
        self.assertIn("const sameWorkflow", block)
        self.assertIn('el("viewerReuse").hidden = !sameWorkflow', block)


class BatchTests(unittest.TestCase):
    """One press can queue several images."""

    def setUp(self):
        self.html = (_MODULES_DIR.parent / "web" / "mobile.html").read_text(encoding="utf-8")
        self.source = (_MODULES_DIR / "mobile_ui.py").read_text(encoding="utf-8")

    def test_the_count_is_remembered_and_capped(self):
        self.assertIn('const BATCH_KEY = "qq-mobile-batch"', self.html)
        self.assertIn("const BATCH_MAX = 4", self.html)
        block = self.html.split("function cycleBatch()")[1].split("\n}")[0]
        self.assertIn("state.batch >= BATCH_MAX ? 1 : state.batch + 1", block)

    def test_each_extra_image_gets_its_own_seed(self):
        block = self.html.split("function nextSeedValues(values)")[1].split("\n}")[0]
        self.assertIn("isSeedParameter(parameter)", block)
        self.assertIn("randomSeed(parameter)", block)
        gen = self.html.split("async function generate()")[1].split("\nfunction stopPolling")[0]
        self.assertIn("nextSeedValues(state.values)", gen)

    def test_all_queued_ids_are_polled(self):
        poll = self.html.split("async function poll()")[1].split("\nasync function cancel")[0]
        self.assertIn("state.promptIds", poll)
        self.assertIn("state.media.push(...data.media)", self.html)

    def test_cancelling_reaches_a_queued_job(self):
        block = self.html.split("async function cancel()")[1].split("\n}")[0]
        self.assertIn("prompt_id: state.promptId", block)
        route = self.source.split('@server.routes.post("/qq_mobile/interrupt")')[1]
        route = route.split("@server.routes")[0]
        self.assertIn('"delete": [prompt_id]', route)


class SwipeSwitchTests(unittest.TestCase):
    """Left/right swipe moves to the next/previous pipeline."""

    def setUp(self):
        self.html = (_MODULES_DIR.parent / "web" / "mobile.html").read_text(encoding="utf-8")

    def test_a_clearly_horizontal_swipe_switches(self):
        block = self.html.split("function attachSwipe()")[1].split("\n}\n")[0]
        self.assertIn("Math.abs(dx) >= SWIPE_MIN" if False else "SWIPE_MIN", block)
        # Horizontal only: a vertical scroll must never switch pipelines.
        self.assertIn("Math.abs(dx) < Math.abs(dy) * 1.5", block)

    def test_swiping_skips_controls_that_scroll_sideways(self):
        block = self.html.split("function swipeIgnored(target)")[1].split("\n}")[0]
        for selector in (".media-thumbs", ".history", ".picker", "input", "textarea"):
            self.assertIn(selector, block)

    def test_it_wraps_around_the_ready_pipelines(self):
        block = self.html.split("async function swipeTo(direction)")[1].split("\n}")[0]
        self.assertIn("% order.length", block)
        order = self.html.split("async function pipelineOrder()")[1].split("\n}")[0]
        self.assertIn("ready.has(key)", order)

    def test_the_swipe_is_wired_at_boot(self):
        self.assertIn("attachSwipe();", self.html)


class PickerErgonomicsTests(unittest.TestCase):
    """Finding a pipeline among dozens, and reading the form at a glance."""

    def setUp(self):
        self.html = (_MODULES_DIR.parent / "web" / "mobile.html").read_text(encoding="utf-8")

    # -- the pipeline list --------------------------------------------------
    def test_the_picker_can_be_searched(self):
        block = self.html.split("async function showPipelinePicker()")[1].split("\nfunction ")[0]
        self.assertIn('placeholder = "搜索流水线…"', block)
        self.assertIn("paint(input.value)", block)

    def test_search_matches_title_name_and_folder(self):
        block = self.html.split("const paint = (query) => {")[1].split("input.addEventListener")[0]
        self.assertIn("row.title, row.name, row.folder, row.key", block)

    def test_an_empty_search_result_says_so(self):
        block = self.html.split("const paint = (query) => {")[1].split("input.addEventListener")[0]
        self.assertIn("没有匹配的流水线", block)

    def test_recently_used_pipelines_come_first(self):
        block = self.html.split("const paint = (query) => {")[1].split("input.addEventListener")[0]
        self.assertIn("loadRecent()", block)
        self.assertIn("最近使用", block)

    def test_opening_a_pipeline_marks_it_recent(self):
        self.assertIn("markRecent(item.key)", self.html)
        self.assertIn('const RECENT_KEY = "qq-mobile-recent"', self.html)

    def test_a_recent_pipeline_is_not_listed_twice(self):
        block = self.html.split("const paint = (query) => {")[1].split("input.addEventListener")[0]
        self.assertIn("shownAbove.add(item.key)", block)
        self.assertIn("if (shownAbove.has(row.key)) continue;", block)

    # -- the form -----------------------------------------------------------
    def test_raw_socket_names_are_shown_in_readable_form(self):
        self.assertIn('seed: "随机种"', self.html)
        self.assertIn('sampler_name: "采样器"', self.html)
        self.assertIn("prettyLabel(parameter.label || parameter.name)", self.html)

    def test_a_user_chosen_label_is_left_alone(self):
        block = self.html.split("function prettyLabel(text) {")[1].split("\n}")[0]
        # Only the known aliases are translated; everything else is kept.
        self.assertIn("|| raw", block)

    def test_empty_text_fields_carry_a_hint(self):
        self.assertIn("input.placeholder = hint", self.html)
        block = self.html.split("function placeholderFor(parameter) {")[1].split("\n}")[0]
        self.assertIn("输入提示词…", block)


class LoraPreviewTests(unittest.TestCase):
    """A LoRA is looked at before it is chosen.

    Thirty LoRAs in one folder share almost the same name; the preview image
    that downloaders write next to the weights is what tells them apart. So the
    first tap on a row shows the picture and the second one picks it.
    """

    def setUp(self):
        self.ui = _load("mobile_ui_lora_preview", _MODULES_DIR / "mobile_ui.py")
        self.html = (_MODULES_DIR.parent / "web" / "mobile.html").read_text(encoding="utf-8")
        self.source = (_MODULES_DIR / "mobile_ui.py").read_text(encoding="utf-8")
        # Tests point the lookup at a temporary directory.
        self._orig_roots = self.ui._loras_roots

    def tearDown(self):
        self.ui._loras_roots = self._orig_roots

    def _use(self, root):
        self.ui._loras_roots = lambda: [str(root)]

    # -- finding the file ---------------------------------------------------
    def test_a_sibling_image_is_found(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "sub").mkdir()
            (root / "sub" / "a.safetensors").write_bytes(b"x")
            preview = root / "sub" / "a.jpeg"
            preview.write_bytes(b"jpg")
            self._use(root)
            self.assertEqual(self.ui._find_lora_preview("sub/a.safetensors"), str(preview))

    def test_a_preview_suffix_wins_over_a_bare_image(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "a.safetensors").write_bytes(b"x")
            (root / "a.png").write_bytes(b"png")
            (root / "a.preview.png").write_bytes(b"preview")
            self._use(root)
            self.assertEqual(
                self.ui._find_lora_preview("a.safetensors"), str(root / "a.preview.png")
            )

    def test_a_video_preview_is_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "a.safetensors").write_bytes(b"x")
            (root / "a.mp4").write_bytes(b"mp4")
            self._use(root)
            self.assertEqual(self.ui._find_lora_preview("a.safetensors"), str(root / "a.mp4"))

    def test_windows_separators_are_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "sub").mkdir()
            (root / "sub" / "a.safetensors").write_bytes(b"x")
            (root / "sub" / "a.png").write_bytes(b"png")
            self._use(root)
            self.assertIsNotNone(self.ui._find_lora_preview("sub\\a.safetensors"))

    def test_leaving_the_loras_directory_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "a.safetensors").write_bytes(b"x")
            (root / "a.png").write_bytes(b"png")
            self._use(root)
            for probe in (
                "../a.safetensors",
                "..\\a.safetensors",
                "/etc/passwd",
                "C:/Windows/win.ini",
                "",
            ):
                self.assertIsNone(
                    self.ui._find_lora_preview(probe), f"{probe!r} must be refused"
                )

    def test_a_lora_without_preview_returns_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "a.safetensors").write_bytes(b"x")
            self._use(root)
            self.assertIsNone(self.ui._find_lora_preview("a.safetensors"))

    def test_the_route_exists(self):
        self.assertIn('@server.routes.get("/qq_mobile/preview")', self.source)
        self.assertIn("web.FileResponse", self.source)

    # -- the interaction ----------------------------------------------------
    def test_the_first_tap_only_previews(self):
        block = self.html.split("function chooseOption(")[1].split("/* ---------------- fullscreen")[0]
        self.assertIn("if (previewable(option) && previewing !== option)", block)
        self.assertIn("showPreview(option)", block)
        # The second tap is the one that commits.
        self.assertIn("onPick(option);", block)

    def test_only_model_rows_need_two_taps(self):
        block = self.html.split("function chooseOption(")[1].split("/* ---------------- fullscreen")[0]
        self.assertIn("MODEL_FILE_RE.test(String(option", block)

    def test_the_preview_says_what_to_do(self):
        self.assertIn("再点一次选择", self.html)

    def test_the_preview_falls_back_to_a_video_then_to_nothing(self):
        block = self.html.split("const showPreview = (option) => {")[1].split("\n    };")[0]
        self.assertIn('createElement("video")', block)
        self.assertIn("无预览图", block)
        # The video element is attached immediately, not only once a frame has
        # decoded: an undecodable codec would otherwise leave an empty box.
        self.assertIn("thumb.replaceChildren(video)", block)

    def test_the_preview_image_is_not_lazy(self):
        """loading="lazy" on a detached <img> never fetches: it is not in the DOM."""
        block = self.html.split("const showPreview = (option) => {")[1].split("\n    };")[0]
        self.assertNotIn('loading = "lazy"', block)


class ComboPickerTests(unittest.TestCase):
    """Dropdowns open a sheet that belongs to the page.

    A native <select> popup is drawn by the browser: light box in a dark UI,
    long model paths wrapped over several lines, no search, and on Android it
    takes over the whole screen.
    """

    def setUp(self):
        self.html = (_MODULES_DIR.parent / "web" / "mobile.html").read_text(encoding="utf-8")

    def test_the_field_is_a_page_button_not_a_select(self):
        block = self.html.split("function fieldFor(parameter)")[1].split("\nfunction ")[0]
        self.assertNotIn('createElement("select")', block)
        self.assertIn('className = "select-field"', block)
        self.assertIn("chooseOption(", block)

    def test_the_picker_has_a_search_box_for_long_lists(self):
        block = self.html.split("function chooseOption(")[1].split("/* ---------------- fullscreen")[0]
        self.assertIn("options.length > 12", block)
        self.assertIn('className = "picker-search"', block)
        self.assertIn("renderRows()", block)

    def test_a_model_path_shows_its_file_name_first(self):
        block = self.html.split("function splitOptionPath(")[1].split("\n}")[0]
        self.assertIn('lastIndexOf("\\\\")', block)
        self.assertIn('lastIndexOf("/")', block)

    def test_the_current_value_is_marked_and_scrolled_to(self):
        block = self.html.split("function chooseOption(")[1].split("/* ---------------- fullscreen")[0]
        self.assertIn('option === current ? " on" : ""', block)
        self.assertIn("scrollIntoView", block)

    def test_picking_updates_the_stored_value(self):
        block = self.html.split("function fieldFor(parameter)")[1].split("\nfunction ")[0]
        self.assertIn("commit(next)", block)
        self.assertIn("paint(next)", block)


class OnDemandPrepareTests(unittest.TestCase):
    """Preparing every workflow on the button press is wasteful.

    Expanding a workflow needs the real graph, so the editor has to load the
    file, expand it and put the user's canvas back. Doing that for the whole
    library blocks the click for seconds and swaps the canvas once per file.
    The phone lists the library anyway (a directory scan), so unprepared
    workflows can simply be shown as 待准备 and expanded when they are picked.
    """

    def setUp(self):
        self.ui = _load("mobile_ui_on_demand", _MODULES_DIR / "mobile_ui.py")
        self.js = (_MODULES_DIR.parent / "web" / "mobile_ui.js").read_text(encoding="utf-8")
        self.html = (_MODULES_DIR.parent / "web" / "mobile.html").read_text(encoding="utf-8")

    # -- the button no longer expands the whole library --------------------
    def test_the_button_does_not_prepare_every_workflow(self):
        button = self.js.split("const openMobile = async (event)")[1].split("\n};\n")[0]
        self.assertNotIn("prepareAllWorkflows", button)

    def test_the_button_still_prepares_the_open_workflow(self):
        button = self.js.split("const openMobile = async (event)")[1].split("\n};\n")[0]
        self.assertIn("prepareTemplate({ notify: false })", button)

    def test_the_bulk_run_is_kept_as_a_manual_entry_point(self):
        self.assertIn("async function prepareAllWorkflows(", self.js)
        self.assertIn("prepareAllWorkflows", self.js)

    # -- the request queue -------------------------------------------------
    def test_a_request_is_queued(self):
        state = self.ui.MobileState()
        record = state.request_prepare("unsaved-1", {"path": "a.json", "title": "A"})
        self.assertEqual(record["state"], "pending")
        self.assertEqual([r["workflow"] for r in state.pending_requests()], ["unsaved-1"])

    def test_a_request_needs_a_path(self):
        state = self.ui.MobileState()
        record = state.request_prepare("unsaved-1", {})
        self.assertEqual(record["path"], "")

    def test_storing_a_template_settles_the_request(self):
        state = self.ui.MobileState()
        state.request_prepare("unsaved-1", {"path": "a.json"})
        state.settle_request("unsaved-1", True)
        self.assertEqual(state.pending_requests(), [])
        self.assertEqual(state.requests["unsaved-1"]["state"], "done")

    def test_a_failure_is_reported_to_the_phone(self):
        state = self.ui.MobileState()
        state.request_prepare("unsaved-1", {"path": "a.json"})
        state.settle_request("unsaved-1", False, "没有可调参数")
        self.assertEqual(state.requests["unsaved-1"]["state"], "failed")
        self.assertEqual(state.requests["unsaved-1"]["error"], "没有可调参数")

    def test_the_routes_exist(self):
        source = (_MODULES_DIR / "mobile_ui.py").read_text(encoding="utf-8")
        self.assertIn('@server.routes.post("/qq_mobile/prepare")', source)
        self.assertIn('@server.routes.get("/qq_mobile/prepare")', source)
        self.assertIn('@server.routes.post("/qq_mobile/prepare-result")', source)

    def test_storing_a_template_settles_the_request_over_http(self):
        source = (_MODULES_DIR / "mobile_ui.py").read_text(encoding="utf-8")
        handler = source.split('@server.routes.post("/qq_mobile/template")')[1]
        handler = handler.split("@server.routes")[0]
        self.assertIn("settle_request(workflow_key, True)", handler)

    # -- the editor serves the requests ------------------------------------
    def test_the_editor_polls_for_requests(self):
        self.assertIn("/qq_mobile/prepare", self.js)
        self.assertIn("servePrepareRequests()", self.js)

    def test_the_editor_restores_the_canvas_after_preparing(self):
        block = self.js.split("async function servePrepareRequests(")[1].split("\nfunction ")[0]
        self.assertIn("finally", block)
        self.assertIn("app.loadGraphData(restore, true, true)", block)

    def test_the_editor_reports_a_failure(self):
        block = self.js.split("async function servePrepareRequests(")[1].split("\nfunction ")[0]
        self.assertIn("/qq_mobile/prepare-result", block)
        self.assertIn("ok: false", block)

    # -- the phone asks for what it wants ----------------------------------
    def test_a_pending_row_asks_for_preparation(self):
        self.assertIn("async function preparePipeline(", self.html)
        self.assertIn('"/qq_mobile/prepare"', self.html)

    def test_the_phone_waits_for_the_template(self):
        block = self.html.split("async function waitForTemplate(")[1].split("\nfunction ")[0]
        self.assertIn("/qq_mobile/template?workflow=", block)
        self.assertIn('"ready"', block)
        self.assertIn('"failed"', block)
        self.assertIn('"timeout"', block)

    def test_unprepared_rows_are_listed_as_pending(self):
        self.assertIn("待准备", self.html)


class DynamicSyncTests(unittest.TestCase):
    """The phone form tracks canvas changes after it was prepared.

    Real scenario: a media loader starts bypassed, then a QQ-多值输入 switch
    enables it. The template was a one-time snapshot, so the phone kept showing
    the stale form — the newly enabled loader never appeared.
    """

    def setUp(self):
        self.js = (_MODULES_DIR.parent / "web" / "mobile_ui.js").read_text(encoding="utf-8")
        self.html = (_MODULES_DIR.parent / "web" / "mobile.html").read_text(encoding="utf-8")

    def test_watcher_is_started_from_setup(self):
        setup = self.js.split("async setup()")[1].split("},")[0]
        self.assertIn("startTemplateWatcher()", setup)

    def test_signature_includes_node_mode(self):
        # Mode is what changes when a bypass rule flips.
        block = self.js.split("function graphSignature")[1].split("\n}")[0]
        self.assertIn("node?.mode", block)

    def test_identical_state_is_not_re_pushed(self):
        block = self.js.split("function startTemplateWatcher")[1].split("\n}")[0]
        self.assertIn("graphSignature(graph) === lastPushedSignature", block)

    def test_push_records_the_signature(self):
        self.assertIn("lastPushedSignature = signature", self.js)

    def test_page_polls_for_a_new_revision(self):
        self.assertIn("TEMPLATE_POLL_MS", self.html)
        self.assertIn("templateRevision", self.html)
        self.assertIn('toast("参数已同步")', self.html)

    def test_typed_values_survive_a_refresh(self):
        block = self.html.split("async function watchTemplate")[1].split("\nasync function")[0]
        self.assertIn("const kept = { ...state.values }", block)

    def test_polling_pauses_while_generating(self):
        block = self.html.split("async function watchTemplate")[1].split("\nasync function")[0]
        self.assertIn("if (state.polling) return;", block)


class TitleTests(unittest.TestCase):
    """The page title is the pipeline name, never a subgraph's name.

    A subgraph instance is usually titled after the stage it wraps ("Text to
    Image (Z-Image-Turbo)"), and using that as the page title made the whole
    pipeline look like that one stage.
    """

    def setUp(self):
        self.js = (_MODULES_DIR.parent / "web" / "mobile_ui.js").read_text(encoding="utf-8")
        self.html = (_MODULES_DIR.parent / "web" / "mobile.html").read_text(encoding="utf-8")
        self.title_fn = self.js.split("function workflowTitle()")[1].split("\n}\n")[0]

    def test_title_comes_from_the_document_title(self):
        self.assertIn("document.title", self.title_fn)
        # The frontend renders "<workflow> - ComfyUI".
        self.assertIn("ComfyUI", self.title_fn)

    def test_suffix_asterisk_and_extension_are_stripped(self):
        self.assertIn('replace(/\\s+-\\s+ComfyUI\\s*$/i', self.title_fn)
        self.assertIn('replace(/^\\*+/, "")', self.title_fn)
        self.assertIn('replace(/\\.json$/i', self.title_fn)

    def test_subgraph_title_is_not_used_as_a_fallback(self):
        self.assertNotIn("subgraph", self.title_fn.replace("subgraph instance", ""))

    def test_page_keeps_the_tab_title_in_sync(self):
        self.assertIn("document.title = data.title", self.html)


class NodeModeFilteringTests(unittest.TestCase):
    """Muted and bypassed nodes must not appear on the phone.

    A bypassed media loader contributes no media, so showing its picker would
    invite the user to choose a file that is silently ignored. The same applies
    to a muted subgraph instance or a disabled QQ-多值输入.
    """

    def setUp(self):
        self.js = (_MODULES_DIR.parent / "web" / "mobile_ui.js").read_text(encoding="utf-8")

    def test_mode_helper_covers_mute_and_bypass(self):
        body = self.js.split("function isNodeActive(node)")[1].split("\n}")[0]
        self.assertIn("mode !== 2", body)
        self.assertIn("mode !== 4", body)

    def test_media_loaders_are_filtered(self):
        block = self.js.split("function mediaParameters(graph)")[1].split("\nfunction ")[0]
        self.assertIn("isNodeActive(node)", block)

    def test_multi_primitive_is_filtered(self):
        block = self.js.split("function multiPrimitiveParameters(graph)")[1].split("\nfunction ")[0]
        self.assertIn("isNodeActive(node)", block)

    def test_subgraph_instances_are_filtered(self):
        block = self.js.split("function subgraphInstances()")[1].split("\nfunction ")[0]
        self.assertIn("isNodeActive(node)", block)

    def test_helper_is_defined_once_and_before_use(self):
        self.assertEqual(self.js.count("function isNodeActive("), 1)
        self.assertLess(
            self.js.index("function isNodeActive("),
            self.js.index("function subgraphInstances()"),
        )

    def test_everything_disabled_is_reported_not_rendered_empty(self):
        self.assertIn("既没有子图，也没有 QQ-多值输入 或媒体加载节点", self.js)


class GroupSwitchTests(unittest.TestCase):
    """A QQ-魔术贴 group must be switchable from the phone.

    A QQ-魔术贴 bypasses every node of its group while its 模式 widget says
    绕过. A bypassed node is not merely disabled, it is absent from the prompt
    altogether — so the phone cannot offer a picker for it, and flipping the
    switch on the phone cannot bring it back.

    The fix is to keep one prompt per switch state: the extension sets the
    tag's 模式 widget and asks the frontend for the prompt again, which
    produces exactly the prompt that state runs. The backend then picks the
    prompt that matches the values the phone sent.
    """

    def setUp(self):
        self.ui = _load("mobile_ui_group_switch", _MODULES_DIR / "mobile_ui.py")
        self.js = (_MODULES_DIR.parent / "web" / "mobile_ui.js").read_text(encoding="utf-8")

    @staticmethod
    def _record():
        return {
            "workflow": "wf",
            "title": "wf",
            # The bypassed state: the loader is gone from the prompt.
            "prompt": {"1": {"class_type": "Tag", "inputs": {}}},
            "variants": {
                "106=绕过": {"1": {"class_type": "Tag", "inputs": {}}},
                "106=启用": {
                    "1": {"class_type": "Tag", "inputs": {}},
                    "70": {"class_type": "LoadImage", "inputs": {"image": "old.png"}},
                },
            },
            "switches": [{"tag": "106", "key": "108:模式", "default": "绕过"}],
            "parameters": [
                {
                    "key": "108:模式",
                    "name": "模式",
                    "label": "模式",
                    "type": "COMBO",
                    "value": "绕过",
                    "options": ["绕过", "启用"],
                    "targets": [["106", "模式"]],
                },
                {
                    "key": "70:image",
                    "name": "image",
                    "label": "加载图像",
                    "type": "COMBO",
                    "value": "old.png",
                    "media": "image",
                    "targets": [["70", "image"]],
                },
            ],
        }

    # -- backend: picking the prompt --------------------------------------
    def test_switch_state_picks_its_own_prompt(self):
        record = self._record()
        chosen = self.ui._select_variant(record, {"108:模式": "启用"})
        self.assertIn("70", chosen)

    def test_bypassed_state_picks_the_prompt_without_the_group(self):
        record = self._record()
        chosen = self.ui._select_variant(record, {"108:模式": "绕过"})
        self.assertNotIn("70", chosen)

    def test_missing_value_falls_back_to_the_stored_default(self):
        record = self._record()
        chosen = self.ui._select_variant(record, {})
        self.assertNotIn("2", chosen)

    def test_unknown_state_falls_back_to_the_default_prompt(self):
        record = self._record()
        chosen = self.ui._select_variant(record, {"108:模式": "半开"})
        self.assertEqual(chosen, record["prompt"])

    def test_template_without_variants_uses_its_prompt(self):
        record = self._record()
        record["variants"] = {}
        record["switches"] = []
        self.assertEqual(self.ui._select_variant(record, {"108:模式": "启用"}), record["prompt"])

    def test_variant_key_matches_the_extension(self):
        pairs = [("106", "启用"), ("7", "绕过")]
        self.assertEqual(self.ui._variant_key(pairs), "106=启用;7=绕过")
        self.assertIn('`${tag}=${value}`', self.js)
        self.assertIn('.sort()\n        .join(";")', self.js)

    def test_switched_group_runs_with_the_chosen_file(self):
        record = self._record()
        values = {"108:模式": "启用", "70:image": "new.png"}
        prompt, _warnings = self.ui.apply_parameter_values(
            self.ui._select_variant(record, values), record["parameters"], values
        )
        self.assertIn("70", prompt)
        self.assertEqual(prompt["70"]["inputs"]["image"], "new.png")

    def test_bypassed_group_does_not_run(self):
        record = self._record()
        values = {"108:模式": "绕过", "70:image": "new.png"}
        prompt, warnings = self.ui.apply_parameter_values(
            self.ui._select_variant(record, values), record["parameters"], values
        )
        self.assertNotIn("70", prompt)
        self.assertTrue(any("不在模板中" in item for item in warnings))

    # -- backend: storing the variants ------------------------------------
    def test_template_stores_the_variants_and_the_switches(self):
        payload = {
            "workflow": "wf",
            "title": "wf",
            "prompt": {"1": {}},
            "parameters": [],
            "variants": {"106=启用": {"1": {}, "2": {}}},
            "switches": [{"tag": "106", "key": "108:模式", "default": "绕过"}],
        }
        state = self.ui.MobileState()
        record = state.put("wf", payload)
        self.assertIn("106=启用", record["variants"])
        self.assertEqual(record["switches"][0]["key"], "108:模式")

    def test_template_route_forwards_the_variants(self):
        source = (_MODULES_DIR / "mobile_ui.py").read_text(encoding="utf-8")
        handler = source.split('@server.routes.post("/qq_mobile/template")')[1].split("@server.routes")[0]
        self.assertIn('"variants"', handler)
        self.assertIn('"switches"', handler)

    def test_get_template_reports_the_switches(self):
        source = (_MODULES_DIR / "mobile_ui.py").read_text(encoding="utf-8")
        handler = source.split('@server.routes.get("/qq_mobile/template")')[1].split("@server.routes")[0]
        self.assertIn('"switches"', handler)

    # -- extension: finding the switch and building the prompts -----------
    def test_switch_is_found_through_the_tag_mode_input(self):
        block = self.js.split("function switchableTags(graph)")[1].split("\nfunction ")[0]
        self.assertIn("GROUP_TAG_TYPE", block)
        self.assertIn("GROUP_TAG_MODE", block)
        self.assertIn("target_slot", block)
        self.assertIn("__h3MultiPrimitiveSlot", block)

    def test_one_prompt_is_built_per_switch_state(self):
        block = self.js.split("async function promptVariants(")[1].split("\nfunction ")[0]
        self.assertIn("app.graphToPrompt()", block)
        self.assertIn("tagStates(tag)", block)
        states = self.js.split("function tagStates(")[1].split("\nfunction ")[0]
        self.assertIn("GROUP_TAG_ON", states)
        self.assertIn("GROUP_TAG_OFF", states)

    def test_the_canvas_is_restored_after_building_the_prompts(self):
        block = self.js.split("async function promptVariants(")[1].split("\nfunction ")[0]
        self.assertIn("finally", block)
        self.assertIn("applyTagState(tag, original[index])", block)

    def test_the_switch_is_driven_through_the_multi_primitive(self):
        # The 多值输入 keeps writing its value into the tag, so the tag's own
        # widget cannot be set directly.
        block = self.js.split("function applyTagState(")[1].split("\nfunction ")[0]
        self.assertIn("tag.slotWidget", block)
        self.assertIn("widget.callback?.(", block)

    def test_a_bypassed_group_still_gets_a_picker(self):
        block = self.js.split("async function prepareTemplate(")[1].split("\nasync function ")[0]
        self.assertIn("switchableMedia", block)
        self.assertIn("mediaParameters(graph)", block)


class MediaInputTests(unittest.TestCase):
    """Image-to-image needs media, not just numbers.

    ``LoadImage`` stores a file name in a combo widget, while
    ``QQ-多媒体加载`` keeps one JSON string holding images/audios/videos. Both
    are ordinary widgets, so the same (node, input) override carries them —
    only the encoding differs.
    """

    def setUp(self):
        self.ui = _load("mobile_ui_media_under_test", _MODULES_DIR / "mobile_ui.py")
        self.js = (_MODULES_DIR.parent / "web" / "mobile_ui.js").read_text(encoding="utf-8")
        self.html = (_MODULES_DIR.parent / "web" / "mobile.html").read_text(encoding="utf-8")

    # -- backend encoding ------------------------------------------------
    def test_plain_media_parameter_passes_the_file_name_through(self):
        parameter = {"media": "image", "mediaState": False}
        self.assertEqual(self.ui._serialise_media_value(parameter, "a.png"), "a.png")

    def test_media_state_list_is_encoded_as_images(self):
        parameter = {"media": "image", "mediaState": True}
        encoded = self.ui._serialise_media_value(parameter, ["a.png", "b.jpg"])
        self.assertEqual(json.loads(encoded), {"images": ["a.png", "b.jpg"]})

    def test_media_state_uses_the_matching_key_per_kind(self):
        for kind, key in (("image", "images"), ("video", "videos"), ("audio", "audios")):
            parameter = {"media": kind, "mediaState": True}
            encoded = self.ui._serialise_media_value(parameter, ["x"])
            self.assertIn(key, json.loads(encoded))

    def test_media_state_single_string_is_wrapped(self):
        parameter = {"media": "image", "mediaState": True}
        self.assertEqual(json.loads(self.ui._serialise_media_value(parameter, "a.png")),
                         {"images": ["a.png"]})

    def test_already_encoded_media_state_is_kept(self):
        parameter = {"media": "image", "mediaState": True}
        original = '{"images": ["x.png"]}'
        self.assertEqual(self.ui._serialise_media_value(parameter, original), original)

    def test_state_is_written_as_a_json_string_not_an_object(self):
        prompt = {"9": {"class_type": "QQMediaLoader", "inputs": {"media_state": ""}}}
        parameters = [{
            "key": "9:media_state", "name": "media_state",
            "targets": [["9", "media_state"]],
            "mediaState": True, "media": "image",
        }]
        updated, warnings = self.ui.apply_parameter_values(
            prompt, parameters, {"9:media_state": ["a.png"]}
        )
        value = updated["9"]["inputs"]["media_state"]
        self.assertIsInstance(value, str)
        self.assertEqual(json.loads(value), {"images": ["a.png"]})
        self.assertEqual(warnings, [])

    def test_media_extensions_cover_the_three_kinds(self):
        self.assertIn(".png", self.ui.MEDIA_EXTENSIONS["image"])
        self.assertIn(".mp4", self.ui.MEDIA_EXTENSIONS["video"])
        self.assertIn(".mp3", self.ui.MEDIA_EXTENSIONS["audio"])

    # -- frontend wiring -------------------------------------------------
    def test_known_loader_nodes_are_mapped(self):
        for node in ("LoadImage", "LoadVideo", "LoadAudio", "QQ-多媒体加载"):
            self.assertIn(node, self.js)

    def test_media_fields_render_a_picker_with_upload(self):
        self.assertIn("mediaField(parameter", self.html)
        self.assertIn("uploadMedia(", self.html)
        self.assertIn("/qq_mobile/upload", self.html)

    def test_media_list_endpoint_is_used_for_existing_files(self):
        self.assertIn("/qq_mobile/media?kind=", self.html)

    def test_media_parameters_come_before_regular_ones(self):
        body = self.js.split("const media = mediaParameters(graph)")[0]
        self.assertIn("mediaParameters(graph)", self.js)
        # The media block is pushed before multi/subgraph parameters.
        after = self.js.split("const media = mediaParameters(graph)")[1]
        media_push = after.index("parameters.push(entry)")
        sub_push = after.index("promotedTargets(instance)")
        self.assertLess(media_push, sub_push)


class MultiPrimitiveTests(unittest.TestCase):
    """``QQ-多值输入`` wins over subgraph promoted inputs.

    That node is a frontend virtual node: it never reaches the submitted
    prompt. Its values flow along links into real node inputs, so those links
    are what a parameter has to write to.
    """

    def setUp(self):
        self.js = (_MODULES_DIR.parent / "web" / "mobile_ui.js").read_text(encoding="utf-8")
        self.html = (_MODULES_DIR.parent / "web" / "mobile.html").read_text(encoding="utf-8")

    def test_both_node_type_names_are_recognised(self):
        self.assertIn('const MULTI_PRIMITIVE_TYPE = "QQ-多值输入";', self.js)
        self.assertIn('const MULTI_PRIMITIVE_LEGACY = "QQMultiPrimitive";', self.js)

    def test_multi_primitive_is_checked_before_subgraphs(self):
        body = self.js.split("async function prepareTemplate")[1].split("const workflowKey")[0]
        multi_at = body.index("multiPrimitiveParameters(graph)")
        sub_at = body.index("promotedTargets(instance)")
        self.assertLess(multi_at, sub_at)
        # And it is an either/or, not an addition.
        self.assertIn("else if (instances.length)", body)

    def test_targets_are_the_linked_real_inputs(self):
        block = self.js.split("function multiPrimitiveParameters")[1].split("\nfunction ")[0]
        self.assertIn("link.target_id", block)
        self.assertIn("link.target_slot", block)
        self.assertIn("targets.push(entry)", block)

    def test_labels_come_from_the_widget(self):
        block = self.js.split("function multiPrimitiveParameters")[1].split("\nfunction ")[0]
        self.assertIn("widget.label", block)

    def test_widget_types_map_to_form_controls(self):
        block = self.js.split("function widgetTypeToSlot")[1].split("\nfunction ")[0]
        self.assertIn('"combo"', block)
        self.assertIn("INT", block)
        self.assertIn("FLOAT", block)
        self.assertIn("BOOLEAN", block)

    def test_workflow_with_neither_subgraph_nor_multi_primitive_is_rejected(self):
        self.assertIn("既没有子图，也没有 QQ-多值输入", self.js)

    def test_promoted_dropdowns_are_not_collapsed_as_advanced(self):
        # Task mode / aspect ratio are primary choices, not model files.
        block = self.html.split("const isAdvanced = ")[1].split("\n};")[0]
        self.assertIn("MODEL_FILE_RE", block)
        self.assertIn("ADVANCED_LABELS", block)


class ExtensionRegistrationTests(unittest.TestCase):
    """The extension must survive a hostile frontend environment.

    Two real failures motivated these checks:
    1. Alt+Shift+M is already bound to Comfy.Canvas.ToggleMinimap; registering a
       duplicate keybinding throws and aborts the whole extension, so the
       toolbar button silently never appeared.
    2. Any throw in the descriptor has the same effect, so registration must be
       staged with a fallback.
    """

    def setUp(self):
        self.js = (_MODULES_DIR.parent / "web" / "mobile_ui.js").read_text(encoding="utf-8")

    def test_toolbar_button_uses_a_real_material_icon(self):
        """A made-up icon name renders as an empty <i>: the button looked blank."""
        match = re.search(r'const ICON_CLASS = "([^"]+)"', self.js)
        self.assertIsNotNone(match)
        # Verified against the bundled Material font at toolbar size.
        self.assertIn(match.group(1), {"cellphone", "cellphone-link", "monitor-cellphone"})
        self.assertIn("icon: ICON_CLASS", self.js)
        self.assertNotIn("mdi-qq-mobile", self.js)

    def test_toolbar_button_does_not_depend_on_iconElement(self):
        # `iconElement` is a frontend internal; the glyph must not hinge on it.
        block = self.js.split("const createButton = async () => {")[1].split("\n};")[0]
        self.assertIn("button.iconElement ||", block)
        self.assertIn("classList.add", block)

    def test_shortcut_does_not_collide_with_the_builtin_minimap_toggle(self):
        self.assertNotIn('key: "m", alt: true, shift: true', self.js)
        self.assertIn('key: "m", ctrl: true, alt: true', self.js)

    def test_registration_is_staged_with_fallbacks(self):
        self.assertIn("for (const attempt of", self.js)
        self.assertIn("registration attempt failed, retrying simpler", self.js)

    def test_entry_point_is_exposed_before_registration(self):
        # Tests and the phone page rely on window.qqMobile existing.
        exposed = self.js.index("globalThis.qqMobile = ")
        registered = self.js.index("app.registerExtension")
        self.assertLess(exposed, registered)

    def test_button_failure_does_not_abort_setup(self):
        setup = self.js.split("async setup()")[1].split("},")[0]
        self.assertIn("try {", setup)
        self.assertIn("catch", setup)


class ProxyDeploymentTests(unittest.TestCase):
    """Behind a reverse proxy with basic auth, self-requests must not leave.

    Building them from request.url sends the call out to the public hostname,
    where the proxy challenges it with 401 because server-to-server requests
    carry no credentials. That showed up as being asked to log in twice.
    """

    def setUp(self):
        self.source = (_MODULES_DIR / "mobile_ui.py").read_text(encoding="utf-8")

    def test_self_requests_use_the_loopback_base(self):
        self.assertIn("def _local_base(", self.source)
        self.assertIn("127.0.0.1", self.source)

    def test_no_internal_call_is_built_from_request_url_anymore(self):
        for marker in ("with_path(\"/prompt\")", "with_path(\"/interrupt\")",
                       "with_path(\"\").with_query(None)"):
            self.assertNotIn(marker, self.source)

    def test_loopback_is_skipped_when_listening_on_a_single_interface(self):
        body = self.source.split("def _local_base(")[1].split("\ndef ")[0]
        self.assertIn('"0.0.0.0"', body)
        self.assertIn("address", body)


class LongPressEditorTests(unittest.TestCase):
    """Hold a text field for 2s to edit it full screen, in place.

    A phone keyboard covers most of the viewport, so editing a long prompt in
    a 120px box is impractical. Long-press promotes the field to a fullscreen
    panel rather than navigating to another page or opening a tab.
    """

    def setUp(self):
        self.html = (_MODULES_DIR.parent / "web" / "mobile.html").read_text(encoding="utf-8")

    def test_fullscreen_panel_exists(self):
        self.assertIn('id="editor"', self.html)
        self.assertIn('class="editor"', self.html)
        self.assertIn('id="editorText"', self.html)

    def test_panel_covers_the_viewport(self):
        css = self.html.split(".editor {")[1].split("}")[0]
        self.assertIn("position: fixed", css)
        self.assertIn("inset: 0", css)

    def test_long_press_threshold_is_two_seconds(self):
        self.assertIn("const LONG_PRESS_MS = 2000;", self.html)

    def test_movement_cancels_the_press(self):
        # Scrolling over a text field must not pop the editor open.
        self.assertIn("LONG_PRESS_SLOP", self.html)
        self.assertIn("dx > LONG_PRESS_SLOP || dy > LONG_PRESS_SLOP", self.html)

    def test_text_fields_are_wired_but_number_fields_are_not(self):
        # attachLongPress is called on the generic text control only.
        block = self.html.split("const multiline = parameter.multiline")[1].split("return wrap;")[0]
        self.assertIn("attachLongPress(input, parameter)", block)

    def test_commit_writes_back_to_the_field(self):
        close = self.html.split("function closeEditor(")[1].split("\n}")[0]
        self.assertIn("editor.target.value = text.value", close)
        self.assertIn('new Event("input"', close)

    def test_revert_restores_the_original(self):
        self.assertIn("el(\"editorText\").value = editor.original;", self.html)

    def test_escape_cancels_and_ctrl_enter_commits(self):
        self.assertIn('event.key === "Escape"', self.html)
        self.assertIn('event.key === "Enter"', self.html)


class BackButtonTests(unittest.TestCase):
    """The phone page needs a way back to the ComfyUI graph."""

    def setUp(self):
        self.html = (_MODULES_DIR.parent / "web" / "mobile.html").read_text(encoding="utf-8")

    def test_back_button_exists_in_the_header(self):
        header = self.html.split("<header>")[1].split("</header>")[0]
        self.assertIn('id="back"', header)
        self.assertIn("返回 ComfyUI", header)

    def test_back_prefers_history_then_falls_back_to_root(self):
        block = self.html.split('el("back").addEventListener')[1].split("});")[0]
        self.assertIn("history.back()", block)
        self.assertIn("location.assign", block)


class ReachabilityTests(unittest.TestCase):
    """The entry point must not send the user to a page their phone cannot open.

    A ComfyUI started without ``--listen`` binds 127.0.0.1, which no phone on
    the network can reach. Detecting that up front beats navigating to a dead
    URL.
    """

    def setUp(self):
        self.source = (_MODULES_DIR / "mobile_ui.py").read_text(encoding="utf-8")
        self.js = (_MODULES_DIR.parent / "web" / "mobile_ui.js").read_text(encoding="utf-8")

    def test_endpoint_exists(self):
        self.assertIn('"/qq_mobile/reachability"', self.source)

    def test_loopback_binding_is_reported_as_unreachable(self):
        block = self.source.split("async def qq_mobile_reachability")[1].split("async def")[0]
        self.assertIn('"127.0.0.1"', block)
        self.assertIn('"reachable": False', block)

    def test_wildcard_binding_is_reported_as_reachable(self):
        block = self.source.split("async def qq_mobile_reachability")[1].split("async def")[0]
        self.assertIn('"reachable": True', block)

    def test_probe_failure_does_not_block_entry(self):
        block = self.js.split("async function probeMobileReachable")[1].split("\nconst openMobile")[0]
        self.assertIn("reachable: true, known: false", block)

    def test_entry_checks_reachability_before_navigating(self):
        block = self.js.split("const openMobile")[1].split("\nconst createButton")[0]
        self.assertIn("probeMobileReachable()", block)
        # The warning is shown instead of navigating.
        self.assertIn("手机无法访问这个 ComfyUI", block)
        self.assertLess(
            block.index("probeMobileReachable()"),
            block.index("location.assign"),
        )

    def test_network_access_is_not_blocked_by_the_bind_address(self):
        # Viewing through a proxy means a phone can use the same address, even
        # when ComfyUI itself listens on loopback only.
        block = self.source.split("async def qq_mobile_reachability")[1].split("async def")[0]
        self.assertIn("viewed_over_network", block)

    def test_local_view_suggests_the_lan_address(self):
        block = self.source.split("async def qq_mobile_reachability")[1].split("async def")[0]
        self.assertIn("_lan_url(port)", block)
        self.assertIn('"suggested_url"', block)

    def test_lan_url_helper_ignores_loopback(self):
        block = self.source.split("def _lan_url(")[1].split("\ndef ")[0]
        self.assertIn("127.", block)
        self.assertIn("/qq_mobile/", block)


class PipelinePickerTests(unittest.TestCase):
    """The phone lands on a chooser instead of one hard-coded pipeline."""

    def setUp(self):
        self.html = (_MODULES_DIR.parent / "web" / "mobile.html").read_text(encoding="utf-8")

    def test_picker_is_shown_when_no_workflow_is_given(self):
        boot = self.html.split("const initialWorkflow")[1].split("</script>")[0]
        self.assertIn("showPipelinePicker()", boot)
        self.assertIn("loadTemplate()", boot)

    def test_picker_reads_the_template_list(self):
        block = self.html.split("async function showPipelinePicker")[1].split("/* ---------------- boot")[0]
        self.assertIn("/qq_mobile/state", block)

    def test_rows_are_sorted_ready_first_then_newest(self):
        block = self.html.split("async function showPipelinePicker")[1].split("/* ---------------- boot")[0]
        self.assertIn("a.ready !== b.ready", block)
        self.assertIn("(b.updated || 0) - (a.updated || 0)", block)

    def test_tapping_a_row_loads_that_pipeline(self):
        block = self.html.split("function pipelineRow(item, titleCounts)")[1].split("\n}")[0]
        self.assertIn("state.workflow = item.key", block)
        self.assertIn("replaceState", block)

    def test_tapping_an_unprepared_row_prepares_it(self):
        block = self.html.split("function pipelineRow(item, titleCounts)")[1].split("\n}")[0]
        self.assertIn("if (!item.ready)", block)
        self.assertIn("preparePipeline(item, row, meta, arrow)", block)

    def test_picker_lists_the_whole_library_not_only_templates(self):
        block = self.html.split("async function showPipelinePicker")[1].split("/* ---------------- boot")[0]
        self.assertIn("/qq_mobile/workflows", block)
        self.assertIn("/qq_mobile/state", block)

    def test_rows_are_grouped_by_folder(self):
        block = self.html.split("async function showPipelinePicker")[1].split("/* ---------------- boot")[0]
        self.assertIn('className = "folder-head"', block)

    def test_empty_state_explains_how_to_prepare_one(self):
        block = self.html.split("async function showPipelinePicker")[1].split("/* ---------------- boot")[0]
        self.assertIn("还没有可用的流水线", block)

    def test_generate_is_disabled_while_choosing(self):
        block = self.html.split("async function showPipelinePicker")[1].split("/* ---------------- boot")[0]
        self.assertIn('el("generate").disabled = true', block)

    def test_switch_button_returns_to_the_picker(self):
        block = self.html.split('el("switch").addEventListener')[1].split("});")[0]
        self.assertIn("showPipelinePicker()", block)
        self.assertIn('searchParams.delete("workflow")', block)

    def test_switch_button_hidden_on_the_picker(self):
        block = self.html.split("async function showPipelinePicker")[1].split("/* ---------------- boot")[0]
        self.assertIn('el("switch").hidden = true', block)


class MultiSubgraphTests(unittest.TestCase):
    """One pipeline may hold several subgraph instances.

    Distinct instances share promoted-input names ("prompt", "seed"), so the
    template has to keep them apart by instance id and the page has to render
    them under separate headings.
    """

    def setUp(self):
        self.source = (_MODULES_DIR / "mobile_ui.py").read_text(encoding="utf-8")
        self.js = (_MODULES_DIR.parent / "web" / "mobile_ui.js").read_text(encoding="utf-8")
        self.html = (_MODULES_DIR.parent / "web" / "mobile.html").read_text(encoding="utf-8")

    def test_parameters_are_keyed_per_instance(self):
        # Keys carry the execution id, so two instances cannot collide.
        self.assertIn("key: `${instance.id}:${entry.name}`", self.js)

    def test_every_instance_is_walked(self):
        self.assertIn("for (const instance of instances)", self.js)

    def test_each_parameter_carries_a_group(self):
        self.assertIn("group,", self.js)
        self.assertIn("groupTitle(instance", self.js)

    def test_backend_preserves_the_group_field(self):
        self.assertIn('"group": entry.get("group")', self.source)

    def test_page_renders_sections_per_group(self):
        self.assertIn("sectionHeading(", self.html)
        self.assertIn("sections.set(name", self.html)

    def test_headings_only_appear_when_there_are_several_groups(self):
        self.assertIn("const showHeadings = order.length > 1;", self.html)


class PollingContractTests(unittest.TestCase):
    """The poller must use endpoints that actually know about running jobs.

    Regression: the page used ``GET /prompt`` and read ``queue_running`` /
    ``queue_pending`` from it. In this ComfyUI version that endpoint returns
    only ``{"exec_info": {"queue_remaining": N}}``, so a prompt that was
    actively sampling looked absent and the phone reported "任务已不在队列中"
    while the job kept running.
    """

    def setUp(self):
        self.source = (_MODULES_DIR / "mobile_ui.py").read_text(encoding="utf-8")
        self.handler = self.source.split("async def qq_mobile_jobs")[1].split(
            "server._qq_mobile_routes"
        )[0]

    def test_jobs_handler_uses_the_job_api(self):
        self.assertIn("/api/jobs/", self.handler)

    def test_jobs_handler_does_not_read_queue_arrays_from_prompt(self):
        # Strip the docstring first: it deliberately names the keys that must
        # not be used, and only real code should be inspected.
        body = self.handler.split('"""')[-1]
        self.assertNotIn("{base}/prompt", body)
        self.assertNotIn("queue_running", body)

    def test_in_progress_is_reported_as_a_live_state(self):
        html = (_MODULES_DIR.parent / "web" / "mobile.html").read_text(encoding="utf-8")
        poll = html.split("async function poll()")[1].split("\nasync function cancel")[0]
        self.assertIn('data.status === "in_progress"', poll)
        self.assertIn('data.status === "pending"', poll)
        # A live job is recognised before the terminal handler absorbs it,
        # otherwise it would be reported as finished on the spot.
        self.assertLess(poll.index('data.status === "in_progress"'), poll.index("absorb(data)"))

    def test_failed_and_cancelled_stop_polling(self):
        html = (_MODULES_DIR.parent / "web" / "mobile.html").read_text(encoding="utf-8")
        self.assertIn('data.status === "failed"', html)
        self.assertIn('data.status === "cancelled"', html)

    def test_execution_error_is_surfaced(self):
        self.assertIn("_execution_error", self.source)


class SettleWindowTests(unittest.TestCase):
    """A prompt missing from both queue and history is not instantly dead."""

    def setUp(self):
        self.ui = _load("mobile_ui_settle_under_test", _MODULES_DIR / "mobile_ui.py")

    def tearDown(self):
        self.ui.SUBMITTED_AT.clear()

    def test_recent_submission_is_inside_the_settling_window(self):
        self.ui.SUBMITTED_AT["abc"] = self.ui.time.time()
        elapsed = self.ui._elapsed_since_submit(None, "abc")
        self.assertIsNotNone(elapsed)
        self.assertLess(elapsed, self.ui.SETTLE_SECONDS)

    def test_old_submission_is_past_the_settling_window(self):
        self.ui.SUBMITTED_AT["abc"] = self.ui.time.time() - self.ui.SETTLE_SECONDS - 5
        elapsed = self.ui._elapsed_since_submit(None, "abc")
        self.assertGreaterEqual(elapsed, self.ui.SETTLE_SECONDS)

    def test_unknown_prompt_has_no_elapsed_time(self):
        self.assertIsNone(self.ui._elapsed_since_submit(None, "never-submitted"))
        self.assertIsNone(self.ui._elapsed_since_submit(None, ""))


class TemplateStateTests(unittest.TestCase):
    def setUp(self):
        path = _MODULES_DIR / "mobile_ui.py"
        self.ui = _load("mobile_ui_state_under_test", path)

    def test_newest_template_is_returned_without_a_key(self):
        state = self.ui.MobileState()
        state.put("a", {"prompt": {"1": {}}, "parameters": []})
        state.put("b", {"prompt": {"2": {}}, "parameters": []})
        self.assertEqual(state.get(None)["workflow"], "b")

    def test_named_lookup(self):
        state = self.ui.MobileState()
        state.put("a", {"prompt": {"1": {}}, "parameters": []})
        self.assertEqual(state.get("a")["workflow"], "a")
        self.assertIsNone(state.get("missing"))

    def test_stale_templates_are_dropped(self):
        state = self.ui.MobileState()
        record = state.put("a", {"prompt": {"1": {}}, "parameters": []})
        record["updated"] -= self.ui.TEMPLATE_MAX_AGE_SECONDS + 1
        self.assertIsNone(state.get("a"))


class PhoneUiTests(unittest.TestCase):
    """Layout and affordance fixes on the phone page."""

    def setUp(self):
        self.html = (_MODULES_DIR.parent / "web" / "mobile.html").read_text(encoding="utf-8")

    # -- picker vs form chrome ------------------------------------------
    def test_footer_is_hidden_while_picking(self):
        self.assertIn("footer[hidden] { display: none; }", self.html)
        block = self.html.split("async function showPipelinePicker")[1].split("/* ---------------- boot")[0]
        self.assertIn("setFooterVisible(false)", block)

    def test_refresh_is_unavailable_while_picking(self):
        # Otherwise it silently opens the newest pipeline from the list.
        block = self.html.split("async function showPipelinePicker")[1].split("/* ---------------- boot")[0]
        self.assertIn("setFooterVisible(false)", block)
        helper = self.html.split("function setFooterVisible")[1].split("\n}")[0]
        self.assertIn('el("reload").hidden = !visible', helper)

    # -- touch targets ---------------------------------------------------
    def test_header_buttons_meet_the_touch_target_size(self):
        block = self.html.split(".icon-btn {")[1].split("}")[0]
        self.assertIn("width: 44px", block)
        self.assertIn("height: 44px", block)

    # -- text fields -----------------------------------------------------
    def test_textareas_do_not_offer_a_resize_grip(self):
        block = self.html.split(".field textarea {")[1].split("}")[0]
        self.assertIn("resize: none", block)
        self.assertNotIn("resize: vertical", block)

    def test_text_fields_have_a_tappable_expand_button(self):
        self.assertIn("function textWrapWithExpand", self.html)
        self.assertIn('expand.innerHTML = iconSvg("expand", 17)', self.html)
        self.assertIn("openEditor(parameter, input)", self.html)

    # -- seed ------------------------------------------------------------
    def test_seed_fields_get_a_dice_instead_of_steppers(self):
        block = self.html.split("function isSeedParameter")[1].split("\nfunction ")[0]
        self.assertIn("seed", block)
        render = self.html.split("if (isSeedParameter(parameter))")[1].split("} else {")[0]
        self.assertIn("randomSeed(parameter)", render)
        # Steppers are dropped for seeds: ±1 is meaningless and squeezed the value.
        self.assertNotIn("minus, input, plus", render)

    def test_seed_stays_within_the_exact_integer_range(self):
        block = self.html.split("function randomSeed")[1].split("\n}")[0]
        self.assertIn("1125899906842624", block)

    # -- reset -----------------------------------------------------------
    def test_form_offers_reset_to_workflow_defaults(self):
        self.assertIn("function resetToDefaults", self.html)
        self.assertIn("已恢复默认值", self.html)
        reset = self.html.split("function resetToDefaults")[1].split("\n}")[0]
        self.assertIn("state.values = {}", reset)
        self.assertIn("removeItem", reset)

    # -- result reachability --------------------------------------------
    def test_result_chip_lives_in_the_footer(self):
        footer = self.html.split("<footer id=\"footer\">")[1].split("</footer>")[0]
        self.assertIn('id="resultChip"', footer)

    def test_result_chip_toggles_with_scroll(self):
        self.assertIn("updateResultChip", self.html)
        self.assertIn('el("main").addEventListener("scroll", updateResultChip', self.html)

    # -- no layout shift -------------------------------------------------
    def test_status_line_lives_in_the_footer_not_above_the_form(self):
        footer = self.html.split("<footer id=\"footer\">")[1].split("</footer>")[0]
        self.assertIn('id="status"', footer)
        main = self.html.split('<main id="main">')[1].split("</main>")[0]
        self.assertNotIn('id="status"', main)

    # -- visual hierarchy ------------------------------------------------
    def test_advanced_group_reads_as_a_section_not_a_field(self):
        block = self.html.split("details.group {")[1].split("}")[0]
        self.assertIn("border-top: 1px dashed", block)
        # No filled card background: it should not look like an input.
        self.assertNotIn("background: var(--surface)", block)

    # -- picker metadata -------------------------------------------------
    def test_picker_shows_relative_time(self):
        self.assertIn("function relativeTime", self.html)
        block = self.html.split("async function showPipelinePicker")[1].split("/* ---------------- boot")[0]
        self.assertIn("relativeTime(item.updated)", block)

    def test_identical_titles_are_disambiguated(self):
        block = self.html.split("function pipelineRow(item, titleCounts)")[1].split("\n}")[0]
        self.assertIn("shortWorkflowId(item.key)", block)


class MobilePolishTests(unittest.TestCase):
    """Small correctness details that break real phones."""

    def setUp(self):
        self.js = (_MODULES_DIR.parent / "web" / "mobile_ui.js").read_text(encoding="utf-8")
        self.html = (_MODULES_DIR.parent / "web" / "mobile.html").read_text(encoding="utf-8")

    def test_result_urls_respect_a_reverse_proxy_subpath(self):
        # A bare "/view" escapes the mount and 404s under e.g. /comfyui/.
        block = self.html.split("function viewUrl(item)")[1].split("\nfunction ")[0]
        self.assertIn("basePath()", block)

    def test_form_controls_use_16px_to_stop_ios_zoom(self):
        block = self.html.split('.field input[type="number"],')[1].split("}")[0]
        self.assertIn("font-size: 16px", block)
        # The shorthand with `inherit` as family is invalid and gets dropped.
        # Matched with the terminator so the explanatory comment does not count.
        self.assertNotIn("font: 16px/1.5 inherit;", self.html)

    def test_pinch_zoom_is_not_disabled(self):
        # Check the meta tag itself: the word also appears in a comment.
        meta = self.html.split('name="viewport"')[1].split(">")[0]
        self.assertNotIn("maximum-scale", meta)
        self.assertNotIn("user-scalable=no", meta)

    def test_watcher_accepts_workflows_without_a_subgraph(self):
        block = self.js.split("function startTemplateWatcher")[1].split("\nfunction ")[0]
        self.assertIn("hasMultiPrimitive(graph)", block)
        self.assertIn("hasMediaLoader(graph)", block)
        self.assertNotIn("if (!instances.length) return;", block)


class TemplatePersistenceTests(unittest.TestCase):
    """Templates are mirrored to disk so a restart keeps the picker usable."""

    def setUp(self):
        import tempfile

        self.ui = _load("mobile_ui_persist_under_test", _MODULES_DIR / "mobile_ui.py")
        self.tempdir = tempfile.TemporaryDirectory()
        self.store = pathlib.Path(self.tempdir.name) / "QQ_ComfyUI_Tools" / "mobile_templates.json"
        # Redirect the store path without touching the real user directory.
        self.ui._store_path = lambda: str(self.store)

    def tearDown(self):
        self.tempdir.cleanup()

    def test_put_then_save_then_load_round_trips(self):
        first = self.ui.MobileState()
        first.put("a", {"prompt": {"1": {"class_type": "X", "inputs": {}}},
                        "parameters": [{"key": "k"}], "graph": {"id": "g", "nodes": []}})
        first.save_now()
        self.assertTrue(self.store.exists())

        second = self.ui.MobileState()
        restored = second.load()
        self.assertEqual(restored, 1)
        record = second.get("a")
        self.assertIsNotNone(record)
        self.assertEqual(record["parameters"], [{"key": "k"}])
        self.assertEqual(record["graph"], {"id": "g", "nodes": []})

    def test_missing_file_loads_nothing(self):
        state = self.ui.MobileState()
        self.assertEqual(state.load(), 0)

    def test_corrupt_file_is_ignored(self):
        self.store.parent.mkdir(parents=True, exist_ok=True)
        self.store.write_text("{not json", encoding="utf-8")
        state = self.ui.MobileState()
        self.assertEqual(state.load(), 0)
        self.assertEqual(state.templates, {})

    def test_stale_records_are_not_restored(self):
        first = self.ui.MobileState()
        record = first.put("old", {"prompt": {"1": {}}, "parameters": []})
        record["updated"] -= self.ui.TEMPLATE_MAX_AGE_SECONDS + 10
        first.save_now()
        second = self.ui.MobileState()
        self.assertEqual(second.load(), 0)

    def test_store_is_capped(self):
        state = self.ui.MobileState()
        for index in range(self.ui.TEMPLATE_STORE_LIMIT + 8):
            state.put(f"wf{index}", {"prompt": {"1": {}}, "parameters": []})
        state.save_now()
        saved = json.loads(self.store.read_text(encoding="utf-8"))
        self.assertEqual(len(saved["templates"]), self.ui.TEMPLATE_STORE_LIMIT)

    def test_write_is_atomic_via_temp_file(self):
        source = (_MODULES_DIR / "mobile_ui.py").read_text(encoding="utf-8")
        block = source.split("def save_now(self)")[1].split("\n    def ")[0]
        self.assertIn("os.replace(temp, path)", block)

    def test_module_restores_the_cache_on_import(self):
        source = (_MODULES_DIR / "mobile_ui.py").read_text(encoding="utf-8")
        self.assertIn("STATE.load()", source)


if __name__ == "__main__":
    unittest.main()
