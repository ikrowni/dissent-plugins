// views/team.js — the team page.
//
// Three fetches (roster, schedule, depth chart), each degrading independently: a dead
// depth-chart endpoint must not cost the roster, and if the roster itself fails the hero
// still renders from the local team table.
import { chip, panel, stateMsg, esc, errorPane} from '../core/ui.js';
import { cache, TTL } from '../core/cache.js';
import {
  urls, fetchTeamRoster, fetchTeamSchedule, fetchDepthChart,
} from '../core/espn-client.js';
import {
  parseTeamRoster, parseTeamRecord, parseDepthChart, parseTeamSchedule,
} from '../core/espn-team.js';
import { parseRosterInjuries } from '../core/espn-league.js';
import { teamByAbbr, logoPath } from '../core/config.js';
import { teamColor } from '../core/player-visuals.js';
import { imageUrl } from '../../plugin-sdk.js';

const state = {
  loading: true, error: null, abbr: null, team: null,
  roster: [], injuries: [], depth: [], schedule: [],
};

const GROUPS = {
  Offense: ['QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'OG', 'C', 'G', 'T', 'OL'],
  Defense: ['DE', 'DT', 'NT', 'LB', 'ILB', 'OLB', 'MLB', 'CB', 'S', 'SS', 'FS', 'DB', 'DL'],
  'Special teams': ['K', 'P', 'LS', 'PK'],
};

export function groupRoster(roster) {
  const out = { Offense: [], Defense: [], 'Special teams': [], Other: [] };
  for (const a of roster ?? []) {
    const bucket = Object.keys(GROUPS).find((g) => GROUPS[g].includes(a.position)) ?? 'Other';
    out[bucket].push(a);
  }
  for (const k of Object.keys(out)) {
    out[k].sort((x, y) => String(x.position).localeCompare(String(y.position))
      || String(x.name).localeCompare(String(y.name)));
  }
  return out;
}

/** Completed games only, in schedule order — a form strip of upcoming games says nothing. */
export function formStrip(schedule) {
  const played = (schedule ?? []).filter((g) => g.state === 'post' && g.result);
  if (!played.length) return '';
  const color = (r) => (r === 'W' ? 'var(--win)' : r === 'L' ? 'var(--loss)' : 'var(--text-2)');
  return `<div style="display:flex;gap:6px;flex-wrap:wrap">${played.map((g) => (
    '<div class="form-tile" style="text-align:center;padding:6px 8px;border-radius:6px;'
    + 'background:var(--ink-2);border:1px solid var(--line);min-width:56px">'
    + `<div style="font-family:var(--f-display);font-weight:800;color:${color(g.result)}">`
      + `${esc(g.result)}</div>`
    + `<div style="font-size:10px;color:var(--text-3)">${esc(g.isHome ? 'vs' : '@')} `
      + `${esc(g.opponentAbbr ?? '')}</div>`
    + `<div class="num" style="font-size:10px;color:var(--text-3)">${esc(g.myScore)}-`
      + `${esc(g.theirScore)}</div>`
    + '</div>'
  )).join('')}</div>`;
}

function playerRow(a) {
  const shot = a.headshot
    ? `<img src="${esc(imageUrl(a.headshot))}" alt="" loading="lazy"`
      + ' style="width:26px;height:26px;border-radius:50%;object-fit:cover;flex:0 0 auto">'
    : '';
  return `<button class="sb-row" data-act="player" data-player="${esc(a.id)}"`
    + ' style="width:100%;background:none;border:0;color:inherit;font:inherit;'
    + 'cursor:pointer;text-align:left">'
    + `<span class="sb-meta" style="width:26px;text-align:left;margin-left:0">`
      + `${esc(a.jersey ?? '')}</span>`
    + shot
    + `<span style="font-weight:600">${esc(a.name)}</span>`
    + `<span class="sb-meta">${esc(a.position ?? '')}</span>`
    + (a.injured ? '<span class="badge redzone">INJ</span>' : '')
    + '</button>';
}

export function renderTeam(s = state) {
  if (s.loading) return stateMsg('Loading team…', { spinner: true });
  if (s.error) return errorPane(s.error, 'Could not load this team.');
  if (!s.team) return stateMsg('Choose a team to see its page.');

  const t = s.team;
  const groups = groupRoster(s.roster);

  let html = '<div style="padding:10px 20px 0">'
    + '<button class="badge" data-act="nav" data-view="standings">← Standings</button></div>';

  // ⚠️ A TEAM PAGE IS THE ONE SURFACE WHERE A CLUB'S COLOUR IS THE SUBJECT, and
  // this was a grey panel with a logo in it — the club's own primary sat in `t`
  // and was spent on a 1px border. `teamColor()` lifts near-black primaries, so
  // the four clubs whose primary is effectively black still get a band.
  const meta = [t.record, t.standingSummary, t.conf ? `${t.conf} ${t.div}` : null]
    .filter(Boolean).map(esc).join(' · ');
  html += `<div class="tm-band" style="--tc:${esc(teamColor(t.abbr))}">`
    // ⚠️ The badge again, big and faint, BEHIND the name. Texture, never a second
    // signal — the same badge is already legible at full strength beside it.
    + `<img class="tm-wm" src="${esc(t.logo)}" alt="" aria-hidden="true" onerror="this.remove()">`
    + '<div class="tm-band-in">'
      + `<img class="tm-badge" src="${esc(t.logo)}" alt="" onerror="this.remove()">`
      + '<div>'
        + `<div class="tm-name">${esc(t.fullName)}</div>`
        + (meta ? `<div class="tm-meta">${meta}</div>` : '')
      + '</div>'
    + '</div></div>';

  const form = formStrip(s.schedule);
  if (form) html += panel({ title: 'Form', body: form });

  if (s.injuries?.length) {
    html += panel({
      title: 'Injury report',
      flush: true,
      body: '<table class="grid"><thead><tr><th>Player</th><th>Pos</th><th>Status</th>'
        + '<th>Detail</th></tr></thead><tbody>'
        + s.injuries.map((i) => (
          `<tr><td>${esc(i.name)}</td><td class="num">${esc(i.position ?? '')}</td>`
          + `<td class="num">${esc(i.status ?? '')}</td>`
          + `<td class="num">${esc(i.detail ?? '')}</td></tr>`
        )).join('')
        + '</tbody></table>',
    });
  }

  html += panel({
    title: 'Roster',
    right: `<span class="kicker">${s.roster.length} players</span>`,
    body: '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">'
      + Object.entries(groups).filter(([, list]) => list.length).map(([name, list]) => (
        `<div class="mod"><div class="mod-head"><span class="t">${esc(name)}</span>`
        + `<span class="v">${list.length}</span></div>`
        + `<div class="mod-body">${list.map(playerRow).join('')}</div></div>`
      )).join('')
      + '</div>',
  });

  if (s.depth?.length) {
    html += panel({
      title: 'Depth chart',
      body: '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">'
        + s.depth.map((f) => (
          `<div class="mod"><div class="mod-head"><span class="t">${esc(f.name)}</span></div>`
          + `<div class="mod-body">${f.positions.map((p) => (
            `<div style="margin-bottom:8px"><div class="kicker">${esc(p.abbr)}</div>`
            + p.athletes.map((a) => (
              `<div style="font-size:11px;color:var(--text-2)">${a.rank}. ${esc(a.name)}</div>`
            )).join('')
            + '</div>'
          )).join('')}</div></div>`
        )).join('')
        + '</div>',
    });
  }

  if (s.schedule?.length) {
    html += panel({
      title: 'Schedule',
      flush: true,
      body: '<table class="grid"><thead><tr><th>Wk</th><th>Opponent</th><th>Result</th>'
        + '<th>Score</th></tr></thead><tbody>'
        + s.schedule.map((g) => (
          `<tr><td>${esc(g.weekText ?? g.week ?? '')}</td>`
          + `<td>${esc(g.isHome ? 'vs' : '@')} ${g.opponentAbbr
            ? chip({ abbr: g.opponentAbbr, logo: g.opponentLogo },
              { clickable: true, showRecord: false })
            : ''}</td>`
          + `<td class="num">${esc(g.result ?? '—')}</td>`
          + `<td class="num">${g.myScore !== null
            ? `${esc(g.myScore)}-${esc(g.theirScore)}` : '—'}</td></tr>`
        )).join('')
        + '</tbody></table>',
    });
  }

  return html;
}

export function render() { return renderTeam(state); }

async function load(abbr, season) {
  const t = teamByAbbr(abbr);
  if (!t) { state.error = `unknown team ${abbr}`; state.loading = false; return; }
  state.abbr = t.abbr;

  const [rosterRaw, schedRaw, depthRaw] = await Promise.all([
    cache.get(urls.teamRoster(t.id), () => fetchTeamRoster(t.id), TTL.TEAM_ROSTER,
      { staleOnError: true }).catch(() => null),
    cache.get(urls.teamSchedule(t.id), () => fetchTeamSchedule(t.id), TTL.TEAM_ROSTER,
      { staleOnError: true }).catch(() => ({ events: [] })),
    cache.get(urls.depthChart(t.id, season), () => fetchDepthChart(t.id, season),
      TTL.DEPTH_CHART, { staleOnError: true }).catch(() => ({ items: [] })),
  ]);

  // If the roster fetch died the hero still renders, from the local team table.
  state.team = rosterRaw ? parseTeamRecord(rosterRaw) : {
    abbr: t.abbr, fullName: t.fullName, logo: logoPath(t.abbr),
    primary: t.primary, record: null, standingSummary: null, conf: t.conf, div: t.div,
  };
  state.roster = rosterRaw ? parseTeamRoster(rosterRaw) : [];
  state.injuries = rosterRaw ? parseRosterInjuries(rosterRaw) : [];
  state.depth = parseDepthChart(depthRaw, state.roster);
  state.schedule = parseTeamSchedule(schedRaw, t.abbr);
  state.error = null;
  state.loading = false;
}

export async function enter() {
  const { app } = await import('../core/app.js');
  app.onAction = (act, el) => {
    if (act === 'player') { app.athleteId = el.dataset.player; app.router.go('player'); }
    if (act === 'team' && el.dataset.team !== state.abbr) {
      app.teamAbbr = el.dataset.team;
      state.loading = true;
      app.router.refresh();
      enter();
    }
  };

  const abbr = app.teamAbbr;
  if (!abbr) { state.loading = false; state.team = null; app.router.refresh(); return; }
  if (state.abbr !== abbr) { state.loading = true; app.router.refresh(); }

  try {
    await load(abbr, app.season ?? new Date().getFullYear());
  } catch (err) {
    state.error = err?.message ?? 'failed';
    state.loading = false;
  }
  app.router.refresh();
}
