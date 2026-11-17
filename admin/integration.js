// Integración con ZadALQulub (manual): genera el archivo audio-overrides.js con los audios publicados que el
// administrador elija. El Studio nunca modifica ZadALQulub; el archivo se copia a mano al repositorio.
import { publicUrl } from '../services/supabase.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HEADER = '// Generado por ZadALQulub Audio Studio (pestaña Integración). Los audios de esta lista sustituyen a los originales.\n// Para volver al audio original de un elemento, quítalo de la lista desde el Studio y vuelve a generar este archivo.\n';

export function parseManifest(text) {
  const m = /=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(String(text).trim());
  if (!m) throw new Error('format');
  const o = JSON.parse(m[1]);
  if (!o || typeof o !== 'object' || typeof o.items !== 'object') throw new Error('format');
  return o;
}
export function buildManifest({ base, selected, keep }) {
  const items = {};
  for (const id of Object.keys(base.items || {}).sort()) if (keep.has(id)) items[id] = base.items[id];
  for (const [id, v] of selected) items[id] = v;                      // lo elegido pisa lo anterior
  const ordered = {}; Object.keys(items).sort((a, b) => { const [sa, na] = a.split('_'), [sb, nb] = b.split('_'); return sa === sb ? na - nb : sa < sb ? -1 : 1; }).forEach((k) => { ordered[k] = items[k]; });
  const out = { version: 1, enabled: true, generatedAt: new Date().toISOString(), items: ordered };
  return HEADER + 'window.ZAD_AUDIO_OVERRIDES = ' + JSON.stringify(out, null, 1) + ';\n';
}

