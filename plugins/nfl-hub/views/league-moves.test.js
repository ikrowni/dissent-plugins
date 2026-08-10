import { describe, it, expect, beforeEach } from 'vitest';
import {
  render, reset, rosteredIds, actionsFor, setBid, setDrop, toggleTradePlayer, _state,
} from './league-moves.js';
import { setIndex } from '../core/player-index.js';

const INDEX = {
  p1: { n: 'Alpha One', p: 'QB', t: 'KC' },
  p2: { n: 'Beta Two', p: 'RB', t: 'SF' },
  p3: { n: 'Gamma Three', p: 'WR', t: 'MIN' },
  fa1: { n: 'Free Agent', p: 'TE', t: 'DAL' },
};

const league = (over = {}) => ({
  settings: { waiverType: 'faab', waiverBudget: 100 },
  teams: {
    t1: { id: 't1', name: 'Alice FC' },
    t2: { id: 't2', name: 'Bob United' },
  },
  assets: {
    rosters: {
      t1: { players: ['p1'], ir: [], taxi: [] },
      t2: { players: ['p2'], ir: ['p3'], taxi: [] },
    },
  },
  myTeams: ['t1'],
  ...over,
});

beforeEach(() => {
  reset();
  setIndex(INDEX);
});

const setup = (over = {}) => {
  Object.assign(_state, {
    leagueId: 'lg', league: league(), teamId: 't1', week: 3,
    claims: { claims: [], budgets: { t1: 75 }, pendingCount: 0 },
    trades: [], loaded: true, error: null, busy: false, notice: null,
    query: '', results: [], bid: 0, dropId: '',
    tradeWith: '', tradeMine: [], tradeTheirs: [], ...over,
  });
};

