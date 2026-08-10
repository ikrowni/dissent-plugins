import { describe, it, expect, beforeEach } from 'vitest';
import { render, reset, _state } from './league-draft.js';

const league = (teamCount = 4, over = {}) => ({
  id: 'lg',
  isCommissioner: true,
  teams: Object.fromEntries(
    Array.from({ length: teamCount }, (_, i) => [`t${i + 1}`, { id: `t${i + 1}`, name: `Team ${i + 1}` }]),
  ),
  myTeams: ['t1'],
  ...over,
});

beforeEach(reset);

const setup = (over = {}) => {
  Object.assign(_state, {
    leagueId: 'lg', league: league(), teamId: 't1', draft: null,
    error: null, busy: false, notice: null, noDraft: false, query: '', results: [], ...over,
  });
};

describe('a league with no draft yet', () => {
  // ⚠️ THE REGRESSION. The module refuses `draft:get` for a league that never
  // created one, and rendering that refusal as an error left a commissioner
  // looking at "Try again" — a button that could never work, on the one screen
  // where they were the only person able to act.
  it('is a state with a way forward, not an error with a retry', () => {
    setup({ noDraft: true });
    const html = render();
    expect(html).toContain('draft-create');
    expect(html).not.toContain('draft-retry');
  });

  it('explains what is missing', () => {
    setup({ noDraft: true });
    expect(render()).toMatch(/No draft has been set up/i);
  });

  // ⚠️ A draft needs opponents. Offering a live button that the module will
  // refuse teaches nothing; saying the count does.
  it('refuses to offer a draft to a one-team league, and says why', () => {
    setup({ noDraft: true, league: league(1) });
    const html = render();
    expect(html).toMatch(/at least two teams/i);
    expect(html).toMatch(/this league has 1/i);
    expect(html).toMatch(/data-act="draft-create"[^>]*disabled/);
  });

  it('enables the button once a second team exists', () => {
    setup({ noDraft: true, league: league(2) });
    expect(render()).not.toMatch(/data-act="draft-create"[^>]*disabled/);
  });

  it('tells a non-commissioner who to ask, without a button they cannot use', () => {
    setup({ noDraft: true, league: league(4, { isCommissioner: false }) });
    const html = render();
    expect(html).toMatch(/commissioner needs to create it/i);
    expect(html).not.toContain('draft-create');
  });

  // A real failure still has to look like one.
  it('keeps the retry pane for an actual error', () => {
    setup({ error: 'the league engine is not running' });
    const html = render();
    expect(html).toContain('draft-retry');
    expect(html).toContain('not running');
  });
});
