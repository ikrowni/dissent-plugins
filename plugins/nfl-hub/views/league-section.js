// views/league-section.js — the native league section shell.
//
// Owns which sub-view is showing and routes every league action to it. The hub's
// router only knows about this one view; the sub-views are plain modules it
// renders into its own body, which is the same shape views/fantasy.js uses for
// the Sleeper mirror.
//
// ⚠️ THE SLEEPER MIRROR STAYS. views/fantasy*.js render a league that lives on
// Sleeper and can only be read. This section renders a league that lives here
// and can be played. Both are legitimate and they do not interfere: a native
// league is identified by its own leagueId in plugin storage.

import { esc } from '../core/ui.js';
import * as home from './league-home.js';
import * as roster from './league-roster.js';
import * as draft from './league-draft.js';
import * as matchup from './league-matchup.js';
import * as moves from './league-moves.js';
import * as coowners from './league-coowners.js';
import * as mock from './league-mock.js';

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

export function render() {
  const body = state.tab === 'roster' ? roster.render()
    : state.tab === 'draft' ? draft.render()
      : state.tab === 'matchup' ? matchup.render()
        : state.tab === 'moves' ? moves.render()
          : state.tab === 'mock' ? mock.render()
            : home.render() + coOwnersPanel();
  return `${tabsHtml()}<div class="section-body">${body}</div>`;
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

  // A stale notice or a half-finished ask from a previous visit must not greet
  // the next one.
  coowners.reset();
  mock.reset();
  home.load(app);
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
  document.removeEventListener('submit', onSubmit, true);
  if (app?.onAction === onAction) app.onAction = null;
}

/** Route a form submit to the action named on the form itself. */
export function onSubmit(event) {
  const form = event.target?.closest?.('form[data-act]');
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const act = form.dataset.act;
  if (act === 'league-create-form') home.create(app, data);
  else if (act === 'league-join-form') home.join(app, data.teamName);
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
