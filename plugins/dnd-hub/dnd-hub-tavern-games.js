// dnd-hub-tavern-games.js — where each tavern game's code lives. Loaded only when a hero sits down to play it.
//
// A game module exports `play(root, ctx)`: it draws itself into `root`, plays, and resolves with
// { won: true | false | 'draw', multiplier?, caught? }. `ctx` is built in dnd-hub-tavern-seat.js (the DM's setup, the
// host, the hero's numbers, `edge` from their stat, `rollD20`, `tryCheat`, `say`, `signal` for walking away, and
// `send`/`onMessage` for games the whole table plays). A new game = a loader here + its id in lk-tavern.js PLAYABLE.

export const GAME_LOADERS = {
  'bones-grid': () => import('./tavern-games/bones-grid.js?v=20261015d'),
  'dagger-toss': () => import('./tavern-games/dagger-toss.js?v=20261015d'),
  'twenty': () => import('./tavern-games/twenty.js?v=20261015d'),
  'arm-wrestle': () => import('./tavern-games/arm-wrestle.js?v=20261015d'),
  'fillet': () => import('./tavern-games/fillet.js?v=20261015d'),
  'hearthlane': () => import('./tavern-games/hearthlane.js?v=20261015d'),
  'rune-dice': () => import('./tavern-games/rune-dice.js?v=20261015d'),
  'bluff-bones': () => import('./tavern-games/bluff-bones.js?v=20261015d'),
  'beetle-derby': () => import('./tavern-games/beetle-derby.js?v=20261015d'),
  'last-standing': () => import('./tavern-games/last-standing.js?v=20261015d'),
};

/** The rules of each whole-table game, which the DM's Hub runs (dnd-hub-tavern-table.js). */
export const TABLE_RULES = {
  'rune-dice': () => import('./tavern-games/rune-dice-rules.js?v=20261015d'),
  'bluff-bones': () => import('./tavern-games/bluff-bones-rules.js?v=20261015d'),
  'beetle-derby': () => import('./tavern-games/beetle-derby-rules.js?v=20261015d'),
  'last-standing': () => import('./tavern-games/last-standing-rules.js?v=20261015d'),
};

export async function loadGame(type) {
  const load = GAME_LOADERS[type];
  if (!load) throw new Error(`No tavern game called ${type}`);
  return load();
}

export async function loadTableRules(type) {
  const load = TABLE_RULES[type];
  if (!load) throw new Error(`No whole-table game called ${type}`);
  return load();
}
