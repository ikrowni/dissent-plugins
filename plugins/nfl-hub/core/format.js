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

export function fmtMoneyline(ml) {
  if (ml === null || ml === undefined) return '—';
  const n = Number(ml);
  if (!Number.isFinite(n)) return '—';
  return n > 0 ? `+${n}` : String(n);
}
