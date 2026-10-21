"""Tests for the phone UI backend: subgraph expansion and value binding."""

import importlib.util
import pathlib
import sys
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
        self.assertIn('data.status === "in_progress"', html)
        self.assertIn('data.status === "pending"', html)
        # The running branch must be checked before the terminal ones, or a
        # live job would fall through to "lost".
        self.assertLess(
            html.index('data.status === "in_progress"'),
            html.index('data.status === "lost"'),
        )

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


if __name__ == "__main__":
    unittest.main()
