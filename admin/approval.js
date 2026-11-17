// Revisión: aprobar o rechazar (con motivo obligatorio). El servidor registra revisor y fecha.
export async function approve(client, id) {
  const { error } = await client.from('recordings').update({ status: 'approved', rejection_reason: null }).eq('id', id);
  if (error) throw error;
}
export async function reject(client, id, reason) {
  if (!reason || !reason.trim()) throw new Error('reason');
  const { error } = await client.from('recordings').update({ status: 'rejected', rejection_reason: reason.trim() }).eq('id', id);
  if (error) throw error;
}
