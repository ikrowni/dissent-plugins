// views/standings.js — division standings plus the playoff picture.
import { chip, panel, stateMsg, esc } from '../core/ui.js';
import { cache, TTL } from '../core/cache.js';
import { urls, fetchStandings } from '../core/espn-client.js';
import { parseStandings } from '../core/espn-league.js';

const state = { loading: true, error: null, table: {} };

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

function divisionTable(division, rows) {
  const body = rows.map((r) => (
    `<tr><td>${chip(r, { clickable: true, showRecord: false })}</td>`
    + COLS.map(([, k]) => `<td class="num">${esc(r[k] ?? '—')}</td>`).join('')
    + '</tr>'
  )).join('');
  return panel({
    title: division,
    flush: true,
    body: '<table class="grid"><thead><tr><th>Team</th>'
      + COLS.map(([label]) => `<th>${esc(label)}</th>`).join('')
      + `</tr></thead><tbody>${body}</tbody></table>`,
  });
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

export function renderStandings(s = state) {
  if (s.loading) return stateMsg('Loading standings…', { spinner: true });
  if (s.error) return stateMsg('Could not load standings.', { retry: true });

  const divisions = Object.keys(s.table ?? {});
  if (!divisions.length) return stateMsg('Standings are not available yet.');

  let html = panel({
    title: 'Playoff picture',
    body: '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">'
      + playoffColumn('AFC', seedGroups(s.table, 'AFC'))
      + playoffColumn('NFC', seedGroups(s.table, 'NFC'))
      + '</div>',
  });
  for (const d of divisions.sort()) html += divisionTable(d, s.table[d]);
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
    state.error = null;
  } catch (err) {
    state.error = err?.message ?? 'failed';
  } finally {
    state.loading = false;
  }
  app.router.refresh();
}
