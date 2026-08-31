// @vitest-environment jsdom
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

const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

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

  /**
   * ⚠️ THE PANEL ITS OWN COMMENT CALLS "SUPPLEMENTARY" RENDERED FIRST. It was
   * prepended inside freeAgentPane(), so the one thing on this tab you cannot act
   * on sat above the search box, your claims and the waiver wire. Dimming it
   * without moving it is half a fix — weight and POSITION both say what matters.
   */
  it('renders last, below everything you act on', () => {
    setup({ trending });
    const heads = [...parse(render()).querySelectorAll('.panel-head h2')]
      .map((h) => h.textContent);
    expect(heads.some((h) => /trending/i.test(h))).toBe(true);
    expect(heads.findIndex((h) => /trending/i.test(h))).toBe(heads.length - 1);
    expect(heads.findIndex((h) => /free agents/i.test(h)))
      .toBeLessThan(heads.findIndex((h) => /trending/i.test(h)));
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

describe('trade block', () => {
  beforeEach(() => {
    Object.assign(_state, {
      leagueId: 'lg', league: league(), teamId: 't1', week: 3, loaded: true, error: null,
    });
    _state.block = { t2: { players: ['p2'], picks: [] } };
    _state.interest = { t2: ['p1'] };
    _state.counts = { p1: 1 };
  });

  it('shows what other teams are offering', () => {
    expect(render()).toContain('On the block');
  });

  // ⚠️ The heart-with-a-number from study §8.3 — it turns "would anyone take
  // him?" into a number, which is the whole value of the feature.
  it('shows how many teams want one of my players', () => {
    expect(render()).toMatch(/1\s*(interested|<)/i);
  });

  it('offers a control to block my own players', () => {
    expect(render()).toContain('moves-block-toggle');
  });

  it('offers a control to express interest in theirs', () => {
    expect(render()).toContain('moves-interest-toggle');
  });

  it('renders without a block or interest at all', () => {
    _state.block = {};
    _state.interest = {};
    _state.counts = {};
    expect(() => render()).not.toThrow();
  });
});

describe('the waiver wire', () => {
  beforeEach(() => {
    Object.assign(_state, {
      leagueId: 'lg', league: league(), teamId: 't1', week: 3, loaded: true, error: null,
      block: {}, interest: {}, counts: {},
    });
  });

  it('lists players sitting on waivers', () => {
    _state.wire = [{ playerId: 'p2', clearsAt: Date.now() + 86400000, droppedBy: 't2' }];
    const html = render();
    expect(html).toContain('On waivers');
    expect(html).toContain('Beta Two');
  });

  // ⚠️ The whole point of showing it: a claim is the ONLY way to get him, and a
  // manager who cannot see the deadline cannot plan around it.
  it('shows when each player clears', () => {
    _state.wire = [{ playerId: 'p2', clearsAt: Date.now() + 86400000, droppedBy: 't2' }];
    expect(render()).toMatch(/clears/i);
  });

  it('says so when the wire is empty', () => {
    _state.wire = [];
    expect(render()).toContain('Nobody is on waivers');
  });

  it('renders with no wire loaded at all', () => {
    _state.wire = undefined;
    expect(() => render()).not.toThrow();
  });
});

// ── §8b item 2: a team's colour on its OWN cards ────────────────────────────
//
// ⚠️ SCOPED DELIBERATELY. §8b says "a team's colour on its own rows and cards".
// The trade board renders one block per team, which is that team's own card, so
// it takes the accent. Inline mentions of a team inside somebody else's row —
// "dropped by X", or the "A → B: Player" trade legs — are neither a row nor a
// card of that team's, and a left border on a mid-sentence span reads as damage.
// Those are left alone on purpose; do not "finish the job" by accenting them.
describe('team accent on the trade board', () => {
  it('accents each other team block with its own colour', () => {
    setup({
      block: {
        t2: { players: ['p3'] },
      },
    });
    const el = parse(render());
    const blocks = [...el.querySelectorAll('.tb-team')];
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0].classList.contains('team-accent')).toBe(true);
    expect(blocks[0].getAttribute('style')).toContain('--mgr:');
  });

  it('leaves inline team mentions unaccented', () => {
    setup({ block: { t2: { players: ['p3'] } } });
    const el = parse(render());
    for (const s of el.querySelectorAll('.ww-by, .trade-legs')) {
      expect(s.classList.contains('team-accent')).toBe(false);
    }
  });

});

