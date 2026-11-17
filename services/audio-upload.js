// Envío de una grabación para revisión: sube el MP3 (y opcionalmente el WAV original) al bucket privado
// y crea la fila en "recordings" con estado "pending" (el servidor fija estado, versión y categoría).
import { getClient, FOLDERS } from './supabase.js';

export async function submitRecording({ userId, item, mp3Blob, originalBlob, duration, onProgress = () => {} }) {
  const c = await getClient(); if (!c) throw new Error('Supabase no está configurado');
  const base = `${FOLDERS[item.section]}/${item.id}/${userId}/${Date.now()}`;
  const mp3Path = base + '.mp3';
  onProgress('mp3');
  let r = await c.storage.from('submissions').upload(mp3Path, mp3Blob, { contentType: 'audio/mpeg', upsert: false });
  if (r.error) throw r.error;
  let originalPath = null;
  if (originalBlob) {
    originalPath = base + '_original.wav'; onProgress('original');
    r = await c.storage.from('submissions').upload(originalPath, originalBlob, { contentType: 'audio/wav', upsert: false });
    if (r.error) { await c.storage.from('submissions').remove([mp3Path]); throw r.error; }
  }
  onProgress('db');
  const ins = await c.from('recordings').insert({
    content_id: item.id, category: item.section, user_id: userId, file_path: mp3Path, original_path: originalPath,
    mime_type: 'audio/mpeg', duration_seconds: Math.round(duration * 100) / 100, size_bytes: mp3Blob.size
  }).select('id, version, status').single();
  if (ins.error) { await c.storage.from('submissions').remove([mp3Path, originalPath].filter(Boolean)); throw ins.error; }
  return ins.data;
}
