// dnd-player-tavern.js — my purse at the tavern: what my Hub may know of my hero, paying a bet, and winnings.
//
// The gold lives on this sheet, so the sheet pays. My Hub asks (local events, from this screen only):
//   tavern:hero? → I answer tavern:hero with my gold, name, ability modifiers and the skills tavern games use;
//   tavern:pay   → I take the bet + entry fee if I have it, and answer tavern:paid.
// Winnings come from the DM's Hub (tavern:payout, over the network): taken only when the node says the DM sent it.
import { localPublish } from '../plugin-sdk.js';
import { abilityMod, profBonus } from './lk-rules5e.js';

const SKILLS = { 'Sleight of Hand': 'dex', Insight: 'wis', Perception: 'wis', Athletics: 'str', Deception: 'cha' };
const TAVERN_CONDITIONS = new Set(['Poisoned']);
const _paid = new Set(); // payouts already taken (the same event can arrive on two channels)

/** What a tavern game may know of my hero. `eff` is the sheet with items applied (effectiveChar). */
export function heroForTavern(char, eff) {
  const mods = {};
  for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha']) mods[a] = abilityMod(eff?.[a] ?? char?.[a] ?? 10);
  const pb = profBonus(char?.level);
  const skills = {};
  for (const [name, a] of Object.entries(SKILLS)) {
    const prof = (char?.skills || {})[name] || 'none';
    skills[name] = mods[a] + (prof === 'expertise' ? pb * 2 : prof === 'proficient' ? pb : 0);
  }
  return { gold: char?.gold || 0, name: char?.name || '', mods, skills };
}

/**
 * A tavern event for this sheet. `d`: { char, eff, campaignId, userId, dmUserId, save, addItem, toast }.
 * Returns true when it was a tavern event (handled or ignored).
 */
export async function handleTavern(ev, d) {
  const p = ev.data;
  if (!p?.type?.startsWith('tavern:')) return false;
  if (p.campaignId && p.campaignId !== d.campaignId) return true;
  const hub = (type, data) => localPublish('dnd-hub', type, { type, campaignId: d.campaignId, ...data });
  switch (p.type) {
    case 'tavern:hero?':
      if (!ev.sender_id && d.char) hub('tavern:hero', heroForTavern(d.char, d.eff));
      return true;
    case 'tavern:pay': {
      if (ev.sender_id) return true; // only my own Hub may spend my gold
      const amount = Math.max(0, Math.floor(Number(p.amount) || 0));
      if (!d.char) { hub('tavern:paid', { seatId: p.seatId, ok: false, reason: 'Your hero isn\'t loaded yet.' }); return true; }
      if ((d.char.gold || 0) < amount) {
        hub('tavern:paid', { seatId: p.seatId, ok: false, reason: `You need ${amount} gp (you have ${d.char.gold || 0}).` });
        return true;
      }
      d.char.gold = (d.char.gold || 0) - amount;
      await d.save();
      hub('tavern:paid', { seatId: p.seatId, ok: true });
      hub('tavern:hero', heroForTavern(d.char, d.eff));
      return true;
    }
    case 'tavern:condition': {
      // A tavern game left my hero with a condition (only from my own Hub, and only the ones a game may give).
      if (ev.sender_id || !d.char || !TAVERN_CONDITIONS.has(p.condition)) return true;
      const list = (d.char.conditions ||= []);
      if (!list.includes(p.condition)) { list.push(p.condition); await d.save(); d.toast(`🍺 You wake up ${p.condition.toLowerCase()}.`); }
      return true;
    }
    case 'tavern:payout': {
      if (p.userId !== d.userId || !d.char || !ev.sender_id || ev.sender_id !== d.dmUserId) return true;
      if (_paid.has(p.seatId)) return true;
      _paid.add(p.seatId);
      const gold = Math.max(0, Math.floor(Number(p.gold) || 0));
      if (gold) d.char.gold = (d.char.gold || 0) + gold;
      const item = p.itemId ? d.addItem(p.itemId) : null;
      if (gold || item) await d.save();
      if (gold || item) d.toast(`🍺 You won ${gold ? `${gold} gp` : ''}${gold && item ? ' and ' : ''}${item ? item : ''} at the tavern!`);
      return true;
    }
  }
  return true;
}
