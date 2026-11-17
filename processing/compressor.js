// Compresor suave (ratio máx. 4:1) para no aplastar la dinámica natural de la recitación.
export function buildCompressor(ctx, comp) {
  if (!comp || !comp.enabled) return [];
  const c = ctx.createDynamicsCompressor();
  c.threshold.value = Math.max(-60, Math.min(0, comp.threshold));
  c.knee.value = comp.knee; c.ratio.value = Math.max(1, Math.min(4, comp.ratio));
  c.attack.value = comp.attack; c.release.value = comp.release;
  const nodes = [c];
  if (comp.makeup) { const g = ctx.createGain(); g.gain.value = Math.pow(10, comp.makeup / 20); nodes.push(g); }
  return nodes;
}
