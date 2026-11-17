// ZadALQulub Audio Studio — interfaz principal (catálogo + estudio).
import { t, setLang, initialLang, LANGS, lang } from './services/i18n.js';
import { loadCatalog } from './services/content-loader.js';
import * as store from './services/local-store.js';
import { checkCapabilities, listInputDevices } from './recording/microphone.js';
import { Recorder } from './recording/recorder.js';
import { LiveWaveform } from './recording/waveform.js';
import { LevelMeter } from './recording/audio-monitor.js';
import { encodeWav, decodeWavBlob } from './recording/wav.js';
import { WaveformEditor } from './editor/waveform-editor.js';
import { Previewer } from './editor/preview.js';
import { PROFILES, defaultProfile } from './processing/profiles.js';
import { processAudio } from './processing/pipeline.js';
import { noiseReductionAvailable } from './processing/noise-reduction.js';
import { exportMp3 } from './processing/mp3-exporter.js';
import { isConfigured, getSession, signIn, signOut, getProfile, loadRemoteState, signedUrl, publicUrl, resetPassword, getClient, setPassword } from './services/supabase.js';
import { submitRecording } from './services/audio-upload.js';
import { renderAdmin } from './admin/dashboard.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PAGE = 40;
const strip = (s) => String(s || '').replace(/[ً-ٰٟـۖ-ۭ]/g, '').toLowerCase();
const fmtTime = (s) => { const m = Math.floor(s / 60), r = s - m * 60; return String(m).padStart(2, '0') + ':' + r.toFixed(1).padStart(4, '0'); };

const S = { catalog: null, statuses: {}, remote: null, user: null, profile: null, view: 'catalog', section: 'azkar', filter: 'all', query: '', shown: PAGE, item: null,
  original: null, originalWav: null, processed: null, processedSource: null, mp3: null, caps: checkCapabilities() };
const recorder = new Recorder(), previewer = new Previewer(), cardAudio = $('cardPlayer');
let editor, meter, live, lastDevices = [];

// ------------------------------------------------------------------ vistas y sesión
function showView(name) {
  S.view = name;
  ['login', 'catalog', 'studio', 'my', 'admin'].forEach((v) => { $(v + 'View').hidden = v !== name; });
  $('mainNav').hidden = !S.user || name === 'studio' || name === 'login';
  $('navCatalog').setAttribute('aria-selected', name === 'catalog'); $('navMy').setAttribute('aria-selected', name === 'my'); $('navAdmin').setAttribute('aria-selected', name === 'admin');
  window.scrollTo(0, 0);
}
async function refreshRemote() {
  if (!S.user) { S.remote = null; return; }
  try { S.remote = await loadRemoteState(S.user.id); } catch (e) { console.warn(e); }
}
async function enterApp(session) {
  S.user = session.user;
  try { S.profile = await getProfile(S.user.id); } catch (e) { $('loginError').textContent = t('auth.error', { err: e.message }); showView('login'); return; }
  if (!S.profile.active) { $('loginError').textContent = t('auth.inactive'); await signOut(); S.user = null; showView('login'); return; }
  $('userChip').textContent = S.profile.display_name || S.profile.email || '';
  $('navAdmin').hidden = S.profile.role !== 'admin';
  await refreshRemote(); renderList(); showView('catalog');
  if (S.needPw) { S.needPw = false; $('pwMsg').textContent = ''; $('pwDialog').showModal(); }
}
function renderMy() {
  const mine = S.remote ? S.remote.mine : [];
  $('myList').innerHTML = mine.length ? mine.map((r) => `<article class="card" data-id="${r.id}" data-content="${r.content_id}" data-path="${esc(r.file_path)}">
    <div class="meta"><span class="badge">${esc(r.content_id)}</span><span class="badge rs-r_${r.status}">${esc(t('status.r_' + r.status))}</span><span class="muted small">v${r.version} · ${esc(new Date(r.submitted_at).toLocaleString())}</span></div>
    ${r.rejection_reason ? `<p class="warn">${esc(t('admin.reason'))}: ${esc(r.rejection_reason)}</p>` : ''}
    <div class="actions"><button class="btn" data-act="play">▶ ${esc(t('card.play'))}</button><button class="btn primary" data-act="again">${esc(t('my.rerecord'))}</button></div><div class="extra"></div></article>`).join('') : `<p class="muted">${esc(t('my.empty'))}</p>`;
}

