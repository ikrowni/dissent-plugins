// core/builds.js — game build order and ascension bands, shared by the plugin and the stats service.

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

/** The ascension bands community stats are published in (spec §6.1). */
export const BANDS = ['0', '1-4', '5-9', '10+'];
export const bandOf = (a) => (a === 0 ? '0' : a <= 4 ? '1-4' : a <= 9 ? '5-9' : '10+');
