import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

/**
 * Let a plain `LoadImage` see a painted layer, for one run only.
 *
 * `LoadImage` takes its MASK from the PNG's alpha channel and its outputs are
 * fixed by `RETURN_TYPES`, so a painted layer can only reach it through a
 * file. That file has no value of its own — it is the layer plus a picture,
 * made to be read once.
 *
 * So nothing is written when the layer is painted, and no widget ever points
 * at it. Just before a prompt is expanded, the graph is asked which pictures
 * have a layer; the server drops a fresh copy into `temp/` and the *submitted
 * prompt* gets `name [temp]`, which ComfyUI resolves with
 * `get_annotated_filepath` (`LoadImage.VALIDATE_INPUTS` replaces the combo check
 * for the `image` input, so the annotated value validates even though it is not
 * one of the input-directory entries the widget lists).
 *
 * The graph keeps the original file name, so the desktop widget and the phone
 * picker still show the picture the user chose, and `input/` stays clean.
 */
const LOAD_IMAGE = "LoadImage";
const PREPARE_ROUTE = "/qq_mobile/mask/prepare";
const BRIDGE_MARKER = Symbol.for("QQ.MaskPromptBridge.graphToPrompt");
const ANNOTATION = /\s*\[(?:input|output|temp)\]\s*$/i;
const INSTALL_RECHECKS = 40;

let installGeneration = 0;

function baseName(value) {
    return typeof value === "string" ? value.replace(ANNOTATION, "").trim() : "";
}

async function prepareMasks(names) {
    if (!names.length) return {};
    try {
        const response = await api.fetchApi(PREPARE_ROUTE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ files: names }),
        });
        if (!response.ok) return {};
        const body = await response.json();
        return body && typeof body.masks === "object" && body.masks ? body.masks : {};
    } catch {
        // A workflow must still run when the layer cannot be read.
        return {};
    }
}

async function annotateMaskedImages(output) {
    const wanted = new Map();
    for (const entry of Object.values(output || {})) {
        if (String(entry?.class_type || "") !== LOAD_IMAGE) continue;
        const inputs = entry?.inputs;
        const value = typeof inputs?.image === "string" ? inputs.image : "";
        // Already pointing at a copy (or at nothing usable): leave it be.
        if (!value || ANNOTATION.test(value)) continue;
        const name = baseName(value);
        if (!name) continue;
        const holders = wanted.get(name);
        if (holders) holders.push(entry);
        else wanted.set(name, [entry]);
    }
    if (!wanted.size) return;
    const masks = await prepareMasks([...wanted.keys()]);
    for (const [name, reference] of Object.entries(masks)) {
        if (typeof reference !== "string" || !reference) continue;
        for (const entry of wanted.get(name) || []) entry.inputs.image = reference;
    }
}

function patchGraphToPrompt() {
    if (typeof app.graphToPrompt !== "function" || app.graphToPrompt[BRIDGE_MARKER]) return;
    const original = app.graphToPrompt;
    const wrapped = async function graphToPromptWithMaskedImages() {
        const promptData = await original.apply(this, arguments);
        try {
            await annotateMaskedImages(promptData?.output);
        } catch {
            // Never block a queue because a layer could not be written.
        }
        return promptData;
    };
    Object.defineProperty(wrapped, BRIDGE_MARKER, { value: true });
    app.graphToPrompt = wrapped;
}

function installBridge() {
    const generation = ++installGeneration;
    const recheck = (attempt = 0) => {
        patchGraphToPrompt();
        if (generation !== installGeneration || attempt >= INSTALL_RECHECKS) return;
        setTimeout(() => recheck(attempt + 1), 250);
    };
    recheck();
}

app.registerExtension({
    name: "QQ.MaskPromptBridge",
    setup() {
        installBridge();
    },
});