// ------------------------------------------------------------------ catálogo
const isDone = (st) => st.state === 'done' || st.state === 'r_pending' || st.state === 'r_approved' || st.state === 'r_published';
function statusOf(id) {
  const item = S.catalog.byId.get(id), r = S.remote;
  if (r) {
    const group = [id].concat(item.sameTextAs || []);
    const pubId = group.find((g) => r.published.has(g));
    if (pubId) return { state: 'r_published', via: pubId === id ? null : pubId, pubId };
    const mine = r.latest.get(id);
    if (mine) return { state: 'r_' + mine.status, reason: mine.rejection_reason, mine };
    const viaId = (item.sameTextAs || []).find((g) => r.latest.get(g) && r.latest.get(g).status !== 'rejected');
    if (viaId) return { state: 'r_' + r.latest.get(viaId).status, via: viaId, mine: r.latest.get(viaId) };
  }
  return S.statuses[id] || { state: 'pending' };
}
function filtered() {
  const q = strip(S.query).trim();
  return S.catalog.items.filter((i) => {
    if (i.section !== S.section) return false;
    if (S.filter === 'pending' && isDone(statusOf(i.id))) return false;
    if (S.filter === 'done' && !isDone(statusOf(i.id))) return false;
    if (!q) return true;
    return i.id.includes(q) || String(i.itemNumber) === q || strip(i.text).includes(q) || strip(i.groupTitleEs).includes(q) || strip(i.groupTitleAr).includes(q);
  });
}
function renderTabs() {
  $('tabs').innerHTML = S.catalog.sections.map((s) => {
    const items = S.catalog.items.filter((i) => i.section === s.key), done = items.filter((i) => isDone(statusOf(i.id))).length;
    return `<button class="tab" role="tab" data-sec="${s.key}" aria-selected="${s.key === S.section}">${esc(t('cat.' + s.key))}<small>${done}/${items.length}</small></button>`;
  }).join('');
}
function renderProgress() {
  const items = S.catalog.items.filter((i) => i.section === S.section), done = items.filter((i) => isDone(statusOf(i.id))).length;
  $('progressBar').style.width = (items.length ? done / items.length * 100 : 0) + '%';
  $('progressText').textContent = t('progress', { done, total: items.length });
}
function statusBadge(id) {
  const st = statusOf(id);
  if (st.state.startsWith('r_')) return `<span class="badge rs-${st.state.slice(2)}">${esc(t('status.' + st.state))}${st.via ? ' · ' + esc(t('status.via', { id: st.via })) : ''}</span>${st.reason ? `<span class="warn small"> ${esc(t('admin.reason'))}: ${esc(st.reason)}</span>` : ''}`;
  if (st.state === 'done') return `<span class="badge done">${esc(st.via ? t('status.doneVia', { id: st.via }) : t('status.done'))}</span>`;
  if (st.state === 'recorded') return `<span class="badge recorded">${esc(t('status.recorded'))}</span>`;
  return `<span class="badge">${esc(t('status.pending'))}</span>`;
}
function renderList() {
  const all = filtered(), page = all.slice(0, S.shown);
  $('list').innerHTML = page.length ? page.map((i) => {
    const st = statusOf(i.id), hasAudio = isDone(st) || st.state === 'r_rejected' || (i.currentAudio && i.currentAudio.length);
    return `<article class="card" data-id="${i.id}">
      <div class="meta"><span class="badge">${esc(i.id)}</span>${statusBadge(i.id)}<span class="muted small">${esc(t('card.group'))}: ${esc(lang() === 'ar' ? i.groupTitleAr : i.groupTitleEs)}</span>
      ${i.sameTextAs && i.sameTextAs.length ? `<span class="muted small">· ${esc(t('card.sameText', { n: i.sameTextAs.length }))}</span>` : ''}</div>
      <div class="ar" lang="ar" dir="rtl">${esc(i.text)}</div>
      <div class="actions">
        <button class="btn primary" data-act="record">${esc(t(st.state === 'pending' || st.state === 'recorded' ? 'card.record' : 'card.rerecord'))}</button>
        <button class="btn" data-act="play" ${hasAudio ? '' : 'disabled'}>▶ ${esc(t(isDone(st) || st.state === 'r_rejected' ? 'card.play' : 'card.currentAudio'))}</button>
      </div></article>`;
  }).join('') : `<p class="muted">${esc(t('list.empty'))}</p>`;
  $('moreBtn').hidden = all.length <= S.shown;
  renderTabs(); renderProgress();
}
async function playCard(id) {
  const item = S.catalog.byId.get(id), st = statusOf(id);
  cardAudio.pause();
  if (cardAudio.dataset.id === id && cardAudio.dataset.playing === '1') { cardAudio.dataset.playing = '0'; return; }
  let url = null;
  try {
    if (st.state === 'r_published' && S.remote) { const p = S.remote.published.get(st.pubId); if (p) url = publicUrl(p.current_path, p.version); }
    else if (st.state.startsWith('r_') && st.mine) url = await signedUrl(st.mine.file_path);
    else if (st.state === 'done') { const rec = await store.getRecord(st.via || id); if (rec && rec.mp3) url = URL.createObjectURL(rec.mp3); }
  } catch (e) {}
  if (url && /^(https?|blob):/.test(url)) { cardAudio.dataset.id = id; cardAudio.dataset.playing = '1'; cardAudio.onended = () => { cardAudio.dataset.playing = '0'; }; cardAudio.src = url; cardAudio.play().catch(() => {}); return; }
  if (!url && item.currentAudio && item.currentAudio.length) {
    const list = item.currentAudio.slice(); let k = 0;
    cardAudio.dataset.id = id; cardAudio.dataset.playing = '1'; cardAudio.src = list[0]; cardAudio.play().catch(() => {});
    cardAudio.onended = () => { k++; if (k < list.length) { cardAudio.src = list[k]; cardAudio.play(); } else cardAudio.dataset.playing = '0'; };
    return;
  }
  if (url) { cardAudio.dataset.id = id; cardAudio.dataset.playing = '1'; cardAudio.onended = () => { cardAudio.dataset.playing = '0'; }; cardAudio.src = url; cardAudio.play().catch(() => {}); }
}

