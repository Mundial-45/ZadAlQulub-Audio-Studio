// Efectos de voz seleccionables (se aplican en el procesado, no durante la captura, para conservar el original).
export const EFFECTS = {
  none:  { tail: 0 },
  warm:  { tail: 0 },
  room:  { tail: 0.8 },
  hall:  { tail: 2.2 },
  echo:  { tail: 1.6 }
};

// Respuesta al impulso sintética: ruido con caída exponencial y cola más oscura.
function impulse(ctx, seconds, predelay, darkness) {
  const sr = ctx.sampleRate, n = Math.round(seconds * sr), pre = Math.round(predelay * sr);
  const buf = ctx.createBuffer(1, n + pre, sr), d = buf.getChannelData(0);
  let seed = 12345, lp = 0;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
  for (let i = 0; i < n; i++) {
    const t = i / sr, amp = Math.exp(-6.91 * t / seconds);
    const k = Math.min(0.95, darkness * t / seconds + 0.1);       // el filtro se cierra con el tiempo
    lp = lp * k + rnd() * (1 - k);
    d[i + pre] = lp * amp;
  }
  return buf;
}

// Devuelve {input, output} ya conectados dentro del contexto, o null si no hay efecto.
export function buildEffect(ctx, effect) {
  if (!effect || effect.type === 'none') return null;
  const mix = Math.max(0, Math.min(1, effect.mix == null ? 0.25 : effect.mix));
  const input = ctx.createGain(), output = ctx.createGain();
  if (effect.type === 'warm') {
    const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 220; low.gain.value = 4 * mix * 2;
    const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 8000; high.gain.value = -3 * mix * 2;
    input.connect(low); low.connect(high); high.connect(output); return { input, output };
  }
  const dry = ctx.createGain(); dry.gain.value = 1;
  const wet = ctx.createGain(); wet.gain.value = mix * 1.2;
  input.connect(dry); dry.connect(output);
  if (effect.type === 'room' || effect.type === 'hall') {
    const conv = ctx.createConvolver();
    conv.buffer = effect.type === 'room' ? impulse(ctx, 0.6, 0.008, 0.6) : impulse(ctx, 1.9, 0.02, 0.8);
    input.connect(conv); conv.connect(wet);
  } else if (effect.type === 'echo') {
    const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.26;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 4500;
    input.connect(delay); delay.connect(tone); tone.connect(fb); fb.connect(delay); tone.connect(wet);
  }
  wet.connect(output);
  return { input, output };
}
