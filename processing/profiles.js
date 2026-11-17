// Perfiles iniciales (puntos de partida modificables, no modos de grabación).
const band = (type, freq, gain, q) => ({ type, freq, gain, q });
const base = () => ({
  noise: { enabled: true, amount: 0.4 },
  hpf: { enabled: true, freq: 70 },
  eq: { enabled: true, bands: [band('lowshelf', 160, 0, 0.7), band('peaking', 3000, 0, 1), band('highshelf', 9000, 0, 0.7)] },
  comp: { enabled: true, threshold: -26, ratio: 1.8, knee: 12, attack: 0.012, release: 0.25, makeup: 0 },
  effect: { type: 'none', mix: 0.25 },
  loudness: { enabled: true, target: -16 },
  limiter: { enabled: true, ceiling: -1 },
  gainDb: 0
});
export const PROFILES = {
  natural() { const p = base(); p.noise.amount = 0.3; p.hpf.freq = 60; p.comp.ratio = 1.5; p.comp.threshold = -28; return p; },
  clean() {
    const p = base(); p.noise.amount = 0.6; p.hpf.freq = 80; p.comp.ratio = 2; p.comp.threshold = -26;
    p.eq.bands[0].gain = -1.5; p.eq.bands[1].gain = 1.5; return p;
  },
  studio() {
    const p = base(); p.noise.amount = 0.5; p.hpf.freq = 75; p.comp.ratio = 2.5; p.comp.threshold = -28; p.comp.makeup = 1;
    p.eq.bands[0].gain = -1; p.eq.bands[1].gain = 2; p.eq.bands[2].gain = 1.5; return p;
  }
};
export const defaultProfile = 'natural';
