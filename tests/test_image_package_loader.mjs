import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../web/image_package_loader.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "");

class Element {
    constructor(tag) {
        this.tagName = tag;
        this.children = [];
        this.dataset = {};
        this.style = {};
        this.listeners = {};
        this.className = "";
        this.classList = {
            add: (name) => { if (!this.className.split(" ").includes(name)) this.className += ` ${name}`; },
            remove: (name) => { this.className = this.className.split(" ").filter((item) => item !== name).join(" "); },
            toggle: (name, enabled) => enabled ? this.classList.add(name) : this.classList.remove(name),
        };
    }
    append(...items) {
        for (const item of items) { item.parent?.removeChild(item); item.parent = this; this.children.push(item); }
    }
    prepend(item) { item.parent = this; this.children.unshift(item); }
    removeChild(item) { this.children = this.children.filter((child) => child !== item); }
    remove() { this.parent?.removeChild(this); }
    replaceChildren(...items) { this.children = []; this.append(...items); }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    querySelector(selector) {
        for (const child of this.children) {
            if (child.className.split(" ").includes(selector.slice(1))) return child;
            const match = child.querySelector(selector);
            if (match) return match;
        }
        return null;
    }
    click() { this.listeners.click?.({ target: this, stopPropagation() {} }); }
}

async function fixture() {
    const listeners = new Map();
    const timers = new Map();
    let timerId = 0, promptId = 0, extension, infoReads = 0;
    const document = {
        head: new Element("head"), body: new Element("body"),
        createElement: (tag) => new Element(tag),
        getElementById: (id) => document.head.children.find((child) => child.id === id),
    };
    const api = {
        queue: { queue_running: [], queue_pending: [] },
        addEventListener(name, fn) { listeners.set(name, fn); },
        async queuePrompt() {
            const response = { prompt_id: `prompt-${++promptId}` };
            await api.beforeResponse?.(response.prompt_id);
            return response;
        },
        async fetchApi(url) {
            if (url === "/queue") return { ok: true, json: async () => api.queue };
            if (url.startsWith("/qq_image_packages/info")) {
                infoReads++;
                return { ok: true, json: async () => ({ count: 3, kind: "archive", name: "book.cbz", first: "1.png" }) };
            }
            if (url.startsWith("/qq_image_packages/list")) {
                return { ok: true, json: async () => ({ folder: "parent/child", source: "input", folders: [{name:"pages",path:"parent/child/pages"}], files: [] }) };
            }
            throw new Error(`unexpected URL: ${url}`);
        },
    };
    const app = {
        calls: [],
        graph: { _nodes: [], getNodeById(id) { return this._nodes.find((node) => String(node.id) === String(id)); } },
        registerExtension(value) { extension = value; },
        async queuePrompt(number, count) {
            this.calls.push({number, count});
            return await submit();
        },
    };
    const setTimeout = (fn, delay) => { timers.set(++timerId, {fn, delay}); return timerId; };
    const clearTimeout = (id) => timers.delete(id);
    new Function("app", "api", "document", "globalThis", "setTimeout", "clearTimeout", source)(
        app, api, document, {}, setTimeout, clearTimeout);
    extension.setup();
    class Node {
        constructor(id, sources = ["book.cbz"]) {
            this.id = id;
            this.type = "QQImagePackageLoader";
            this.mode = 0;
            this.inputs = [{name:"file_path", link:null}];
            this.size = [350, 300];
            this.widgets = [
                {name:"package_state", value:JSON.stringify({sources})},
                {name:"当前序号", value:1},
                {name:"自动下一张", value:true},
                {name:"循环模式", value:false},
            ];
        }
        addDOMWidget(name, type, element, options) {
            const widget = {name, type, element, options};
            this.widgets.push(widget);
            return widget;
        }
        setDirtyCanvas() {}
    }
    await extension.beforeRegisterNodeDef(Node, {name:"QQImagePackageLoader"});
    function node(id, sources) {
        const value = new Node(id, sources);
        app.graph._nodes.push(value);
        value.onNodeCreated();
        return value;
    }
    function get(node, name) { return node.widgets.find((item) => item.name === name); }
    async function submit(nodes = app.graph._nodes) {
        const output = Object.fromEntries(nodes.map((node) => [node.id, {class_type:node.type,
            inputs:Object.fromEntries(node.widgets.filter((item) => item.serialize !== false).map((item) => [item.name,item.value]))}]));
        return await api.queuePrompt(0, {output,workflow:{}});
    }
    function emit(name, detail) { return listeners.get(name)?.({detail}); }
    function executed(id, node, total = 3) {
        emit("executed", {prompt_id:id, node:String(node.id), output:{qq_image_package:[{
            node_id:String(node.id), index:get(node,"当前序号").value, total, auto:true,
            current:"page.png",
        }]}});
    }
    async function flush() {
        const items = [...timers.entries()].filter(([, timer]) => timer.delay === 180);
        for (const [id, timer] of items) { timers.delete(id); await timer.fn(); }
    }
    return {app,api,node,get,submit,emit,executed,flush,document,extension,infoReads:()=>infoReads};
}

