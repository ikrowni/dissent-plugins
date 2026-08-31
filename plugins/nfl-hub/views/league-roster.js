// views/league-roster.js — set a lineup, and manage a roster.
//
// ⚠️ THE LINEUP IS POSITIONAL. Index i is the player in starting slot i, and an
// empty slot must stay in the array as null rather than being dropped —
// compacting it shifts every slot after the hole and silently starts the wrong
// players.

import { esc, panel, stateMsg, noLeaguePane} from '../core/ui.js';
import { playerChip, positionColor } from '../core/player-visuals.js';
import { getIndex } from '../core/player-index.js';
import {
  setLineup, getLineup, setAutoSubs, getAutoSubs, dropPlayer, movePlayer,
} from '../core/league-api.js';
import {
  splitRosterPositions, slotAccepts, irEligible, eligiblePositions,
} from '../core/league/slots.js';
import { describe } from './league-home.js';
import { loadRanking } from '../core/draft-ranking.js';
import { loadWeekProjections } from '../core/weekly-projections.js';
import { byeProjCells, byeProjHead } from '../core/lineup-cells.js';

const state = {
  leagueId: null,
  league: null,
  teamId: null,
  week: null,
  lineup: [],       // positional, may contain nulls
  subs: {},         // { [starterPlayerId]: subPlayerId }
  loaded: false,
  error: null,
  busy: false,
  notice: null,
};