// ------------------------------------------------------------------ estudio
const val = (id) => parseFloat($(id).value);
function paramsToControls(p) {
  $('noiseOn').checked = p.noise.enabled; $('noiseAmt').value = p.noise.amount;
  $('hpfOn').checked = p.hpf.enabled; $('hpfFreq').value = p.hpf.freq;
  $('eqLow').value = p.eq.bands[0].gain; $('eqMid').value = p.eq.bands[1].gain; $('eqHigh').value = p.eq.bands[2].gain;
  $('compOn').checked = p.comp.enabled; $('compThr').value = p.comp.threshold; $('compRatio').value = p.comp.ratio;
  $('fxType').value = (p.effect && p.effect.type) || 'none'; $('fxMix').value = p.effect ? p.effect.mix : 0.25;
  $('normOn').checked = p.loudness.enabled; $('lufsTarget').value = p.loudness.target; $('ceiling').value = p.limiter.ceiling; $('gainDb').value = p.gainDb;
  S.profile = p; refreshOutputs();
}
function controlsToParams() {
  const p = JSON.parse(JSON.stringify(S.profile || PROFILES[defaultProfile]()));
  p.noise = { enabled: $('noiseOn').checked, amount: val('noiseAmt') };
  p.hpf = { enabled: $('hpfOn').checked, freq: val('hpfFreq') };
  p.eq.bands[0].gain = val('eqLow'); p.eq.bands[1].gain = val('eqMid'); p.eq.bands[2].gain = val('eqHigh');
  p.comp.enabled = $('compOn').checked; p.comp.threshold = val('compThr'); p.comp.ratio = val('compRatio');
  p.loudness = { enabled: $('normOn').checked, target: val('lufsTarget') };
  p.limiter = { enabled: true, ceiling: val('ceiling') }; p.gainDb = val('gainDb');
  p.effect = { type: $('fxType').value, mix: val('fxMix') };
  return p;
}
function refreshOutputs() {
  $('noiseOut').textContent = Math.round(val('noiseAmt') * 100) + ' %'; $('hpfOut').textContent = val('hpfFreq') + ' Hz';
  $('eqLowOut').textContent = val('eqLow') + ' dB'; $('eqMidOut').textContent = val('eqMid') + ' dB'; $('eqHighOut').textContent = val('eqHigh') + ' dB';
  $('compThrOut').textContent = val('compThr') + ' dB'; $('compRatioOut').textContent = val('compRatio').toFixed(1) + ':1';
  $('lufsOut').textContent = val('lufsTarget') + ' LUFS'; $('ceilOut').textContent = val('ceiling') + ' dBTP'; $('gainDbOut').textContent = val('gainDb') + ' dB';
  $('fxMixOut').textContent = Math.round(val('fxMix') * 100) + ' %'; $('fxMix').disabled = $('fxType').value === 'none';
  $('noiseWarn').hidden = !($('noiseOn').checked && val('noiseAmt') > 0.8);
}

