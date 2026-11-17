// Exportación MP3: mono, 192 kbps, 44,1 kHz por defecto (ajustable).
import { callWorker } from './worker-client.js';
import { resample } from './resample.js';
const URL_MP3 = new URL('./mp3-worker.js', import.meta.url);
export const MP3_DEFAULTS = { kbps: 192, sampleRate: 44100 };

export async function exportMp3(pcm, sampleRate, { kbps = MP3_DEFAULTS.kbps, rate = MP3_DEFAULTS.sampleRate } = {}, onProgress) {
  const x = await resample(pcm, sampleRate, rate), copy = x.slice();
  const r = await callWorker(URL_MP3, { pcm: copy, sr: rate, kbps }, [copy.buffer], onProgress);
  return { blob: r.blob, sampleRate: rate, kbps };
}
