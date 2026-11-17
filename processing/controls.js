// Esquema declarativo de los controles de procesado. app.js construye la interfaz a partir de esto,
// así que añadir una opción es añadir una línea aquí + su texto en locales/*.json (claves "p.*").
const c = (path, label, o = {}) => ({ type: 'check', path, label, ...o });
const r = (path, label, min, max, step, unit, o = {}) => ({ type: 'range', path, label, min, max, step, unit, ...o });
const s = (path, label, options, o = {}) => ({ type: 'select', path, label, options, ...o });
const EQ = (i, label) => r(`eq.bands.${i}.gain`, label, -9, 9, 0.5, 'dB');

export const GROUPS = [
  { id: 'clean', open: true, controls: [
    c('noise.enabled', 'p.noise'), r('noise.amount', 'p.amount', 0, 1, 0.05, '%'), s('noise.passes', 'p.passes', [1, 2, 3]),
    c('spectral.enabled', 'p.spectral'), r('spectral.amount', 'p.amount', 0, 1, 0.05, '%'), { type: 'profile' },
    c('dereverb.enabled', 'p.dereverb'), r('dereverb.amount', 'p.amount', 0, 1, 0.05, '%'),
    c('breath.enabled', 'p.breath'), r('breath.amount', 'p.amount', 0, 1, 0.05, '%'),
    c('gate.enabled', 'p.gate'), c('gate.auto', 'p.gateAuto'), r('gate.threshold', 'p.gateThr', -75, -25, 1, 'dB'), r('gate.depth', 'p.gateDepth', 6, 60, 1, 'dB'), r('gate.hold', 'p.hold', 0, 500, 10, 'ms'), r('gate.release', 'p.release', 20, 800, 10, 'ms'),
    c('hum.enabled', 'p.hum'), s('hum.freq', 'p.humFreq', [50, 60]),
    c('declick.enabled', 'p.declick'), r('declick.amount', 'p.amount', 0, 1, 0.05, '%')
  ] },
  { id: 'filters', controls: [
    c('hpf.enabled', 'p.hpf'), r('hpf.freq', 'p.freq', 30, 300, 5, 'Hz'),
    c('lpf.enabled', 'p.lpf'), r('lpf.freq', 'p.freq', 4000, 20000, 250, 'Hz')
  ] },
  { id: 'eq', controls: [
    c('eq.enabled', 'p.eq'), EQ(0, 'p.eqBody'), EQ(1, 'p.eqMud'), EQ(2, 'p.eqPresence'), EQ(3, 'p.eqClarity'), EQ(4, 'p.eqAir')
  ] },
  { id: 'dynamics', controls: [
    c('comp.enabled', 'p.comp'), r('comp.threshold', 'p.threshold', -60, -6, 1, 'dB'), r('comp.ratio', 'p.ratio', 1, 4, 0.1, ':1'), r('comp.makeup', 'p.makeup', 0, 12, 0.5, 'dB'),
    c('leveler.enabled', 'p.leveler'), r('leveler.amount', 'p.levelerAmt', 0, 12, 0.5, 'dB'), r('leveler.target', 'p.levelerTarget', -35, -12, 1, 'dB'), r('leveler.speed', 'p.speed', 0, 1, 0.05, '%'),
    c('deess.enabled', 'p.deess'), r('deess.freq', 'p.deessFreq', 3500, 9000, 100, 'Hz'), r('deess.sensitivity', 'p.sensitivity', 0, 1, 0.05, '%'), r('deess.maxReduction', 'p.maxRed', 2, 18, 1, 'dB')
  ] },
  { id: 'beauty', controls: [
    c('exciter.enabled', 'p.exciter'), r('exciter.amount', 'p.amount', 0, 1, 0.05, '%'), r('exciter.freq', 'p.exciterFreq', 2000, 8000, 100, 'Hz'),
    c('saturation.enabled', 'p.saturation'), r('saturation.drive', 'p.drive', 0, 1, 0.05, '%'), r('saturation.mix', 'p.mix', 0, 1, 0.05, '%'),
    c('chorus.enabled', 'p.chorus'), r('chorus.depth', 'p.depth', 0, 1, 0.05, '%'), r('chorus.rate', 'p.rate', 0.1, 4, 0.1, 'Hz'), r('chorus.mix', 'p.mix', 0, 1, 0.05, '%')
  ] },
  { id: 'fx', controls: [
    s('effect.type', 'p.fxType', ['none', 'warm', 'bright', 'deep', 'radio', 'telephone', 'megaphone', 'room', 'chamber', 'plate', 'hall', 'mosque', 'cave', 'slap', 'echo', 'longecho'], { i18n: 'fx.' }),
    r('effect.mix', 'p.mix', 0, 1, 0.05, '%'), r('effect.tone', 'p.tone', 1500, 16000, 250, 'Hz'), r('effect.size', 'p.size', 0.5, 1.6, 0.1, '×'), r('effect.predelay', 'p.predelay', 0, 0.12, 0.005, 's')
  ] },
  { id: 'output', controls: [
    c('trim.enabled', 'p.trim'), r('trim.margin', 'p.margin', 0, 1, 0.05, 's'),
    c('loudness.enabled', 'p.target'), r('loudness.target', 'p.targetLevel', -23, -12, 0.5, 'LUFS'),
    r('limiter.ceiling', 'p.ceiling', -6, -0.1, 0.1, 'dBTP'), r('gainDb', 'p.gain', -12, 12, 0.5, 'dB')
  ] }
];

export const getPath = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
export function setPath(o, path, v) {
  const ks = path.split('.'); let a = o;
  for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] == null) a[ks[i]] = {}; a = a[ks[i]]; }
  a[ks[ks.length - 1]] = v;
}
export const fmt = (ctl, v) => {
  if (ctl.unit === '%') return Math.round(v * 100) + ' %';
  if (ctl.unit === ':1') return Number(v).toFixed(1) + ':1';
  if (ctl.unit === '×') return Number(v).toFixed(1) + '×';
  return v + ' ' + ctl.unit;
};
