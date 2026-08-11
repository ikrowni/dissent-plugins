import { describe, it, expect } from 'vitest';
import {
  matchesFilter, renderBoard, renderOnTheClock, renderFilters, renderPool,
  renderRosterProgress, POOL_FILTERS, picksUntilTurn, renderQueue, roundArrow, rosterNeeds,
} from './draft-board.js';

const INDEX = {
  p1: { n: 'Christian McCaffrey', p: 'RB', t: 'SF', e: 3117251 },
  p2: { n: 'Puka Nacua', p: 'WR', t: 'LAR' },
  p3: { n: 'Josh Allen', p: 'QB', t: 'BUF' },
  p4: { n: 'Travis Kelce', p: 'TE', t: 'KC' },
};
const playerOf = (id) => INDEX[String(id)] ?? null;

// A 4-team snake, 2 rounds — small enough to reason about, big enough to snake.
const teamIds = ['a', 'b', 'c', 'd'];
const order = [
  { overall: 1, round: 1, pickInRound: 1, owner: 'a' },
  { overall: 2, round: 1, pickInRound: 2, owner: 'b' },
  { overall: 3, round: 1, pickInRound: 3, owner: 'c' },
  { overall: 4, round: 1, pickInRound: 4, owner: 'd' },
  { overall: 5, round: 2, pickInRound: 1, owner: 'd' },
  { overall: 6, round: 2, pickInRound: 2, owner: 'c' },
  { overall: 7, round: 2, pickInRound: 3, owner: 'b' },
  { overall: 8, round: 2, pickInRound: 4, owner: 'a' },
];

describe('matchesFilter', () => {
  it('passes everything for ALL', () => {
    expect(matchesFilter('QB', 'ALL')).toBe(true);
    expect(matchesFilter('K', null)).toBe(true);
  });

  it('matches an exact position', () => {
    expect(matchesFilter('QB', 'QB')).toBe(true);
    expect(matchesFilter('RB', 'QB')).toBe(false);
  });

  // ⚠️ FLEX is a slot, not a position — a filter that matched literal "FLEX"
  // would return nobody, because no player has that position.
  it('treats FLEX as RB, WR or TE', () => {
    expect(['RB', 'WR', 'TE'].every((p) => matchesFilter(p, 'FLEX'))).toBe(true);
    expect(matchesFilter('QB', 'FLEX')).toBe(false);
  });

  it('is case-insensitive', () => expect(matchesFilter('qb', 'QB')).toBe(true));
});

