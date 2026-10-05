// dnd-master-levels.js — the DM levels heroes up (milestone) or gives XP (experience). The campaign record is the
// authority (spec 2026-10-03 growing your hero §2); every screen hears level:grant.
import { publishTo } from './lk-bus.js';
import { EV } from './dnd-hub-event-types.js?v=20261014k';
import { saveHubDmCompanion } from './dnd-hub-shared-storage.js';
import { rule } from './lk-table-rules.js';
import { allowedLevel, xpShare } from './lk-levelling.js';

let _s = { dmCampaign: null, dmCampaignId: null, serverData: null, userId: null, onChange: null };
export function setLevelsState(s) { _s = { ..._s, ...s }; }
const byXp = () => rule(_s.dmCampaign?.settings, 'levelByXp');

async function commit(levels, xp) {
  const c = _s.dmCampaign;
  if (levels) c.levels = { ...(c.levels || {}), ...levels };
  if (xp) c.xp = { ...(c.xp || {}), ...xp };
  _s.serverData.campaigns[_s.dmCampaignId] = c;
  await saveHubDmCompanion(_s.serverData);
  await publishTo(['hub', 'player'], EV.LEVEL_GRANT, { type: EV.LEVEL_GRANT, campaignId: _s.dmCampaignId, levels, xp, fromUserId: _s.userId });
  _s.onChange?.();
}

/** Milestone: one more level than each hero may reach now. */
export async function levelUpHeroes(uids) {
  const c = _s.dmCampaign, sums = c.characterSummaries || {};
  const levels = {};
  for (const uid of uids) {
    const s = sums[uid];
    if (!s) continue;
    levels[uid] = Math.min(20, allowedLevel(c, uid, s, false) + 1);
  }
  if (Object.keys(levels).length) await commit(levels, null);
}
export const levelUpParty = () => levelUpHeroes(Object.keys(_s.dmCampaign?.characterSummaries || {}));

/** Experience: add `amount` to each hero's XP. */
export async function giveXp(uids, amount) {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  if (!n || !uids.length) return;
  const c = _s.dmCampaign, xp = {};
  for (const uid of uids) xp[uid] = (c.xp?.[uid] ?? c.characterSummaries?.[uid]?.xp ?? 0) + n;
  await commit(null, xp);
}

/** After a fight (experience mode): offer the defeated monsters' XP to the heroes who fought. */
export async function fightXp(order) {
  if (!byXp()) return;
  const players = (order || []).filter(c => c.type === 'player' && c.userId).map(c => c.userId);
  const total = (order || []).filter(c => c.type === 'monster' && (c.hp ?? 1) <= 0).reduce((a, m) => a + (m.xp || 0), 0);
  if (!players.length) return;
  const answer = prompt(`Experience for this fight, shared by ${players.length} hero${players.length === 1 ? '' : 'es'}:`, String(total));
  if (answer === null) return;
  const share = xpShare(Number(answer) || 0, players);
  const c = _s.dmCampaign, xp = {};
  for (const [uid, n] of Object.entries(share)) xp[uid] = (c.xp?.[uid] ?? c.characterSummaries?.[uid]?.xp ?? 0) + n;
  await commit(null, xp);
}

/** For the party panel: is a level waiting for this hero? */
export function levelWaiting(uid) {
  const c = _s.dmCampaign, s = c?.characterSummaries?.[uid];
  return !!s && allowedLevel(c, uid, s, byXp()) > (s.level || 1);
}
export { byXp as levellingByXp };
