// API de reducción de ruido: RNNoise (WASM) con mezcla seca/húmeda ajustable.
import { callWorker } from './worker-client.js';
import { resample } from './resample.js';

const URL_ENGINE = new URL('./rnnoise-engine.js', import.meta.url);
export const RNNOISE_RATE = 48000;
// RNNoise introduce un retardo de salida; se compensa al mezclar con la señal original.
export const RNNOISE_DELAY = 958; // medido con correlación cruzada (muestras a 48 kHz, ≈20 ms)

export async function noiseReductionAvailable() {
  try { if (typeof WebAssembly !== 'object') return false; await callWorker(URL_ENGINE, { op: 'probe' }); return true; }
  catch (e) { return false; }
}

export async function reduceNoise(pcm, sampleRate, amount, onProgress) {
  const x = await resample(pcm, sampleRate, RNNOISE_RATE);
  const copy = x.slice();
  const r = await callWorker(URL_ENGINE, { op: 'run', pcm: copy, amount }, [copy.buffer], onProgress);
  const wet = r.wet, out = new Float32Array(x.length), d = RNNOISE_DELAY;
  for (let i = 0; i < x.length; i++) {
    const w = i + d < wet.length ? wet[i + d] : 0;
    out[i] = x[i] * (1 - amount) + w * amount;
  }
  return { pcm: out, sampleRate: RNNOISE_RATE, vad: r.vad };
}