// 🔴 These rows replaced a wall of inline `<label class="check">` elements that
// reflowed into a paragraph at roster size — reported 2026-08-31 as "the way
// you choose players on this screen does not look very good". The point of a
// table is that the same fact sits in the same place on every row.
describe('trade pickers are tables, not a wall of checkboxes', () => {
  const openTrade = () => {
    setup();
    _state.tradeWith = 't2';
  };

  it('puts each selectable player in its own row', () => {
    openTrade();
    const d = parse(render());
    expect(d.querySelectorAll('.pick-table tbody tr').length).toBeGreaterThan(0);
    expect(d.querySelectorAll('.pick-table thead').length).toBeGreaterThan(0);
  });

  // The click target is the whole name, not a 13px box.
  it('labels every checkbox so the name is clickable', () => {
    openTrade();
    const d = parse(render());
    // Membership in an id set rather than a `#id` selector: these ids contain
    // characters a selector would need escaping for, and CSS.escape is not
    // present in this environment.
    const inputIds = new Set([...d.querySelectorAll('.pick-table input[type="checkbox"]')]
      .map((n) => n.id));
    const labels = [...d.querySelectorAll('.pick-label')];
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const forId = label.getAttribute('for');
      expect(forId, 'label has no for=').toBeTruthy();
      expect(inputIds.has(forId), `no checkbox with id ${forId}`).toBe(true);
    }
  });

  it('keeps the checkbox wired to the same action as before', () => {
    openTrade();
    const d = parse(render());
    const acts = new Set([...d.querySelectorAll('.pick-table input[data-act]')]
      .map((n) => n.dataset.act));
    expect(acts.has('moves-trade-mine') || acts.has('moves-trade-theirs')).toBe(true);
  });

  it('names the columns, including what the value number is', () => {
    openTrade();
    const html = render();
    expect(html).toContain('>Val<');
    expect(html).toMatch(/preseason projections/i);
  });

  // ⚠️ 0 IS A REAL VALUE IN THESE UNITS, so an absent one must not render as 0 —
  // a replacement-level player scores exactly 0 value over replacement, and a
  // manager cannot tell "worth nothing" from "we don't know" if they look alike.
  //
  // 🔴 THE FIRST VERSION OF THIS TEST WAS VACUOUS and only breaking it showed
  // that: it allowed `'—' || /^-?\d+$/`, and "0" matches that regex, so the
  // exact regression it names passed. No ranking asset is loaded under test, so
  // every value is unknown here and every cell must be a dash.
  it('renders an unranked player as a dash, never as zero', () => {
    openTrade();
    const d = parse(render());
    // ⚠️ Selected by ITS OWN CLASS, not by column index or position. Two
    // columns were inserted before Val, and `td[3]` silently began reading a
    // different cell while still passing; `:last-child` then picked up the
    // optional Want column instead. A cell worth asserting on is worth naming.
    const vals = [...d.querySelectorAll('.pick-table tbody tr td.val')]
      .map((td) => td.textContent.trim());
    expect(vals.length).toBeGreaterThan(0);
    for (const v of vals) {
      expect(v, 'an unknown value must not render as a number').toBe('—');
    }
  });
})

// 🔴 THE TRADE SCREEN WAS UNUSABLE. `disabled` is decided at render time, and
// the last render before you tick anybody is the one from choosing the other
// team — when both sides are empty by definition. Ticking players updated state
// and re-evaluated nothing, so Propose stayed disabled forever. The rows even
// highlighted, because that is a CSS :has() rule needing no JavaScript, so every
// visible signal said the selection had registered.
describe('Propose enables as soon as a side is picked', () => {
  const openTrade = () => {
    setup();
    _state.tradeWith = 't2';
    _state.tradeMine = [];
    _state.tradeTheirs = [];
    document.body.innerHTML = render();
  };
  const btn = () => document.querySelector('[data-act="moves-propose"]');

  it('starts disabled with nothing selected', () => {
    openTrade();
    expect(btn().disabled).toBe(true);
  });

  it('enables on the first pick, without a re-render', () => {
    openTrade();
    toggleTradePlayer('mine', 'qb1', true);
    expect(btn().disabled).toBe(false);
  });

  it('enables from either side alone', () => {
    openTrade();
    toggleTradePlayer('theirs', 'rb2', true);
    expect(btn().disabled).toBe(false);
  });

  it('disables again when the last pick is removed', () => {
    openTrade();
    toggleTradePlayer('mine', 'qb1', true);
    toggleTradePlayer('mine', 'qb1', false);
    expect(btn().disabled).toBe(true);
  });

  // ⚠️ It must not re-render. A refresh would destroy the checkbox mid-click and
  // throw away the pick table's scroll position.
  it('does not rebuild the pane', () => {
    openTrade();
    const before = document.querySelector('.pick-table');
    toggleTradePlayer('mine', 'qb1', true);
    expect(document.querySelector('.pick-table')).toBe(before);
  });

  it('is safe with no button on screen', () => {
    document.body.innerHTML = '';
    expect(() => toggleTradePlayer('mine', 'qb1', true)).not.toThrow();
  });
})

