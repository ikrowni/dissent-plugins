// dnd-hub-tavern-table.js — whole-table games on the DM's Hub: one table runner per host (tavern-games/table-runner.js).
//
// The house (dnd-hub-tavern-ref.js) seats a hero and hands the seat here; the runner keeps a lobby open for a few
// seconds so others can sit down, then plays the game with every hero there plus the host's NPCs, and settles each
// seat itself (a hero's screen never reports a whole-table result). Its state goes to every Hub as `tavern:game`.
import { MAP } from './dnd-hub-state.js?v=20261015l';
import { publishTo } from './lk-bus.js';
import { createTableRunner } from './tavern-games/table-runner.js?v=20261015l';
import { loadTableRules } from './dnd-hub-tavern-games.js?v=20261015l';

const _tables = new Map(); // hostId → runner

/** The runner at `host`'s table: the open lobby, the game under way, or a new lobby. */
export async function tableFor(host, setup, actor, settle) {
  const t = _tables.get(host.id);
  if (t && t.phase !== 'done') return t;
  const rules = await loadTableRules(setup.type);
  const runner = createTableRunner({
    rules, setup, host, actor, settle,
    broadcast: data => publishTo([], 'tavern:game', { type: 'tavern:game', campaignId: MAP.campaignId, hostId: host.id, data }),
  });
  _tables.set(host.id, runner);
  return runner;
}

export const tableAt = hostId => {
  const t = _tables.get(hostId);
  return t && t.phase !== 'done' ? t : null;
};

export function closeTables() {
  for (const t of _tables.values()) t.close();
  _tables.clear();
}
