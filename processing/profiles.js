// Perfiles iniciales (puntos de partida modificables, no modos de grabación).
const band = (type, freq, gain, q) => ({ type, freq, gain, q });
export const base = () => ({
  // --- limpieza ---
  declick: { enabled: false, amount: 0.5 },
  hum: { enabled: false, freq: 50 },
  noise: { enabled: true, amount: 0.4, passes: 1 },                    // RNNoise (red neuronal)
  spectral: { enabled: false, amount: 0.5, profile: null, profileSr: 0 },  // sustracción espectral con perfil de ruido
  dereverb: { enabled: false, amount: 0.4 },
  breath: { enabled: false, amount: 0.5 },
  gate: { enabled: false, auto: true, threshold: -50, depth: 25, hold: 120, release: 180 },
  deess: { enabled: false, freq: 5500, sensitivity: 0.5, maxReduction: 8 },
  // --- tono ---
  hpf: { enabled: true, freq: 70 },
  lpf: { enabled: false, freq: 14000 },
  eq: { enabled: true, bands: [band('lowshelf', 120, 0, 0.7), band('peaking', 280, 0, 1), band('peaking', 3000, 0, 1), band('peaking', 5500, 0, 1), band('highshelf', 10000, 0, 0.7)] },
  // --- dinámica ---
  comp: { enabled: true, threshold: -26, ratio: 1.8, knee: 12, attack: 0.012, release: 0.25, makeup: 0 },
  leveler: { enabled: false, amount: 6, target: -22, speed: 0.4 },
  // --- embellecedores y efectos ---
  exciter: { enabled: false, amount: 0.3, freq: 4000 },
  saturation: { enabled: false, drive: 0.3, mix: 0.4 },
  chorus: { enabled: false, depth: 0.4, rate: 0.8, mix: 0.3 },
  effect: { type: 'none', mix: 0.25, tone: 9000, size: 1, predelay: 0 },
  // --- salida ---
  trim: { enabled: false, margin: 0.2 },
  loudness: { enabled: true, target: -16 },
  limiter: { enabled: true, ceiling: -1 },
  gainDb: 0
});