// The trade block and the proposal share pickTable, so both get the same
// columns — a bye clash is exactly the kind of thing a trade turns on.
describe('trade tables carry bye and projection', () => {
  const openTrade = () => { setup(); _state.tradeWith = 't2'; };

  it('names Bye and Proj alongside Val', () => {
    openTrade();
    const html = render();
    expect(html).toContain('>Bye<');
    expect(html).toContain('>Proj<');
    expect(html).toContain('>Val<');
  });

  it('gives every row all three cells', () => {
    openTrade();
    const rows = [...parse(render()).querySelectorAll('.pick-table tbody tr')];
    expect(rows.length).toBeGreaterThan(0);
    for (const tr of rows) {
      expect(tr.querySelector('td.bye'), 'no bye cell').toBeTruthy();
      expect(tr.querySelector('td.proj'), 'no proj cell').toBeTruthy();
      expect(tr.querySelector('td.val'), 'no val cell').toBeTruthy();
    }
  });

  // ⚠️ Val and Proj are different quantities and the tooltips must not blur
  // them: Val is season-long and static, Proj is this week's.
  it('distinguishes the season value from the weekly projection', () => {
    openTrade();
    const html = render();
    expect(html).toMatch(/does not change week to week/i);
    expect(html).toMatch(/this week/i);
  });

  it('applies to the trade block too, not only the proposal', () => {
    setup();
    _state.tradeWith = '';
    _state.block = { t1: { players: ['qb1'], picks: [] } };
    const html = render();
    expect(html).toContain('>Bye<');
    expect(html).toContain('>Proj<');
  });
})

// 🔴 A trade in review showed the word "review" and a date. The vote was fully
// implemented — ballots counted, module routing them, button offered — and
// nothing said a vote was running. Reported as wanting "voting on trades like
// other fantasy sites": the league already had it and could not see it.
describe('a trade in review shows its vote', () => {
  // ⚠️ FOUR TEAMS, not the file's default two. Both of the default league's
  // teams are the trading parties, which leaves ZERO eligible voters — a real
  // state (and correctly reported as "no trade can be vetoed"), but not the one
  // these tests are about.
  const fourTeams = () => ({
    t1: { id: 't1', name: 'Alice FC' }, t2: { id: 't2', name: 'Bob United' },
    t3: { id: 't3', name: 'Cara City' }, t4: { id: 't4', name: 'Dee Town' },
  });
  const inReview = (over = {}) => {
    setup();
    _state.league.teams = fourTeams();
    _state.league.settings = { ..._state.league.settings, vetoVotesNeeded: 3 };
    _state.trades = [{
      id: 'x1', status: 'review', parties: ['t1', 't2'], proposedBy: 't1',
      acceptances: { t1: 1, t2: 1 }, vetoes: {}, reviewEndsAt: Date.now() + 8.64e7,
      legs: [{ from: 't1', to: 't2', playerId: 'qb1' }], ...over,
    }];
    return render();
  };

  it('shows the tally and how many more would block it', () => {
    const html = inReview({ vetoes: { t3: 1 } });
    expect(html).toContain('1 of 3');
    expect(html).toMatch(/2 more block this trade/i);
  });

  // ⚠️ The denominator is ELIGIBLE VOTERS — a party cannot veto its own trade,
  // so "of 8 teams" would describe a vote nobody is running.
  it('counts only the teams that may actually vote', () => {
    const html = inReview();
    expect(html).toMatch(/2 teams may vote/i);
    expect(html).toMatch(/everyone except the two trading/i);
  });

  it('names who has voted', () => {
    const html = inReview({ vetoes: { t3: 1 } });
    expect(html).toMatch(/Voted to veto/i);
  });

  // ⚠️ THE SHIPPED DEFAULT IS UNANIMITY IN AN 8-TEAM LEAGUE. Two numbers do not
  // say that; the sentence does.
  it('says so when the threshold means every eligible team', () => {
    setup();
    _state.league.teams = fourTeams();
    _state.league.settings = { ..._state.league.settings, vetoVotesNeeded: 2 };
    _state.trades = [{
      id: 'x2', status: 'review', parties: ['t1', 't2'], proposedBy: 't1',
      acceptances: {}, vetoes: {}, reviewEndsAt: Date.now(), legs: [],
    }];
    expect(render()).toMatch(/every eligible team/i);
  });

  it('says outright when no trade could ever be vetoed', () => {
    setup();
    _state.league.teams = fourTeams();
    _state.league.settings = { ..._state.league.settings, vetoVotesNeeded: 99 };
    _state.trades = [{
      id: 'x3', status: 'review', parties: ['t1', 't2'], proposedBy: 't1',
      acceptances: {}, vetoes: {}, reviewEndsAt: Date.now(), legs: [],
    }];
    expect(render()).toMatch(/No trade can be vetoed/i);
  });

  it('tells a party why it has no vote', () => {
    const html = inReview();
    expect(html).toMatch(/You are in this trade, so you cannot vote/i);
  });

  // ⚠️ vetoTrade refuses a second ballot, so offering the button again offers a
  // refusal.
  it('withdraws the button once you have voted', () => {
    expect(actionsFor({ status: 'review', parties: ['t2'], vetoes: {} }, 't1')).toEqual(['veto']);
    expect(actionsFor({ status: 'review', parties: ['t2'], vetoes: { t1: 1 } }, 't1')).toEqual([]);
  });

  it('shows nothing for a trade that is not in review', () => {
    const html = inReview({ status: 'executed', reviewEndsAt: null });
    expect(html).not.toMatch(/veto votes/i);
  });
})