describe('rosteredIds', () => {
  // ⚠️ Every compartment on EVERY team. A free agent is someone no team holds —
  // offering a rostered player produces a refusal the manager cannot explain.
  it('includes players on IR and taxi, across all teams', () => {
    const ids = rosteredIds(league());
    expect([...ids].sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('is empty for a league with no rosters', () => {
    expect(rosteredIds(null).size).toBe(0);
    expect(rosteredIds({ assets: {} }).size).toBe(0);
  });
});

describe('actionsFor', () => {
  const trade = (over = {}) => ({
    id: 'tr1', status: 'proposed', proposedBy: 't1',
    parties: ['t1', 't2'], acceptances: { t1: 1 }, ...over,
  });

  it('lets the proposer cancel while it is proposed', () => {
    expect(actionsFor(trade(), 't1')).toEqual(['cancel']);
  });

  it('lets the other party accept or reject', () => {
    expect(actionsFor(trade(), 't2')).toEqual(['accept', 'reject']);
  });

  it('offers a party nothing once they have accepted', () => {
    expect(actionsFor(trade({ acceptances: { t1: 1, t2: 1 } }), 't2')).toEqual([]);
  });

  // ⚠️ Only a NON-party may veto, and only during review. Offering it to a party
  // invites a refusal the module already enforces, and implies the rule differs.
  it('offers a veto only to a non-party, only in review', () => {
    expect(actionsFor(trade({ status: 'review' }), 't3')).toEqual(['veto']);
    expect(actionsFor(trade({ status: 'review' }), 't1')).toEqual([]);
    expect(actionsFor(trade({ status: 'proposed' }), 't3')).toEqual([]);
  });

  it('offers nothing on a finished trade', () => {
    for (const status of ['executed', 'rejected', 'cancelled', 'vetoed', 'expired']) {
      expect(actionsFor(trade({ status }), 't1')).toEqual([]);
      expect(actionsFor(trade({ status }), 't3')).toEqual([]);
    }
  });
});

describe('render', () => {
  it('needs at least two letters before searching', () => {
    setup({ query: 'a' });
    expect(render()).toContain('at least two letters');
  });

  it('lists free agents with a claim button', () => {
    setup({ query: 'free', results: [{ id: 'fa1', name: 'Free Agent', position: 'TE', team: 'DAL' }] });
    const html = render();
    expect(html).toContain('Free Agent');
    expect(html).toContain('moves-claim');
  });

  it('shows the FAAB budget and a bid field in a FAAB league', () => {
    setup();
    const html = render();
    expect(html).toContain('$75 left');
    expect(html).toContain('moves-bid');
  });

  it('hides the bid field in a non-FAAB league, and says Claim not Bid', () => {
    // The button label only exists on a result row, so the search has to have
    // found something for this to assert anything at all.
    const results = [{ id: 'fa1', name: 'Free Agent', position: 'TE', team: 'DAL' }];
    setup({ league: league({ settings: { waiverType: 'rolling' } }), query: 'free', results });
    const html = render();
    expect(html).not.toContain('moves-bid');
    expect(html).toContain('>\n        Claim\n      </button>');

    setup({ query: 'free', results });   // FAAB league
    expect(render()).toContain('>\n        Bid\n      </button>');
  });

  it('offers only the caller’s own players to drop', () => {
    setup();
    const html = render();
    const dropBlock = html.slice(html.indexOf('moves-drop'), html.indexOf('</select>', html.indexOf('moves-drop')));
    expect(dropBlock).toContain('Alpha One');   // t1's player
    expect(dropBlock).not.toContain('Beta Two'); // t2's player
  });

  it('lists my pending claims with a cancel button', () => {
    setup({ claims: { claims: [{ playerId: 'fa1', bid: 22, dropPlayerId: 'p1' }], budgets: { t1: 78 } } });
    const html = render();
    expect(html).toContain('Free Agent');
    expect(html).toContain('$22');
    expect(html).toContain('moves-cancel-claim');
  });

  // ⚠️ Blind auction: the view must not imply other managers' claims are visible.
  it('describes claims as blind', () => {
    setup({ claims: { claims: [{ playerId: 'fa1', bid: 5 }], budgets: {} } });
    expect(render()).toContain('blind');
  });

  it('shows no trade builder until a team is chosen', () => {
    setup();
    const html = render();
    expect(html).toContain('choose a team');
    expect(html).not.toContain('You send');
  });

  it('shows both sides once a team is chosen', () => {
    setup({ tradeWith: 't2' });
    const html = render();
    expect(html).toContain('You send');
    expect(html).toContain('You get');
    expect(html).toContain('Alpha One');
    expect(html).toContain('Beta Two');
  });

  it('disables propose until something is selected', () => {
    setup({ tradeWith: 't2' });
    expect(render()).toMatch(/data-act="moves-propose"[^>]*disabled/);
    setup({ tradeWith: 't2', tradeMine: ['p1'] });
    expect(render()).not.toMatch(/data-act="moves-propose"[^>]*disabled/);
  });

  it('renders a trade with its legs and status', () => {
    setup({
      trades: [{
        id: 'tr1', status: 'proposed', proposedBy: 't2', parties: ['t1', 't2'],
        acceptances: { t2: 1 }, legs: [{ from: 't2', to: 't1', playerId: 'p2' }],
      }],
    });
    const html = render();
    expect(html).toContain('proposed');
    expect(html).toContain('Bob United → Alice FC');
    expect(html).toContain('accept');
  });

  it('says so plainly when there is no team', () => {
    setup({ teamId: null });
    expect(render()).toContain('do not have a team');
  });

  it('renders an error as a pane with a retry', () => {
    setup({ error: 'bid 90 exceeds remaining budget 75' });
    const html = render();
    expect(html).toContain('exceeds remaining budget');
    expect(html).toContain('moves-retry');
  });

  it('escapes player and team names', () => {
    setIndex({ x1: { n: '<img src=x onerror=alert(1)>', p: 'QB' } });
    setup({ query: 'img', results: [{ id: 'x1', name: '<img src=x onerror=alert(1)>', position: 'QB', team: null }] });
    const html = render();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});

describe('local state helpers', () => {
  it('clamps a bid to zero or more', () => {
    setup();
    setBid(-5); expect(_state.bid).toBe(0);
    setBid('12'); expect(_state.bid).toBe(12);
    setBid('nonsense'); expect(_state.bid).toBe(0);
  });

  it('records and clears a drop selection', () => {
    setup();
    setDrop('p1'); expect(_state.dropId).toBe('p1');
    setDrop(''); expect(_state.dropId).toBe('');
  });

  it('toggles trade selections without duplicating', () => {
    setup({ tradeWith: 't2' });
    toggleTradePlayer('mine', 'p1', true);
    toggleTradePlayer('mine', 'p1', true);
    expect(_state.tradeMine).toEqual(['p1']);
    toggleTradePlayer('mine', 'p1', false);
    expect(_state.tradeMine).toEqual([]);
  });

  it('keeps the two sides separate', () => {
    setup({ tradeWith: 't2' });
    toggleTradePlayer('mine', 'p1', true);
    toggleTradePlayer('theirs', 'p2', true);
    expect(_state.tradeMine).toEqual(['p1']);
    expect(_state.tradeTheirs).toEqual(['p2']);
  });
});

describe('the trending panel', () => {
  const trending = {
    adds: [{ id: 'fa1', count: 52614, player: INDEX.fa1 }],
    drops: [{ id: 'p2', count: 11736, player: INDEX.p2 }],
  };

  // ⚠️ Supplementary, and loaded off the critical path. Before it arrives the
  // waiver wire must look finished, not half-loaded — an empty "Trending" box
  // would be louder than the feature is important.
  it('renders nothing before it has loaded', () => {
    setup({ trending: null });
    expect(render()).not.toContain('Trending now');
  });

  it('renders nothing when both directions came back empty', () => {
    setup({ trending: { adds: [], drops: [] } });
    expect(render()).not.toContain('Trending now');
  });

  it('shows the most added and most dropped', () => {
    setup({ trending });
    const html = render();
    expect(html).toContain('Trending now');
    expect(html).toContain('Most added');
    expect(html).toContain('Free Agent');
    expect(html).toContain('Beta Two');
  });

  // ⚠️ 52,614 is a real top-add count. Raw, it is noise in a narrow column.
  it('shortens the transaction counts', () => {
    setup({ trending });
    expect(render()).toContain('52.6k');
  });

  // ⚠️ Roughly 1 in 12 men cannot separate the red from the green, so direction
  // is never carried by colour alone.
  it('marks direction with a class, not only a colour', () => {
    setup({ trending });
    const html = render();
    expect(html).toContain('trend-head up');
    expect(html).toContain('trend-head down');
  });

  it('still renders one side when the other is empty', () => {
    setup({ trending: { adds: trending.adds, drops: [] } });
    const html = render();
    expect(html).toContain('Trending now');
    expect(html).toContain('Nothing yet.');
  });
});
