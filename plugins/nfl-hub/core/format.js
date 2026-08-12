// core/format.js — display formatters. Pure, no DOM.

export function fmtClock(period, clock) {
  if (!period) return '';
  const label = period > 4 ? 'OT' : `Q${period}`;
  return clock ? `${label} · ${clock}` : label;
}

const ORD = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };

export function ordinalDown(down, distance) {
  if (!down) return '';
  const d = ORD[down] ?? `${down}th`;
  if (distance === null || distance === undefined) return d;
  return `${d} & ${distance}`;
}

/** Spread as bettors read it: negative for the favourite, PK at zero. */
export function fmtSpread(spread) {
  if (spread === null || spread === undefined) return '—';
  const n = Number(spread);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return 'PK';
  return n > 0 ? `+${n}` : String(n);
}

export function fmtPct(pct) {
  if (pct === null || pct === undefined) return '—';
  const n = Number(pct);
  if (!Number.isFinite(n)) return '—';
  return `${Math.round(n)}%`;
}

export function fmtRecord(record) {
  return record ? String(record) : '';
}

/**
 * How long ago, in the shortest form that is still unambiguous.
 *
 * ⚠️ A NEWS FEED WITHOUT TIMES IS NOT A FEED. `parseNews` has always carried
 * `published` and the view discarded it, so twenty-five headlines rendered with
 * nothing to say whether the top one broke ten minutes or ten days ago — and in
 * August most of them are the same syndicated "training camp: latest intel"
 * template, which makes recency the ONLY thing distinguishing them.
 *
 * ⚠️ A FUTURE TIMESTAMP READS AS "just now", NOT "-3m ago". Clock skew between a
 * viewer and ESPN's publisher is normal and small; rendering negative time makes
 * the whole column look broken over a few seconds of drift.
 */
export function fmtAgo(iso, now = Date.now()) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const secs = Math.floor((now - t) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function fmtMoneyline(ml) {
  if (ml === null || ml === undefined) return '—';
  const n = Number(ml);
  if (!Number.isFinite(n)) return '—';
  return n > 0 ? `+${n}` : String(n);
}
