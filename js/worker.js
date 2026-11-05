// Background thread for the AI models, so the page stays responsive while they run.
import * as AI from './ai.js';
const { loadModels, recognize, cutout, onProgress } = AI;

onProgress((p) => self.postMessage({ kind: 'progress', p }));

self.onmessage = async ({ data }) => {
  const { id, op, blob } = data;
  const t0 = performance.now();
  try {
    let result;
    if (op === 'load') { await loadModels(); result = { backend: AI.backend }; }
    if (op === 'recognize') result = await recognize(blob);
    if (op === 'cutout') {
      const mask = await cutout(blob);
      self.postMessage({ kind: 'result', id, result: mask, ms: Math.round(performance.now() - t0) }, [mask.buffer]);
      return;
    }
    self.postMessage({ kind: 'result', id, result, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    self.postMessage({ kind: 'error', id, error: String(err?.message || err) });
  }
};
