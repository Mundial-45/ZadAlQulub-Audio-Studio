// Cliente de Supabase: autenticación, perfil y utilidades. Sin claves privadas.
import { CONFIG } from '../config.js';

export const FOLDERS = { azkar: 'adhkar', adya: 'adiya', ruqyah: 'ruqya', munajat: 'munajat' };
export const isConfigured = () => !!(window.__SUPABASE_FAKE || (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY));

let client = null;
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar ' + src)); document.head.appendChild(s); });
}
export async function getClient() {
  if (window.__SUPABASE_FAKE) return window.__SUPABASE_FAKE;
  if (!isConfigured()) return null;
  if (client) return client;
  if (!window.supabase) await loadScript(new URL('../vendor/supabase.js', import.meta.url).href);
  client = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}
export const publicUrl = (path, version) => CONFIG.SUPABASE_URL.replace(/\/$/, '') + '/storage/v1/object/public/published/' + path + (version ? '?v=' + version : '');

export async function signIn(email, password) {
  const c = await getClient(); const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error; return data.session;
}
export async function signOut() { const c = await getClient(); if (c) await c.auth.signOut(); }
export async function getSession() { const c = await getClient(); if (!c) return null; const { data } = await c.auth.getSession(); return data.session; }
export async function resetPassword(email) { const c = await getClient(); const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] }); if (error) throw error; }
export async function getProfile(userId) {
  const c = await getClient(); const { data, error } = await c.from('profiles').select('*').eq('id', userId).single();
  if (error) throw error; return data;
}
export async function updateDisplayName(userId, name) { const c = await getClient(); const { error } = await c.from('profiles').update({ display_name: name }).eq('id', userId); if (error) throw error; }

// Estados remotos: mis grabaciones y lo ya publicado (visible para todos).
export async function loadRemoteState(userId) {
  const c = await getClient();
  const [mine, pub] = await Promise.all([
    c.from('recordings').select('id, content_id, version, status, rejection_reason, submitted_at, duration_seconds, file_path').eq('user_id', userId).order('version', { ascending: false }),
    c.from('published_audio').select('content_id, version, current_path').eq('is_current', true)
  ]);
  if (mine.error) throw mine.error; if (pub.error) throw pub.error;
  const latest = new Map(); (mine.data || []).forEach((r) => { if (!latest.has(r.content_id)) latest.set(r.content_id, r); });
  const published = new Map(); (pub.data || []).forEach((p) => published.set(p.content_id, p));
  return { mine: mine.data || [], latest, published };
}
export async function signedUrl(path, bucket = 'submissions', seconds = 3600) {
  const c = await getClient(); const { data, error } = await c.storage.from(bucket).createSignedUrl(path, seconds);
  if (error) throw error; return data.signedUrl;
}
export async function setPassword(password) { const c = await getClient(); const { error } = await c.auth.updateUser({ password }); if (error) throw error; }
