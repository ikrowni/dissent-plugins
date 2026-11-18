// views/game-winprob.js — win-probability graph as inline SVG.
//
// Inline rather than canvas: it is a single path over at most a few hundred points, it
// scales without a resize observer, and it needs no animation loop. A canvas here
// would mean owning a rAF, which the motion budget does not allow for a static chart.
import { esc, stateMsg, legibleColor } from '../core/ui.js';
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

/**
 * The same line, closed down to the baseline so it can be filled.
 *
 * ⚠️ A 2px stroke on an empty box is a squiggle; the fill is what makes it read as
 * "how much of this game did the home side own". It is the area under the SAME
 * points — deriving it separately would let the two disagree by a rounding step
 * and draw a fill that does not meet its own line.
 */
export function wpArea(samples, w = W, h = H) {
  const pts = wpPath(samples, w, h);
  if (!pts) return '';
  const last = pts.slice(pts.lastIndexOf(' ') + 1);
  const lastX = last.split(',')[0];
  return `0,${h} ${pts} ${lastX},${h}`;
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
  // Lifted for legibility: several team primaries are near-black, and a 2px stroke in
  // #000000 on a #05070b background is invisible.
  const homeCol = legibleColor(teams?.home?.primary ?? '#5b8dd9');
  const awayCol = legibleColor(teams?.away?.primary ?? '#e0596c');
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
      + `<polyline class="wp-area" points="${wpArea(list)}" fill="${esc(homeCol)}"`
        + ' fill-opacity="0.16" stroke="none"/>'
      + `<line class="mid" x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}"`
        + ' stroke="rgba(255,255,255,.12)" stroke-width="1" stroke-dasharray="3 3"/>'
      // ⚠️ pathLength="1" NORMALISES THE LINE so booth.css can draw it in with a
      // dash of 1 whatever the real geometry. A hard-coded dash length only stays
      // solid while the path is shorter than it, and this path's length depends on
      // how volatile the game was — a close one would leave a permanent gap.
      + `<polyline class="wp-line" points="${wpPath(list)}" pathLength="1"`
        + ` fill="none" stroke="${esc(homeCol)}" stroke-width="2" stroke-linejoin="round"/>`
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
