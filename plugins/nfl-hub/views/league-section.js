// views/league-section.js — the native league section shell.
//
// Owns which sub-view is showing and routes every league action to it. The hub's
// router only knows about this one view; the sub-views are plain modules it
// renders into its own body.
//
// ⚠️ THIS IS THE ONLY LEAGUE NOW. A `fantasy` view used to sit beside it,
// mirroring a league that lived on Sleeper and could only be READ — this one
// lives here and can be PLAYED. The mirror was removed on 2026-08-12: it had
// never been configured on any install and no install held a single row of its
// state. If a read-only view of an external league is ever wanted again, it is a
// new feature, not a revert — `fromSleeperSettings` in core/league/settings.js is
// the closer idea and it still has no caller.

import { esc } from '../core/ui.js';
import * as home from './league-home.js';
import * as roster from './league-roster.js';
import * as draft from './league-draft.js';
import * as matchup from './league-matchup.js';
import * as moves from './league-moves.js';
import * as coowners from './league-coowners.js';
import * as mock from './league-mock.js';
import * as identity from './league-identity.js';
import * as teamImages from '../core/team-images.js';

const TABS = [
  ['home', 'League'],
  ['matchup', 'Matchups'],
  ['roster', 'My Roster'],
  ['moves', 'Moves'],
  ['draft', 'Draft'],
  // ⚠️ Reachable WITHOUT a league. A mock is the one part of this section
  // somebody can use before they have joined anything, and it is the best
  // advertisement the rest of it has.
  ['mock', 'Mock Draft'],
];

const state = { tab: 'home' };

function tabsHtml() {
  return `<div class="subnav" role="tablist">${TABS.map(([id, label]) => (
    `<button class="tab" role="tab" aria-selected="${state.tab === id}"
             data-act="lg-tab" data-tab="${id}">${esc(label)}</button>`
  )).join('')}</div>`;
}

/**
 * Does this sub-view already stand on a lit surface?
 *
 * ⚠️ DECIDED FROM THE OUTPUT, NOT FROM A LIST OF TAB NAMES. This began as
 * `new Set(['draft', 'mock'])`, on the reasoning that those two bring their own
 * stage from gridiron.css — which is true, but only once a BOARD IS UP. Their
 * setup screen and their empty states are ordinary panels, so the name list left
 * exactly those two screens as the only unlit surfaces left in the hub: "Start
 * mock draft" and "No draft has been set up for this league yet".
 *
 * Reading the rendered output instead is self-correcting. A view that lights
 * itself is left alone; a view that does not gets the section's stage, whatever
 * tab it happens to be on and whatever state it is in.
 *
 * ⚠️ A stage inside a stage is the thing being avoided — two gradients, two
 * vignettes, and a board that reads as a picture of a board.
 */
/** Which sub-tab is showing. Exported for tests; the UI sets it through `lg-tab`. */
export function setTab(tab) { state.tab = tab; }

export function wrapBody(body) {
  if (body.includes('gr-stage')) return body;
  return `<div class="stage lg-stage"><div class="lg-stage-in m-stagger">${body}</div></div>`;
}

export function render() {
  const body = state.tab === 'roster' ? roster.render()
    : state.tab === 'draft' ? draft.render()
      : state.tab === 'matchup' ? matchup.render()
        : state.tab === 'moves' ? moves.render()
          : state.tab === 'mock' ? mock.render()
            : home.render() + coOwnersPanel() + identityPanels();
  // ⚠️ WRAPPED HERE RATHER THAN IN SIX VIEWS. The section already owns which
  // sub-tab is showing, so one wrapper lights them all identically and cannot
  // drift between them — and the views stay pure render functions that know
  // nothing about the surface they land on.
  //
  // ⚠️ NO `is-first` GATE: none of these registers a scheduler task, so they paint
  // on navigation and on action, never on a timer. Around the League and Game
  // Center need the gate; adding one here would be cargo.
  return `${tabsHtml()}<div class="section-body">${wrapBody(body)}</div>`;
}

/**
 * Co-management sits UNDER the league home pane rather than in a tab of its own.
 *
 * It is a league-level question — who runs which team — and it has to be
 * reachable by someone with NO team, who has nothing to look at on the roster or
 * moves tabs. It renders to nothing until a league is open.
 *
 * ⚠️ Rendered from HERE, not from inside league-home, because the co-owner view
 * imports `describe` from league-home. Calling it the other way round would make
 * that a static import cycle, which this file's own comment on the app import
 * explains the project avoids.
 */