function openStudio(id) {
  const item = S.catalog.byId.get(id); S.item = item;
  S.original = null; S.originalWav = null; S.processed = null; S.mp3 = null;
  S.returnView = S.view === 'studio' ? S.returnView : S.view; showView('studio');
  $('studioId').textContent = item.id; $('studioGroup').textContent = lang() === 'ar' ? item.groupTitleAr : item.groupTitleEs;
  $('studioText').innerHTML = `<div class="ar" lang="ar" dir="rtl">${esc(item.text)}</div>`;
  $('editBody').hidden = true; $('editEmpty').hidden = false; $('mp3Btn').disabled = true;
  $('downloadLink').hidden = true; $('saveBtn').hidden = true; $('submitBtn').hidden = true; $('inclRow').hidden = true; $('submitStatus').textContent = ''; $('mp3Player').hidden = true; $('mp3Status').textContent = ''; $('saveStatus').textContent = ''; $('recSaved').textContent = ''; $('procStats').textContent = ''; $('procStatus').textContent = '';
  paramsToControls(PROFILES[$('profileSelect').value || defaultProfile]());
  live.clear(); $('timer').textContent = '00:00.0'; $('recWarn').textContent = '';
  // borrador previo
  store.getRecord(id).then(async (rec) => {
    if (rec && rec.original && !S.original) { const d = await decodeWavBlob(rec.original); S.originalWav = rec.original; loadOriginal(d.pcm, d.sampleRate, true); }
  });
}
async function closeStudio() {
  previewer.stop(); await recorder.close(); setRecUi('closed');
  S.statuses = await store.loadStatuses(); await refreshRemote(); renderList(); showView(S.returnView || 'catalog'); if (S.view === 'my') renderMy();
}