describe('renderBoard', () => {
  it('says so rather than drawing an empty grid before the order exists', () => {
    expect(renderBoard({ order: [], teamIds: [] })).toMatch(/appears once/i);
  });

  // ⚠️ THE SNAKE BUG THIS GUARDS. In round two the pick order reverses; placing
  // cells by pick order rather than by OWNER puts every pick under the wrong
  // manager — the board telling you a lie about who picked.
  it('places a snaked pick under its owner, not its pick order', () => {
    const picks = { 5: { playerId: 'p1', teamId: 'd' } };
    const html = renderBoard({ order, picks, teamIds, playerOf });
    const rows = html.split('<div class="db-row">');
    const round2 = rows[rows.length - 1];
    const cells = round2.split('<div class="db-cell');
    // Column order is a,b,c,d — team d is the LAST cell even though it picked first.
    expect(cells[cells.length - 1]).toContain('McCaffrey');
  });

  it('draws a made pick with its player and position colour', () => {
    const html = renderBoard({ order, picks: { 1: { playerId: 'p3', teamId: 'a' } }, teamIds, playerOf });
    expect(html).toContain('Josh Allen');
    expect(html).toContain('QB');
    expect(html).toContain('db-made');
  });

  it('shows the pick number in an empty cell', () => {
    expect(renderBoard({ order, picks: {}, teamIds, playerOf })).toContain('1.01');
  });

  it('marks the cell on the clock', () => {
    const html = renderBoard({ order, picks: {}, teamIds, playerOf, onClock: order[2] });
    expect(html).toContain('db-live');
    expect(html).toContain('On the clock');
  });

  it('marks the viewer’s own column', () => {
    const html = renderBoard({ order, picks: {}, teamIds, playerOf, isMine: (t) => t === 'b' });
    expect(html).toContain('db-mine');
  });

  it('flags an auto pick as one', () => {
    const html = renderBoard({ order, picks: { 1: { playerId: 'p1', teamId: 'a', auto: true } }, teamIds, playerOf });
    expect(html).toContain('db-auto');
  });

  it('falls back to the id rather than blanking an unknown player', () => {
    const html = renderBoard({ order, picks: { 1: { playerId: 'ghost', teamId: 'a' } }, teamIds, playerOf });
    expect(html).toContain('ghost');
  });

  it('escapes a team label rather than injecting it', () => {
    const html = renderBoard({ order, picks: {}, teamIds, playerOf, teamLabel: () => '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});

describe('renderOnTheClock', () => {
  it('names the team that is up', () => {
    const html = renderOnTheClock({ onClock: order[0], teamLabel: () => 'Alice FC' });
    expect(html).toContain('Alice FC');
    expect(html).toContain('Round 1');
  });

  // ⚠️ The single question anybody has in a live draft.
  it('says plainly when it is YOUR turn', () => {
    const html = renderOnTheClock({ onClock: order[0], isMine: () => true });
    expect(html).toMatch(/You are on the clock/i);
    expect(html).toContain('is-me');
  });

  it('reports a finished draft instead of a phantom pick', () => {
    const html = renderOnTheClock({ onClock: null, complete: true });
    expect(html).toMatch(/Draft complete/i);
  });

  it('renders nothing when there is neither a pick nor an ending', () => {
    expect(renderOnTheClock({ onClock: null })).toBe('');
  });
});

describe('renderFilters', () => {
  it('offers every position plus ALL and FLEX', () => {
    const html = renderFilters();
    for (const f of POOL_FILTERS) expect(html).toContain(`data-filter="${f}"`);
  });

  it('marks the active one', () => {
    expect(renderFilters('RB')).toContain('aria-selected="true"');
  });

  it('shows counts when given them', () => {
    expect(renderFilters('ALL', { QB: 14 })).toContain('14');
  });
});

describe('renderPool', () => {
  const available = [
    { id: 'p1', pos: 'RB', rank: 1 },
    { id: 'p2', pos: 'WR', rank: 2 },
  ];

  it('lists players with their rank', () => {
    const html = renderPool({ available, playerOf });
    expect(html).toContain('McCaffrey');
    expect(html).toContain('>1<');
  });

  // ⚠️ A Draft button on somebody else's turn is an invitation to a refusal.
  it('offers no draft button when it is not your pick', () => {
    expect(renderPool({ available, playerOf, canPick: false })).not.toContain('draft-take');
    expect(renderPool({ available, playerOf, canPick: true })).toContain('draft-take');
  });

  it('says the board is empty rather than rendering nothing', () => {
    expect(renderPool({ available: [], emptyText: 'The draft is over.' })).toContain('The draft is over.');
  });

  it('caps the list and says how many more there are', () => {
    const many = Array.from({ length: 90 }, (_, i) => ({ id: `x${i}`, pos: 'WR', rank: i + 1 }));
    expect(renderPool({ available: many, playerOf, limit: 60 })).toContain('30 more');
  });
});

describe('renderRosterProgress', () => {
  const slots = ['QB', 'RB', 'RB', 'WR', 'TE', 'FLEX'];

  it('shows every slot, filled or not', () => {
    const html = renderRosterProgress({ slots, owned: [], playerOf });
    expect((html.match(/db-slot-tag/g) ?? []).length).toBe(slots.length);
    expect(html).toContain('db-slot-empty');
  });

  it('drops a player into their own slot', () => {
    const html = renderRosterProgress({ slots, owned: [{ id: 'p3', pos: 'QB' }], playerOf });
    expect(html).toContain('Josh Allen');
    expect(html).toContain('filled');
  });

  // ⚠️ A spare skill player belongs in FLEX, not on the bench, or the screen
  // says a manager still needs a flex they already have a body for.
  it('puts a spare running back in the flex', () => {
    const html = renderRosterProgress({
      slots, owned: [{ id: 'p1', pos: 'RB' }, { id: 'p1', pos: 'RB' }, { id: 'p2', pos: 'WR' }], playerOf,
    });
    expect(html).not.toContain('db-bench');
  });

  it('benches whatever is left over and counts it', () => {
    const owned = Array.from({ length: 9 }, () => ({ id: 'p3', pos: 'QB' }));
    const html = renderRosterProgress({ slots, owned, playerOf });
    expect(html).toContain('db-bench');
    expect(html).toContain('8 on the bench');
  });
});

// --- Wave 1: the draft queue -------------------------------------------------

describe('picksUntilTurn', () => {
  const q = [
    { overall: 1, round: 1, pickInRound: 1, owner: 'a' },
    { overall: 2, round: 1, pickInRound: 2, owner: 'b' },
    { overall: 3, round: 1, pickInRound: 3, owner: 'c' },
    { overall: 4, round: 2, pickInRound: 1, owner: 'c' },
  ];

  it('counts the picks before my next one', () => {
    expect(picksUntilTurn(q, {}, 'c')).toBe(2);
  });

  it('is 0 when I am on the clock', () => {
    expect(picksUntilTurn(q, {}, 'a')).toBe(0);
  });

  it('skips picks already made', () => {
    expect(picksUntilTurn(q, { 1: { playerId: 'p1' } }, 'c')).toBe(1);
  });

  it('is null when I have no pick left', () => {
    expect(picksUntilTurn(q, { 1: {}, 2: {}, 3: {}, 4: {} }, 'c')).toBe(null);
  });

  it('is null without a team', () => {
    expect(picksUntilTurn(q, {}, null)).toBe(null);
  });
});

describe('renderQueue', () => {
  it('lists queued players in order', () => {
    const html = renderQueue({ queue: ['p1', 'p2'], playerOf });
    expect(html.indexOf('McCaffrey')).toBeLessThan(html.indexOf('Nacua'));
  });

  it('carries the count', () => {
    expect(renderQueue({ queue: ['p1', 'p2'], playerOf })).toContain('QUEUE (2)');
  });

  it('draws the divider after the picks that land first', () => {
    const html = renderQueue({ queue: ['p1', 'p2', 'p3'], playerOf, untilTurn: 2 });
    const divider = html.indexOf('NEXT PICK');
    expect(divider).toBeGreaterThan(html.indexOf('Nacua'));
    expect(divider).toBeLessThan(html.indexOf('Allen'));
  });

  // Matches the live capture: pre-draft, nothing has been picked, so the
  // divider sits at the very top of the queue.
  it('puts the divider on top when on the clock', () => {
    const html = renderQueue({ queue: ['p1'], playerOf, untilTurn: 0 });
    expect(html.indexOf('NEXT PICK')).toBeLessThan(html.indexOf('McCaffrey'));
  });

  it('omits the divider when there is no next turn', () => {
    expect(renderQueue({ queue: ['p1'], playerOf, untilTurn: null })).not.toContain('NEXT PICK');
  });

  it('omits the divider when the queue cannot reach it', () => {
    expect(renderQueue({ queue: ['p1'], playerOf, untilTurn: 5 })).not.toContain('NEXT PICK');
  });

  it('shows an empty state', () => {
    expect(renderQueue({ queue: [], playerOf })).toContain('Queue is empty');
  });

  it('only offers edit controls when the manager owns a team', () => {
    expect(renderQueue({ queue: ['p1'], playerOf, canEdit: false })).not.toContain('draft-queue-remove');
    expect(renderQueue({ queue: ['p1'], playerOf, canEdit: true })).toContain('draft-queue-remove');
  });

  it('escapes player ids into the action attributes', () => {
    const html = renderQueue({ queue: ['"><img>'], playerOf: () => null, canEdit: true });
    expect(html).not.toContain('<img>');
  });
});

describe('roundArrow', () => {
  const cols = new Map([['a', 0], ['b', 1], ['c', 2], ['d', 3]]);

  it('points right on a left-to-right round', () => {
    expect(roundArrow(order, 1, cols)).toBe('→');
  });

  it('points left on a snapped-back round', () => {
    expect(roundArrow(order, 2, cols)).toBe('←');
  });

  it('is blank when a round has a single pick', () => {
    expect(roundArrow([order[0]], 1, cols)).toBe('');
  });

  it('is blank when a column is unknown', () => {
    expect(roundArrow(order, 1, new Map())).toBe('');
  });

  // Derived from the ORDER, so a linear draft reads left-to-right every round
  // without this function knowing draft types exist.
  it('reads a linear draft as always rightward', () => {
    const linear = [
      { overall: 1, round: 1, pickInRound: 1, owner: 'a' },
      { overall: 2, round: 1, pickInRound: 2, owner: 'b' },
      { overall: 3, round: 2, pickInRound: 1, owner: 'a' },
      { overall: 4, round: 2, pickInRound: 2, owner: 'b' },
    ];
    expect(roundArrow(linear, 1, cols)).toBe('→');
    expect(roundArrow(linear, 2, cols)).toBe('→');
  });
});

describe('board direction arrows', () => {
  it('draws an arrow in every cell, not just the round label', () => {
    const html = renderBoard({ order, picks: {}, teamIds, playerOf });
    // 4 teams x 2 rounds = 8 cells, each carrying its round's arrow.
    expect((html.match(/db-dir/g) ?? []).length).toBe(8);
  });
});

describe('rosterNeeds', () => {
  it('counts rostered players over starting slots', () => {
    const need = rosterNeeds({ slots: ['QB', 'RB', 'RB'], owned: [{ pos: 'RB' }] });
    expect(need.QB).toEqual({ have: 0, slots: 1 });
    expect(need.RB).toEqual({ have: 1, slots: 2 });
  });

  // ⚠️ The correction from the live draft: Sleeper shows RB 4/2, not RB 2/2.
  it('runs over the slot count instead of capping', () => {
    const need = rosterNeeds({
      slots: ['RB', 'RB'],
      owned: [{ pos: 'RB' }, { pos: 'RB' }, { pos: 'RB' }, { pos: 'RB' }],
    });
    expect(need.RB).toEqual({ have: 4, slots: 2 });
  });

  it('does not let FLEX steal a player from their own position', () => {
    const need = rosterNeeds({ slots: ['RB', 'FLEX'], owned: [{ pos: 'RB' }, { pos: 'WR' }] });
    expect(need.RB.have).toBe(1);
    expect(need.WR.have).toBe(1);
    expect(need.FLEX.slots).toBe(1);
  });

  it('reports ALL as roster size over every slot including bench', () => {
    const need = rosterNeeds({ slots: ['QB', 'RB', 'BN'], owned: [{ pos: 'QB' }, { pos: 'RB' }] });
    expect(need.ALL).toEqual({ have: 2, slots: 3 });
  });

  it('excludes bench slots from position counts', () => {
    expect(rosterNeeds({ slots: ['BN', 'IR', 'TAXI'], owned: [] }).BN).toBeUndefined();
  });

  it('is empty-safe', () => {
    expect(rosterNeeds().ALL).toEqual({ have: 0, slots: 0 });
  });
});

describe('renderFilters with roster needs', () => {
  it('shows have/slots beside the availability count', () => {
    const html = renderFilters('ALL', { RB: 41 }, { RB: { have: 4, slots: 2 } });
    expect(html).toContain('4/2');
    expect(html).toContain('41');
  });

  it('omits the need when none is supplied, keeping the old behaviour', () => {
    expect(renderFilters('ALL', { RB: 41 })).not.toContain('db-filter-need');
  });
});

// ⚠️ views/draft-board.js carried its OWN copy of the flex rule and matched only
// the literal 'FLEX', so a SUPER_FLEX slot looked for a player whose POSITION
// was "SUPER_FLEX" — nobody — and rendered permanently empty in a superflex
// league. slots.js has always known better.
describe('flex variants in the roster strip', () => {
  const idx = { q: { n: 'Quinn', p: 'QB' }, r: { n: 'Ray', p: 'RB' } };
  const of = (id) => idx[id] ?? null;

  it('fills a SUPER_FLEX with a QB', () => {
    const html = renderRosterProgress({
      slots: ['SUPER_FLEX'], owned: [{ id: 'q', pos: 'QB' }], playerOf: of,
    });
    expect(html).toContain('Quinn');
  });

  it('fills a WRRB_FLEX with an RB', () => {
    const html = renderRosterProgress({
      slots: ['WRRB_FLEX'], owned: [{ id: 'r', pos: 'RB' }], playerOf: of,
    });
    expect(html).toContain('Ray');
  });

  it('leaves a REC_FLEX empty for an RB', () => {
    const html = renderRosterProgress({
      slots: ['REC_FLEX'], owned: [{ id: 'r', pos: 'RB' }], playerOf: of,
    });
    expect(html).not.toContain('Ray');
  });
});
