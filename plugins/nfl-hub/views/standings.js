// views/standings.js — division standings plus the playoff picture.
import { chip, panel, stateMsg, esc, errorPane } from '../core/ui.js';
import { teamColor } from '../core/player-visuals.js';
import { cache, TTL } from '../core/cache.js';
import { urls, fetchStandings } from '../core/espn-client.js';
import { parseStandings } from '../core/espn-league.js';

const state = { loading: true, error: null, table: {}, seasonType: null };

const COLS = [
  ['W', 'wins'], ['L', 'losses'], ['T', 'ties'], ['PCT', 'pct'],
  ['DIV', 'divRecord'], ['CONF', 'confRecord'], ['PF', 'pointsFor'],
  ['PA', 'pointsAgainst'], ['DIFF', 'diff'], ['STRK', 'streak'],
];

/** Seeds 1-7, then everyone else split by record.
 *
 *  ESPN gives playoffSeed on every row. It publishes no clinch/eliminate flags here, so
 *  "in the hunt" is deliberately the next five by record rather than a mathematical
 *  claim the data cannot support. */
export function seedGroups(table, conf) {
  const rows = Object.entries(table ?? {})
    .filter(([div]) => div.startsWith(conf))
    .flatMap(([, list]) => list);
  if (!rows.length) return { seeded: [], hunt: [], out: [] };

  const withSeed = rows.filter((r) => r.seed !== null).sort((a, b) => a.seed - b.seed);
  const seeded = withSeed.slice(0, 7);
  const rest = [...withSeed.slice(7), ...rows.filter((r) => r.seed === null)]
    .sort((a, b) => (b.wins - a.wins) || (a.losses - b.losses));

  return { seeded, hunt: rest.slice(0, 5), out: rest.slice(5) };
}

/**
 * One division.
 *
 * ⚠️ THE RECORD IS ONE THING, NOT THREE. W, L and T stood as separate equal
 * columns beside seven more, so a reader scanning for "who is winning" weighed
 * `STRK` exactly as heavily as the record. They are now a single unit, and the
 * secondary stats are muted behind it.
 *
 * ⚠️ THE DIFFERENTIAL GETS A BAR, scaled to the largest ABSOLUTE gap in this
 * division so both directions are comparable — the same "the gap is the story"
 * rule already used by league-home's standings bar and the matchup score bar. A
 * bare column of numbers makes the reader do that comparison themselves.
 */
function divisionTable(division, rows) {
  const widest = Math.max(1, ...rows.map((r) => Math.abs(Number(r.diff) || 0)));
  const body = rows.map((r) => {
    const diff = Number(r.diff) || 0;
    const pct = Math.round((Math.abs(diff) / widest) * 100);
    return `<div class="st-row" style="--tc:${esc(teamColor(r.abbr))}">
      <span class="st-team">${chip(r, { clickable: true, showRecord: false })}</span>
      <span class="st-rec">${esc(r.wins ?? 0)}-${esc(r.losses ?? 0)}${Number(r.ties) ? `-${esc(r.ties)}` : ''}</span>
      <span class="st-pct">${esc(r.pct ?? '—')}</span>
      <span class="st-diff ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">
        <span class="st-diff-bar"><i style="width:${pct}%"></i></span>
        <b>${diff > 0 ? '+' : ''}${esc(diff)}</b>
      </span>
      <span class="st-sec" title="Division / Conference">${esc(r.divRecord ?? '—')} · ${esc(r.confRecord ?? '—')}</span>
      <span class="st-sec">${esc(r.pointsFor ?? '—')} / ${esc(r.pointsAgainst ?? '—')}</span>
      <span class="st-strk">${esc(r.streak ?? '—')}</span>
    </div>`;
  }).join('');

  return `<div class="st-div">
    <div class="mod-head"><span class="t">${esc(division)}</span>
      <span class="v">PF / PA</span></div>
    <div class="st-rows">${body}</div>
  </div>`;
}


function playoffColumn(conf, groups) {
  const row = (r, label) => (
    '<div class="sb-row">'
    + `<span class="sb-meta" style="width:34px;text-align:left;margin-left:0">${esc(label)}</span>`
    + chip(r, { clickable: true, showRecord: false })
    + `<span class="sb-meta">${esc(r.record ?? `${r.wins}-${r.losses}`)}</span>`
    + '</div>'
  );
  return '<div class="mod">'
    + `<div class="mod-head"><span class="t">${esc(conf)} playoff picture</span></div>`
    + '<div class="mod-body">'
      + '<div class="kicker" style="margin-bottom:6px">Seeded</div>'
      + groups.seeded.map((r, i) => row(r, `#${i + 1}`)).join('')
      + (groups.hunt.length
        ? '<div class="kicker" style="margin:12px 0 6px">In the hunt</div>'
          + groups.hunt.map((r) => row(r, '—')).join('')
        : '')
    + '</div></div>';
}


