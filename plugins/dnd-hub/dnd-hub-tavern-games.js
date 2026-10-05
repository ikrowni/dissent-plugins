// dnd-hub-tavern-games.js — where each tavern game's code lives. Loaded only when a hero sits down to play it.
//
// A game module exports `play(root, ctx)`: it draws itself into `root`, plays, and resolves with
// { won: true | false | 'draw', multiplier?, caught? }. `ctx` is built in dnd-hub-tavern-seat.js (the DM's setup, the
// host, the hero's numbers, `edge` from their stat, `rollD20`, `tryCheat`, `say`, `signal` for walking away, and
// `send`/`onMessage` for games the whole table plays). A new game = a loader here + its id in lk-tavern.js PLAYABLE.

export const GAME_LOADERS = {
  'bones-grid': () => import('./tavern-games/bones-grid.js?v=20261014e'),
};

export async function loadGame(type) {
  const load = GAME_LOADERS[type];
  if (!load) throw new Error(`No tavern game called ${type}`);
  return load();
}