function coOwnersPanel() {
  const { league } = home.current();
  return league ? coowners.render(league) : '';
}

/**
 * Naming and picturing a franchise, above co-management.
 *
 * ⚠️ Rendered from HERE for the same reason the co-owner panel is: league-identity
 * imports `describe` from league-home, so rendering it from inside league-home
 * would make that a static import cycle.
 *
 * ⚠️ ORDER CORRECTED 2026-08-12. These first shipped ABOVE the co-manager panel,
 * on the reasoning that every manager renames a team and few share one. That was
 * wrong in practice: it pushed "Co-managers" to the very bottom of an already long
 * League tab, below four other panels, and the owner reported being unable to find
 * how to add or remove one at all. Renaming a team is discoverable from the team's
 * own name; co-management is not discoverable from anywhere else, so it goes first.
 */
function identityPanels() {
  const { league } = home.current();
  if (!league) return '';
  return identity.renderTeamCard(league) + identity.renderLeagueCard(league);
}

// The app singleton, resolved on enter and kept for the actions. Imported
// dynamically for the same reason every other view does it: a static cycle
// between app.js and its views is fragile, and this module must stay importable
// by a unit test without booting the hub.
let app = null;

export async function enter() {
  ({ app } = await import('../core/app.js'));
  app.onAction = onAction;

  // ⚠️ A FORM SUBMIT NEVER REACHES app.onAction. The hub delegates `click` and
  // `input` only, so a submit button inside a form fires neither in a useful
  // form — the click lands on the button, and the browser then navigates. This
  // listener is the view's own, and leave() removes it.
  document.addEventListener('submit', onSubmit, true);

  // ⚠️ ITS OWN LISTENER, AND `change` RATHER THAN `input`. A file input is the
  // only control in this section whose value arrives from a dialog rather than a
  // keystroke, and core/app.js already delegates `input` to onAction — so putting
  // `data-act` on a file input would deliver the same chosen file twice and
  // upload it twice. See `pickerRow` in league-identity.js.
  document.addEventListener('change', onChange, true);

  // A stale notice or a half-finished ask from a previous visit must not greet
  // the next one.
  coowners.reset();
  mock.reset();
  identity.reset();
  home.load(app);
}

/** What the identity actions need: the league id, the payload, and a reload. */
function idCtx() {
  const { leagueId } = home.current();
  return {
    leagueId,
    // A GETTER, not the value: the actions run after an await, by which point the
    // league captured at click time may already have been replaced by a reload.
    league: () => home.current().league,
    reload: () => home.open(app, leagueId),
  };
}

/** What the co-owner actions need: the league id, and how to reload it. */
function coCtx() {
  const { leagueId } = home.current();
  return { leagueId, reload: () => home.open(app, leagueId) };
}

export function leave() {
  // ⚠️ Stop the draft poll on the way out. A leaked interval keeps invoking the
  // module from a view nobody is looking at, and the install's daily allowance
  // is finite.
  draft.stopPolling();
  // ⚠️ The mock's optional pick clock is a timer too. A leaked one keeps counting
  // down a board nobody is looking at and auto-picks into it.
  mock.stopClock();
  document.removeEventListener('submit', onSubmit, true);
  document.removeEventListener('change', onChange, true);
  // ⚠️ The resolved image URLs go too. They are signed and expiring, so a cache
  // kept across a visit hands the next render URLs that have already died — and
  // the ids they were resolved from may belong to a league this user has since
  // left, where the node would now refuse them anyway.
  teamImages.reset();
  if (app?.onAction === onAction) app.onAction = null;
}

/**
 * Route a file choice to the picker that made it.
 *
 * ⚠️ THE INPUT IS CLEARED IMMEDIATELY. Without it, choosing the same file twice
 * in a row fires no second `change` — the value has not changed — so a failed
 * upload could not be retried with the same image.
 */
export function onChange(event) {
  const input = event.target?.closest?.('input[data-pick]');
  if (!input) return;
  const file = input.files?.[0];
  const kind = input.dataset.pick;
  input.value = '';
  if (file) identity.pick(app, idCtx(), kind, file);
}

/** Route a form submit to the action named on the form itself. */
export function onSubmit(event) {
  const form = event.target?.closest?.('form[data-act]');
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const act = form.dataset.act;
  if (act === 'league-create-form') home.create(app, data);
  else if (act === 'league-settings-form') home.saveSettings(app, data);
  else if (act === 'league-join-form') home.join(app, data.teamName);
  else if (act === 'team-rename-form') identity.rename(app, idCtx(), data);
  else if (act === 'draft-pick-form') draft.pick(app, data.playerId);
}

