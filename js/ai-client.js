// Page-side handle to the AI worker. Each call returns a promise of { result, ms }.
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const pending = new Map();
let nextId = 1;
let progressFn = () => {};

worker.onmessage = ({ data }) => {
  if (data.kind === 'progress') { progressFn(data.p); return; }
  const p = pending.get(data.id);
  if (!p) return;
  pending.delete(data.id);
  if (data.kind === 'error') p.reject(new Error(data.error));
  else p.resolve({ result: data.result, ms: data.ms });
};
worker.onerror = (e) => {
  for (const p of pending.values()) p.reject(new Error(e.message || 'AI worker crashed'));
  pending.clear();
};

function call(op, blob) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, op, blob });
  });
}

export const ai = {
  onProgress: (fn) => { progressFn = fn; },
  load: () => call('load'),
  recognize: (blob) => call('recognize', blob),
  cutout: (blob) => call('cutout', blob),
};
