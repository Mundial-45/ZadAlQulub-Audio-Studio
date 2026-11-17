// Worker: reducción de ruido con RNNoise (WebAssembly). Trabaja a 48 kHz, tramas de 480 muestras.
import { Rnnoise } from '../vendor/rnnoise.js';
let rn = null;
self.onmessage = async (e) => {
  const { id, op, pcm, amount } = e.data;
  try {
    if (!rn) rn = await Rnnoise.load();
    if (op === 'probe') { self.postMessage({ id, ok: true, frameSize: rn.frameSize }); return; }
    const fs = rn.frameSize, st = rn.createDenoiseState();
    const n = pcm.length, wet = new Float32Array(n), frame = new Float32Array(fs);
    let vadSum = 0, frames = 0;
    for (let o = 0; o < n; o += fs) {
      const len = Math.min(fs, n - o);
      frame.fill(0);
      for (let i = 0; i < len; i++) frame[i] = pcm[o + i] * 32768;
      vadSum += st.processFrame(frame); frames++;
      for (let i = 0; i < len; i++) wet[o + i] = frame[i] / 32768;
      if ((frames & 255) === 0) self.postMessage({ id, progress: o / n });
    }
    st.destroy();
    self.postMessage({ id, ok: true, wet, vad: frames ? vadSum / frames : 0 }, [wet.buffer]);
  } catch (err) { self.postMessage({ id, ok: false, error: String(err && err.message || err) }); }
};
