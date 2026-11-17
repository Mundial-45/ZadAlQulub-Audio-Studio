// Worker: normalización LUFS, limitador, mediciones y limpieza (declick, hum, espectral, puerta, de-esser, nivelador).
import { master, integratedLufs, truePeakDb, samplePeakDb } from './dsp-core.js';
import { declick, dehum, spectralClean, noiseGate, deess, leveler, trimSilence } from './dsp-extra.js';
self.onmessage = (e) => {
  const { id, op, pcm, sr, params } = e.data;
  try {
    if (op === 'master') {
      const r = master(pcm, sr, params);
      self.postMessage({ id, ok: true, pcm: r.pcm, stats: r.stats }, [r.pcm.buffer]);
    } else if (op === 'analyze') {
      self.postMessage({ id, ok: true, stats: { lufs: integratedLufs(pcm, sr), truePeak: truePeakDb(pcm), samplePeak: samplePeakDb(pcm) } });
    } else if (op === 'pre') {                 // antes de RNNoise: clics y zumbido de red
      let x = pcm;
      if (params.declick && params.declick.enabled) x = declick(x, sr, params.declick.amount);
      if (params.hum && params.hum.enabled) x = dehum(x, sr, params.hum.freq || 50);
      self.postMessage({ id, ok: true, pcm: x }, [x.buffer]);
    } else if (op === 'post') {                // después de RNNoise
      let x = pcm; const s = params.spectral, d = params.dereverb, b = params.breath;
      const so = s && s.enabled, dr = d && d.enabled, br = b && b.enabled;
      if (so || dr || br) x = spectralClean(x, sr, { amount: so ? s.amount : 0, profile: so && s.profileSr === sr ? s.profile : null, dereverb: dr ? d.amount : 0, breath: br ? b.amount : 0 });
      if (params.gate && params.gate.enabled) x = noiseGate(x, sr, params.gate);
      if (params.deess && params.deess.enabled) x = deess(x, sr, params.deess);
      if (params.leveler && params.leveler.enabled) x = leveler(x, sr, params.leveler);
      if (params.trim && params.trim.enabled) x = trimSilence(x, sr, { margin: params.trim.margin });
      self.postMessage({ id, ok: true, pcm: x }, [x.buffer]);
    }
  } catch (err) { self.postMessage({ id, ok: false, error: String(err && err.message || err) }); }
};
