// DSP adicional (sin DOM, corre en Worker): STFT, reducción espectral de ruido con perfil, de-reverb,
// reducción de respiraciones, puerta/expansor, de-click, de-hum, de-esser y nivelador de volumen.
// Todo es procesado offline sobre Float32Array mono. Nada de esto toca el audio original.
import { dbToLin, linToDb } from './dsp-core.js';

// ---------------------------------------------------------------- FFT radix-2 (in situ)
const fftCache = new Map();
function fftPlan(n) {
  let p = fftCache.get(n); if (p) return p;
  const rev = new Uint32Array(n), bits = Math.log2(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = -Math.sin(2 * Math.PI * i / n); }
  p = { rev, cos, sin }; fftCache.set(n, p); return p;
}
export function fft(re, im, inverse = false) {
  const n = re.length, { rev, cos, sin } = fftPlan(n);
  for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let s = 0; s < n; s += size) {
      for (let k = 0, t = 0; k < half; k++, t += step) {
        const wr = cos[t], wi = inverse ? -sin[t] : sin[t];
        const a = s + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

const hann = (n) => { const w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / n); return w; };

// Recorre el audio por tramas solapadas, llama a fn(re, im, frameIndex) para modificar el espectro y reconstruye.
export function stftProcess(pcm, N, hop, prepare, fn) {
  const win = hann(N), n = pcm.length, pad = N;
  const total = n + 2 * pad, frames = Math.ceil((total - N) / hop) + 1;
  const buf = new Float64Array(frames * hop + N);
  for (let i = 0; i < n; i++) buf[pad + i] = pcm[i];
  const out = new Float64Array(buf.length), norm = new Float64Array(buf.length);
  const re = new Float64Array(N), im = new Float64Array(N);
  if (prepare) prepare(frames);
  for (let f = 0; f < frames; f++) {
    const o = f * hop;
    for (let i = 0; i < N; i++) { re[i] = buf[o + i] * win[i]; im[i] = 0; }
    fft(re, im);
    fn(re, im, f, frames);
    fft(re, im, true);
    for (let i = 0; i < N; i++) { out[o + i] += re[i] * win[i]; norm[o + i] += win[i] * win[i]; }
  }
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) { const w = norm[pad + i]; y[i] = w > 1e-6 ? out[pad + i] / w : 0; }
  return y;
}

// Espectro de potencia medio (N/2+1 bins) de un fragmento: sirve como "perfil de ruido".
export function noiseProfileOf(pcm, N = 1024) {
  const hop = N / 2, win = hann(N), bins = N / 2 + 1, acc = new Float64Array(bins);
  const re = new Float64Array(N), im = new Float64Array(N); let c = 0;
  for (let o = 0; o + N <= pcm.length; o += hop) {
    for (let i = 0; i < N; i++) { re[i] = pcm[o + i] * win[i]; im[i] = 0; }
    fft(re, im); for (let k = 0; k < bins; k++) acc[k] += re[k] * re[k] + im[k] * im[k]; c++;
  }
  if (!c) return null;
  return Array.from(acc, (v) => v / c);
}

