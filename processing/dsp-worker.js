// Worker: normalización LUFS, limitador, mediciones.
import { master, integratedLufs, truePeakDb, samplePeakDb } from './dsp-core.js';
self.onmessage = (e) => {
  const { id, op, pcm, sr, params } = e.data;
  try {
    if (op === 'master') {
      const r = master(pcm, sr, params);
      self.postMessage({ id, ok: true, pcm: r.pcm, stats: r.stats }, [r.pcm.buffer]);
    } else if (op === 'analyze') {
      self.postMessage({ id, ok: true, stats: { lufs: integratedLufs(pcm, sr), truePeak: truePeakDb(pcm), samplePeak: samplePeakDb(pcm) } });
    }
  } catch (err) { self.postMessage({ id, ok: false, error: String(err && err.message || err) }); }
};
