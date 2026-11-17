// Editor de forma de onda interactivo: selección, zoom, recorte, eliminación, fundidos, deshacer/rehacer.
import { computePeaks, fitCanvas, cssVar } from '../recording/waveform.js';
import * as ops from './audio-trimmer.js';

const MAX_HISTORY = 25;

export class WaveformEditor extends EventTarget {
  constructor(canvas) {
    super();
    this.canvas = canvas; this.pcm = new Float32Array(0); this.sr = 48000;
    this.undoStack = []; this.redoStack = [];
    this.sel = null; this.playhead = 0;           // en muestras
    this.viewStart = 0; this.viewLen = 1;
    this._bind();
  }
  get duration() { return this.pcm.length / this.sr; }
  get selection() { return this.sel ? { ...this.sel } : null; }

  setAudio(pcm, sr) {
    this.pcm = pcm; this.sr = sr; this.undoStack = []; this.redoStack = []; this.sel = null; this.playhead = 0;
    this.viewStart = 0; this.viewLen = Math.max(1, pcm.length); this.draw(); this._changed();
  }
  _changed() { this.dispatchEvent(new CustomEvent('change', { detail: { duration: this.duration, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0, selection: this.selection } })); }
  _commit(next) {
    this.undoStack.push(this.pcm); if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = []; this.pcm = next; this.sel = null;
    this.viewStart = Math.min(this.viewStart, Math.max(0, next.length - 1)); this.viewLen = Math.min(Math.max(this.viewLen, 1), Math.max(1, next.length - this.viewStart));
    this.draw(); this._changed();
  }
  undo() { if (!this.undoStack.length) return; this.redoStack.push(this.pcm); this.pcm = this.undoStack.pop(); this.sel = null; this.zoomFit(); this._changed(); }
  redo() { if (!this.redoStack.length) return; this.undoStack.push(this.pcm); this.pcm = this.redoStack.pop(); this.sel = null; this.zoomFit(); this._changed(); }
  resetTo(pcm) { if (pcm === this.pcm) return; this._commit(pcm.slice()); this.zoomFit(); }

  // --- operaciones ---
  _range() { return this.sel ? [this.sel.start, this.sel.end] : [0, this.pcm.length]; }
  trimToSelection() { if (this.sel) this._commit(ops.trimTo(this.pcm, this.sel.start, this.sel.end)); this.zoomFit(); }
  deleteSelection() { if (this.sel) this._commit(ops.deleteRange(this.pcm, this.sel.start, this.sel.end, this.sr)); this.zoomFit(); }
  silenceSelection() { if (this.sel) this._commit(ops.silenceRange(this.pcm, this.sel.start, this.sel.end)); }
  fadeIn(sec = 0.05) { const [a] = this._range(); this._commit(ops.fadeIn(this.pcm, a, a + Math.round(sec * this.sr))); }
  fadeOut(sec = 0.08) { const [, b] = this._range(); this._commit(ops.fadeOut(this.pcm, b - Math.round(sec * this.sr), b)); }
  gain(db) { const [a, b] = this._range(); this._commit(ops.gainRange(this.pcm, a, b, db)); }

  // --- vista ---
  zoomFit() { this.viewStart = 0; this.viewLen = Math.max(1, this.pcm.length); this.draw(); }
  zoom(factor, centerSample) {
    const c = centerSample == null ? this.viewStart + this.viewLen / 2 : centerSample;
    const len = Math.max(Math.min(this.pcm.length, this.sr * 0.05), Math.min(this.pcm.length, this.viewLen * factor));
    this.viewStart = Math.max(0, Math.min(this.pcm.length - len, c - len * ((c - this.viewStart) / this.viewLen)));
    this.viewLen = len; this.draw();
  }
  pan(fraction) { this.viewStart = Math.max(0, Math.min(this.pcm.length - this.viewLen, this.viewStart + this.viewLen * fraction)); this.draw(); }
  setPlayhead(sec) { this.playhead = Math.round(sec * this.sr); this.draw(); }

