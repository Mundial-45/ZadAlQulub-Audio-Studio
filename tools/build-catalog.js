// Genera data/catalog.json a partir de una copia local de ZadALQulub (solo lectura).
// Uso: node tools/build-catalog.js <carpeta-de-ZadALQulub> [salida.json]
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = process.argv[2];
const out = process.argv[3] || path.join(__dirname, '..', 'data', 'catalog.json');
if (!root) { console.error('Uso: node tools/build-catalog.js <carpeta-de-ZadALQulub> [salida.json]'); process.exit(1); }

const SECTIONS = [
  { key: 'azkar',   file: 'azkar.js',   variable: 'azkarData',   titleAr: 'الأذكار',        titleEs: 'Azkar',    titleFr: 'Adhkar' },
  { key: 'adya',    file: 'adya.js',    variable: 'adyaData',    titleAr: 'الأدعية',        titleEs: 'Súplicas', titleFr: 'Invocations' },
  { key: 'ruqyah',  file: 'ruqya.js',   variable: 'ruqyahData',  titleAr: 'الرقية الشرعية', titleEs: 'Ruqya',    titleFr: 'Roqya' },
  { key: 'munajat', file: 'munajat.js', variable: 'munajatData', titleAr: 'المناجاة',       titleEs: 'Munayat',  titleFr: 'Invocations intimes' }
];
const normaliseAudio = (it) => (Array.isArray(it.audioUrls) && it.audioUrls.length ? it.audioUrls : (it.audioUrl ? [it.audioUrl] : []));
const items = [], problems = [];
for (const s of SECTIONS) {
  const ctx = { window: {} }; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, s.file), 'utf8').replace('const ' + s.variable, 'var ' + s.variable), ctx);
  const seen = new Set();
  ctx[s.variable].forEach((g) => g.items.forEach((it) => {
    if (it.isInfo) return;                       // introducciones: no se graban
    if (!Number.isInteger(it.itemNumber)) { problems.push(s.key + '|' + g.id + ': item sin itemNumber'); return; }
    if (seen.has(it.itemNumber)) problems.push(s.key + ': itemNumber repetido ' + it.itemNumber);
    seen.add(it.itemNumber);
    items.push({
      id: s.key + '_' + it.itemNumber, section: s.key, itemNumber: it.itemNumber,
      group: g.id, groupTitleAr: g.titleAr, groupTitleEs: g.titleEs,
      text: it.text, latin: it.latin || '', es: it.explanationEs || '', ar: it.explanationAr || '',
      currentAudio: normaliseAudio(it)
    });
  }));
}
// Items que comparten el mismo texto árabe (normalizado): una grabación sirve para todos.
const norm = (t) => String(t).replace(/[ً-ٰٟـۖ-ۭ]/g, '').replace(/\s+/g, ' ').trim();
const byText = new Map();
items.forEach((i) => { const k = norm(i.text); if (!byText.has(k)) byText.set(k, []); byText.get(k).push(i.id); });
let n = 0;
items.forEach((i) => { const g = byText.get(norm(i.text)); i.sameTextAs = g.filter((x) => x !== i.id); if (i.sameTextAs.length) n++; });
fs.mkdirSync(path.dirname(out), { recursive: true });
let sourceCommit = '';
try { sourceCommit = require('child_process').execSync('git -C ' + JSON.stringify(root) + ' rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) {}
// Compara con el catálogo anterior para avisar de elementos nuevos o retirados (los retirados conservan sus grabaciones en Supabase).
try {
  const prev = JSON.parse(fs.readFileSync(out, 'utf8')), had = new Set(prev.items.map((i) => i.id)), has = new Set(items.map((i) => i.id));
  console.log('nuevos:', items.filter((i) => !had.has(i.id)).length, '| retirados:', prev.items.filter((i) => !has.has(i.id)).length);
} catch (e) {}
fs.writeFileSync(out, JSON.stringify({ generatedFrom: 'ZadALQulub', sourceCommit, sections: SECTIONS.map(({ key, titleAr, titleEs, titleFr }) => ({ key, titleAr, titleEs, titleFr })), items }, null, 1));
console.log('items:', items.length, '| con texto repetido:', n, '| problemas:', problems.length); problems.forEach((p) => console.log(' -', p));