function setRecUi(state) {
  const open = state !== 'closed';
  $('micBtn').textContent = t(open ? 'rec.disable' : 'rec.enable');
  $('recBtn').disabled = state !== 'ready'; $('pauseBtn').disabled = !(state === 'recording' || state === 'paused');
  $('pauseBtn').textContent = t(state === 'paused' ? 'rec.resume' : 'rec.pause'); $('stopBtn').disabled = !(state === 'recording' || state === 'paused');
  $('deviceSelect').hidden = !open || lastDevices.length < 2;
}
async function toggleMic() {
  if (recorder.state !== 'closed') { await recorder.close(); setRecUi('closed'); $('recInfo').textContent = ''; return; }
  try {
    const info = await recorder.open({ deviceId: $('deviceSelect').value || undefined, noiseSuppression: $('nsCheck').checked, gain: val('gainRange') });
    recorder.setMonitor($('monitorCheck').checked);
    lastDevices = await listInputDevices();
    const sel = $('deviceSelect'), cur = info.track && info.track.deviceId;
    sel.innerHTML = `<option value="">${esc(t('rec.deviceDefault'))}</option>` + lastDevices.map((d, k) => `<option value="${esc(d.deviceId)}" ${d.deviceId === cur ? 'selected' : ''}>${esc(d.label || ('Mic ' + (k + 1)))}</option>`).join('');
    $('recInfo').textContent = t('rec.info', { rate: info.sampleRate, ch: (info.track && info.track.channelCount) || 1 }) + (info.track && info.track.label ? ' · ' + info.track.label : '');
    setRecUi('ready');
  } catch (e) { $('recWarn').textContent = t('rec.denied', { err: e.message || e.name }); setRecUi('closed'); }
}
function loadOriginal(pcm, sr, fromDraft) {
  S.original = { pcm, sr }; S.processed = null; S.mp3 = null;
  $('editBody').hidden = false; $('editEmpty').hidden = true;
  editor.setAudio(pcm.slice(), sr); updateEditInfo();
  $('mp3Btn').disabled = false; $('playProcBtn').disabled = true; $('procStats').textContent = '';
  $('recSaved').textContent = fromDraft ? '' : t('rec.saved');
}
function updateEditInfo() { $('editInfo').textContent = fmtTime(editor.duration) + ' · ' + editor.sr + ' Hz · mono' + (S.processed && S.processedSource !== editor.pcm ? ' · ' + t('proc.stale') : ''); }

async function stopRecording() {
  const r = await recorder.stop(); if (!r || !r.pcm.length) return;
  const wav = encodeWav(r.pcm, r.sampleRate); S.originalWav = wav;
  await store.putRecord({ id: S.item.id, original: wav, sampleRate: r.sampleRate, duration: r.duration, createdAt: Date.now() });
  loadOriginal(r.pcm, r.sampleRate, false);
  if (r.clipped) $('recWarn').textContent = t('rec.clip');
  S.statuses = await store.loadStatuses();
}

async function runProcessing() {
  if (!S.original) return null;
  const params = controlsToParams(); $('procBtn').disabled = true; $('mp3Btn').disabled = true;
  const src = editor.pcm;
  try {
    const r = await processAudio(src, editor.sr, params, (stage, p) => { $('procStatus').textContent = t('proc.running', { stage: t('proc.stage.' + stage) || stage }); });
    S.processed = r; S.processedSource = src; S.params = params; S.mp3 = null;
    const s = r.stats, f = (v) => (isFinite(v) ? v.toFixed(1) : '—');
    $('procStats').textContent = t('proc.stats', { lb: f(s.lufsBefore), tb: f(s.tpBefore), la: f(s.lufsAfter), ta: f(s.tpAfter) });
    let msg = ''; if (r.noise && !r.noise.ok) msg += t('proc.noRnnoise') + ' ';
    if (s.limiterReductionDb > 3) msg += t('proc.limiterWarn', { db: s.limiterReductionDb.toFixed(1) });
    $('procStatus').textContent = msg; $('playProcBtn').disabled = false;
    return r;
  } catch (e) { $('procStatus').textContent = String(e.message || e); return null; }
  finally { $('procBtn').disabled = false; $('mp3Btn').disabled = false; updateEditInfo(); }
}
async function makeMp3() {
  let r = S.processed && S.processedSource === editor.pcm ? S.processed : await runProcessing();
  if (!r) return;
  $('mp3Btn').disabled = true; $('mp3Status').textContent = t('exp.working');
  try {
    const out = await exportMp3(r.pcm, r.sampleRate, { kbps: parseInt($('kbps').value, 10), rate: parseInt($('mp3Rate').value, 10) }, (p) => { $('mp3Status').textContent = t('exp.working') + ' ' + Math.round(p * 100) + '%'; });
    S.mp3 = out; const url = URL.createObjectURL(out.blob), dur = r.pcm.length / r.sampleRate;
    $('mp3Player').src = url; $('mp3Player').hidden = false; $('downloadLink').href = url; $('downloadLink').download = S.item.id + '.mp3'; $('downloadLink').hidden = false; $('saveBtn').hidden = false; $('submitBtn').hidden = !S.user; $('inclRow').hidden = !S.user;
    $('mp3Status').textContent = t('exp.ready', { dur: dur.toFixed(1), kb: Math.round(out.blob.size / 1024), kbps: out.kbps });
  } catch (e) { $('mp3Status').textContent = String(e.message || e); }
  finally { $('mp3Btn').disabled = false; }
}
async function saveDone() {
  if (!S.mp3) return;
  const n = await store.saveDone(S.item, { original: S.originalWav, mp3: S.mp3.blob, params: S.params, stats: S.processed && S.processed.stats, duration: editor.duration, sampleRate: S.mp3.sampleRate });
  $('saveStatus').textContent = n ? t('exp.saved', { n }) : t('exp.savedNone');
  S.statuses = await store.loadStatuses();
}

