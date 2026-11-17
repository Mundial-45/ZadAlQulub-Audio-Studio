// Operaciones de edición sobre PCM mono (siempre devuelven un arreglo nuevo).
export const trimTo = (pcm, a, b) => pcm.slice(Math.max(0, a), Math.min(pcm.length, b));
export function deleteRange(pcm, a, b, sr, crossfadeMs = 4) {
  a = Math.max(0, a); b = Math.min(pcm.length, b);
  if (b <= a) return pcm.slice();
  const out = new Float32Array(pcm.length - (b - a));
  out.set(pcm.subarray(0, a), 0); out.set(pcm.subarray(b), a);
  // pequeño fundido cruzado en la unión para evitar clics
  const x = Math.min(Math.round(crossfadeMs * sr / 1000), a, pcm.length - b);
  for (let i = 0; i < x; i++) {
    const t = (i + 1) / (x + 1);
    out[a - x + i] = pcm[a - x + i] * (1 - t) + pcm[b - x + i] * t;
  }
  return out;
}
export function fadeIn(pcm, a, b) {
  const out = pcm.slice(), n = Math.max(1, b - a);
  for (let i = a; i < b && i < out.length; i++) { const t = (i - a) / n; out[i] *= t * t * (3 - 2 * t); }
  return out;
}
export function fadeOut(pcm, a, b) {
  const out = pcm.slice(), n = Math.max(1, b - a);
  for (let i = a; i < b && i < out.length; i++) { const t = 1 - (i - a) / n; out[i] *= t * t * (3 - 2 * t); }
  return out;
}
export function gainRange(pcm, a, b, db) {
  const out = pcm.slice(), g = Math.pow(10, db / 20);
  for (let i = Math.max(0, a); i < Math.min(out.length, b); i++) out[i] *= g;
  return out;
}
export function silenceRange(pcm, a, b) {
  const out = pcm.slice(); out.fill(0, Math.max(0, a), Math.min(out.length, b)); return out;
}
