// Worker: codificación MP3 (lamejs). Mono, bitrate constante.
import { Mp3Encoder } from '../vendor/lamejs.js';
self.onmessage = (e) => {
  const { id, pcm, sr, kbps } = e.data;
  try {
    const enc = new Mp3Encoder(1, sr, kbps), parts = [], BLOCK = 1152 * 8;
    const i16 = new Int16Array(BLOCK);
    for (let o = 0; o < pcm.length; o += BLOCK) {
      const len = Math.min(BLOCK, pcm.length - o), view = len === BLOCK ? i16 : new Int16Array(len);
      for (let i = 0; i < len; i++) { const s = Math.max(-1, Math.min(1, pcm[o + i])); view[i] = s < 0 ? s * 32768 : s * 32767; }
      const out = enc.encodeBuffer(view); if (out.length) parts.push(new Uint8Array(out));
      if (((o / BLOCK) & 31) === 0) self.postMessage({ id, progress: o / pcm.length });
    }
    const end = enc.flush(); if (end.length) parts.push(new Uint8Array(end));
    self.postMessage({ id, ok: true, blob: new Blob(parts, { type: 'audio/mpeg' }) });
  } catch (err) { self.postMessage({ id, ok: false, error: String(err && err.message || err) }); }
};
