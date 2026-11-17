// Grabador avanzado: captura PCM con AudioWorklet (sin recompresión), pausa, ganancia,
// medidor de nivel y monitorización opcional con auriculares.
import { openMicrophone, describeTrack } from './microphone.js';

const WORKLET_URL = new URL('./pcm-worklet.js', import.meta.url);
const MAX_SECONDS = 15 * 60;       // límite de seguridad de memoria (~170 MB a 48 kHz)

export class Recorder extends EventTarget {
  constructor() {
    super();
    this.state = 'closed';          // closed | ready | recording | paused
    this.chunks = []; this.samples = 0;
    this.peakMax = 0; this.clipBlocks = 0;
    this._flushResolve = null;
  }
  get sampleRate() { return this.ctx ? this.ctx.sampleRate : 0; }
  get seconds() { return this.sampleRate ? this.samples / this.sampleRate : 0; }

  async open({ deviceId, noiseSuppression = false, echoCancellation = false, autoGainControl = false, sampleRate = 48000, hpf = 0, gain = 1 } = {}) {
    await this.close();
    this.stream = await openMicrophone({ deviceId, noiseSuppression, echoCancellation, autoGainControl, sampleRate });
    this.trackInfo = describeTrack(this.stream);
    let ctx;
    try { ctx = new AudioContext({ sampleRate, latencyHint: 'interactive' }); }
    catch (e) { ctx = new AudioContext({ latencyHint: 'interactive' }); }
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(WORKLET_URL);
    this.src = ctx.createMediaStreamSource(this.stream);
    this.gainNode = ctx.createGain(); this.gainNode.gain.value = gain;
    this.node = new AudioWorkletNode(ctx, 'pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
    this.mute = ctx.createGain(); this.mute.gain.value = 0;                 // mantiene vivo el worklet sin sonido
    this.monitor = ctx.createGain(); this.monitor.gain.value = 0;           // monitorización (solo con auriculares)
    if (hpf > 0) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hpf; f.Q.value = 0.707; this.src.connect(f); f.connect(this.gainNode); }
    else this.src.connect(this.gainNode);
    this.gainNode.connect(this.node);
    this.node.connect(this.mute); this.mute.connect(ctx.destination);
    this.gainNode.connect(this.monitor); this.monitor.connect(ctx.destination);
    this.node.port.onmessage = (e) => this._onMessage(e.data);
    this.state = 'ready';
    this._emit('state', { state: this.state });
    return { sampleRate: ctx.sampleRate, track: this.trackInfo };
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  _onMessage(m) {
    if (m.type === 'pcm') {
      if (this.state === 'recording' || this._flushResolve) {
        this.chunks.push(m.data); this.samples += m.data.length;
        if (this.samples / this.sampleRate >= MAX_SECONDS && this.state === 'recording') { this._emit('limit', {}); this.pause(); }
      }
    } else if (m.type === 'level') {
      if (this.state === 'recording') {
        if (m.peak > this.peakMax) this.peakMax = m.peak;
        if (m.peak >= 0.985) this.clipBlocks++;
        this._emit('time', { seconds: this.seconds });
      }
      this._emit('level', { peak: m.peak, rms: m.rms, clipping: m.peak >= 0.985, recording: this.state === 'recording' });
    } else if (m.type === 'flushed') {
      if (this._flushResolve) { this._flushResolve(); this._flushResolve = null; }
    }
  }

  setGain(g) { if (this.gainNode) this.gainNode.gain.value = g; }
  setMonitor(on) { if (this.monitor) this.monitor.gain.value = on ? 1 : 0; }

  start(preroll = false) {
    if (this.state !== 'ready') return;
    this.chunks = []; this.samples = 0; this.peakMax = 0; this.clipBlocks = 0;
    this.node.port.postMessage({ type: 'active', value: true, preroll: !!preroll });
    this.state = 'recording'; this._emit('state', { state: this.state });
  }
  pause() {
    if (this.state !== 'recording') return;
    this.node.port.postMessage({ type: 'active', value: false });
    this.state = 'paused'; this._emit('state', { state: this.state });
  }
  resume() {
    if (this.state !== 'paused') return;
    this.node.port.postMessage({ type: 'active', value: true });
    this.state = 'recording'; this._emit('state', { state: this.state });
  }
  async stop() {
    if (this.state !== 'recording' && this.state !== 'paused') return null;
    this.node.port.postMessage({ type: 'active', value: false });
    await new Promise((res) => { this._flushResolve = res; this.node.port.postMessage({ type: 'flush' }); });
    const pcm = new Float32Array(this.samples);
    let o = 0; for (const c of this.chunks) { pcm.set(c, o); o += c.length; }
    this.chunks = [];
    this.state = 'ready'; this._emit('state', { state: this.state });
    return { pcm, sampleRate: this.sampleRate, duration: pcm.length / this.sampleRate, peak: this.peakMax, clipped: this.clipBlocks > 0, track: this.trackInfo };
  }
  async close() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx && this.ctx.state !== 'closed') { try { await this.ctx.close(); } catch (e) {} }
    this.stream = null; this.ctx = null; this.node = null; this.state = 'closed';
  }
}