// ---------------------------------------------------------------- reducción espectral + de-reverb + respiraciones
// p: { amount 0..1, profile?:number[], dereverb 0..1, breath 0..1 }
export function spectralClean(pcm, sr, p) {
  const N = 1024, hop = 256, bins = N / 2 + 1;
  const amount = Math.max(0, Math.min(1, p.amount || 0)), derev = Math.max(0, Math.min(1, p.dereverb || 0)), breath = Math.max(0, Math.min(1, p.breath || 0));
  if (!pcm.length || (amount <= 0 && derev <= 0 && breath <= 0)) return pcm;

  // 1) pasada de análisis: energía por trama y estimación del ruido de fondo
  const energies = [];
  const spectra = [];
  stftProcess(pcm, N, hop, null, (re, im) => {
    const pw = new Float32Array(bins); let e = 0;
    for (let k = 0; k < bins; k++) { pw[k] = re[k] * re[k] + im[k] * im[k]; e += pw[k]; }
    spectra.push(pw); energies.push(e / bins);
  });
  const F = spectra.length;
  let noise = new Float64Array(bins);
  if (p.profile && p.profile.length === bins) { for (let k = 0; k < bins; k++) noise[k] = p.profile[k]; }
  else {
    const idx = energies.map((e, i) => i).sort((a, b) => energies[a] - energies[b]);
    const take = Math.max(4, Math.round(F * 0.12));
    for (let j = 0; j < take; j++) { const s = spectra[idx[j]]; for (let k = 0; k < bins; k++) noise[k] += s[k] / take; }
  }
  // suaviza el perfil en frecuencia para evitar "ruido musical"
  const nsm = new Float64Array(bins);
  for (let k = 0; k < bins; k++) { let a = 0, c = 0; for (let d = -3; d <= 3; d++) { const j = k + d; if (j >= 0 && j < bins) { a += noise[j]; c++; } } nsm[k] = a / c; }
  noise = nsm;

  // características por trama para respiraciones
  const sortedE = energies.slice().sort((a, b) => a - b);
  const speechLvl = sortedE[Math.floor(F * 0.9)] || 1e-9, floorLvl = sortedE[Math.floor(F * 0.1)] || 1e-12;
  const k1 = Math.round(1000 / (sr / N)), k2 = Math.min(bins - 1, Math.round(8000 / (sr / N)));
  const isBreath = new Float32Array(F);
  if (breath > 0) {
    for (let f = 0; f < F; f++) {
      const s = spectra[f]; let am = 0, lg = 0, c = 0;
      for (let k = k1; k <= k2; k++) { const v = s[k] + 1e-12; am += v; lg += Math.log(v); c++; }
      const flat = Math.exp(lg / c) / (am / c);
      const lvl = energies[f];
      const mid = lvl < speechLvl * Math.pow(10, -2.0) && lvl > floorLvl * Math.pow(10, 0.6);
      isBreath[f] = mid && flat > 0.22 ? 1 : 0;
    }
    // continuidad: una trama aislada no cuenta
    for (let f = 1; f < F - 1; f++) if (isBreath[f] && !(isBreath[f - 1] || isBreath[f + 1])) isBreath[f] = 0;
  }

  // 2) pasada de síntesis con ganancia de Wiener (a priori SNR decision-directed)
  const reduceDb = 4 + 26 * Math.max(amount, derev * 0.75), gMin = dbToLin(-reduceDb), over = 1 + 2.2 * amount;
  const alpha = 0.96, D = 10, delta = 0.9 * derev;
  const prevClean = new Float64Array(bins); const gains = new Float64Array(bins);
  const hist = []; // potencias pasadas para la cola de reverberación
  const bGain = dbToLin(-18 * breath);
  let bSmooth = 1;
  return stftProcess(pcm, N, hop, null, (re, im, f) => {
    const pw = spectra[Math.min(f, F - 1)];
    // potencia observada de esta trama ya la tenemos en pw (misma rejilla de tramas)
    const late = hist.length >= D ? hist[hist.length - D] : null;
    for (let k = 0; k < bins; k++) {
      const P = re[k] * re[k] + im[k] * im[k];
      let Nk = (amount > 0 ? noise[k] * over : noise[k] * 0.0);
      if (late && derev > 0) Nk += delta * late[k];
      let g = 1;
      if (Nk > 0) {
        const gamma = P / (Nk + 1e-20);
        const xi = alpha * (prevClean[k] / (Nk + 1e-20)) + (1 - alpha) * Math.max(gamma - 1, 0);
        g = xi / (1 + xi);
        if (g < gMin) g = gMin;
      }
      gains[k] = g;
    }
    // suavizado en frecuencia (3 bins) para reducir artefactos
    for (let k = 0; k < bins; k++) {
      const a = gains[Math.max(0, k - 1)], b = gains[k], c = gains[Math.min(bins - 1, k + 1)];
      const g = 0.25 * a + 0.5 * b + 0.25 * c;
      re[k] *= g; im[k] *= g;
      if (k > 0 && k < N / 2) { re[N - k] *= g; im[N - k] *= g; }
      prevClean[k] = P_of(re[k], im[k]);
    }
    // respiraciones
    if (breath > 0) {
      const target = isBreath[Math.min(f, F - 1)] ? bGain : 1;
      bSmooth += (target - bSmooth) * (target < bSmooth ? 0.5 : 0.2);
      for (let k = 0; k < N; k++) { re[k] *= bSmooth; im[k] *= bSmooth; }
    }
    // historial de potencia original para la estimación de cola
    const keep = new Float32Array(bins); for (let k = 0; k < bins; k++) keep[k] = pw[k];
    hist.push(keep); if (hist.length > D + 2) hist.shift();
  });
}
const P_of = (r, i) => r * r + i * i;