/**
 * Has anybody played yet?
 *
 * ⚠️ ESPN PUBLISHES playoffSeed IN PRESEASON, where it is division order rather
 * than a standing. Seeding a "playoff picture" from an all-0-0 table presents
 * that ordering as information and gives the reader no way to tell it from a
 * real one — which, from February to September, is what this tab opens on.
 * views/league-home.js already refuses to draw records before a week is scored;
 * this is the same rule for the NFL table.
 */
export function seasonStarted(table) {
  return Object.values(table ?? {})
    .flat()
    .some((r) => (Number(r?.wins) || 0) + (Number(r?.losses) || 0) + (Number(r?.ties) || 0) > 0);
}

/**
 * Is a playoff picture worth drawing at all?
 *
 * ⚠️ RECORDS ALONE ARE NOT ENOUGH, and assuming they were is how the first
 * version of this shipped broken. ESPN's preseason standings carry preseason
 * results — on 2026-08-11 the Hall of Fame game had been played, so Carolina sat
 * at 1-0 and "has anybody played?" answered yes. Preseason results have no
 * bearing on seeding whatsoever, so the picture stayed just as meaningless.
 *
 * The season TYPE is the real gate; the record check then covers the days
 * between the regular season opening and its first game finishing.
 */
export function playoffPictureWorthDrawing(table, seasonType) {
  if (seasonType === 'pre') return false;
  return seasonStarted(table);
}

export function renderStandings(s = state) {
  if (s.loading) return stateMsg('Loading standings…', { spinner: true });
  if (s.error) return errorPane(s.error, 'Could not load standings.');

  const divisions = Object.keys(s.table ?? {});
  if (!divisions.length) return stateMsg('Standings are not available yet.');

  // Before kickoff the seeds are noise; say what the tab is showing instead of
  // dressing division order up as a race.
  let html = playoffPictureWorthDrawing(s.table, s.seasonType)
    ? panel({
      title: 'Playoff picture',
      body: '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">'
        + playoffColumn('AFC', seedGroups(s.table, 'AFC'))
        + playoffColumn('NFC', seedGroups(s.table, 'NFC'))
        + '</div>',
    })
    : panel({
      title: 'Standings',
      body: `<p class="muted">${s.seasonType === 'pre'
        ? 'It is preseason, so there is no playoff picture yet — preseason results do not count '
          + 'towards seeding. The divisions below are the league as it stands.'
        : 'The season has not started, so there is no playoff picture yet — every team is 0-0. '
          + 'The divisions below are the league as it stands.'}</p>`,
    });
  // ⚠️ TWO COLUMNS, BY CONFERENCE. Eight stacked panels meant the NFC began
  // roughly two screens below the AFC, so the two halves of the league could
  // never be compared without scrolling between them.
  const col = (conf) => divisions.filter((d) => d.startsWith(conf)).sort()
    .map((d) => divisionTable(d, s.table[d])).join('');
  html += `<div class="st-conf">
    <div class="st-conf-col"><h3 class="st-conf-h">AFC</h3>${col('AFC')}</div>
    <div class="st-conf-col"><h3 class="st-conf-h">NFC</h3>${col('NFC')}</div>
  </div>`;
  return html;
}

export function render() { return renderStandings(state); }

export async function enter() {
  const { app } = await import('../core/app.js');
  app.onAction = (act, el) => {
    if (act === 'team') { app.teamAbbr = el.dataset.team; app.router.go('team'); }
  };
  // Standings change once a week; a revisit inside the TTL should not refetch.
  if (!state.loading && Object.keys(state.table).length) return;
  try {
    const season = app.season ?? new Date().getFullYear();
    const raw = await cache.get(urls.standings(season), () => fetchStandings(season),
      TTL.STANDINGS, { staleOnError: true });
    state.table = parseStandings(raw);
    state.seasonType = app.seasonType ?? null;
    state.error = null;
  } catch (err) {
    state.error = err?.message ?? 'failed';
  } finally {
    state.loading = false;
  }
  app.router.refresh();
}
