// Cadena de procesado: ruido → pasa-altos → EQ → compresor → normalización → limitador.
import { reduceNoise } from './noise-reduction.js';
import { buildEq } from './equalizer.js';
import { buildCompressor } from './compressor.js';
import { buildEffect, EFFECTS } from './effects.js';
import { callWorker } from './worker-client.js';

const DSP = new URL('./dsp-worker.js', import.meta.url);

async function renderFilters(pcm, sr, params) {
  const effType = params.effect && params.effect.type !== 'none' ? params.effect.type : 'none';
  const tail = (EFFECTS[effType] || EFFECTS.none).tail, extra = Math.round(tail * sr);
  const ctx = new OfflineAudioContext(1, pcm.length + extra, sr);
  const chain = [...buildEq(ctx, params), ...buildCompressor(ctx, params.comp)];
  const fx = buildEffect(ctx, params.effect);
  if (!chain.length && !fx) return pcm;
  const buf = ctx.createBuffer(1, pcm.length, sr); buf.copyToChannel(pcm, 0);
  const src = ctx.createBufferSource(); src.buffer = buf;
  let prev = src; for (const n of chain) { prev.connect(n); prev = n; }
  if (fx) { prev.connect(fx.input); prev = fx.output; }
  prev.connect(ctx.destination); src.start();
  const out = (await ctx.startRendering()).getChannelData(0).slice();
  if (extra) { const f = Math.min(out.length, Math.round(0.25 * sr)); for (let i = 0; i < f; i++) out[out.length - 1 - i] *= i / f; }  // cierre suave de la cola
  return out;
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