export async function integrationTab(el, { t, client, catalog }) {
  el.innerHTML = `<p class="muted small">${esc(t('int.intro'))}</p><p class="muted">…</p>`;
  const { data, error } = await client.from('published_audio').select('content_id, version, current_path, published_at').eq('is_current', true);
  if (error) { el.innerHTML = `<p class="warn">${esc(error.message)}</p>`; return; }
  const byId = new Map(catalog.items.map((i) => [i.id, i]));
  const rows = (data || []).filter((r) => byId.has(r.content_id)).sort((a, b) => { const x = byId.get(a.content_id), y = byId.get(b.content_id); return x.section === y.section ? x.itemNumber - y.itemNumber : x.section < y.section ? -1 : 1; });
  const published = new Map(rows.map((r) => [r.content_id, r]));
  let current = { version: 1, enabled: true, items: {} };            // manifiesto cargado por el administrador
  const picked = new Set(), removed = new Set();
  let siblings = true, filter = '';

  const entryFor = (id, r) => { const i = byId.get(id); return { url: publicUrl(r.current_path, r.version), v: r.version, group: i.group, n: i.itemNumber }; };
  const stateOf = (id) => { const c = current.items[id], p = published.get(id); if (!c) return 'new'; return c.v === p.version ? 'same' : 'changed'; };
  function selection() {                                              // elegidos + hermanos con el mismo texto
    const m = new Map();
    for (const id of picked) {
      const r = published.get(id); if (!r) continue; m.set(id, entryFor(id, r));
      if (siblings) for (const sid of byId.get(id).sameTextAs || []) if (!published.has(sid) && byId.has(sid)) m.set(sid, entryFor(sid, r));
    }
    return m;
  }
  function render() {
    const list = rows.filter((r) => !filter || r.content_id.includes(filter));
    const cur = Object.keys(current.items);
    el.innerHTML = `<p class="muted small">${esc(t('int.intro'))}</p>
      <div class="toolbar wrap"><label class="btn small">${esc(t('int.load'))}<input id="intFile" type="file" accept=".js,.json,text/javascript" hidden></label>
        <input id="intQ" type="search" placeholder="${esc(t('admin.searchId'))}" value="${esc(filter)}">
        <button class="btn small" id="intAllNew">${esc(t('int.selectNew'))}</button><button class="btn small" id="intNone">${esc(t('int.selectNone'))}</button></div>
      <label class="check"><input id="intSib" type="checkbox" ${siblings ? 'checked' : ''}><span>${esc(t('int.siblings'))}</span></label>
      <p class="muted small" id="intLoaded">${cur.length ? esc(t('int.loaded', { n: cur.length })) : esc(t('int.noneLoaded'))}</p>
      <div class="list" id="intList">${list.length ? list.map((r) => { const i = byId.get(r.content_id), s = stateOf(r.content_id); return `<article class="card"><div class="meta"><label class="check"><input type="checkbox" data-pick="${r.content_id}" ${picked.has(r.content_id) ? 'checked' : ''}><span class="badge">${esc(r.content_id)}</span></label>
        <span class="badge rs-${s === 'same' ? 'published' : s === 'changed' ? 'pending' : 'approved'}">${esc(t('int.st.' + s))} · v${r.version}</span><span class="muted small">${esc(i.groupTitleEs)}</span></div>
        <div class="actions"><button class="btn small" data-play="${esc(r.current_path)}" data-v="${r.version}">▶ ${esc(t('card.play'))}</button></div><div class="extra"></div></article>`; }).join('') : `<p class="muted">${esc(t('int.none'))}</p>`}</div>
      ${cur.length ? `<h3>${esc(t('int.inManifest'))}</h3><div class="list">${cur.map((id) => `<label class="check"><input type="checkbox" data-rm="${id}" ${removed.has(id) ? 'checked' : ''}><span class="badge">${esc(id)}</span><span class="muted small">v${current.items[id].v || '?'}</span><span>${esc(t('int.remove'))}</span></label>`).join('')}</div>` : ''}
      <div class="panel"><p id="intSummary" class="muted"></p><div class="row wrap"><button class="btn primary" id="intGen">${esc(t('int.generate'))}</button><a class="btn" id="intDl" hidden download="audio-overrides.js">${esc(t('int.download'))}</a></div><p class="muted small">${esc(t('int.steps'))}</p></div>`;
    summary();
    el.querySelector('#intFile').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { current = parseManifest(await f.text()); removed.clear(); render(); } catch (err) { el.querySelector('#intLoaded').textContent = t('int.badFile'); } };
    el.querySelector('#intQ').onchange = (e) => { filter = e.target.value.trim().toLowerCase(); render(); };
    el.querySelector('#intSib').onchange = (e) => { siblings = e.target.checked; summary(); };
    el.querySelector('#intAllNew').onclick = () => { rows.forEach((r) => { if (stateOf(r.content_id) !== 'same') picked.add(r.content_id); }); render(); };
    el.querySelector('#intNone').onclick = () => { picked.clear(); removed.clear(); render(); };
    el.querySelector('#intList').onchange = (e) => { const id = e.target.dataset.pick; if (id) { e.target.checked ? picked.add(id) : picked.delete(id); summary(); } };
    el.querySelectorAll('[data-rm]').forEach((c) => { c.onchange = () => { c.checked ? removed.add(c.dataset.rm) : removed.delete(c.dataset.rm); summary(); }; });
    el.querySelectorAll('[data-play]').forEach((b) => { b.onclick = () => { b.closest('article').querySelector('.extra').innerHTML = `<audio controls autoplay src="${esc(publicUrl(b.dataset.play, b.dataset.v))}"></audio>`; }; });
    el.querySelector('#intGen').onclick = generate;
  }
  function summary() { const s = selection(); el.querySelector('#intSummary').textContent = t('int.summary', { n: s.size, r: removed.size }); }
  function generate() {
    const keep = new Set(Object.keys(current.items).filter((id) => !removed.has(id)));
    const text = buildManifest({ base: current, selected: selection(), keep });
    const a = el.querySelector('#intDl'); if (a.href && a.href.startsWith('blob:')) URL.revokeObjectURL(a.href);
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/javascript' })); a.hidden = false; a.click();
    window.__lastManifest = text;
  }
  render();
}
