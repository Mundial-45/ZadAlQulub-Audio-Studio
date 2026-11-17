// Genera supabase/seed.sql (categorías + identificadores de contenido) a partir de data/catalog.json.
const fs = require('fs'), path = require('path');
const cat = require('../data/catalog.json');
const folders = { azkar: 'adhkar', adya: 'adiya', ruqyah: 'ruqya', munajat: 'munajat' };
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const out = ['-- Generado por tools/build-seed.js · no editar a mano', 'begin;'];
cat.sections.forEach((s, i) => out.push(`insert into public.categories (key, folder, title_ar, title_es, title_fr, sort) values (${q(s.key)}, ${q(folders[s.key])}, ${q(s.titleAr)}, ${q(s.titleEs)}, ${q(s.titleFr)}, ${i}) on conflict (key) do update set folder = excluded.folder, title_ar = excluded.title_ar, title_es = excluded.title_es, title_fr = excluded.title_fr, sort = excluded.sort;`));
const canon = new Map();
cat.items.forEach((i) => { const ids = [i.id, ...(i.sameTextAs || [])]; const idx = (x) => cat.items.findIndex((y) => y.id === x); canon.set(i.id, ids.sort((a, b) => idx(a) - idx(b))[0]); });
const rows = cat.items.map((i) => `(${q(i.id)}, ${q(i.section)}, ${i.itemNumber}, ${q(i.group)}, ${q(canon.get(i.id))})`);
for (let k = 0; k < rows.length; k += 200) out.push('insert into public.content_items (id, category, item_number, group_id, same_text_group) values\n' + rows.slice(k, k + 200).join(',\n') + '\non conflict (id) do update set group_id = excluded.group_id, same_text_group = excluded.same_text_group;');
out.push('commit;');
fs.writeFileSync(path.join(__dirname, '..', 'supabase', 'seed.sql'), out.join('\n') + '\n');
console.log('filas:', rows.length, '| grupos de texto repetido:', new Set([...canon.values()]).size);