// Completa un perfil antiguo o parcial con los valores por defecto (compatibilidad con grabaciones guardadas).
export function withDefaults(p) {
  const b = base();
  const merge = (d, s) => { for (const k of Object.keys(s || {})) { if (Array.isArray(s[k])) d[k] = s[k].map((x, i) => (x && typeof x === 'object' && d[k] && d[k][i] ? Object.assign({}, d[k][i], x) : x)); else if (s[k] && typeof s[k] === 'object' && d[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) merge(d[k], s[k]); else d[k] = s[k]; } return d; };
  return merge(b, p || {});
}

const eqSet = (p, low, mud, pres, clar, air) => { const g = p.eq.bands; g[0].gain = low; g[1].gain = mud; g[2].gain = pres; g[3].gain = clar; g[4].gain = air; };
const mk = (f) => () => withDefaults(f(base()));

export const PROFILES = {
  natural: mk((p) => { p.noise.amount = 0.3; p.hpf.freq = 60; p.comp.ratio = 1.5; p.comp.threshold = -28; return p; }),
  clean: mk((p) => { p.noise.amount = 0.6; p.hpf.freq = 80; p.comp.ratio = 2; eqSet(p, -1.5, -1, 1.5, 0, 0); p.gate.enabled = true; p.gate.depth = 14; p.gate.auto = true; return p; }),
  studio: mk((p) => { p.noise.amount = 0.5; p.hpf.freq = 75; p.comp.ratio = 2.5; p.comp.threshold = -28; p.comp.makeup = 1; eqSet(p, -1, -1, 2, 0.5, 1.5); p.deess.enabled = true; p.deess.sensitivity = 0.4; p.leveler.enabled = true; p.leveler.amount = 4; p.exciter.enabled = true; p.exciter.amount = 0.2; return p; }),
  rescue: mk((p) => {    // grabación mala: ruido fuerte, eco de habitación, zumbido
    p.noise.amount = 0.85; p.noise.passes = 2; p.hum.enabled = true; p.declick.enabled = true; p.spectral.enabled = true; p.spectral.amount = 0.6;
    p.dereverb.enabled = true; p.dereverb.amount = 0.6; p.breath.enabled = true; p.gate.enabled = true; p.gate.depth = 22; p.hpf.freq = 95; p.lpf.enabled = true; p.lpf.freq = 11000;
    p.deess.enabled = true; p.comp.ratio = 2.5; p.leveler.enabled = true; p.leveler.amount = 6; eqSet(p, -2, -2, 2.5, 0, 0); return p;
  }),
  phone: mk((p) => {     // grabado con el móvil: voz más llena y sin sibilancia
    p.noise.amount = 0.65; p.hpf.freq = 90; p.deess.enabled = true; p.deess.sensitivity = 0.6; p.dereverb.enabled = true; p.dereverb.amount = 0.35;
    p.leveler.enabled = true; p.comp.ratio = 2.2; eqSet(p, 2, -1.5, 1.5, 0, 1); p.saturation.enabled = true; p.saturation.drive = 0.25; p.saturation.mix = 0.3; return p;
  }),
  soft: mk((p) => {      // recitación suave y cálida
    p.noise.amount = 0.45; p.hpf.freq = 70; p.comp.ratio = 1.6; p.leveler.enabled = true; p.leveler.amount = 3; p.breath.enabled = true; p.breath.amount = 0.4;
    eqSet(p, 2, -0.5, 0.5, -1, 0); p.saturation.enabled = true; p.saturation.drive = 0.2; p.saturation.mix = 0.35; p.effect = { type: 'warm', mix: 0.3, tone: 9000, size: 1, predelay: 0 }; return p;
  }),
  broadcast: mk((p) => { // voz de radio / podcast: presente, cercana y uniforme
    p.noise.amount = 0.55; p.hpf.freq = 85; p.comp.ratio = 3; p.comp.threshold = -30; p.comp.makeup = 2; p.deess.enabled = true; p.gate.enabled = true; p.gate.depth = 16;
    p.leveler.enabled = true; p.leveler.amount = 5; eqSet(p, 2.5, -1.5, 3, 1, 2); p.exciter.enabled = true; p.exciter.amount = 0.3; p.saturation.enabled = true; p.saturation.drive = 0.25; p.saturation.mix = 0.3; return p;
  }),
  mosque: mk((p) => {    // espacio amplio con eco de piedra, para recitación
    p.noise.amount = 0.5; p.comp.ratio = 1.8; p.leveler.enabled = true; p.leveler.amount = 3; eqSet(p, 1, -1, 1, 0, 1); p.effect = { type: 'mosque', mix: 0.28, tone: 6500, size: 1, predelay: 0.02 }; return p;
  }),
  deep: mk((p) => {      // voz profunda y envolvente
    p.noise.amount = 0.5; p.hpf.freq = 60; p.comp.ratio = 2.2; eqSet(p, 4, 0, -0.5, -1.5, -1); p.saturation.enabled = true; p.saturation.drive = 0.35; p.saturation.mix = 0.4;
    p.chorus.enabled = true; p.chorus.mix = 0.15; p.effect = { type: 'chamber', mix: 0.12, tone: 7000, size: 1, predelay: 0.01 }; return p;
  }),
  bright: mk((p) => {    // voz brillante y clara
    p.noise.amount = 0.55; p.hpf.freq = 80; p.deess.enabled = true; p.deess.sensitivity = 0.6; p.comp.ratio = 2.2; eqSet(p, -1, -1.5, 2.5, 2, 3);
    p.exciter.enabled = true; p.exciter.amount = 0.4; p.effect = { type: 'plate', mix: 0.12, tone: 11000, size: 1, predelay: 0.008 }; return p;
  }),
  raw: mk((p) => { p.noise.enabled = false; p.hpf.enabled = false; p.eq.enabled = false; p.comp.enabled = false; return p; })   // solo normaliza y limita
};
export const PROFILE_ORDER = ['natural', 'clean', 'studio', 'rescue', 'phone', 'soft', 'broadcast', 'mosque', 'deep', 'bright', 'raw'];
export const defaultProfile = 'natural';
