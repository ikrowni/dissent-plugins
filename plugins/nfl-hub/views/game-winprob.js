// views/game-winprob.js — win-probability graph as inline SVG.
//
// Inline rather than canvas: it is a single path over at most a few hundred points, it
// scales without a resize observer, and it needs no animation loop. A canvas here
// would mean owning a rAF, which the motion budget does not allow for a static chart.
import { esc, stateMsg } from '../core/ui.js';
import { fmtPct } from '../core/format.js';

const W = 600;
const H = 120;

/** Points string for the home win-probability line. y=0 is 100% home. */
export function wpPath(samples, w = W, h = H) {
  const list = samples ?? [];
  if (!list.length) return '';
  const step = list.length > 1 ? w / (list.length - 1) : 0;
  return list
    .map((s, i) => {
      // Clamped: a value outside 0-100 would draw off-canvas, and Number(null) is 0
      // rather than NaN so a missing sample sits on the baseline instead of breaking
      // the path.
      const pct = Math.max(0, Math.min(100, Number(s.homePct) || 0));
      return `${Math.round(i * step)},${Math.round(h - (pct / 100) * h)}`;
    })
    .join(' ');
}

export function renderWinProb(samples, teams, { scoringSeqs = [] } = {}) {
  const list = samples ?? [];
  const head = '<div class="mod"><div class="mod-head"><span class="t">Win probability</span>';

  if (!list.length) {
    return `${head}</div><div class="mod-body">`
      + `${stateMsg('Win probability is not available for this game.')}</div></div>`;
  }

  const last = list.at(-1);
  const homeAbbr = teams?.home?.abbr ?? 'Home';
  const awayAbbr = teams?.away?.abbr ?? 'Away';
  const homeCol = teams?.home?.primary ?? '#5b8dd9';
  const awayCol = teams?.away?.primary ?? '#e0596c';
  const step = list.length > 1 ? W / (list.length - 1) : 0;

  const marks = (scoringSeqs ?? [])
    .map((seq) => list.findIndex((s) => s.seq === seq))
    .filter((i) => i >= 0)
    .map((i) => {
      const pct = Math.max(0, Math.min(100, Number(list[i].homePct) || 0));
      return `<circle class="score-mark" cx="${Math.round(i * step)}"`
        + ` cy="${Math.round(H - (pct / 100) * H)}" r="3" fill="var(--gold)"/>`;
    })
    .join('');

  return `${head}<span class="v">${esc(list.length)} samples</span></div>`
    + '<div class="mod-body">'
    + '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-3)">'
      + `<span>${esc(homeAbbr)} ${esc(fmtPct(last.homePct))}</span>`
      + `<span>${esc(awayAbbr)} ${esc(fmtPct(last.awayPct))}</span>`
    + '</div>'
    + `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"`
      + ' style="width:100%;height:120px;display:block;margin-top:6px">'
      + `<line class="mid" x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}"`
        + ' stroke="rgba(255,255,255,.12)" stroke-width="1" stroke-dasharray="3 3"/>'
      + `<polyline points="${wpPath(list)}" fill="none" stroke="${esc(homeCol)}"`
        + ' stroke-width="2" stroke-linejoin="round"/>'
      + marks
    + '</svg>'
    + `<p class="sr-only">${esc(homeAbbr)} win probability is `
      + `${esc(fmtPct(last.homePct))} after ${esc(list.length)} samples.</p>`
    + '<div style="display:flex;justify-content:space-between;font-size:9.5px;'
      + 'color:var(--text-3);margin-top:4px">'
      + `<span style="color:${esc(homeCol)}">▲ ${esc(homeAbbr)}</span>`
      + `<span style="color:${esc(awayCol)}">▼ ${esc(awayAbbr)}</span>`
    + '</div>'
    + '</div></div>';
}
