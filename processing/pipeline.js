// Cadena de procesado: ruido → pasa-altos → EQ → compresor → normalización → limitador.
import { reduceNoise } from './noise-reduction.js';
import { buildEq } from './equalizer.js';
import { buildCompressor } from './compressor.js';
import { buildEffect, EFFECTS } from './effects.js';
import { buildExciter, buildSaturation, buildChorus } from './enhance.js';
import { withDefaults } from './profiles.js';
import { callWorker } from './worker-client.js';

const DSP = new URL('./dsp-worker.js', import.meta.url);

async function renderFilters(pcm, sr, params) {
  const effType = params.effect && params.effect.type !== 'none' ? params.effect.type : 'none';
  const tail = (EFFECTS[effType] || EFFECTS.none).tail, extra = Math.round(tail * sr);
  const ctx = new OfflineAudioContext(1, pcm.length + extra, sr);
  const chain = [...buildEq(ctx, params), ...buildCompressor(ctx, params.comp)];
  const blocks = [];
  if (params.exciter && params.exciter.enabled) blocks.push(buildExciter(ctx, params.exciter));
  if (params.saturation && params.saturation.enabled) blocks.push(buildSaturation(ctx, params.saturation));
  if (params.chorus && params.chorus.enabled) blocks.push(buildChorus(ctx, params.chorus));
  const fx = buildEffect(ctx, params.effect);
  if (fx) blocks.push(fx);
  if (!chain.length && !blocks.length) return pcm;
  const buf = ctx.createBuffer(1, pcm.length, sr); buf.copyToChannel(pcm, 0);
  const src = ctx.createBufferSource(); src.buffer = buf;
  let prev = src; for (const n of chain) { prev.connect(n); prev = n; }
  for (const bl of blocks) { prev.connect(bl.input); prev = bl.output; }
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

export async function processAudio(pcm, sampleRate, rawParams, onProgress = () => {}) {
  const params = withDefaults(rawParams);
  let x = pcm, sr = sampleRate, noiseInfo = null;
  const dsp = async (op, buf, rate) => { const c = buf.slice(); return (await callWorker(DSP, { op, pcm: c, sr: rate, params }, [c.buffer])).pcm; };
  onProgress('clean', 0);
  x = await dsp('pre', x, sr);
  if (params.noise.enabled && params.noise.amount > 0) {
    onProgress('noise', 0);
    try {
      const passes = Math.max(1, Math.min(3, params.noise.passes || 1));
      for (let k = 0; k < passes; k++) {
        const amt = k === 0 ? params.noise.amount : Math.min(1, params.noise.amount * 0.7);   // pasadas siguientes algo más suaves
        const r = await reduceNoise(x, sr, amt, (p) => onProgress('noise', (k + p) / passes));
        x = r.pcm; sr = r.sampleRate;
      }
      noiseInfo = { ok: true };
    } catch (e) { noiseInfo = { ok: false, error: String(e.message || e) }; }
  }
  onProgress('spectral', 0);
  x = await dsp('post', x, sr);
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
