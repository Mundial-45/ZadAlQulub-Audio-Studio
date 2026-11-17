// Efectos de voz seleccionables (se aplican en el procesado, no durante la captura, para conservar el original).
// tail = segundos extra que hay que renderizar al final para no cortar la reverberación o el eco.
export const EFFECTS = {
  none:      { tail: 0 },
  warm:      { tail: 0 },     // calidez: realce de graves y suavizado de agudos
  bright:    { tail: 0 },     // brillo: aire y presencia
  deep:      { tail: 0 },     // voz profunda (más cuerpo, menos estridencia)
  radio:     { tail: 0 },     // radio AM/FM
  telephone: { tail: 0 },
  megaphone: { tail: 0 },
  room:      { tail: 0.8 },
  chamber:   { tail: 1.3 },
  plate:     { tail: 1.9 },
  hall:      { tail: 2.4 },
  mosque:    { tail: 4.2 },   // gran espacio de piedra: cola larga y oscura
  cave:      { tail: 5.2 },
  slap:      { tail: 0.7 },
  echo:      { tail: 1.8 },
  longecho:  { tail: 3.2 }
};

// Respuesta al impulso sintética: ruido con caída exponencial y cola más oscura.
function impulse(ctx, seconds, predelay, darkness, seed0 = 12345) {
  const sr = ctx.sampleRate, n = Math.round(seconds * sr), pre = Math.round(predelay * sr);
  const buf = ctx.createBuffer(1, n + pre, sr), d = buf.getChannelData(0);
  let seed = seed0, lp = 0;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
  for (let i = 0; i < n; i++) {
    const t = i / sr, amp = Math.exp(-6.91 * t / seconds);
    const k = Math.min(0.97, darkness * t / seconds + 0.1);     // el filtro se cierra con el tiempo
    lp = lp * k + rnd() * (1 - k);
    d[i + pre] = lp * amp * (1 + 2 * Math.exp(-t * 60) * 0);     // sin picos artificiales
  }
  return buf;
}
const REVERBS = {
  room:    [0.6, 0.008, 0.6],
  chamber: [1.1, 0.012, 0.7],
  plate:   [1.6, 0.004, 0.35],
  hall:    [1.9, 0.02, 0.8],
  mosque:  [3.8, 0.035, 0.88],
  cave:    [4.8, 0.05, 0.9]
};
const DELAYS = {          // [tiempo s, realimentación, paso-bajo Hz]
  slap:     [0.11, 0.12, 6000],
  echo:     [0.26, 0.32, 4500],
  longecho: [0.42, 0.45, 3800]
};
const SAT_CURVE = (k) => { const n = 2048, c = new Float32Array(n), t = Math.tanh(k); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / t; } return c; };

function bf(ctx, type, f, q, gain) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; if (gain != null) b.gain.value = gain; return b; }
function chainNodes(nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return { input: nodes[0], output: nodes[nodes.length - 1] }; }

// Devuelve {input, output} ya conectados dentro del contexto, o null si no hay efecto.
export function buildEffect(ctx, effect) {
  if (!effect || effect.type === 'none' || !EFFECTS[effect.type]) return null;
  const mix = Math.max(0, Math.min(1, effect.mix == null ? 0.25 : effect.mix));
  const input = ctx.createGain(), output = ctx.createGain();
  const t = effect.type;
  // coloraciones del timbre (la mezcla regula cuánto se aplica)
  if (t === 'warm' || t === 'bright' || t === 'deep') {
    const m = mix * 2;
    const nodes = t === 'warm' ? [bf(ctx, 'lowshelf', 220, 0, 4 * m), bf(ctx, 'highshelf', 8000, 0, -3 * m)]
      : t === 'bright' ? [bf(ctx, 'peaking', 3500, 0.9, 3 * m), bf(ctx, 'highshelf', 9000, 0, 4 * m), bf(ctx, 'lowshelf', 200, 0, -1.5 * m)]
      : [bf(ctx, 'lowshelf', 150, 0, 6 * m), bf(ctx, 'peaking', 350, 0.8, 2 * m), bf(ctx, 'highshelf', 6000, 0, -4 * m)];
    const c = chainNodes([input, ...nodes, output]); return { input: c.input, output: c.output };
  }
  if (t === 'radio' || t === 'telephone' || t === 'megaphone') {
    const lo = t === 'telephone' ? 400 : t === 'radio' ? 280 : 500, hi = t === 'telephone' ? 3000 : t === 'radio' ? 5200 : 4000;
    const dry = ctx.createGain(), wet = ctx.createGain(); dry.gain.value = 1 - mix; wet.gain.value = mix;
    const ws = ctx.createWaveShaper(); ws.curve = SAT_CURVE(t === 'megaphone' ? 6 : 2.2); ws.oversample = '2x';
    const path = chainNodes([bf(ctx, 'highpass', lo, 0.8), bf(ctx, 'lowpass', hi, 0.8), bf(ctx, 'peaking', t === 'telephone' ? 1600 : 1400, 1.2, 4), ws]);
    input.connect(dry); dry.connect(output); input.connect(path.input); path.output.connect(wet); wet.connect(output);
    return { input, output };
  }
  const dry = ctx.createGain(); dry.gain.value = 1;
  const wet = ctx.createGain(); wet.gain.value = mix * 1.2;
  const tone = bf(ctx, 'lowpass', Math.max(1500, Math.min(16000, effect.tone || 9000)), 0.707);
  input.connect(dry); dry.connect(output);
  if (REVERBS[t]) {
    const [secs, pre, dark] = REVERBS[t], conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, secs * (effect.size || 1), pre + (effect.predelay || 0), dark);
    input.connect(conv); conv.connect(tone); tone.connect(wet);
  } else if (DELAYS[t]) {
    const [time, fbk, lp] = DELAYS[t], delay = ctx.createDelay(2.0); delay.delayTime.value = time;
    const fb = ctx.createGain(); fb.gain.value = fbk;
    const dtone = bf(ctx, 'lowpass', lp, 0.707);
    input.connect(delay); delay.connect(dtone); dtone.connect(fb); fb.connect(delay); dtone.connect(tone); tone.connect(wet);
  }
  wet.connect(output);
  return { input, output };
}
