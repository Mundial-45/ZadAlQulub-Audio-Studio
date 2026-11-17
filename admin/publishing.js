// Publicación manual: copia el MP3 aprobado al bucket público "published".
//   <carpeta>/<content_id>_v<N>.mp3   copia inmutable de cada versión (historial)
//   <carpeta>/<content_id>.mp3        ruta estable de la versión vigente
import { FOLDERS, publicUrl } from '../services/supabase.js';

async function download(client, bucket, path) {
  const { data, error } = await client.storage.from(bucket).download(path); if (error) throw error; return data;
}
async function upload(client, path, blob, upsert) {
  const { error } = await client.storage.from('published').upload(path, blob, { contentType: 'audio/mpeg', upsert, cacheControl: '60' });
  if (error) throw error;
}
export async function listVersions(client, contentId) {
  const { data, error } = await client.from('published_audio').select('*').eq('content_id', contentId).order('version', { ascending: false });
  if (error) throw error; return data || [];
}

export async function publish(client, rec, adminId) {
  if (rec.status !== 'approved' && rec.status !== 'published') throw new Error('not-approved');
  const folder = FOLDERS[rec.category], versions = await listVersions(client, rec.content_id);
  const version = (versions[0] ? versions[0].version : 0) + 1;
  const archive = `${folder}/${rec.content_id}_v${version}.mp3`, current = `${folder}/${rec.content_id}.mp3`;
  const blob = await download(client, 'submissions', rec.file_path);
  await upload(client, archive, blob, false);
  await upload(client, current, blob, true);
  const prev = versions.find((v) => v.is_current);
  if (prev) { const r = await client.from('published_audio').update({ is_current: false }).eq('id', prev.id); if (r.error) throw r.error; }
  const ins = await client.from('published_audio').insert({ content_id: rec.content_id, recording_id: rec.id, version, file_path: archive, current_path: current, is_current: true, published_by: adminId }).select().single();
  if (ins.error) { if (prev) await client.from('published_audio').update({ is_current: true }).eq('id', prev.id); throw ins.error; }
  if (prev) await client.from('recordings').update({ status: 'approved' }).eq('id', prev.recording_id).eq('status', 'published');
  const st = await client.from('recordings').update({ status: 'published' }).eq('id', rec.id); if (st.error) throw st.error;
  return { version, url: publicUrl(current, version) };
}

// Vuelve a dejar como vigente una versión anterior del historial.
export async function restoreVersion(client, row) {
  const blob = await download(client, 'published', row.file_path);
  await upload(client, row.current_path, blob, true);
  const all = await listVersions(client, row.content_id), cur = all.find((v) => v.is_current);
  if (cur && cur.id !== row.id) { const r = await client.from('published_audio').update({ is_current: false }).eq('id', cur.id); if (r.error) throw r.error; }
  const r2 = await client.from('published_audio').update({ is_current: true }).eq('id', row.id); if (r2.error) throw r2.error;
  if (cur && cur.id !== row.id) await client.from('recordings').update({ status: 'approved' }).eq('id', cur.recording_id).eq('status', 'published');
  await client.from('recordings').update({ status: 'published' }).eq('id', row.recording_id);
  return { version: row.version, url: publicUrl(row.current_path, row.version) };
}
