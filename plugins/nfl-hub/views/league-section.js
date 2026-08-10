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

const TABS = [
  ['home', 'League'],
  ['matchup', 'Matchups'],
  ['roster', 'My Roster'],
  ['draft', 'Draft'],
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
        : home.render();
  return `${tabsHtml()}<div class="section-body">${body}</div>`;
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

  home.load(app);
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
      }
      return;

    case 'league-retry':
    case 'league-refresh':
      if (leagueId) home.open(app, leagueId); else home.load(app);
      return;

    case 'league-open':
      home.open(app, target.dataset.league);
      return;

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
      roster.setSlot(target.dataset.index, target.value);
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
