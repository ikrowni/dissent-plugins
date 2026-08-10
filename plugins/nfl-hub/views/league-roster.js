// views/league-roster.js — set a lineup, and manage a roster.
//
// ⚠️ THE LINEUP IS POSITIONAL. Index i is the player in starting slot i, and an
// empty slot must stay in the array as null rather than being dropped —
// compacting it shifts every slot after the hole and silently starts the wrong
// players.

import { esc, panel, stateMsg } from '../core/ui.js';
import { setLineup, getLineup, dropPlayer, movePlayer } from '../core/league-api.js';
import { splitRosterPositions, slotAccepts } from '../core/league/slots.js';
import { describe } from './league-home.js';

const state = {
  leagueId: null,
  league: null,
  teamId: null,
  week: null,
  lineup: [],       // positional, may contain nulls
  loaded: false,
  error: null,
  busy: false,
  notice: null,
};

export function reset() {
  Object.assign(state, {
    leagueId: null, league: null, teamId: null, week: null,
    lineup: [], loaded: false, error: null, busy: false, notice: null,
  });
}

export function render() {
  if (state.error) {
    return panel({
      title: 'My Roster',
      body: `<p class="muted">${esc(state.error)}</p>
             <button class="btn" data-act="roster-retry">Try again</button>`,
    });
  }
  if (!state.loaded) return stateMsg('Loading your roster…', { spinner: true });
  if (!state.teamId) {
    return panel({ title: 'My Roster', body: '<p class="muted">You do not have a team in this league yet.</p>' });
  }

  const { starters } = splitRosterPositions(state.league?.settings?.rosterPositions);
  const roster = state.league?.assets?.rosters?.[state.teamId] ?? { players: [], ir: [], taxi: [] };
  const started = new Set(state.lineup.filter(Boolean).map(String));
  const bench = (roster.players ?? []).map(String).filter((id) => !started.has(id));

  return panel({
    title: 'My Roster',
    right: state.week ? `<span class="muted">Week ${state.week}</span>` : '',
    body: `
      ${state.notice ? `<p class="notice">${esc(state.notice)}</p>` : ''}
      <h4>Starters</h4>
      <table class="tbl lineup">
        <tbody>${starters.map((slot, i) => slotRow(slot, i, state.lineup[i], bench)).join('')}</tbody>
      </table>

      <h4>Bench</h4>
      ${bench.length === 0 ? '<p class="muted">Nobody on the bench.</p>' : `
        <table class="tbl">
          <tbody>${bench.map((id) => benchRow(id)).join('')}</tbody>
        </table>`}

      ${(roster.ir ?? []).length ? `<h4>Injured reserve</h4>
        <table class="tbl"><tbody>${roster.ir.map((id) => benchRow(id, 'ir')).join('')}</tbody></table>` : ''}

      <div class="row-actions">
        <button class="btn primary" data-act="roster-save" ${state.busy ? 'disabled' : ''}>
          ${state.busy ? 'Saving…' : 'Save lineup'}
        </button>
        <button class="btn" data-act="roster-refresh">Refresh</button>
      </div>`,
  });
}

/**
 * One starting slot, with a picker of the players eligible for it.
 *
 * ⚠️ The eligible list is a CONVENIENCE, not a rule. The module validates against
 * its own trusted position index, so a disagreement here shows up as a refused
 * save rather than an illegal lineup.
 */
function slotRow(slot, index, current, bench) {
  const options = ['<option value="">— empty —</option>'];
  const candidates = [...bench, ...(current ? [String(current)] : [])];
  for (const id of [...new Set(candidates)]) {
    const pos = positionOf(id);
    if (pos && !slotAccepts(slot, pos)) continue;
    const sel = String(current ?? '') === String(id) ? ' selected' : '';
    options.push(`<option value="${esc(id)}"${sel}>${esc(playerLabel(id))}</option>`);
  }
  return `<tr>
    <td class="slot">${esc(slot)}</td>
    <td><select data-act="roster-slot" data-index="${index}">${options.join('')}</select></td>
  </tr>`;
}

