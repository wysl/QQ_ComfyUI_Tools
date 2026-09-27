# Third-Party Notices

The following adapted components are distributed under the MIT License:

- The H3 chroma-noise palette, taper and luminance-preservation algorithm in
  `node_modules/h3_segments.py`, adapted from
  [ComfyUI-MiniMaxH3-Easy](https://github.com/wysl/ComfyUI-MiniMaxH3-Easy),
  copyright (c) 2026 nkxx188.
- The face tracking, crop normalization, latent injection, per-frame denoise,
  masking, and stitch-back primitives in `face_refine_nodes.py`, adapted from
  [ComfyUI-H3-FaceRefine](https://github.com/Carasibana/ComfyUI-H3-FaceRefine),
  copyright (c) 2026 Carasibana.

Not covered by the MIT grant above:

- `node_modules/qwen_pe.py` and `node_modules/qwen_pe_prompts.py` port the
  `TE MAN Qwen Image 2.1 AI提示词增强(本地orAPI)` node from the local `TE_MAN`
  custom-node package. The Qwen Image 2.1 rewriting rules are the Qwen
  project's own prompt templates; the node-level policy blocks, request shape
  and parsing rules come from TE MAN, which ships its own terms
  (`本项目代码仅供学习和阅读使用。未经作者书面授权，严禁任何形式的复制、修改、衍生开发及发布。`).
  Those terms do not grant redistribution rights, so obtain the TE MAN
  author's written authorization before publishing this port.

MIT License

Copyright (c) 2026 nkxx188
Copyright (c) 2026 Carasibana

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
