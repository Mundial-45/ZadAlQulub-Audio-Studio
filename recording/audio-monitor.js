// Medidor de nivel (dBFS) con retención de pico e indicador de saturación.
import { fitCanvas, cssVar } from './waveform.js';

export const toDb = (lin) => (lin > 1e-6 ? 20 * Math.log10(lin) : -120);

export class LevelMeter {
  constructor(canvas) {
    this.canvas = canvas; this.level = 0; this.hold = 0; this.holdTime = 0; this.clipUntil = 0;
    this.low = 0; // segundos seguidos con nivel bajo
    this.min = -60;
  }
  update(peak, recording) {
    const now = performance.now();
    this.level = Math.max(peak, this.level * 0.85);
    if (peak >= this.hold || now - this.holdTime > 1200) { this.hold = peak; this.holdTime = now; }
    if (peak >= 0.985) this.clipUntil = now + 2500;
    this.low = (recording && peak < 0.05) ? this.low + 0.04 : 0;
    this.draw();
    const db = toDb(peak);
    return {
      db, clipping: now < this.clipUntil,
      tooHigh: toDb(this.hold) > -3 && now < this.holdTime + 1200,
      tooLow: recording && this.low > 2
    };
  }
  draw() {
    const { w, h } = fitCanvas(this.canvas), g = this.canvas.getContext('2d');
    g.clearRect(0, 0, w, h);
    const pos = (lin) => Math.max(0, Math.min(1, (toDb(lin) - this.min) / -this.min)) * w;
    g.fillStyle = cssVar('--track', '#252b33'); g.fillRect(0, 0, w, h);
    const x = pos(this.level);
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#2fbf9b'); grad.addColorStop(0.72, '#2fbf9b'); grad.addColorStop(0.86, '#f2b134'); grad.addColorStop(1, '#e5484d');
    g.fillStyle = grad; g.fillRect(0, 0, x, h);
    g.fillStyle = '#fff'; g.fillRect(Math.min(w - 2, pos(this.hold)), 0, 2, h);
    g.fillStyle = cssVar('--muted', '#8b95a3'); g.font = Math.round(h * 0.38) + 'px sans-serif';
    [-48, -36, -24, -12, -6, 0].forEach((db) => { const px = ((db - this.min) / -this.min) * w; g.fillRect(px, h - 4, 1, 4); });
  }
}
