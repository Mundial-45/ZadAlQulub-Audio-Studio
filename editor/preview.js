// Reproducción de previsualización (original frente a procesado) con posición de lectura.
export class Previewer extends EventTarget {
  constructor() { super(); this.ctx = null; this.src = null; this.playing = false; this.volume = 1; }
  _ctx() { if (!this.ctx || this.ctx.state === 'closed') { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); this.gain = this.ctx.createGain(); this.gain.connect(this.ctx.destination); } this.gain.gain.value = this.volume; return this.ctx; }
  setVolume(v) { this.volume = v; if (this.gain) this.gain.gain.value = v; }
  async play(pcm, sr, fromSec = 0, toSec = null) {
    this.stop();
    const ctx = this._ctx(); if (ctx.state === 'suspended') await ctx.resume();
    const buf = ctx.createBuffer(1, pcm.length, sr); buf.copyToChannel(pcm, 0);
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(this.gain);
    const end = toSec == null ? buf.duration : Math.min(toSec, buf.duration);
    this.startedAt = ctx.currentTime; this.from = fromSec; this.end = end;
    src.start(0, fromSec, Math.max(0.01, end - fromSec));
    src.onended = () => { if (this.src === src) { this.playing = false; this._tick(true); this.dispatchEvent(new CustomEvent('ended')); } };
    this.src = src; this.playing = true;
    const loop = () => { if (!this.playing) return; this._tick(false); requestAnimationFrame(loop); }; loop();
  }
  position() { return this.playing ? Math.min(this.end, this.from + (this.ctx.currentTime - this.startedAt)) : this.from; }
  _tick(final) { this.dispatchEvent(new CustomEvent('tick', { detail: { seconds: final ? this.end : this.position() } })); }
  stop() { if (this.src) { const s = this.src; this.src = null; this.playing = false; try { s.stop(); } catch (e) {} } }
}
