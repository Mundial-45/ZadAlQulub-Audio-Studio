// Almacén local (IndexedDB): originales WAV, MP3 procesados y marcas de "hecho".
// Cuando exista Supabase (etapa 3), este módulo seguirá sirviendo como borrador sin conexión.
const DB = 'zad-audio-studio', V = 1;
function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, V);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('records', { keyPath: 'id' }); d.createObjectStore('marks', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const tx = async (store, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const out = fn(t.objectStore(store)); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }); };

export const getRecord = (id) => tx('records', 'readonly', (s) => s.get(id));
export const putRecord = (rec) => tx('records', 'readwrite', (s) => s.put({ ...rec, updatedAt: Date.now() }));
export const deleteRecord = (id) => tx('records', 'readwrite', (s) => s.delete(id));
export const allRecords = () => tx('records', 'readonly', (s) => s.getAll());
export const allMarks = () => tx('marks', 'readonly', (s) => s.getAll());
export const putMark = (m) => tx('marks', 'readwrite', (s) => s.put({ ...m, updatedAt: Date.now() }));
export const deleteMark = (id) => tx('marks', 'readwrite', (s) => s.delete(id));

// Estado de todos los items: { id: {state:'recorded'|'done', via?:id} }
export async function loadStatuses() {
  const st = {};
  for (const r of await allRecords()) st[r.id] = { state: r.mp3 ? 'done' : 'recorded' };
  for (const m of await allMarks()) if (!st[m.id] || st[m.id].state !== 'done') st[m.id] = { state: 'done', via: m.via };
  return st;
}

// Guarda el MP3 de un item y marca como hechos los que comparten texto (sin pisar los que tienen MP3 propio).
export async function saveDone(item, record) {
  await putRecord({ ...record, id: item.id });
  const own = new Set((await allRecords()).filter((r) => r.mp3).map((r) => r.id));
  let n = 0;
  for (const other of item.sameTextAs || []) { if (!own.has(other)) { await putMark({ id: other, via: item.id }); n++; } }
  return n;
}
export async function removeRecord(item) {
  await deleteRecord(item.id);
  for (const m of await allMarks()) if (m.via === item.id) await deleteMark(m.id);
}
