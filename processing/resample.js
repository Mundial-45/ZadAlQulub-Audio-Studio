// Remuestreo de alta calidad con OfflineAudioContext (corre fuera del hilo de la interfaz).
export async function resample(pcm, from, to) {
  if (from === to) return pcm;
  const frames = Math.max(1, Math.round(pcm.length * to / from));
  const ctx = new OfflineAudioContext(1, frames, to);
  const buf = ctx.createBuffer(1, pcm.length, from); buf.copyToChannel(pcm, 0);
  const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
  const out = await ctx.startRendering();
  return out.getChannelData(0).slice();
}