export function reset() {
  Object.assign(state, {
    leagueId: null, league: null, teamId: null, week: null,
    lineup: [], subs: {}, loaded: false, error: null, busy: false, notice: null,
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
  // ⚠️ BEFORE any claim about YOUR TEAM. Without a league nothing has answered,
  // and "you do not have a team" is a confident falsehood — see noLeaguePane.
  if (!state.leagueId) return noLeaguePane('My Roster');
  if (!state.teamId) {
    return panel({ title: 'My Roster', body: '<p class="muted">You do not have a team in this league yet.</p>' });
  }

  const { starters, ir: irSlots } = splitRosterPositions(state.league?.settings?.rosterPositions);
  const roster = state.league?.assets?.rosters?.[state.teamId] ?? { players: [], ir: [], taxi: [] };
  const started = new Set(state.lineup.filter(Boolean).map(String));
  const bench = (roster.players ?? []).map(String).filter((id) => !started.has(id));

  return panel({
    title: 'My Roster',
    right: state.week ? `<span class="muted">Week ${state.week}</span>` : '',
    body: `
      ${state.notice ? `<p class="notice">${esc(state.notice)}</p>` : ''}
      <div class="ros-cols">
        <section class="ros-col">
          <h4>Starters</h4>
          <table class="tbl lineup">
            <thead><tr><th></th><th></th>${byeProjHead()}</tr></thead>
            <tbody>${starters.map((slot, i) => slotRow(slot, i, state.lineup[i], bench)).join('')}</tbody>
          </table>
        </section>
        <section class="ros-col">
          <h4>Bench <span class="muted">${bench.length}</span></h4>
          ${bench.length === 0 ? '<p class="muted">Nobody on the bench.</p>' : `
            <table class="tbl">
              <thead><tr><th>Player</th>${byeProjHead()}<th class="num"></th></tr></thead>
              <tbody>${bench.map((id) => benchRow(id)).join('')}</tbody>
            </table>`}
          ${irSection(roster, irSlots)}
        </section>
      </div>

      <div class="row-actions">
        <button class="btn primary" data-act="roster-save" ${state.busy ? 'disabled' : ''}>
          ${state.busy ? 'Saving…' : 'Save lineup'}
        </button>
        <button class="btn" data-act="roster-refresh">Refresh</button>
      </div>`,
  });
}

/**
 * Injured reserve — the slots, not just the occupants.
 *
 * ⚠️ THE EMPTY SLOTS ARE THE POINT. This used to render nothing at all until
 * somebody was already on IR, so a manager could not see that the league HAD an
 * IR slot, let alone that one was free. An empty roster spot you cannot see is
 * an empty roster spot you never use.
 *
 * ⚠️ There is no picker here on purpose. A player reaches IR from the bench, and
 * only if he carries a reserve designation — see `irWatchlist`.
 */
function irSection(roster, irSlots) {
  if (!irSlots) return '';
  const held = (roster.ir ?? []).map(String);
  const empty = Math.max(0, irSlots - held.length);

  const rows = [
    ...held.map((id) => benchRow(id, 'ir')),
    ...Array.from({ length: empty }, () => `<tr class="ir-empty">
      <td><span class="db-slot-empty">Empty IR slot</span></td>
      <td class="num"></td>
    </tr>`),
  ].join('');

  return `<h4>Injured reserve <span class="muted">${held.length} / ${irSlots}</span></h4>
    <table class="tbl"><thead><tr><th>Player</th>${byeProjHead()}<th class="num"></th></tr></thead><tbody>${rows}</tbody></table>
    ${watchlistNote(roster)}`;
}

/**
 * Who on this roster could actually go on IR.
 *
 * ⚠️ THE LIST EXISTS SO THE RULE IS NOT A MYSTERY. The IR button is hidden for
 * everybody else, and a hidden button with no explanation reads as a broken
 * screen — the manager cannot tell whether the feature is missing or the player
 * is ineligible.
 */
function watchlistNote(roster) {
  const eligible = (roster.players ?? []).map(String).filter((id) => irEligible(injuryOf(id)));
  if (eligible.length === 0) {
    return `<p class="tiny">Nobody on your roster is IR-eligible. A player has to carry a
      season-length reserve designation — ${esc(IR_LABEL)} — before he can be placed here.
      Out and Doubtful are week-to-week and do not qualify.</p>`;
  }
  return `<p class="tiny">IR watchlist: ${eligible
    .map((id) => `${esc(playerLabel(id))} <b>${esc(injuryOf(id))}</b>`)
    .join(', ')}. Move one across with the IR button on the bench.</p>`;
}

const IR_LABEL = 'IR, PUP, NFI, NA, COV, DNR or suspended';

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
  // ⚠️ The chosen player is shown BESIDE the select, not only inside it. A
  // <select> cannot carry a portrait or a position colour, and a lineup that is
  // twelve identical dropdowns is the least readable form this screen can take.
  const chosen = current ? (getIndex()?.[String(current)] ?? null) : null;
  return `<tr>
    <td class="slot" style="color:${esc(positionColor(eligiblePositions(slot).length > 1 ? 'RB' : slot))}">${esc(slot)}</td>
    <td class="lineup-pick">
      ${chosen ? playerChip(chosen, { size: 30, compact: true }) : '<span class="db-slot-empty">Empty</span>'}
      <select data-act="roster-slot" data-index="${index}">${options.join('')}</select>
      ${autoSubCell(slot, index, current, bench)}
    </td>
  </tr>`;
}

/**
 * The AutoSub designation for one starting slot.
 *
 * ⚠️ ELIGIBILITY IS AGAINST THE SLOT, not the starter's position — a flex
 * starter may be backed by anything the flex accepts. Mirrors `subEligible`
 * in core/league/autosubs.js; the module validates for real, so a disagreement
 * here surfaces as a refused save rather than an illegal designation.
 *
 * ⚠️ Renders NOTHING when the league has AutoSubs off. A control for a setting
 * that does nothing is worse than no control.
 */
// ⚠️ THE SLOT INDEX PARAMETER IS NOT CALLED `index`. The module-level player map
// is called `index`, and naming the parameter the same thing shadows it — the
// name lookup then indexes a NUMBER and every designation renders as a raw
// player id. That shipped for exactly as long as it took a test to run.
function autoSubCell(slot, slotIndex, current, bench) {
  const maxSubs = Number(state.league?.settings?.autoSubsPerWeek ?? 0);
  if (!Number.isInteger(maxSubs) || maxSubs <= 0) return '';
  if (!current) return '';

  const starting = new Set((state.lineup ?? []).filter(Boolean).map(String));
  const chosenSub = state.subs?.[String(current)] ?? '';

  const options = ['<option value="">— no AutoSub —</option>'];
  for (const id of [...new Set(bench.map(String))]) {
    if (starting.has(id)) continue;                       // already playing
    const pos = positionOf(id);
    if (pos && !slotAccepts(slot, pos)) continue;         // slot eligibility
    const sel = String(chosenSub) === id ? ' selected' : '';
    options.push(`<option value="${esc(id)}"${sel}>${esc(playerLabel(id))}</option>`);
  }

  // ⚠️ THE LOCAL INDEX, not getIndex(). This file resolves names through the map
  // injected by `useIndex`, and mixing the two sources gives a row that renders
  // a raw player id in exactly the environments where the injected map is the
  // only one populated.
  const subName = chosenSub ? (index?.[String(chosenSub)]?.n ?? `#${chosenSub}`) : null;
  return `<div class="autosub">
    <select data-act="roster-autosub" data-sub-index="${slotIndex}" data-starter="${esc(String(current))}">${options.join('')}</select>
    ${subName ? `<span class="autosub-note">Sub ${esc(subName)}, if out</span>` : ''}
  </div>`;
}

/**
 * One held player, on the bench or on IR.
 *
 * ⚠️ THE IR BUTTON IS GATED ON THE DESIGNATION, NOT JUST HIDDEN WHEN FULL. IR is
 * a roster spot that does not count against the roster limit, so letting a
 * healthy player sit there is a free extra bench spot for whoever thinks to try
 * it. The module refuses it too — this only stops the manager from finding out
 * the hard way.
 */
/** The bye and projection cells for a roster row. */
function projCells(id) {
  return byeProjCells(id, {
    team: getIndex()?.[String(id)]?.t,
    season: state.league?.season,
    week: state.week,
    scoring: state.league?.settings?.scoring,
  });
}

function benchRow(id, where = 'bench') {
  const p = getIndex()?.[String(id)] ?? null;
  const status = injuryOf(id);
  const canIR = where === 'bench' && irEligible(status);

  return `<tr>
    <td>
      ${p ? playerChip(p, { size: 30, compact: true }) : esc(playerLabel(id))}
      ${status ? `<span class="inj-tag" title="Injury designation">${esc(status)}</span>` : ''}
    </td>
    ${projCells(id)}
    <td class="num">
      ${where === 'bench'
    ? `<button class="btn tiny" data-act="roster-ir" data-player="${esc(id)}"
               ${canIR ? '' : 'disabled title="Only a player carrying a season-length reserve designation may be placed on IR"'}>IR</button>`
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

/**
 * A player's injury designation, or null when healthy.
 *
 * ⚠️ AS FRESH AS THE INDEX, AND NO FRESHER. `i` is written by
 * `scripts/build-player-index.mjs` from Sleeper's player database, so it is a
 * committed snapshot rather than a live feed — regenerate the asset in-season or
 * a player who has just been placed on IR will not be IR-eligible here yet. The
 * module reads the same asset, so the two never disagree.
 */
function injuryOf(id) {
  return index?.[String(id)]?.i ?? null;
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

      // ⚠️ Only fetched when the league actually has AutoSubs on. Asking a
      // league that does not for designations it cannot have is a request per
      // roster view for nothing.
      state.subs = Number(league?.settings?.autoSubsPerWeek ?? 0) > 0
        ? ((await getAutoSubs(leagueId, teamId, week).catch(() => null))?.subs ?? {})
        : {};
    } else {
      state.lineup = starters.map(() => null);
      state.subs = {};
    }
  } catch (err) {
    state.error = describe(err);
  } finally {
    state.loaded = true;
    app?.router?.refresh();
  }
}

/**
 * A slot changed. Kept in state rather than saved, so one save is one request.
 *
 * ⚠️ THE REPAINT IS PART OF THE RULE, NOT A NICETY. Every other slot's dropdown
 * is built from the BENCH, which is "held, minus whoever is already starting" —
 * so the lists are only correct as of the last render. Without repainting, a
 * player you just started stayed listed in all eleven other slots and could be
 * picked again; the state deduped it silently underneath, so the screen showed
 * one lineup and the save sent a different one.
 */
/**
 * Designate (or clear) an AutoSub for one starter, and save it immediately.
 *
 * ⚠️ SAVED ON CHANGE, unlike the lineup. A lineup is edited slot by slot and
 * saved once because the slots constrain each other; a designation is a single
 * independent fact, and holding it unsaved would let a manager close the screen
 * believing a backup is in place when nothing was ever sent.
 */
export async function setAutoSub(app, starterId, subId) {
  const starter = String(starterId ?? '');
  if (!starter) return;

  const next = { ...(state.subs ?? {}) };
  if (subId) next[starter] = String(subId);
  else delete next[starter];

  const previous = state.subs;
  state.subs = next;
  state.error = null;
  state.notice = null;
  app?.router?.refresh();

  try {
    await setAutoSubs(state.leagueId, state.teamId, state.week, next);
    state.notice = 'AutoSub saved.';
  } catch (err) {
    // ⚠️ ROLL BACK ON REFUSAL. The module is the authority on eligibility and
    // the per-week limit; leaving the rejected designation on screen would show
    // a backup that does not exist.
    state.subs = previous;
    state.error = describe(err);
  } finally {
    app?.router?.refresh();
  }
}

export function setSlot(app, index_, playerId) {
  const i = Number(index_);
  if (!Number.isInteger(i) || i < 0 || i >= state.lineup.length) return;
  const id = playerId ? String(playerId) : null;

  if (id) {
    // Starting someone already in another slot MOVES them, rather than cloning.
    const existing = state.lineup.indexOf(id);
    if (existing !== -1 && existing !== i) state.lineup[existing] = null;
  }
  state.lineup[i] = id;
  app?.router?.refresh();
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