  _x2s(x) { const rect = this.canvas.getBoundingClientRect(); return this.viewStart + (x - rect.left) / rect.width * this.viewLen; }
  _bind() {
    const c = this.canvas; c.style.touchAction = 'none';
    let drag = null, pinch = null; const pts = new Map();
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId); pts.set(e.pointerId, e);
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.abs(a.clientX - b.clientX), len: this.viewLen }; drag = null; return; }
      const s = Math.max(0, Math.min(this.pcm.length, this._x2s(e.clientX)));
      drag = { start: s, moved: false, x: e.clientX };
    });
    c.addEventListener('pointermove', (e) => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, e);
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.max(10, Math.abs(a.clientX - b.clientX));
        const mid = this._x2s((a.clientX + b.clientX) / 2);
        const target = pinch.len * pinch.d / d; this.zoom(target / this.viewLen, mid); return;
      }
      if (!drag) return;
      if (Math.abs(e.clientX - drag.x) > 4) drag.moved = true;
      if (drag.moved) {
        const s = Math.max(0, Math.min(this.pcm.length, this._x2s(e.clientX)));
        this.sel = { start: Math.round(Math.min(drag.start, s)), end: Math.round(Math.max(drag.start, s)) }; this.draw(); this._changed();
      }
    });
    const up = (e) => {
      pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
      if (drag && !drag.moved) { this.sel = null; this.playhead = Math.round(drag.start); this.draw(); this._changed(); this.dispatchEvent(new CustomEvent('seek', { detail: { seconds: this.playhead / this.sr } })); }
      drag = null;
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => { e.preventDefault(); if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) this.zoom(e.deltaY > 0 ? 1.25 : 0.8, this._x2s(e.clientX)); else this.pan(e.deltaX / 400); }, { passive: false });
    new ResizeObserver(() => this.draw()).observe(c);
  }

  draw() {
    const { w, h } = fitCanvas(this.canvas), g = this.canvas.getContext('2d');
    g.clearRect(0, 0, w, h);
    g.fillStyle = cssVar('--track', '#1b2027'); g.fillRect(0, 0, w, h);
    const mid = h / 2;
    g.fillStyle = cssVar('--line', '#3a4350'); g.fillRect(0, mid, w, 1);
    if (!this.pcm.length) return;
    const end = Math.min(this.pcm.length, this.viewStart + this.viewLen);
    const { mins, maxs } = computePeaks(this.pcm, this.viewStart, end, w);
    g.fillStyle = cssVar('--wave', '#2fbf9b');
    for (let x = 0; x < w; x++) { const y1 = mid - maxs[x] * mid, y2 = mid - mins[x] * mid; g.fillRect(x, y1, 1, Math.max(1, y2 - y1)); }
    const s2x = (s) => (s - this.viewStart) / this.viewLen * w;
    if (this.sel) {
      g.fillStyle = 'rgba(80,140,255,.28)'; g.fillRect(s2x(this.sel.start), 0, s2x(this.sel.end) - s2x(this.sel.start), h);
      g.fillStyle = 'rgba(80,140,255,.9)'; g.fillRect(s2x(this.sel.start), 0, 2, h); g.fillRect(s2x(this.sel.end) - 2, 0, 2, h);
    }
    const px = s2x(this.playhead);
    if (px >= 0 && px <= w) { g.fillStyle = cssVar('--accent', '#f2b134'); g.fillRect(px, 0, 2, h); }
    g.fillStyle = cssVar('--muted', '#8b95a3'); g.font = Math.round(h * 0.09) + 'px sans-serif';
    const spanSec = this.viewLen / this.sr, step = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60].find((s) => spanSec / s < 10) || 120;
    for (let t = Math.ceil(this.viewStart / this.sr / step) * step; t < end / this.sr; t += step) { const x = s2x(t * this.sr); g.fillRect(x, h - 8, 1, 8); g.fillText(t.toFixed(step < 1 ? 2 : 0) + 's', x + 3, h - 10); }
  }
}
