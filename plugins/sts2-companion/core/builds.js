// core/builds.js — game build order, shared by the plugin and the stats service.

/** Numeric version order, ignoring a leading "v": v1.10.0 is after 1.3.0. */
export function compareBuilds(a, b) {
  const parts = (x) => String(x).replace(/^v/, '').split('.').map((n) => Number(n) || 0);
  const pa = parts(a); const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
