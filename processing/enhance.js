// Embellecedores de voz en paralelo (se mezclan con la señal limpia): exciter armónico, saturación cálida y chorus.
const bf = (ctx, type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; return b; };
const curve = (k, asym = 0) => { const n = 2048, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * (x + asym)) - Math.tanh(k * asym); } const m = Math.max(...c.map(Math.abs)) || 1; return c.map((v) => v / m); };

// Realza armónicos agudos: da brillo y claridad sin subir el ruido de fondo grave.
export function buildExciter(ctx, p) {
  const input = ctx.createGain(), output = ctx.createGain(), amt = Math.max(0, Math.min(1, p.amount == null ? 0.3 : p.amount));
  input.connect(output);
  const hp = bf(ctx, 'highpass', p.freq || 4000, 0.707), ws = ctx.createWaveShaper(); ws.curve = curve(5, 0.1); ws.oversample = '4x';
  const hp2 = bf(ctx, 'highpass', p.freq || 4000, 0.707), g = ctx.createGain(); g.gain.value = amt * 0.45;
  input.connect(hp); hp.connect(ws); ws.connect(hp2); hp2.connect(g); g.connect(output);
  return { input, output };
}

// Saturación tipo válvula: armónicos pares e impares suaves, voz más cálida y presente.
export function buildSaturation(ctx, p) {
  const input = ctx.createGain(), output = ctx.createGain(), mix = Math.max(0, Math.min(1, p.mix == null ? 0.4 : p.mix)), drive = Math.max(0, Math.min(1, p.drive == null ? 0.3 : p.drive));
  const dry = ctx.createGain(), wet = ctx.createGain(); dry.gain.value = 1 - mix * 0.5; wet.gain.value = mix;
  const pre = ctx.createGain(); pre.gain.value = 1 + drive * 2;
  const ws = ctx.createWaveShaper(); ws.curve = curve(1 + drive * 4, 0.05); ws.oversample = '4x';
  const lp = bf(ctx, 'lowpass', 9500, 0.707), post = ctx.createGain(); post.gain.value = 1 / (1 + drive * 1.2);
  input.connect(dry); dry.connect(output);
  input.connect(pre); pre.connect(ws); ws.connect(lp); lp.connect(post); post.connect(wet); wet.connect(output);
  return { input, output };
}

// Chorus / doblado: engrosa la voz con dos copias muy ligeramente desafinadas y retrasadas.
export function buildChorus(ctx, p) {
  const input = ctx.createGain(), output = ctx.createGain(), mix = Math.max(0, Math.min(1, p.mix == null ? 0.3 : p.mix)), depth = Math.max(0, Math.min(1, p.depth == null ? 0.4 : p.depth)), rate = Math.max(0.1, Math.min(5, p.rate || 0.8));
  const dry = ctx.createGain(); dry.gain.value = 1; input.connect(dry); dry.connect(output);
  [[0.017, rate, 0.0], [0.026, rate * 1.31, 1.7]].forEach(([base, r, phase]) => {
    const d = ctx.createDelay(0.1); d.delayTime.value = base;
    const lfo = ctx.createOscillator(); lfo.frequency.value = r; const lg = ctx.createGain(); lg.gain.value = 0.0035 * depth + 0.0002;
    lfo.connect(lg); lg.connect(d.delayTime); lfo.start(phase * 0.1);
    const w = ctx.createGain(); w.gain.value = mix * 0.7;
    input.connect(d); d.connect(w); w.connect(output);
  });
  return { input, output };
}
