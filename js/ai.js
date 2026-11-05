// On-device AI via transformers.js. Runs inside a Web Worker (see worker.js) so the page never freezes.
//  - CLIP image embedding  -> item type (zero-shot vs. text prompts) AND "similar to" matching
//  - RMBG-1.4 segmentation -> sticker cut-out mask
import {
  env, AutoProcessor, AutoTokenizer, AutoModel, RawImage, Tensor,
  CLIPVisionModelWithProjection, CLIPTextModelWithProjection,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';
import { modelCache } from './db.js';
import { TYPES, cosine } from './types.js';

env.allowLocalModels = false;
if (!self.isSecureContext || !('caches' in self)) {
  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.customCache = modelCache;
}

const CLIP = 'Xenova/clip-vit-base-patch32';
const RMBG = 'briaai/RMBG-1.4';
const RMBG_SIZE = 1024; // the ONNX export only accepts 1024x1024 input

// ---- progress reporting ----
const files = {};
let listener = () => {};
export function onProgress(fn) { listener = fn; }
function progress_callback(p) {
  if (p.status === 'progress' || p.status === 'done') {
    const k = `${p.name}/${p.file}`;
    const f = files[k] || (files[k] = { loaded: 0, total: 0 });
    if (p.total) { f.total = p.total; f.loaded = p.status === 'done' ? p.total : p.loaded; }
    let l = 0, t = 0;
    for (const v of Object.values(files)) { l += v.loaded; t += v.total; }
    listener(t ? l / t : 0);
  }
}

const norm = (v) => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return v.map((x) => x / s); };

// The cut-out model is ~30x faster on the GPU (WebGPU). WebGPU only exists on https/localhost.
// fp16 if the GPU supports it (half the download), else fp32. Falls back to CPU (WASM, q8).
// CLIP stays on CPU q8: it's already fast and small.
export let backend = 'cpu';
async function loadCutoutModel() {
  const cfg = { config: { model_type: 'custom' }, progress_callback };
  try {
    const adapter = self.navigator?.gpu && await self.navigator.gpu.requestAdapter();
    if (adapter) {
      const dtype = adapter.features.has('shader-f16') ? 'fp16' : 'fp32';
      const model = await AutoModel.from_pretrained(RMBG, { ...cfg, device: 'webgpu', dtype });
      backend = `gpu-${dtype}`;
      return model;
    }
  } catch (err) {
    console.warn('WebGPU cut-out failed, using CPU', err);
  }
  backend = 'cpu';
  return AutoModel.from_pretrained(RMBG, { ...cfg, dtype: 'q8' });
}

// ---- model loading (once) ----
let ready = null;
export function loadModels() {
  if (ready) return ready;
  ready = (async () => {
    const q8 = { dtype: 'q8', progress_callback };
    const [clipProc, vision, tokenizer, textModel, rmbg] = await Promise.all([
      AutoProcessor.from_pretrained(CLIP, { progress_callback }),
      CLIPVisionModelWithProjection.from_pretrained(CLIP, q8),
      AutoTokenizer.from_pretrained(CLIP, { progress_callback }),
      CLIPTextModelWithProjection.from_pretrained(CLIP, q8),
      loadCutoutModel(),
    ]);
    // One text vector per item type (average of its prompts). Computed once.
    const prompts = TYPES.flatMap((t) => t.prompts);
    const { text_embeds } = await textModel(tokenizer(prompts, { padding: true, truncation: true }));
    const rows = text_embeds.tolist();
    let i = 0;
    const typeVecs = TYPES.map((t) => {
      const vs = t.prompts.map(() => norm(rows[i++]));
      return norm(vs[0].map((_, d) => vs.reduce((s, v) => s + v[d], 0) / vs.length));
    });
    return { clipProc, vision, rmbg, typeVecs };
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

// ---- 1) recognize: CLIP embedding + zero-shot item type (fast, ~0.2 s on a laptop) ----
export async function recognize(blob) {
  const m = await loadModels();
  const image = await RawImage.fromBlob(blob);
  const { image_embeds } = await m.vision(await m.clipProc(image));
  const embedding = norm(Array.from(image_embeds.data));
  const logits = m.typeVecs.map((v) => cosine(v, embedding) * 100);
  const max = Math.max(...logits);
  const exps = logits.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  const types = TYPES.map((t, k) => ({ id: t.id, p: exps[k] / sum })).sort((a, b) => b.p - a.p);
  return { embedding, types };
}

// ---- 2) cut-out: RMBG foreground mask (slow, ~6 s on a laptop) ----
// Returns a Uint8Array mask (0-255) at the image's own size.
export async function cutout(blob) {
  const m = await loadModels();
  const image = (await RawImage.fromBlob(blob)).rgb();
  const S = RMBG_SIZE;
  const small = await image.resize(S, S);
  const px = small.data; // RGB, length S*S*3
  const f = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) {
    f[i] = px[i * 3] / 255 - 0.5;
    f[S * S + i] = px[i * 3 + 1] / 255 - 0.5;
    f[2 * S * S + i] = px[i * 3 + 2] / 255 - 0.5;
  }
  const { output } = await m.rmbg({ input: new Tensor('float32', f, [1, 3, S, S]) });
  const mask = await RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(image.width, image.height);
  return mask.data;
}
