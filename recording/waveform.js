// Utilidades de forma de onda compartidas por el grabador y el editor.
export function computePeaks(data, start, end, width) {
  const mins = new Float32Array(width), maxs = new Float32Array(width);
  const span = Math.max(1, end - start), step = span / width;
  for (let x = 0; x < width; x++) {
    const a = Math.floor(start + x * step), b = Math.min(data.length, Math.max(a + 1, Math.floor(start + (x + 1) * step)));
    let mn = 1, mx = -1;
    for (let i = a; i < b; i++) { const v = data[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    if (mn > mx) { mn = 0; mx = 0; }
    mins[x] = mn; maxs[x] = mx;
  }
  return { mins, maxs };
}

export function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return { w, h, dpr };
}

export function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Forma de onda "en vivo" que se desplaza durante la grabación.
export class LiveWaveform {
  constructor(canvas) { this.canvas = canvas; this.peaks = []; this.max = 600; }
  clear() { this.peaks = []; this.draw(); }
  push(peak) { this.peaks.push(peak); if (this.peaks.length > this.max) this.peaks.shift(); this.draw(); }
  draw() {
    const { w, h } = fitCanvas(this.canvas), g = this.canvas.getContext('2d');
    g.clearRect(0, 0, w, h);
    const mid = h / 2, n = this.peaks.length, step = w / this.max;
    g.fillStyle = cssVar('--wave', '#2fbf9b');
    for (let i = 0; i < n; i++) {
      const p = this.peaks[i], hh = Math.max(1, p * mid);
      g.fillStyle = p >= 0.985 ? cssVar('--danger', '#e5484d') : cssVar('--wave', '#2fbf9b');
      g.fillRect((this.max - n + i) * step, mid - hh, Math.max(1, step - 0.5), hh * 2);
    }
    g.fillStyle = cssVar('--line', '#3a4350'); g.fillRect(0, mid, w, 1);
  }
}
