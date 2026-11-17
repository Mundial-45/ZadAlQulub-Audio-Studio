// Traducciones ES / FR / AR con cambio de idioma en caliente y orientación RTL para árabe.
export const LANGS = { es: { name: 'Español', dir: 'ltr' }, fr: { name: 'Français', dir: 'ltr' }, ar: { name: 'العربية', dir: 'rtl' } };
let dict = {}, current = 'es';
export const lang = () => current;
export function t(key, vars) {
  let s = dict[key] !== undefined ? dict[key] : key;
  if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}
export async function setLang(code) {
  if (!LANGS[code]) code = 'es';
  const res = await fetch(new URL('../locales/' + code + '.json', import.meta.url));
  dict = await res.json(); current = code;
  document.documentElement.lang = code; document.documentElement.dir = LANGS[code].dir;
  try { localStorage.setItem('studio_lang', code); } catch (e) {}
  applyI18n(document);
  document.dispatchEvent(new CustomEvent('langchange', { detail: { lang: code } }));
}
export function applyI18n(root) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); });
}
export function initialLang() {
  try { const s = localStorage.getItem('studio_lang'); if (LANGS[s]) return s; } catch (e) {}
  const n = (navigator.language || 'es').slice(0, 2); return LANGS[n] ? n : 'es';
}
