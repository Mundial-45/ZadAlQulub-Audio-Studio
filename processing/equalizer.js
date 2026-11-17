// Filtro pasa-altos + ecualizador paramétrico de 3 bandas (con límites seguros para la voz árabe).
export const EQ_LIMITS = { gain: 9, q: [0.3, 6] };

export function buildEq(ctx, { hpf, lpf, eq }) {
  const nodes = [];
  if (hpf && hpf.enabled) {
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hpf.freq; f.Q.value = 0.707; nodes.push(f);
  }
  if (lpf && lpf.enabled) {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = Math.min(lpf.freq, ctx.sampleRate / 2 - 500); f.Q.value = 0.707; nodes.push(f);
  }
  if (eq && eq.enabled) {
    for (const b of eq.bands) {
      if (!b.gain) continue;
      const f = ctx.createBiquadFilter(); f.type = b.type; f.frequency.value = b.freq;
      f.gain.value = Math.max(-EQ_LIMITS.gain, Math.min(EQ_LIMITS.gain, b.gain));
      f.Q.value = Math.max(EQ_LIMITS.q[0], Math.min(EQ_LIMITS.q[1], b.q || 1)); nodes.push(f);
    }
  }
  return nodes;
}