function benchRow(id, where = 'bench') {
  return `<tr>
    <td>${esc(playerLabel(id))}</td>
    <td class="num">
      ${where === 'bench'
    ? `<button class="btn tiny" data-act="roster-ir" data-player="${esc(id)}">IR</button>`
    : `<button class="btn tiny" data-act="roster-activate" data-player="${esc(id)}">Activate</button>`}
      <button class="btn tiny danger" data-act="roster-drop" data-player="${esc(id)}">Drop</button>
    </td>
  </tr>`;
}

// ── Player naming ────────────────────────────────────────────────────────────
//
// ⚠️ Resolved CLIENT-SIDE from the same static index the module uses. The module
// deliberately returns ids and nothing else: names are presentation, and sending
// them per request would put a 300 KB index behind every league call.

let index = null;
export function useIndex(map) { index = map; }

function playerLabel(id) {
  const rec = index?.[String(id)];
  if (!rec) return `#${id}`;
  const team = rec.t ? ` · ${rec.t}` : '';
  return `${rec.n} (${rec.p ?? '—'}${team})`;
}

function positionOf(id) {
  return index?.[String(id)]?.p ?? null;
}

// ── Actions ──────────────────────────────────────────────────────────────────

export async function load(app, { leagueId, league, teamId, week }) {
  Object.assign(state, { leagueId, league, teamId, week, loaded: false, error: null, notice: null });
  app?.router?.refresh();
  try {
    if (!index) {
      const res = await fetch(new URL('../assets/players.index.json', import.meta.url));
      if (res.ok) index = await res.json();
    }
    const { starters } = splitRosterPositions(league?.settings?.rosterPositions);
    if (teamId && week) {
      const stored = await getLineup(leagueId, teamId, week).catch(() => null);
      const saved = stored?.lineup ?? [];
      // Normalise to exactly one entry per slot, preserving holes.
      state.lineup = starters.map((_, i) => (saved[i] ? String(saved[i]) : null));
    } else {
      state.lineup = starters.map(() => null);
    }
  } catch (err) {
    state.error = describe(err);
  } finally {
    state.loaded = true;
    app?.router?.refresh();
  }
}

/** A slot changed. Kept in state rather than saved, so one save is one request. */
export function setSlot(index_, playerId) {
  const i = Number(index_);
  if (!Number.isInteger(i) || i < 0 || i >= state.lineup.length) return;
  const id = playerId ? String(playerId) : null;
  // Starting someone already in another slot moves them, rather than cloning.
  if (id) {
    const existing = state.lineup.indexOf(id);
    if (existing !== -1 && existing !== i) state.lineup[existing] = null;
  }
  state.lineup[i] = id;
}

export async function save(app) {
  state.busy = true;
  state.notice = null;
  state.error = null;
  app?.router?.refresh();
  try {
    await setLineup(state.leagueId, state.teamId, state.week, state.lineup);
    state.notice = 'Lineup saved.';
  } catch (err) {
    // A refusal here is usually a real rule — an ineligible slot, a player no
    // longer on the roster — so it is shown verbatim rather than summarised.
    state.error = describe(err);
  } finally {
    state.busy = false;
    app?.router?.refresh();
  }
}

export async function drop(app, playerId) {
  await act(app, () => dropPlayer(state.leagueId, state.teamId, playerId), 'Player dropped.');
}

export async function toIR(app, playerId) {
  await act(app, () => movePlayer(state.leagueId, state.teamId, playerId, 'ir'), 'Moved to IR.');
}

export async function activate(app, playerId) {
  await act(app, () => movePlayer(state.leagueId, state.teamId, playerId, 'players'), 'Activated.');
}

async function act(app, fn, notice) {
  state.busy = true;
  state.error = null;
  app?.router?.refresh();
  try {
    await fn();
    state.notice = notice;
  } catch (err) {
    state.error = describe(err);
  } finally {
    state.busy = false;
    app?.router?.refresh();
  }
}

export { state as _state };
