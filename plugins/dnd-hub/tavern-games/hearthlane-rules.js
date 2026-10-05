// hearthlane-rules.js — Hearthlane without the drawing: the cards, the lanes, playing, scoring, and the host's play.
//
// Three lanes across the hearth. Each side plays PLAYS cards in turn (the hero first), drawing back up after each.
// A lane holds up to three of a side's units. When all cards are down, each lane goes to the stronger side; take two
// lanes to win (a 1–1 split, or no lanes at all, goes to the higher total power).

export const PLAYS = 5, LANES = 3, LANE_CAP = 3;

export const CARDS = {
  peasant: { name: 'Peasant', power: 1, icon: 'footprints', text: '' },
  archer: { name: 'Archer', power: 2, icon: 'target', text: '' },
  squire: { name: 'Squire', power: 3, icon: 'shield', text: '' },
  knight: { name: 'Knight', power: 5, icon: 'sword', text: '' },
  ogre: { name: 'Ogre', power: 7, icon: 'skull', text: '' },
  bard: { name: 'Bard', power: 1, icon: 'music', text: '+1 to every ally in this lane' },
  rogue: { name: 'Rogue', power: 2, icon: 'swords', text: 'Kills the weakest foe in this lane' },
  storm: { name: 'Storm', power: 0, icon: 'cloud-rain', text: 'Spell: every unit in this lane is worth 1', spell: true },
};
const DECK = ['peasant', 'peasant', 'peasant', 'archer', 'archer', 'archer', 'squire', 'squire', 'knight', 'knight', 'ogre', 'bard', 'rogue', 'storm'];

/** Cards in hand from the stat edge (-1..1); the host holds five. */
export const handSize = edge => (edge >= 0.9 ? 7 : edge >= 0.4 ? 6 : edge <= -0.4 ? 4 : 5);

export function newSide(rng, hand) {
  const deck = [...DECK];
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return { deck, hand: deck.splice(0, hand), lanes: [[], [], []], storms: [false, false, false] };
}

export function newGame(rng = Math.random, heroHand = 5) {
  return { hero: newSide(rng, heroHand), host: newSide(rng, 5), turn: 'hero', plays: { hero: 0, host: 0 } };
}

const other = side => (side === 'hero' ? 'host' : 'hero');

/** A unit's worth in a lane: 1 under a storm, plus 1 for every OTHER bard beside it. */
export function lanePower(state, side, lane) {
  const units = state[side].lanes[lane], storm = state.hero.storms[lane] || state.host.storms[lane];
  const bards = units.filter(u => u === 'bard').length;
  return units.reduce((t, u) => t + (storm ? 1 : CARDS[u].power) + (bards - (u === 'bard' ? 1 : 0)), 0);
}

/** Where card `i` of `side`'s hand may go. */
export function legalLanes(state, side, i) {
  const card = CARDS[state[side].hand[i]];
  if (!card) return [];
  return [0, 1, 2].filter(l => card.spell || state[side].lanes[l].length < LANE_CAP);
}

/** Play card `i` into `lane`; returns a new state (the side draws back up and the turn passes). */
export function play(state, side, i, lane) {
  if (state.turn !== side) throw new Error('Not your turn.');
  if (!legalLanes(state, side, i).includes(lane)) throw new Error('That lane is full.');
  const s = structuredClone(state);
  const me = s[side], foe = s[other(side)];
  const id = me.hand.splice(i, 1)[0];
  if (CARDS[id].spell) { me.storms[lane] = true; }
  else {
    me.lanes[lane].push(id);
    if (id === 'rogue' && foe.lanes[lane].length) {
      const worth = u => (me.storms[lane] || foe.storms[lane] ? 1 : CARDS[u].power);
      let weakest = 0;
      foe.lanes[lane].forEach((u, k) => { if (worth(u) < worth(foe.lanes[lane][weakest])) weakest = k; });
      foe.lanes[lane].splice(weakest, 1);
    }
  }
  if (me.deck.length) me.hand.push(me.deck.shift());
  s.plays[side]++;
  s.turn = other(side);
  return s;
}

export const over = state => state.plays.hero >= PLAYS && state.plays.host >= PLAYS;

/** Each lane's winner ('hero' | 'host' | null) and the game's ('hero' | 'host' | 'draw'). */
export function score(state) {
  const lanes = [0, 1, 2].map(l => { const a = lanePower(state, 'hero', l), b = lanePower(state, 'host', l); return a > b ? 'hero' : b > a ? 'host' : null; });
  const won = { hero: lanes.filter(x => x === 'hero').length, host: lanes.filter(x => x === 'host').length };
  let winner = won.hero >= 2 ? 'hero' : won.host >= 2 ? 'host' : null;
  if (!winner) {
    const tot = side => [0, 1, 2].reduce((t, l) => t + lanePower(state, side, l), 0);
    winner = won.hero > won.host ? 'hero' : won.host > won.hero ? 'host' : tot('hero') > tot('host') ? 'hero' : tot('host') > tot('hero') ? 'host' : 'draw';
  }
  return { lanes, winner };
}

/** How good the board is for `side`: lanes held count for a lot, margins a little. */
export function evaluate(state, side) {
  let v = 0;
  for (let l = 0; l < LANES; l++) {
    const d = lanePower(state, side, l) - lanePower(state, other(side), l);
    v += Math.max(-4, Math.min(4, d)) + (d > 0 ? 3 : d < 0 ? -3 : 0);
  }
  return v;
}

const moves = (state, side) => state[side].hand.flatMap((_, i) => legalLanes(state, side, i).map(lane => ({ i, lane })));

/** The host's move: a novice is often careless; a shark also weighs the hero's best answer. */
export function hostMove(state, skill = 'regular', rng = Math.random) {
  const list = moves(state, 'host');
  if (!list.length) return null;
  if (skill === 'novice' && rng() < 0.5) return list[Math.floor(rng() * list.length)];
  let best = list[0], bestV = -Infinity;
  for (const m of list) {
    const after = play(state, 'host', m.i, m.lane);
    let v = evaluate(after, 'host');
    if (skill === 'shark' && after.plays.hero < PLAYS) {
      const replies = moves(after, 'hero');
      if (replies.length) v -= 0.6 * Math.max(...replies.map(r => evaluate(play(after, 'hero', r.i, r.lane), 'hero')));
    }
    v += rng() * 0.01;
    if (v > bestV) { bestV = v; best = m; }
  }
  return best;
}