{
    const f = await fixture(), a = f.node(1), unused = f.node(2);
    const {prompt_id:id} = await f.submit([a]);
    f.executed(id, a);
    await f.flush();
    assert.equal(f.app.calls.length, 0, "node completion must not queue before workflow success");
    f.emit("execution_success", {prompt_id:id});
    await f.flush();
    assert.equal(f.get(a,"当前序号").value, 2);
    assert.equal(f.get(unused,"当前序号").value, 1, "unexecuted nodes must remain unchanged");
    assert.deepEqual(f.app.calls, [{number:0,count:1}]);
    f.emit("execution_success", {prompt_id:id});
    await f.flush();
    assert.equal(f.app.calls.length, 1, "duplicate success must not queue twice");
}

for (const error of ["execution_error", "execution_interrupted"]) {
    const f = await fixture(), a = f.node(1);
    const {prompt_id:id} = await f.submit();
    f.executed(id, a);
    f.emit(error, {prompt_id:id});
    f.emit("execution_success", {prompt_id:id});
    await f.flush();
    assert.equal(f.app.calls.length, 0, error);
    assert.equal(f.get(a,"当前序号").value, 1);
}

for (const change of ["pause", "cursor", "dispose", "workflow", "manualQueue", "pending", "running", "sources", "bypass"]) {
    const f = await fixture(), a = f.node(1);
    const {prompt_id:id} = await f.submit();
    f.executed(id, a);
    f.emit("execution_success", {prompt_id:id});
    if (change === "pause") f.get(a,"自动下一张").value = false;
    if (change === "cursor") f.get(a,"当前序号").value = 3;
    if (change === "dispose") a.onRemoved();
    if (change === "workflow") f.extension.beforeConfigureGraph();
    if (change === "manualQueue") await f.submit();
    if (change === "pending") f.api.queue.queue_pending.push([1,"manual"]);
    if (change === "running") f.api.queue.queue_running.push([1,"another"]);
    if (change === "sources") f.get(a,"package_state").value = '{"sources":["other.cbz"]}';
    if (change === "bypass") a.mode = 4;
    await f.flush();
    assert.equal(f.app.calls.length, 0, `cancel when ${change}`);
}

for (const loop of [false, true]) {
    const f = await fixture(), a = f.node(1);
    f.get(a,"当前序号").value = 3;
    f.get(a,"循环模式").value = loop;
    const {prompt_id:id} = await f.submit();
    f.executed(id, a);
    f.emit("execution_success", {prompt_id:id});
    await f.flush();
    assert.equal(f.app.calls.length, loop ? 1 : 0);
    assert.equal(f.get(a,"当前序号").value, loop ? 1 : 3);
}

{
    const f = await fixture(), a = f.node(1), b = f.node(2);
    const {prompt_id:id} = await f.submit();
    f.executed(id, a, 1); f.executed(id, b, 3);
    f.emit("execution_success", {prompt_id:id});
    await f.flush();
    assert.equal(f.app.calls.length, 0, "stop together when one finite package ends");
}

{
    const f = await fixture(), a = f.node(1);
    f.executed("other-browser", a);
    f.emit("execution_success", {prompt_id:"other-browser"});
    await f.flush();
    assert.equal(f.app.calls.length, 0, "ignore another browser's runs");
    await Promise.resolve();
    assert.equal(f.infoReads(), 1);
    const card = a.__qqPackageCards.get("book.cbz");
    a.onConfigure(); a.onConnectionsChange();
    assert.equal(a.__qqPackageCards.get("book.cbz"), card, "reuse cards and cached manifest information");
    assert.equal(f.infoReads(), 1);
    assert.equal(f.get(a,"图片包面板").serialize, false);
    assert.equal(f.get(a,"图片包面板").options.serialize, false);
    assert.equal(card.dataset.kind, "archive");
    const fan2 = card.querySelector(".qqpkg-fan-2");
    const fan3 = card.querySelector(".qqpkg-fan-3");
    assert(fan2 && fan3, "archive cards stack the next two images");
    assert(fan2.children[0].src.includes("index=1") && fan3.children[0].src.includes("index=2"));
    assert(fan2.style.display !== "none" && fan3.style.display !== "none");
    assert(!f.document.head.children[0].textContent.includes("}:hover{"), "CSS must not style global hover");
    const styles = f.document.head.children[0].textContent;
    assert(styles.includes(".qqpkg-fan-2{z-index:-1;transform:rotate(-8deg)}"), "second image peeks about a quarter");
    assert(styles.includes(".qqpkg-fan-3{z-index:-2;transform:rotate(-15deg)}"), "third image fans wider behind");
    assert(styles.includes("aspect-ratio:9/16"), "package images crop to 9:16");
    assert(!styles.includes("isolation:isolate"), "fan layers must paint behind the card face");
}

{
    const f = await fixture(), a = f.node(1);
    f.api.beforeResponse = (id) => {
        f.executed(id, a);
        f.executed(id, a);
        f.emit("execution_success", {prompt_id:id});
        f.executed("other-browser", a);
        f.emit("execution_success", {prompt_id:"other-browser"});
    };
    await f.submit();
    await f.flush();
    assert.equal(f.get(a,"当前序号").value, 2);
    assert.equal(f.app.calls.length, 1, "success before HTTP response must advance once");
    await f.flush();
    assert.equal(f.get(a,"当前序号").value, 3);
    await f.flush();
    assert.equal(f.app.calls.length, 2, "fast workflows must finish all pages and stop");
}

console.log("image package panel and auto queue tests passed");
