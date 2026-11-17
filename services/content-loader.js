// Carga el catálogo de textos (copia de solo lectura generada desde ZadALQulub).
export async function loadCatalog() {
  const res = await fetch(new URL('../data/catalog.json', import.meta.url));
  if (!res.ok) throw new Error('catalog.json ' + res.status);
  const cat = await res.json();
  const byId = new Map(); cat.items.forEach((i) => byId.set(i.id, i));
  return { sections: cat.sections, items: cat.items, byId };
}
