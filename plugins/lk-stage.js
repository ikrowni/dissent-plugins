// lk-stage.js — the roleplay stage: up to four NPCs in a talking scene, who is speaking, and the line on screen
// (owner, 2026-10-07; research: 59% of players come for roleplay; Foundry's ConversationHUD / ViNo do this as add-ons).
//
// ⚠️ SOURCE; vendored into dnd-hub (scripts/vendor-shared.mjs). Pure: the whole stage travels in each `stage:set`.

export const MAX_ON_STAGE = 4;
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
let _n = 0;

/** A stage as it may be shown, or null when nobody is on it. */
export function cleanStage(s) {
  const npcs = (Array.isArray(s?.npcs) ? s.npcs : [])
    .map(n => ({ id: str(n?.id, 40), name: str(n?.name, 40) || 'Stranger', portraitFileId: str(n?.portraitFileId, 80) || null }))
    .filter((n, i, all) => n.id && all.findIndex(m => m.id === n.id) === i)
    .slice(0, MAX_ON_STAGE);
  if (!npcs.length) return null;
  const speaker = npcs.some(n => n.id === s.speaker) ? s.speaker : npcs[npcs.length - 1].id;
  const l = s.line;
  const line = l && typeof l.text === 'string' && l.text.trim()
    ? { speaker: npcs.some(n => n.id === l.speaker) ? l.speaker : null, name: str(l.name, 40), text: str(l.text, 500), n: str(String(l.n ?? ''), 40) }
    : null;
  return { npcs, speaker, line };
}

/** Bring an NPC onto the stage (they speak next). Already there, or the stage is full: unchanged but for the speaker. */
export function addToStage(stage, npc) {
  const s = cleanStage(stage) || { npcs: [], speaker: null, line: null };
  const has = s.npcs.some(n => n.id === npc.id);
  if (!has && s.npcs.length >= MAX_ON_STAGE) return s;
  return cleanStage({ ...s, npcs: has ? s.npcs : [...s.npcs, npc], speaker: npc.id });
}

export function removeFromStage(stage, id) {
  const s = cleanStage(stage);
  return s ? cleanStage({ ...s, npcs: s.npcs.filter(n => n.id !== id), speaker: s.speaker === id ? null : s.speaker }) : null;
}

/** A line: said by an NPC on the stage, or narration (`speakerId` null or not on the stage). */
export function speak(stage, speakerId, text) {
  const s = cleanStage(stage);
  if (!s) return null;
  const who = s.npcs.find(n => n.id === speakerId) || null;
  return { ...s, speaker: who ? who.id : s.speaker,
    line: { speaker: who?.id ?? null, name: who?.name ?? '', text: str(text, 500), n: `${Date.now().toString(36)}${(++_n).toString(36)}` } };
}
