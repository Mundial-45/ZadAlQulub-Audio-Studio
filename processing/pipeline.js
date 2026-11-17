// Cadena de procesado: ruido → pasa-altos → EQ → compresor → normalización → limitador.
import { reduceNoise } from './noise-reduction.js';
import { buildEq } from './equalizer.js';
import { buildCompressor } from './compressor.js';
import { callWorker } from './worker-client.js';

const DSP = new URL('./dsp-worker.js', import.meta.url);

async function renderFilters(pcm, sr, params) {
  const ctx = new OfflineAudioContext(1, pcm.length, sr);
  const chain = [...buildEq(ctx, params), ...buildCompressor(ctx, params.comp)];
  if (!chain.length) return pcm;
  const buf = ctx.createBuffer(1, pcm.length, sr); buf.copyToChannel(pcm, 0);
  const src = ctx.createBufferSource(); src.buffer = buf;
  let prev = src; for (const n of chain) { prev.connect(n); prev = n; } prev.connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0).slice();
}

export async function analyze(pcm, sr) {
  const copy = pcm.slice();
  const r = await callWorker(DSP, { op: 'analyze', pcm: copy, sr }, [copy.buffer]);
  return r.stats;
}

export async function processAudio(pcm, sampleRate, params, onProgress = () => {}) {
  let x = pcm, sr = sampleRate, noiseInfo = null;
  if (params.noise.enabled && params.noise.amount > 0) {
    onProgress('noise', 0);
    try {
      const r = await reduceNoise(x, sr, params.noise.amount, (p) => onProgress('noise', p));
      x = r.pcm; sr = r.sampleRate; noiseInfo = { ok: true };
    } catch (e) { noiseInfo = { ok: false, error: String(e.message || e) }; }
  }
  onProgress('filters', 0);
  x = await renderFilters(x, sr, params);
  onProgress('master', 0);
  const copy = x.slice();
  const r = await callWorker(DSP, { op: 'master', pcm: copy, sr, params: {
    normalize: params.loudness.enabled, targetLufs: params.loudness.target,
    limiter: params.limiter.enabled, ceilingDb: params.limiter.ceiling, gainDb: params.gainDb || 0 } }, [copy.buffer]);
  onProgress('done', 1);
  return { pcm: r.pcm, sampleRate: sr, stats: r.stats, noise: noiseInfo };
}
