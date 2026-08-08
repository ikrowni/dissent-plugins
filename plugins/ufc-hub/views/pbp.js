// views/pbp.js — the play-by-play feed, shared by the expanded card and the
// timeline tab so the two cannot drift.
//
// ⚠️ These are TRACKED ACTIONS, not official UFC statistics. No source reachable from
// this project carries strike-level data.
import { esc } from '../core/ui.js';

const LABELS = {
  round_start: 'Round begins', round_end: 'Round ends',
  round_pause: 'Action paused', round_unpause: 'Action resumes',
  takedown: 'Takedown', takedown_attempt: 'Takedown attempt',
  knockdown: 'Knockdown', submission_attempt: 'Submission attempt',
  reversal: 'Reversal',
  pause_reason_low_blow: 'Low blow', pause_reason_eye_poke: 'Eye poke',
  walkout: 'Walkout', staredown: 'Staredown', tale_of_the_tape: 'Tale of the tape',
  fight_open: 'Bout opens', fight_over: 'Final bell', results: 'Result announced',
  fight_complete: 'Bout complete',
  unofficial_winner_decision: 'Unofficial winner · decision',
  unofficial_winner_kotko: 'Unofficial winner · KO/TKO',
  unofficial_winner_submission: 'Unofficial winner · submission',
};

export function actionLabel(type) {
  if (LABELS[type]) return LABELS[type];
  const s = String(type ?? '').replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Action';
}

/** Actions worth calling out in colour. */
const HIGHLIGHT = /^(knockdown|submission_attempt|unofficial_winner_)/;

/**
 * Bucket the feed by round.
 *
 * ⚠️ Round-less actions sit at BOTH ENDS: walkouts and the staredown before the first
 * bell, the result and the unofficial winner after the last. Bucketing on `round || 0`
 * drops the closing ones into "before the bell". Split on position in the payload's own
 * order instead.
 */
export function groupRounds(events, { newestFirst = false } = {}) {
  const list = events ?? [];
  if (!list.length) return [];

  const firstRound = list.findIndex((a) => a.round);
  const buckets = new Map([['pre', []], ['post', []]]);
  list.forEach((a, i) => {
    const key = a.round ? a.round : (firstRound === -1 || i < firstRound ? 'pre' : 'post');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(a);
  });

  const rank = (k) => (k === 'pre' ? -1 : k === 'post' ? Number.MAX_SAFE_INTEGER : k);
  let groups = [...buckets.entries()]
    .filter(([, v]) => v.length)
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([key, actions]) => ({
      key,
      label: key === 'pre' ? 'Before the bell'
        : key === 'post' ? 'After the final bell' : `Round ${key}`,
      actions,
    }));

  // During a fight the useful end of the feed is the end you just missed, so the live
  // view reverses the ROUND order while each round stays chronological.
  if (newestFirst) groups = groups.reverse();
  return groups;
}

export function renderPbp(events, names, opts = {}) {
  const groups = groupRounds(events, opts);
  if (!groups.length) return '';
  const corner = opts.corners ?? {};

  return groups.map((g) => (
    `<section class="pbp-round"><h4>${esc(g.label)}`
    + (opts.liveRound === g.key ? '<span class="pbp-live">Live</span>' : '')
    + '</h4><ul class="pbp-list">'
    + g.actions.map((a) => {
      const side = a.fighterId != null ? (corner[a.fighterId] ?? '') : '';
      const hot = HIGHLIGHT.test(String(a.type ?? '')) ? ' is-hot' : '';
      return `<li class="pbp-item${hot}${side ? ` pbp-${esc(side)}` : ''}">`
        + `<span class="pbp-clock num">${esc(a.clock ?? '')}</span>`
        + '<span class="pbp-dot"></span>'
        + `<span class="pbp-text"><b>${esc(actionLabel(a.type))}</b>`
        + (a.fighterId != null && names?.[a.fighterId]
          ? ` · ${esc(names[a.fighterId])}` : '')
        + '</span></li>';
    }).join('')
    + '</ul></section>'
  )).join('');
}