async function submitForReview() {
  if (!S.mp3 || !S.user) return;
  $('submitBtn').disabled = true; $('submitStatus').className = 'muted';
  try {
    await saveDone();
    const r = await submitRecording({ userId: S.user.id, item: S.item, mp3Blob: S.mp3.blob, originalBlob: $('inclOriginal').checked ? S.originalWav : null, duration: editor.duration,
      onProgress: (step) => { $('submitStatus').textContent = t('exp.submitting', { step }); } });
    $('submitStatus').className = 'ok'; $('submitStatus').textContent = t('exp.submitted', { v: r.version });
    await refreshRemote();
  } catch (e) { $('submitStatus').className = 'warn'; $('submitStatus').textContent = t('exp.submitFail', { err: e.message || e }); }
  finally { $('submitBtn').disabled = false; }
}

// ------------------------------------------------------------------ arranque
function showCaps() {
  const c = S.caps, rows = ['secureContext', 'getUserMedia', 'audioWorklet', 'webAssembly', 'offlineAudio', 'noiseSuppression'];
  $('capsList').innerHTML = rows.map((k) => `<li>${esc(t('caps.' + k))}: <span class="${c[k] ? 'yes' : 'no'}">${esc(t(c[k] ? 'caps.ok' : 'caps.no'))}</span></li>`).join('');
  $('capsNote').textContent = c.secureContext ? '' : t('caps.insecure');
}
function bind() {
  $('tabs').onclick = (e) => { const b = e.target.closest('.tab'); if (b) { S.section = b.dataset.sec; S.shown = PAGE; renderList(); } };
  $('search').oninput = (e) => { S.query = e.target.value; S.shown = PAGE; renderList(); };
  $('statusFilter').onchange = (e) => { S.filter = e.target.value; S.shown = PAGE; renderList(); };
  $('moreBtn').onclick = () => { S.shown += PAGE; renderList(); };
  $('list').onclick = (e) => { const b = e.target.closest('button[data-act]'); if (!b) return; const id = b.closest('.card').dataset.id; b.dataset.act === 'record' ? openStudio(id) : playCard(id); };
  $('backBtn').onclick = closeStudio;
  $('themeBtn').onclick = () => { const d = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = d; try { localStorage.setItem('studio_theme', d); } catch (e) {} };
  $('capsBtn').onclick = () => { showCaps(); $('capsDialog').showModal(); }; $('capsClose').onclick = () => $('capsDialog').close();
  $('langSelect').onchange = (e) => setLang(e.target.value);
  document.addEventListener('langchange', () => { if (S.view === 'my') renderMy(); if (S.view === 'admin' && S.profile) renderAdmin($('adminView'), { t, profile: S.profile, catalog: S.catalog, adminState: S.adminState }); if (S.catalog) renderList(); showCaps(); setRecUi(recorder.state); updateEditInfo(); if (S.item && !$('studioView').hidden) $('studioGroup').textContent = lang() === 'ar' ? S.item.groupTitleAr : S.item.groupTitleEs; });

  $('micBtn').onclick = toggleMic;
  $('deviceSelect').onchange = async () => { if (recorder.state === 'ready') { await recorder.close(); await toggleMic(); } };
  $('gainRange').oninput = (e) => { recorder.setGain(parseFloat(e.target.value)); $('gainOut').textContent = parseFloat(e.target.value).toFixed(2) + '×'; };
  $('monitorCheck').onchange = (e) => { recorder.setMonitor(e.target.checked); $('monitorWarn').hidden = !e.target.checked; };
  $('recBtn').onclick = () => { live.clear(); $('recWarn').textContent = ''; recorder.start(); };
  $('pauseBtn').onclick = () => (recorder.state === 'paused' ? recorder.resume() : recorder.pause());
  $('stopBtn').onclick = stopRecording;
  recorder.addEventListener('state', (e) => setRecUi(e.detail.state));
  recorder.addEventListener('time', (e) => { $('timer').textContent = fmtTime(e.detail.seconds); });
  recorder.addEventListener('limit', () => { $('recWarn').textContent = t('rec.limit'); });
  recorder.addEventListener('level', (e) => {
    const d = e.detail, m = meter.update(d.peak, d.recording);
    if (d.recording) live.push(d.peak);
    if (d.recording || m.clipping) $('recWarn').textContent = m.clipping ? t('rec.clip') : m.tooHigh ? t('rec.high') : m.tooLow ? t('rec.low') : '';
  });

  const play = (pcm, sr, from) => { previewer.play(pcm, sr, from || 0); };
  $('playBtn').onclick = () => { if (previewer.playing) previewer.stop(); else { const sel = editor.selection; play(editor.pcm, editor.sr, sel ? sel.start / editor.sr : editor.playhead / editor.sr); if (sel) previewer.end = sel.end / editor.sr; } };
  $('stopPlayBtn').onclick = () => previewer.stop();
  previewer.addEventListener('tick', (e) => editor.setPlayhead(e.detail.seconds));
  $('volRange').oninput = (e) => previewer.setVolume(parseFloat(e.target.value));
  $('zoomInBtn').onclick = () => editor.zoom(0.5); $('zoomOutBtn').onclick = () => editor.zoom(2); $('fitBtn').onclick = () => editor.zoomFit();
  $('trimBtn').onclick = () => editor.trimToSelection(); $('deleteBtn').onclick = () => editor.deleteSelection(); $('silenceBtn').onclick = () => editor.silenceSelection();
  $('fadeInBtn').onclick = () => editor.fadeIn(0.05); $('fadeOutBtn').onclick = () => editor.fadeOut(0.08);
  $('undoBtn').onclick = () => editor.undo(); $('redoBtn').onclick = () => editor.redo();
  $('restoreBtn').onclick = () => { if (S.original) editor.resetTo(S.original.pcm); };
  $('discardBtn').onclick = async () => { if (!confirm(t('common.confirmDiscard'))) return; previewer.stop(); await store.removeRecord(S.item); S.original = null; S.processed = null; $('editBody').hidden = true; $('editEmpty').hidden = false; $('mp3Btn').disabled = true; S.statuses = await store.loadStatuses(); };
  editor.addEventListener('change', (e) => { $('undoBtn').disabled = !e.detail.canUndo; $('redoBtn').disabled = !e.detail.canRedo; const sel = e.detail.selection; ['trimBtn', 'deleteBtn', 'silenceBtn'].forEach((b) => { $(b).disabled = !sel; }); updateEditInfo(); });
  editor.addEventListener('seek', () => previewer.stop());

  $('profileSelect').onchange = (e) => paramsToControls(PROFILES[e.target.value]());
  $('procControls').addEventListener('input', refreshOutputs);
  $('procBtn').onclick = runProcessing;
  $('playEditedBtn').onclick = () => { previewer.stop(); play(editor.pcm, editor.sr, 0); };
  $('playProcBtn').onclick = () => { if (S.processed) { previewer.stop(); previewer.play(S.processed.pcm, S.processed.sampleRate, 0); } };
  $('mp3Btn').onclick = makeMp3; $('saveBtn').onclick = saveDone; $('submitBtn').onclick = submitForReview;

  $('loginForm').onsubmit = async (e) => {
    e.preventDefault(); $('loginError').textContent = '';
    try { const session = await signIn($('loginEmail').value.trim(), $('loginPass').value); $('loginPass').value = ''; await enterApp(session); }
    catch (err) { $('loginError').textContent = t('auth.error', { err: err.message || err }); }
  };
  $('forgotBtn').onclick = async () => { const em = $('loginEmail').value.trim(); if (!em) { $('loginEmail').focus(); return; } try { await resetPassword(em); } catch (e) {} $('loginError').className = 'ok'; $('loginError').textContent = t('auth.resetSent'); };
  $('logoutBtn').onclick = async () => { await signOut(); S.user = null; S.profile = null; S.remote = null; renderList(); showView('login'); };
  $('pwForm').onsubmit = async (e) => {
    e.preventDefault(); const v = $('newPass').value;
    if (v.length < 8) { $('pwMsg').className = 'warn'; $('pwMsg').textContent = t('auth.passShort'); return; }
    try { await setPassword(v); $('newPass').value = ''; $('pwDialog').close(); history.replaceState(null, '', location.pathname + location.search); } catch (err) { $('pwMsg').className = 'warn'; $('pwMsg').textContent = err.message; }
  };
  $('navCatalog').onclick = () => { renderList(); showView('catalog'); };
  $('navMy').onclick = async () => { await refreshRemote(); renderMy(); showView('my'); };
  $('navAdmin').onclick = () => { showView('admin'); renderAdmin($('adminView'), { t, profile: S.profile, catalog: S.catalog, adminState: S.adminState }).then(() => {}); };
  $('myList').onclick = async (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return; const card = b.closest('.card');
    if (b.dataset.act === 'again') { openStudio(card.dataset.content); return; }
    try { card.querySelector('.extra').innerHTML = `<audio controls autoplay src="${esc(await signedUrl(card.dataset.path))}"></audio>`; } catch (err) { card.querySelector('.extra').textContent = err.message; }
  };
}

