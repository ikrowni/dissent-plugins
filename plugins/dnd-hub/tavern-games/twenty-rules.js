// twenty-rules.js — Twenty without the drawing: decks, totals, sets, and how the host plays.
//
// A set: turn about, each player is dealt a card from the shared deck (1–10, four of each) onto their table. After it,
// they may play ONE card from their side deck (+n, −n, or ±n where they pick the sign), then end the turn or stand.
// Over 20 at the end of your turn is a bust (the set is lost); nine cards without busting wins the set outright.
// When both stand, the closer to 20 takes the set. First to two sets wins; side cards are spent for the whole game.

export const TARGET = 20, MAX_CARDS = 9, SETS_TO_WIN = 2, MAX_SETS = 5;

export function newDeck(rng = Math.random) {
  const d = [];
  for (let v = 1; v <= 10; v++) for (let k = 0; k < 4; k++) d.push(v);
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

/** A side deck of `n` cards: { v } with v ±1..6, or { flip: n } (±1..3, sign chosen when played). */
export function sideDeck(n, rng = Math.random) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = rng();
    if (r < 0.2) out.push({ flip: 1 + Math.floor(rng() * 3) });
    else out.push({ v: (r < 0.6 ? 1 : -1) * (1 + Math.floor(rng() * 6)) });
  }
  return out;
}

/** How many side cards a hero gets from their stat edge (-1..1). The host always has four. */
export const sideCount = edge => (edge >= 0.9 ? 6 : edge >= 0.4 ? 5 : edge <= -0.4 ? 3 : 4);

export const total = table => table.reduce((t, c) => t + c, 0);
export const sideValue = (card, sign = 1) => (card.flip ? card.flip * (sign < 0 ? -1 : 1) : card.v);

/**
 * Who takes the set, once it is over: 'hero', 'host', 'draw', or null while it goes on.
 * Each side: { table: [values], stood, bust }.
 */
export function setResult(hero, host) {
  if (hero.bust) return 'host';
  if (host.bust) return 'hero';
  if (hero.table.length >= MAX_CARDS) return 'hero';
  if (host.table.length >= MAX_CARDS) return 'host';
  if (!hero.stood || !host.stood) return null;
  const a = total(hero.table), b = total(host.table);
  return a > b ? 'hero' : b > a ? 'host' : 'draw';
}

/**
 * The host's play after being dealt a card: { side: index | null, sign, stand }. `me` is the host's side, `them` the
 * hero's, `hand` the host's side cards left. Novices stand early and often; sharks watch what the hero stood on.
 */
export function hostPlay(me, them, hand, skill = 'regular', rng = Math.random) {
  const t = total(me.table);
  const options = [];
  hand.forEach((c, i) => { for (const sign of c.flip ? [1, -1] : [1]) options.push({ side: i, sign, t: t + sideValue(c, sign) }); });
  const best = list => list.sort((a, b) => b.t - a.t)[0];
  const theirs = them.stood && !them.bust ? total(them.table) : null;
  if (t > TARGET) {
    const save = best(options.filter(o => o.t <= TARGET));
    return save ? { side: save.side, sign: save.sign, stand: save.t >= 17 || (theirs != null && save.t > theirs) } : { side: null, sign: 1, stand: true };
  }
  if (t === TARGET) return { side: null, sign: 1, stand: true };
  const exact = options.find(o => o.t === TARGET);
  if (exact && (skill !== 'novice' || rng() < 0.5) && (t >= 14 || skill === 'shark')) return { ...exact, stand: true };
  if (theirs != null) {
    if (t > theirs) return { side: null, sign: 1, stand: true };
    const beat = best(options.filter(o => o.t > theirs && o.t <= TARGET));
    if (beat && (skill !== 'novice')) return { side: beat.side, sign: beat.sign, stand: true };
    if (t === theirs && t >= 17) return { side: null, sign: 1, stand: true };
    return { side: null, sign: 1, stand: false };
  }
  const standAt = skill === 'novice' ? 15 + Math.floor(rng() * 3) : skill === 'shark' ? 18 : 17;
  return { side: null, sign: 1, stand: t >= standAt };
}

/** The game's winner from sets won: 'hero', 'host', 'draw', or null while it goes on. */
export function gameResult(sets, played) {
  if (sets.hero >= SETS_TO_WIN) return 'hero';
  if (sets.host >= SETS_TO_WIN) return 'host';
  if (played >= MAX_SETS) return sets.hero > sets.host ? 'hero' : sets.host > sets.hero ? 'host' : 'draw';
  return null;
}