// ---------------------------------------------------------------- puerta / expansor con retención y anticipación
// p: { threshold dB (o auto), depth dB (>0), attack ms, hold ms, release ms, lookahead ms }
export function noiseGate(pcm, sr, p) {
  const n = pcm.length; if (!n) return pcm;
  const win = Math.max(1, Math.round(0.010 * sr));
  // envolvente RMS en ventanas de 10 ms
  const nb = Math.ceil(n / win), env = new Float32Array(nb);
  for (let b = 0; b < nb; b++) { let s = 0, c = 0; for (let i = b * win; i < Math.min(n, (b + 1) * win); i++) { s += pcm[i] * pcm[i]; c++; } env[b] = Math.sqrt(s / c); }
  let thrDb = p.threshold;
  if (p.auto) { const sorted = Array.from(env).sort((a, b) => a - b); thrDb = linToDb(sorted[Math.floor(nb * 0.1)] || 1e-5) + 9; }
  const open = dbToLin(thrDb), close = dbToLin(thrDb - 4), depth = dbToLin(-Math.abs(p.depth == null ? 25 : p.depth));
  const holdB = Math.round((p.hold == null ? 120 : p.hold) / 10), look = Math.round((p.lookahead == null ? 12 : p.lookahead) / 10);
  const state = new Float32Array(nb); let isOpen = false, hold = 0;
  for (let b = 0; b < nb; b++) {
    if (env[b] > open) { isOpen = true; hold = holdB; } else if (isOpen && env[b] < close) { if (hold-- <= 0) isOpen = false; } else if (isOpen) hold = holdB;
    state[b] = isOpen ? 1 : 0;
  }
  // anticipación: abrir antes de la primera sílaba
  const st2 = new Float32Array(nb); for (let b = 0; b < nb; b++) { let v = 0; for (let j = 0; j <= look && b + j < nb; j++) if (state[b + j]) { v = 1; break; } st2[b] = v; }
  const aC = 1 - Math.exp(-1 / (Math.max(0.5, p.attack == null ? 4 : p.attack) / 1000 * sr)), rC = 1 - Math.exp(-1 / (Math.max(5, p.release == null ? 180 : p.release) / 1000 * sr));
  const out = new Float32Array(n); let g = st2[0] ? 1 : depth;
  for (let i = 0; i < n; i++) {
    const tgt = st2[Math.min(nb - 1, (i / win) | 0)] ? 1 : depth;
    g += (tgt - g) * (tgt > g ? aC : rC);
    out[i] = pcm[i] * g;
  }
  return out;
}

// ---------------------------------------------------------------- de-click / de-pop
export function declick(pcm, sr, sensitivity) {
  const n = pcm.length, s = Math.max(0, Math.min(1, sensitivity)); if (n < 64 || s <= 0) return pcm;
  const k = 11 - 6 * s;                                  // umbral en múltiplos de la desviación local
  const d = new Float32Array(n);
  for (let i = 2; i < n; i++) d[i] = pcm[i] - 2 * pcm[i - 1] + pcm[i - 2];
  const W = Math.round(0.03 * sr), out = pcm.slice(); let acc = 0, bad = new Uint8Array(n);
  for (let i = 0; i < n; i++) { acc += Math.abs(d[i]); if (i >= W) acc -= Math.abs(d[i - W]); const sigma = acc / Math.min(i + 1, W); if (Math.abs(d[i]) > k * sigma + 1e-4) bad[i] = 1; }
  const maxRun = Math.round(0.0015 * sr);
  for (let i = 2; i < n - 2; i++) {
    if (!bad[i]) continue;
    let j = i; while (j < n - 1 && (bad[j] || bad[j + 1] || bad[j + 2]) && j - i < maxRun) j++;
    const a = Math.max(0, i - 2), b = Math.min(n - 1, j + 1);
    for (let q = a + 1; q < b; q++) out[q] = pcm[a] + (pcm[b] - pcm[a]) * (q - a) / (b - a);
    i = j;
  }
  return out;
}

// ---------------------------------------------------------------- filtros biquad (RBJ)
function biq(x, b0, b1, b2, a0, a1, a2) {
  const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
const notch = (x, sr, f, Q) => { const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * Q), c = Math.cos(w); return biq(x, 1, -2 * c, 1, 1 + al, -2 * c, 1 - al); };
const highpass = (x, sr, f, Q = 0.707) => { const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * Q), c = Math.cos(w); return biq(x, (1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al); };