export async function onAction(act, target) {
  const { leagueId, league } = home.current();
  const teamId = (league?.myTeams ?? [])[0] ?? null;

  switch (act) {
    case 'lg-tab':
      state.tab = target.dataset.tab;
      app.router.refresh();
      // Leaving the draft tab must stop its poll, whichever tab is next.
      if (state.tab !== 'draft') draft.stopPolling();
      if (state.tab !== 'mock') mock.stopClock();
      if (state.tab === 'roster') {
        roster.load(app, { leagueId, league, teamId, week: league?.currentWeek ?? null });
      } else if (state.tab === 'draft') {
        draft.load(app, { leagueId, league, teamId });
      } else if (state.tab === 'matchup') {
        matchup.load(app, { leagueId, league, week: league?.currentWeek ?? null });
      } else if (state.tab === 'moves') {
        moves.load(app, { leagueId, league, teamId, week: league?.currentWeek ?? null });
      }
      return;

    // ── Mock draft (no league, no server) ──
    case 'mock-set':
      mock.setField(app, target.dataset.field, target.value);
      return;
    case 'mock-start':
      mock.start(app);
      return;
    case 'mock-reset':
      mock.restart(app);
      return;
    case 'mock-sim':
      mock.simulate(app);
      return;
    case 'mock-search':
      mock.search(app, target.value, target.selectionStart);
      return;
    // ⚠️ SHARED ACTION NAMES, TWO BOARDS. `views/draft-board.js` renders the pool
    // and the filter row for BOTH the live draft and the mock, so these arrive
    // from whichever is on screen and the tab is the only thing that says which.
    // Routing them straight to the mock — as they were, back when only the mock
    // had a pool — made the live board's Draft buttons silently pick in a mock
    // that was not running.
    case 'draft-filter':
      if (state.tab === 'draft') draft.setFilter(app, target.dataset.filter);
      else mock.setFilter(app, target.dataset.filter);
      return;
    // ⚠️ SAME SHARED-BOARD HAZARD as draft-filter above. The queue panel is only
    // rendered by the LIVE draft, but these still branch on the tab rather than
    // assume — draft-board.js is shared and the mock could grow a queue later.
    case 'draft-queue-add':
      if (state.tab === 'draft') draft.queueAdd(app, target.dataset.player);
      return;
    case 'draft-queue-remove':
      if (state.tab === 'draft') draft.queueRemove(app, target.dataset.player);
      return;
    case 'draft-queue-up':
      if (state.tab === 'draft') draft.queueUp(app, target.dataset.player);
      return;
    case 'draft-take':
      if (state.tab === 'draft') draft.pick(app, target.dataset.player);
      else mock.take(app, target.dataset.player);
      return;

    case 'league-retry':
    case 'league-refresh':
      if (leagueId) home.open(app, leagueId); else home.load(app);
      return;

    case 'league-open':
      home.open(app, target.dataset.league);
      return;

    // ⚠️ Reuses the hub's EXISTING player page rather than a second card. It is
    // keyed on an ESPN athlete id, which the index now carries for ~95% of
    // active players — before that enrichment this route was unreachable from
    // any fantasy surface.
    case 'player-open':
      app.athleteId = target.dataset.espn;
      app.router.go('player');
      return;

    case 'league-start-season':
      home.setWeek(app, target.dataset.week);
      return;
    case 'league-set-week': {
      // ⚠️ Read the field at click time. The hub re-renders on every refresh, so
      // a controlled input would lose focus between keystrokes.
      const field = document.querySelector('[data-act="league-week-input"]');
      home.setWeek(app, field?.value);
      return;
    }

    case 'league-goto-roster':
      state.tab = 'roster';
      app.router.refresh();
      roster.load(app, { leagueId, league, teamId, week: league?.currentWeek ?? null });
      return;

    case 'matchup-retry':
      matchup.load(app, { leagueId, league, week: league?.currentWeek ?? null });
      return;
    case 'matchup-start-playoffs':
      matchup.seedPlayoffs(app);
      return;
    case 'matchup-generate':
      matchup.generate(app);
      return;
    case 'matchup-expand':
      matchup.expand(app, target.dataset.team);
      return;

    case 'league-goto-matchup':
      state.tab = 'matchup';
      draft.stopPolling();
      app.router.refresh();
      matchup.load(app, { leagueId, league, week: league?.currentWeek ?? null });
      return;

    // ── Moves ──
    case 'moves-retry':
      moves.load(app, { leagueId, league, teamId, week: league?.currentWeek ?? null });
      return;
    case 'moves-search':
      moves.search(app, target.value, target.selectionStart);
      return;
    case 'moves-bid':
      moves.setBid(target.value);
      return;
    case 'moves-drop':
      moves.setDrop(target.value);
      return;
    case 'moves-claim':
      moves.claim(app, target.dataset.player);
      return;
    case 'moves-cancel-claim':
      moves.cancel(app, target.dataset.player);
      return;
    case 'moves-trade-with':
      moves.setTradeWith(app, target.value);
      return;
    case 'moves-block-toggle':
      moves.toggleBlock(app, target.dataset.player);
      return;
    case 'moves-interest-toggle':
      moves.toggleInterest(app, target.dataset.player);
      return;

    case 'moves-trade-mine':
      moves.toggleTradePlayer('mine', target.dataset.player, target.checked);
      return;
    case 'moves-trade-theirs':
      moves.toggleTradePlayer('theirs', target.dataset.player, target.checked);
      return;
    case 'moves-propose':
      moves.propose(app);
      return;
    case 'moves-trade-act':
      moves.respond(app, target.dataset.trade, target.dataset.action);
      return;

    // ── Identity ──
    // ⚠️ Only the CLEAR is an action. The upload arrives on `change`, from a file
    // input that deliberately carries no data-act — see onChange above.
    case 'tm-clear':
      identity.clear(app, idCtx(), target.dataset.kind);
      return;

    // ── Co-management ──
    case 'co-pick-team':
      coowners.pickTeam(app, target.value);
      return;
    case 'co-ask':
      coowners.ask(app, coCtx());
      return;
    case 'co-withdraw':
      coowners.withdraw(app, coCtx(), target.dataset.team);
      return;
    case 'co-approve':
      coowners.approve(app, coCtx(), target.dataset.team, target.dataset.user);
      return;
    case 'co-decline':
      coowners.decline(app, coCtx(), target.dataset.team, target.dataset.user);
      return;
    case 'co-remove':
      coowners.remove(app, coCtx(), target.dataset.team, target.dataset.user);
      return;
    case 'co-leave':
      coowners.leave(app, coCtx(), target.dataset.team);
      return;

    case 'league-goto-draft':
      state.tab = 'draft';
      app.router.refresh();
      draft.load(app, { leagueId, league, teamId });
      return;

    // ── Roster ──
    case 'roster-retry':
      roster.load(app, { leagueId, league, teamId, week: league?.currentWeek ?? null });
      return;
    case 'roster-refresh':
      home.open(app, leagueId).then(() => {
        const c = home.current();
        roster.load(app, {
          leagueId, league: c.league, teamId, week: c.league?.currentWeek ?? null,
        });
      });
      return;
    case 'roster-autosub':
      roster.setAutoSub(app, target.dataset.starter, target.value);
      return;

    case 'roster-slot':
      roster.setSlot(app, target.dataset.index, target.value);
      return;
    case 'roster-save':
      roster.save(app);
      return;
    case 'roster-drop':
      roster.drop(app, target.dataset.player);
      return;
    case 'roster-ir':
      roster.toIR(app, target.dataset.player);
      return;
    case 'roster-activate':
      roster.activate(app, target.dataset.player);
      return;

    // ── Draft ──
    case 'draft-retry':
      draft.load(app, { leagueId, league, teamId });
      return;
    case 'draft-search':
      // The caret travels with the query so restoring focus does not jump the
      // cursor to the end mid-word.
      draft.search(app, target.value, target.selectionStart);
      return;
    case 'draft-pick-player':
      draft.pick(app, target.dataset.player);
      return;
    case 'draft-create':
      draft.create(app);
      return;
    case 'draft-start':
      draft.start(app);
      return;
    case 'draft-rebuild':
      draft.rebuild(app);
      return;
    case 'draft-auto-toggle':
      draft.toggleAutoDraft(app, target.dataset.team);
      return;
    case 'draft-alert-toggle':
      draft.toggleAlert(app);
      return;
    case 'draft-pick-for':
      draft.pickForOnClock(app);
      return;
    case 'draft-pause':
      draft.pause(app, target.dataset.paused !== 'true');
      return;
    case 'draft-finalize':
      draft.finalize(app);
      return;
    default:
      // Unknown actions belong to another view; ignore rather than guess.
  }
}

export { state as _state, TABS };
