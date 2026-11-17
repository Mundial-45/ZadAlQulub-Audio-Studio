// Pequeño cliente para workers de módulo con promesas, progreso y reutilización.
const pool = new Map();
let seq = 0;
export function callWorker(url, message, transfer = [], onProgress) {
  return new Promise((resolve, reject) => {
    let w = pool.get(url.href);
    if (!w) { w = new Worker(url, { type: 'module' }); pool.set(url.href, w); w.pending = new Map(); w.onmessage = (e) => {
      const d = e.data, p = w.pending.get(d.id); if (!p) return;
      if (d.progress !== undefined) { p.onProgress && p.onProgress(d.progress); return; }
      w.pending.delete(d.id); d.ok ? p.resolve(d) : p.reject(new Error(d.error || 'worker error'));
    }; w.onerror = (ev) => { w.pending.forEach((p) => p.reject(new Error(ev.message || 'worker error'))); w.pending.clear(); pool.delete(url.href); }; }
    const id = ++seq; w.pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ ...message, id }, transfer);
  });
}
