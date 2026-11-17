// DSP puro (sin DOM): sonoridad ITU-R BS.1770-4, true peak, ganancia y limitador con anticipación.
export const dbToLin = (db) => Math.pow(10, db / 20);
export const linToDb = (lin) => (lin > 1e-9 ? 20 * Math.log10(lin) : -180);

// --- Filtro de ponderación K (dos biquads) -------------------------------------------------
function kWeightCoeffs(fs) {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / fs), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0],
    a: [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
  };
  f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / fs);
  a0 = 1 + K / Q + K * K;
  const hp = { b: [1, -2, 1], a: [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, hp];
}

function biquad(x, c) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const [b0, b1, b2] = c.b, [, a1, a2] = c.a;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

// Sonoridad integrada (LUFS) con puerta absoluta (-70) y relativa (-10 LU). Mono.
export function integratedLufs(pcm, sr) {
  if (!pcm.length) return -Infinity;
  let y = pcm;
  for (const c of kWeightCoeffs(sr)) y = biquad(y, c);
  const block = Math.round(0.4 * sr), hop = Math.round(0.1 * sr);
  const energies = [];
  if (y.length < block) {
    let s = 0; for (let i = 0; i < y.length; i++) s += y[i] * y[i];
    energies.push(s / y.length);
  } else {
    // suma acumulada para evitar recalcular cada bloque
    const cum = new Float64Array(y.length + 1);
    for (let i = 0; i < y.length; i++) cum[i + 1] = cum[i] + y[i] * y[i];
    for (let s = 0; s + block <= y.length; s += hop) energies.push((cum[s + block] - cum[s]) / block);
  }
  const lk = (e) => -0.691 + 10 * Math.log10(Math.max(e, 1e-12));
  const abs = energies.filter((e) => lk(e) > -70);
  if (!abs.length) return -Infinity;
  const mean = (a) => a.reduce((p, c) => p + c, 0) / a.length;
  const rel = lk(mean(abs)) - 10;
  const gated = abs.filter((e) => lk(e) > rel);
  return gated.length ? lk(mean(gated)) : -Infinity;
}

// --- True peak (sobremuestreo x4 con sinc ventana) -----------------------------------------
const TP_TAPS = 12; // por lado
const TP_PHASES = (() => {
  const phases = [];
  for (let p = 1; p < 4; p++) {
    const frac = p / 4, h = new Float32Array(TP_TAPS * 2);
    for (let k = -TP_TAPS + 1; k <= TP_TAPS; k++) {
      const t = k - frac, s = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const win = 0.5 * (1 + Math.cos(Math.PI * t / (TP_TAPS + 0.5)));
      h[k + TP_TAPS - 1] = s * win;
    }
    phases.push(h);
  }
  return phases;
})();

export function truePeakDb(pcm) {
  let peak = 0; const n = pcm.length;
  for (let i = 0; i < n; i++) { const a = Math.abs(pcm[i]); if (a > peak) peak = a; }
  for (let i = TP_TAPS; i < n - TP_TAPS; i++) {
    // solo evaluar zonas cercanas al pico para ahorrar CPU
    if (Math.abs(pcm[i]) < peak * 0.5 && Math.abs(pcm[i + 1]) < peak * 0.5) continue;
    for (const h of TP_PHASES) {
      let acc = 0;
      for (let k = 0; k < TP_TAPS * 2; k++) acc += pcm[i - TP_TAPS + 1 + k] * h[k];
      const a = Math.abs(acc); if (a > peak) peak = a;
    }
  }
  return linToDb(peak);
}

export function samplePeakDb(pcm) {
  let p = 0; for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > p) p = a; }
  return linToDb(p);
}

export function applyGain(pcm, db) {
  const g = dbToLin(db), out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] * g;
  return out;
}

// Limitador con anticipación: la ganancia baja antes del pico y se recupera despacio.
export function limit(pcm, sr, ceilingDb, lookaheadMs = 5, releaseMs = 80) {
  const n = pcm.length, ceil = dbToLin(ceilingDb), L = Math.max(1, Math.round(lookaheadMs * sr / 1000));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = Math.abs(pcm[i]); need[i] = a > ceil ? ceil / a : 1; }
  // mínimo móvil sobre [i, i+L] (deque)
  const gmin = new Float32Array(n), dq = new Int32Array(n + 1); let head = 0, tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && need[dq[tail - 1]] >= need[i]) tail--;
    dq[tail++] = i;
    while (dq[head] > i + L) head++;
    gmin[i] = need[dq[head]];
  }
  // media móvil sobre [i-L, i] (suaviza el ataque) y liberación exponencial
  const cum = new Float64Array(n + 1); for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + gmin[i];
  const rel = 1 - Math.exp(-1 / (releaseMs / 1000 * sr));
  const out = new Float32Array(n); let gr = 1, maxRed = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - L), gs = (cum[i + 1] - cum[a]) / (i + 1 - a);
    gr = gs < gr ? gs : gr + (gs - gr) * rel;
    if (gr > gs) gr = gs;
    out[i] = pcm[i] * gr;
    if (gr < maxRed || maxRed === 0) maxRed = gr;
  }
  return { pcm: out, maxReductionDb: -linToDb(Math.min(1, maxRed || 1)) };
}

// Normaliza a un objetivo LUFS y aplica el límite de pico. Devuelve estadísticas.
export function master(pcm, sr, { normalize = true, targetLufs = -16, limiter = true, ceilingDb = -1, gainDb = 0 } = {}) {
  const stats = { lufsBefore: integratedLufs(pcm, sr), tpBefore: truePeakDb(pcm) };
  let x = gainDb ? applyGain(pcm, gainDb) : pcm;
  let appliedDb = gainDb;
  if (normalize && isFinite(stats.lufsBefore)) {
    const cur = integratedLufs(x, sr), add = targetLufs - cur;
    x = applyGain(x, add); appliedDb += add;
  }
  stats.limiterReductionDb = 0;
  if (limiter) {
    const r = limit(x, sr, ceilingDb - 0.3);
    x = r.pcm; stats.limiterReductionDb = r.maxReductionDb;
    const tp = truePeakDb(x);
    if (tp > ceilingDb) { x = applyGain(x, ceilingDb - tp); appliedDb += ceilingDb - tp; }
  }
  stats.lufsAfter = integratedLufs(x, sr); stats.tpAfter = truePeakDb(x); stats.gainAppliedDb = appliedDb;
  return { pcm: x, stats };
}
