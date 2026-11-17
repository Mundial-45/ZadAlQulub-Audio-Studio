// Panel de administración: grabaciones (filtros, escucha, aprobar/rechazar/publicar, versiones),
// colaboradores y estadísticas.
import { getClient, signedUrl, publicUrl } from '../services/supabase.js';
import { approve, reject } from './approval.js';
import { publish, listVersions, restoreVersion } from './publishing.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = (d) => (d ? new Date(d).toLocaleString() : '—');

export async function renderAdmin(root, ctx) {
  const { t, profile, catalog } = ctx;
  const client = await getClient();
  const st = ctx.adminState || (ctx.adminState = { tab: 'recordings', category: '', user: '', status: 'pending', q: '' });
  let profiles = [];
  try { const r = await client.from('profiles').select('*').order('created_at'); profiles = r.data || []; } catch (e) {}
  const nameOf = (id) => { const p = profiles.find((x) => x.id === id); return p ? (p.display_name || p.email) : id.slice(0, 8); };

  root.innerHTML = `<div class="tabs" id="adminTabs">${['recordings', 'collaborators', 'stats'].map((k) => `<button class="tab" data-tab="${k}" aria-selected="${st.tab === k}">${esc(t('admin.tab.' + k))}</button>`).join('')}</div><div id="adminBody"></div>`;
  root.querySelector('#adminTabs').onclick = (e) => { const b = e.target.closest('.tab'); if (b) { st.tab = b.dataset.tab; renderAdmin(root, ctx); } };
  const body = root.querySelector('#adminBody');
  if (st.tab === 'recordings') await recordingsTab(body); else if (st.tab === 'collaborators') collaboratorsTab(body); else await statsTab(body);

  // ---------------------------------------------------------------- grabaciones
  async function recordingsTab(el) {
    el.innerHTML = `<div class="toolbar wrap">
      <select id="fCat"><option value="">${esc(t('admin.allCategories'))}</option>${catalog.sections.map((s) => `<option value="${s.key}" ${st.category === s.key ? 'selected' : ''}>${esc(t('cat.' + s.key))}</option>`).join('')}</select>
      <select id="fUser"><option value="">${esc(t('admin.allUsers'))}</option>${profiles.map((p) => `<option value="${p.id}" ${st.user === p.id ? 'selected' : ''}>${esc(p.display_name || p.email)}</option>`).join('')}</select>
      <select id="fStatus"><option value="">${esc(t('admin.allStatuses'))}</option>${['pending', 'approved', 'rejected', 'published'].map((s) => `<option value="${s}" ${st.status === s ? 'selected' : ''}>${esc(t('rstatus.' + s))}</option>`).join('')}</select>
      <input id="fQ" type="search" value="${esc(st.q)}" placeholder="${esc(t('admin.searchId'))}"></div><div id="recList" class="list"><p class="muted">…</p></div>`;
    const reload = () => recordingsTab(el);
    el.querySelector('#fCat').onchange = (e) => { st.category = e.target.value; reload(); };
    el.querySelector('#fUser').onchange = (e) => { st.user = e.target.value; reload(); };
    el.querySelector('#fStatus').onchange = (e) => { st.status = e.target.value; reload(); };
    el.querySelector('#fQ').onchange = (e) => { st.q = e.target.value.trim(); reload(); };
    let q = client.from('recordings').select('*').order('submitted_at', { ascending: false }).limit(200);
    if (st.category) q = q.eq('category', st.category); if (st.user) q = q.eq('user_id', st.user); if (st.status) q = q.eq('status', st.status);
    const { data, error } = await q; const list = el.querySelector('#recList');
    if (error) { list.innerHTML = `<p class="warn">${esc(error.message)}</p>`; return; }
    const rows = (data || []).filter((r) => !st.q || r.content_id.includes(st.q.toLowerCase()));
    list.innerHTML = rows.length ? rows.map((r) => `<article class="card" data-id="${r.id}">
      <div class="meta"><span class="badge">${esc(r.content_id)}</span><span class="badge rs-${r.status}">${esc(t('rstatus.' + r.status))}</span><span class="muted small">v${r.version} · ${esc(nameOf(r.user_id))} · ${esc(fmtDate(r.submitted_at))} · ${r.duration_seconds != null ? r.duration_seconds + ' s' : ''}</span></div>
      ${r.rejection_reason ? `<p class="warn small">${esc(t('admin.reason'))}: ${esc(r.rejection_reason)}</p>` : ''}
      <div class="actions">
        <button class="btn" data-act="play">▶ ${esc(t('card.play'))}</button>
        ${r.status === 'pending' || r.status === 'rejected' ? `<button class="btn primary" data-act="approve">${esc(t('admin.approve'))}</button>` : ''}
        ${r.status !== 'rejected' && r.status !== 'published' ? `<button class="btn danger" data-act="reject">${esc(t('admin.reject'))}</button>` : ''}
        ${r.status === 'approved' ? `<button class="btn primary" data-act="publish">${esc(t('admin.publish'))}</button>` : ''}
        <button class="btn" data-act="versions">${esc(t('admin.versions'))}</button>
      </div><div class="extra"></div></article>`).join('') : `<p class="muted">${esc(t('list.empty'))}</p>`;
    list.onclick = async (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const card = b.closest('.card'), rec = rows.find((r) => r.id === card.dataset.id), extra = card.querySelector('.extra');
      b.disabled = true;
      try {
        if (b.dataset.act === 'play') { extra.innerHTML = `<audio controls autoplay src="${esc(await signedUrl(rec.file_path))}"></audio>`; }
        else if (b.dataset.act === 'approve') { await approve(client, rec.id); reload(); }
        else if (b.dataset.act === 'reject') {
          extra.innerHTML = `<textarea class="reason" rows="2" placeholder="${esc(t('admin.reasonPh'))}"></textarea><button class="btn danger" data-act="reject-ok">${esc(t('admin.rejectConfirm'))}</button>`;
        } else if (b.dataset.act === 'reject-ok') {
          const reason = extra.querySelector('textarea').value; if (!reason.trim()) { extra.querySelector('textarea').focus(); return; }
          await reject(client, rec.id, reason); reload();
        } else if (b.dataset.act === 'publish') {
          extra.textContent = t('admin.publishing'); const r = await publish(client, rec, profile.id);
          extra.innerHTML = `<p class="ok">${esc(t('admin.published', { v: r.version }))}</p><code class="url">${esc(r.url)}</code> <button class="btn" data-act="copy" data-url="${esc(r.url)}">${esc(t('admin.copyUrl'))}</button>`;
        } else if (b.dataset.act === 'copy') { await navigator.clipboard.writeText(b.dataset.url); b.textContent = t('admin.copied'); }
        else if (b.dataset.act === 'versions') await showVersions(rec, extra);
        else if (b.dataset.act === 'restore') { const row = JSON.parse(b.dataset.row); const r = await restoreVersion(client, row); extra.innerHTML = `<p class="ok">${esc(t('admin.published', { v: r.version }))}</p><code class="url">${esc(r.url)}</code>`; }
        else if (b.dataset.act === 'playPub') { const au = card.querySelector('.pubplayer'); au.src = b.dataset.url; au.hidden = false; au.play(); }
      } catch (err) { extra.innerHTML = `<p class="warn">${esc(err.message === 'reason' ? t('admin.reasonPh') : err.message)}</p>`; }
      finally { b.disabled = false; }
    };
  }
  async function showVersions(rec, extra) {
    const [others, pubs] = await Promise.all([
      client.from('recordings').select('*').eq('content_id', rec.content_id).order('version', { ascending: false }),
      listVersions(client, rec.content_id)
    ]);
    extra.innerHTML = `<h4>${esc(t('admin.recVersions'))}</h4>` + (others.data || []).map((r) => `<div class="vrow"><span class="badge">v${r.version}</span> <span class="badge rs-${r.status}">${esc(t('rstatus.' + r.status))}</span> ${esc(nameOf(r.user_id))} · ${esc(fmtDate(r.submitted_at))} <button class="btn" data-act="playRec" data-path="${esc(r.file_path)}">▶</button></div>`).join('')
      + `<h4>${esc(t('admin.pubVersions'))}</h4>` + (pubs.length ? pubs.map((p) => `<div class="vrow"><span class="badge ${p.is_current ? 'done' : ''}">v${p.version}${p.is_current ? ' ★' : ''}</span> ${esc(fmtDate(p.published_at))} <button class="btn" data-act="playPub" data-url="${esc(publicUrl(p.file_path))}">▶</button>${p.is_current ? ` <button class="btn" data-act="copy" data-url="${esc(publicUrl(p.current_path, p.version))}">${esc(t('admin.copyUrl'))}</button>` : ` <button class="btn" data-act="restore" data-row='${esc(JSON.stringify(p))}'>${esc(t('admin.restore'))}</button>`}</div>`).join('') : `<p class="muted">—</p>`)
      + `<audio class="pubplayer" controls hidden></audio>`;
    extra.onclick = async (e) => { const b = e.target.closest('[data-act=playRec]'); if (!b) return; e.stopPropagation(); const au = extra.querySelector('.pubplayer'); au.src = await signedUrl(b.dataset.path); au.hidden = false; au.play(); };
  }

  // ---------------------------------------------------------------- colaboradores
  function collaboratorsTab(el) {
    el.innerHTML = `<p class="muted">${esc(t('admin.inviteHelp'))}</p><div class="list">${profiles.map((p) => `<article class="card"><div class="meta"><strong>${esc(p.display_name || '')}</strong><span class="muted small">${esc(p.email || '')}</span><span class="badge ${p.role === 'admin' ? 'done' : ''}">${esc(t('role.' + p.role))}</span><span class="badge ${p.active ? '' : 'recorded'}">${esc(t(p.active ? 'admin.active' : 'admin.inactive'))}</span></div>
      ${p.id === profile.id ? '' : `<div class="actions"><button class="btn" data-act="toggle" data-id="${p.id}" data-active="${p.active}">${esc(t(p.active ? 'admin.deactivate' : 'admin.activate'))}</button><button class="btn" data-act="role" data-id="${p.id}" data-role="${p.role}">${esc(t(p.role === 'admin' ? 'admin.makeCollab' : 'admin.makeAdmin'))}</button></div>`}</article>`).join('')}</div>`;
    el.onclick = async (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return; b.disabled = true;
      const patch = b.dataset.act === 'toggle' ? { active: b.dataset.active !== 'true' } : { role: b.dataset.role === 'admin' ? 'collaborator' : 'admin' };
      const { error } = await client.from('profiles').update(patch).eq('id', b.dataset.id);
      if (error) alert(error.message); renderAdmin(root, ctx);
    };
  }

  // ---------------------------------------------------------------- estadísticas
  async function statsTab(el) {
    const [recs, pubs] = await Promise.all([client.from('recordings').select('status, category, user_id, content_id'), client.from('published_audio').select('content_id').eq('is_current', true)]);
    const rows = recs.data || [], by = (key) => rows.reduce((m, r) => { m[r[key]] = (m[r[key]] || 0) + 1; return m; }, {});
    const byStatus = by('status'), byUser = by('user_id');
    const total = {}; catalog.items.forEach((i) => { total[i.section] = (total[i.section] || 0) + 1; });
    const pubBy = {}; (pubs.data || []).forEach((p) => { const it = catalog.byId.get(p.content_id); if (it) pubBy[it.section] = (pubBy[it.section] || 0) + 1; });
    el.innerHTML = `<div class="grid2"><div class="card"><h3>${esc(t('admin.byStatus'))}</h3>${['pending', 'approved', 'rejected', 'published'].map((s) => `<div>${esc(t('rstatus.' + s))}: <strong>${byStatus[s] || 0}</strong></div>`).join('')}</div>
      <div class="card"><h3>${esc(t('admin.byCategory'))}</h3>${catalog.sections.map((s) => `<div>${esc(t('cat.' + s.key))}: <strong>${pubBy[s.key] || 0}</strong> / ${total[s.key] || 0} ${esc(t('admin.publishedWord'))}</div>`).join('')}</div>
      <div class="card"><h3>${esc(t('admin.byUser'))}</h3>${Object.entries(byUser).map(([u, n]) => `<div>${esc(nameOf(u))}: <strong>${n}</strong></div>`).join('') || '—'}</div></div>`;
  }
}