async function main() {
  try { const th = localStorage.getItem('studio_theme'); if (th) document.documentElement.dataset.theme = th; else if (matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'dark'; } catch (e) {}
  $('langSelect').innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  const l = initialLang(); $('langSelect').value = l; await setLang(l);
  editor = new WaveformEditor($('editWave')); meter = new LevelMeter($('meter')); live = new LiveWaveform($('liveWave'));
  bind(); meter.draw(); live.draw();
  try { S.catalog = await loadCatalog(); S.statuses = await store.loadStatuses(); renderList(); }
  catch (e) { $('list').innerHTML = `<p class="warn">${esc(e.message)}</p>`; }
  if (isConfigured()) {
    $('submitSoon').hidden = true; S.needPw = /type=(invite|recovery)/.test(location.hash);
    let session = null; try { session = await getSession(); } catch (e) {}
    if (session) await enterApp(session); else showView('login');
    const c = await getClient(); if (c && c.auth && c.auth.onAuthStateChange) c.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && S.user) { S.user = null; showView('login'); } if (ev === 'PASSWORD_RECOVERY') { S.needPw = true; if (S.user) { S.needPw = false; $('pwDialog').showModal(); } } });
  } else { $('localBanner').hidden = false; showView('catalog'); }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('service-worker.js').catch(() => {});
  noiseReductionAvailable().then((ok) => { S.caps.rnnoise = ok; });
  window.__studio = { S, showView, enterApp, openStudio, submitForReview, recorder, editor, previewer, runProcessing, makeMp3, controlsToParams };   // útil para pruebas
}
main();