// Quita zumbido de red (50/60 Hz) y sus armónicos con muescas estrechas.
export function dehum(pcm, sr, base, harmonics = 5) {
  let y = pcm;
  for (let h = 1; h <= harmonics; h++) { const f = base * h; if (f < sr / 2 - 200) y = notch(y, sr, f, 35); }
  return y;
}

// ---------------------------------------------------------------- de-esser (sibilancia relativa al nivel total)
// p: { freq Hz, sensitivity 0..1, maxReduction dB }
export function deess(pcm, sr, p) {
  const n = pcm.length; if (!n) return pcm;
  const hi = highpass(highpass(pcm, sr, p.freq || 5500), sr, p.freq || 5500);
  const sens = Math.max(0, Math.min(1, p.sensitivity == null ? 0.5 : p.sensitivity));
  const thr = 0.75 - 0.5 * sens, minG = dbToLin(-(p.maxReduction == null ? 8 : p.maxReduction));
  const aF = 1 - Math.exp(-1 / (0.0015 * sr)), rF = 1 - Math.exp(-1 / (0.04 * sr)), sl = 1 - Math.exp(-1 / (0.2 * sr));
  let eh = 0, eb = 0, g = 1; const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ah = Math.abs(hi[i]), ab = Math.abs(pcm[i]);
    eh += (ah - eh) * (ah > eh ? aF : rF); eb += (ab - eb) * sl;
    const ratio = eh / (eb + 1e-6);
    let tgt = 1; if (eb > 0.003 && ratio > thr) tgt = Math.max(minG, Math.pow(thr / ratio, 1.2));
    g += (tgt - g) * (tgt < g ? 0.02 : 0.003);
    out[i] = pcm[i] - hi[i] * (1 - g);
  }
  return out;
}

// ---------------------------------------------------------------- nivelador de volumen (ajuste lento de ganancia)
// p: { amount dB máx (±), target dBFS RMS, speed 0..1 }
export function leveler(pcm, sr, p) {
  const n = pcm.length, maxDb = Math.abs(p.amount == null ? 6 : p.amount); if (!n || maxDb <= 0) return pcm;
  const win = Math.round(0.4 * sr), hop = Math.round(0.05 * sr), target = p.target == null ? -22 : p.target;
  const nb = Math.ceil(n / hop), gdb = new Float32Array(nb);
  const cum = new Float64Array(n + 1); for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + pcm[i] * pcm[i];
  let prev = 0; const speed = 0.04 + 0.2 * (p.speed == null ? 0.4 : p.speed);
  for (let b = 0; b < nb; b++) {
    const c = b * hop, a = Math.max(0, c - win / 2), e = Math.min(n, c + win / 2);
    const rms = Math.sqrt((cum[e] - cum[a]) / Math.max(1, e - a)), db = linToDb(rms);
    let want = db < -50 ? 0 : Math.max(-maxDb, Math.min(maxDb, target - db));   // no sube los silencios
    prev += (want - prev) * speed; gdb[b] = prev;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const b = i / hop, b0 = Math.min(nb - 1, Math.floor(b)), b1 = Math.min(nb - 1, b0 + 1), f = b - b0; out[i] = pcm[i] * dbToLin(gdb[b0] * (1 - f) + gdb[b1] * f); }
  return out;
}

// ---------------------------------------------------------------- recorte automático de silencios de los extremos
export function trimSilence(pcm, sr, { margin = 0.2, extraDb = 10 } = {}) {
  const win = Math.round(0.02 * sr), nb = Math.floor(pcm.length / win); if (nb < 4) return pcm;
  const rms = new Float32Array(nb);
  for (let b = 0; b < nb; b++) { let s = 0; for (let i = b * win; i < (b + 1) * win; i++) s += pcm[i] * pcm[i]; rms[b] = Math.sqrt(s / win); }
  const sorted = Array.from(rms).sort((a, b) => a - b), floor = Math.max(sorted[Math.floor(nb * 0.1)] || 0, 1e-4), thr = Math.max(floor * dbToLin(extraDb), 0.002);
  let a = 0, z = nb - 1; while (a < nb && rms[a] < thr) a++; while (z > a && rms[z] < thr) z--;
  if (a >= z) return pcm;
  const m = Math.round(margin * sr), from = Math.max(0, a * win - m), to = Math.min(pcm.length, (z + 1) * win + m);
  const out = pcm.slice(from, to), f = Math.min(out.length >> 1, Math.round(0.02 * sr));
  for (let i = 0; i < f; i++) { out[i] *= i / f; out[out.length - 1 - i] *= i / f; }
  return out;
}
