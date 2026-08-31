// core/draft-auto.js — who this client should auto-pick for, and with whom.
//
// 🔴 THE 90-SECOND PROBLEM THIS SOLVES. A manager who does not show up costs the
// whole room the full pick clock, every round, because the module only
// autodrafts once the timer EXPIRES. Flagging that team lets a client that is
// already authorised submit the pick immediately instead of waiting it out.
//
// ⚠️ THE COMMISSIONER'S BOARD IS THE DRIVER, and that is deliberate. A browser
// can only act while its tab is open, so a manager's own "auto-draft me" flag
// cannot help once they actually leave — which is the whole case. The
// commissioner is present for the draft by definition, and the signed module
// already lets them pick for any team (`requireTeamControl` returns null for a
// commissioner), so no module change and no owner signature is needed.
//
// ⚠️ TRUST BOUNDARY: these flags live in server-scoped PLUGIN storage, which any
// league member can write. A member could therefore flag someone else's team and
// have the commissioner's board pick for them. That is mischief, not privilege
// escalation — every pick is still authorised server-side against the CLIENT
// submitting it, so no member gains the ability to act as another. Moving the
// flags inside the signed module is what would close it, at the cost of a
// rebuild and a signature.
import { storageGet as hostGet, storageSet as hostSet } from '../../plugin-sdk.js';

export const autoKey = (leagueId) => `fl:autodraft:${leagueId}`;

export function createAutoFlags({ storageGet = hostGet, storageSet = hostSet } = {}) {
  return {
    async load(leagueId) {
      if (!leagueId) return {};
      try {
        const v = await storageGet(autoKey(leagueId), 'server');
        return v && typeof v === 'object' ? v : {};
      } catch {
        // A storage failure must never block a draft.
        return {};
      }
    },
    async save(leagueId, flags) {
      if (!leagueId) return false;
      try {
        await storageSet(autoKey(leagueId), flags ?? {}, 'server');
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * The team this client should auto-pick for right now, or null.
 *
 * Returns null unless the clock is genuinely running, the team on it is flagged,
 * and THIS client is allowed to act for it — a commissioner (any team) or the
 * team's own manager. Without that last check every board in the room would race
 * to submit the same pick.
 */
export function autoPickTarget({ status, clock, flags, isCommissioner, myTeamId }) {
  if (status !== 'active' || !clock) return null;
  const owner = String(clock.owner ?? '');
  if (!owner || !flags?.[owner]) return null;
  if (isCommissioner) return owner;
  return String(myTeamId ?? '') === owner ? owner : null;
}

/**
 * Best available for a team: their own queue first, then the league ranking.
 *
 * ⚠️ THE SAME ORDER THE MODULE USES (`autoPicker` in server/ops-draft.js), so a
 * pick made early by a client and one made late by the expiry cascade choose the
 * same player. Diverging here would make the timing visible in the results.
 */
export function bestAvailableFor({ ranking = [], queue = [], taken = new Set() }) {
  for (const id of queue) if (id != null && !taken.has(String(id))) return String(id);
  for (const id of ranking) if (id != null && !taken.has(String(id))) return String(id);
  return null;
}
