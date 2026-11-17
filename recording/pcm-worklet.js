// AudioWorklet: captura PCM float32 mono sin pérdida y mide el nivel de entrada.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.buf = new Float32Array(8192);
    this.n = 0;
    this.peak = 0; this.sum = 0; this.cnt = 0; this.frames = 0;
    this.ring = new Float32Array(Math.round(sampleRate * 0.5)); this.rp = 0; this.ringFull = false;   // pre-grabación de 0,5 s
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'active') {
        if (m.value && m.preroll) this.sendRing();
        this.active = !!m.value;
      }
      else if (m.type === 'flush') { this.flush(); this.port.postMessage({ type: 'flushed' }); }
    };
  }
  sendRing() {
    const L = this.ring.length, n = this.ringFull ? L : this.rp, out = new Float32Array(n), start = this.ringFull ? this.rp : 0;
    for (let i = 0; i < n; i++) out[i] = this.ring[(start + i) % L];
    if (n) this.port.postMessage({ type: 'pcm', data: out }, [out.buffer]);
  }
  flush() {
    if (this.n > 0) {
      const out = this.buf.slice(0, this.n);
      this.port.postMessage({ type: 'pcm', data: out }, [out.buffer]);
      this.n = 0;
    }
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let peak = 0, sum = 0;
    for (let i = 0; i < ch.length; i++) { const v = ch[i], a = v < 0 ? -v : v; if (a > peak) peak = a; sum += v * v; }
    if (peak > this.peak) this.peak = peak;
    this.sum += sum; this.cnt += ch.length; this.frames += ch.length;
    const L = this.ring.length;
    for (let i = 0; i < ch.length; i++) { this.ring[this.rp++] = ch[i]; if (this.rp >= L) { this.rp = 0; this.ringFull = true; } }
    if (this.active) {
      if (this.n + ch.length > this.buf.length) this.flush();
      this.buf.set(ch, this.n); this.n += ch.length;
    }
    if (this.frames >= sampleRate / 25) {      // ~25 mediciones por segundo
      this.port.postMessage({ type: 'level', peak: this.peak, rms: Math.sqrt(this.sum / Math.max(1, this.cnt)) });
      this.peak = 0; this.sum = 0; this.cnt = 0; this.frames = 0;
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
