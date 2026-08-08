// core/format.js — display formatting. Pure, no DOM.

/** CloudFront Record: { Wins, Losses, Draws, NoContests }. NC is omitted when zero. */
export function fmtRecord(r) {
  if (!r) return '';
  const base = `${r.wins ?? 0}-${r.losses ?? 0}-${r.draws ?? 0}`;
  return r.noContests ? `${base} (${r.noContests} NC)` : base;
}

/** CloudFront Height/Reach are inches as a number, e.g. 73.0 -> 6'1". */
export function fmtHeight(inches) {
  const n = Number(inches);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${Math.floor(n / 12)}'${Math.round(n % 12)}"`;
}

export function fmtReach(inches) {
  const n = Number(inches);
  return Number.isFinite(n) && n > 0 ? `${Math.round(n)}"` : '—';
}

/** FightingOutOf / Born: { City, State, Country, TriCode }. */
export function fmtPlace(p) {
  if (!p) return '';
  return [p.City, p.State, p.Country].filter(Boolean).join(', ');
}

/** An ISO timestamp as a local short date-time. */
export function fmtDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
