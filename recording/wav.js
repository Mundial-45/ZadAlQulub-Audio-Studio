// Codifica PCM float32 mono a WAV de 16 bits (el "original" que nunca se sobrescribe).
export function encodeWav(pcm, sampleRate) {
  const bytes = pcm.length * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < pcm.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export async function decodeWavBlob(blob) {
  const ab = await blob.arrayBuffer();
  const v = new DataView(ab);
  const sampleRate = v.getUint32(24, true);
  const n = (ab.byteLength - 44) / 2;
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) pcm[i] = v.getInt16(44 + i * 2, true) / 0x8000;
  return { pcm, sampleRate };
}
