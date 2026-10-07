// lk-safety.js — the table's safety tools: lines and veils, and the X (owner, 2026-10-07; research: standard at many
// tables, and online play hides the body language a DM reads at a real table).
//
// ⚠️ SOURCE; vendored into dnd-hub (scripts/vendor-shared.mjs).
//
// A LINE is something that does not happen in this game. A VEIL may happen, off-screen ("fade to black"). Each player
// sets theirs privately; the table sees only the combined list, never who asked for what. The X says "let's move on
// from this" with no reason and no name.

/** Common topics, in original words. A player can add their own, too. */
export const TOPICS = [
  { id: 'spiders', name: 'Spiders and insects' },
  { id: 'gore', name: 'Gore' },
  { id: 'torture', name: 'Torture' },
  { id: 'children', name: 'Harm to children' },
  { id: 'animals', name: 'Harm to animals' },
  { id: 'sexual', name: 'Sexual content' },
  { id: 'romance', name: 'Romance between characters' },
  { id: 'slavery', name: 'Slavery' },
  { id: 'self-harm', name: 'Self-harm and suicide' },
  { id: 'abuse', name: 'Abuse in relationships' },
  { id: 'body-horror', name: 'Body horror' },
  { id: 'drowning', name: 'Drowning and tight spaces' },
  { id: 'fire', name: 'Burning' },
  { id: 'addiction', name: 'Drink and drug addiction' },
  { id: 'bigotry', name: 'Real-world bigotry' },
  { id: 'pregnancy', name: 'Pregnancy and its loss' },
];
const NAME = Object.fromEntries(TOPICS.map(t => [t.id, t.name]));
const KINDS = new Set(['line', 'veil']);
export const MAX_CUSTOM = 5;
export const X_COOLDOWN_MS = 15000;

/** A player's own picks as they may be stored: known topics set to line or veil, up to five of their own. */
export function cleanPicks(p) {
  const topics = {};
  for (const [id, kind] of Object.entries(p?.topics || {})) if (NAME[id] && KINDS.has(kind)) topics[id] = kind;
  const custom = (Array.isArray(p?.custom) ? p.custom : [])
    .map(c => ({ text: String(c?.text ?? '').trim().slice(0, 60), kind: c?.kind }))
    .filter(c => c.text && KINDS.has(c.kind))
    .slice(0, MAX_CUSTOM);
  return { topics, custom };
}

/** Everyone's picks → the table's list, with no names: `{ lines, veils }`, sorted. A line beats a veil. */
export function combine(byUser) {
  const kind = new Map(); // lower-case text → { text, kind }
  const add = (text, k) => {
    const key = text.toLowerCase(), had = kind.get(key);
    if (!had || (k === 'line' && had.kind === 'veil')) kind.set(key, { text: had?.text ?? text, kind: had?.kind === 'line' ? 'line' : k });
  };
  for (const raw of Object.values(byUser || {})) {
    const p = cleanPicks(raw);
    for (const [id, k] of Object.entries(p.topics)) add(NAME[id], k);
    for (const c of p.custom) add(c.text, c.kind);
  }
  const all = [...kind.values()];
  const sorted = k => all.filter(x => x.kind === k).map(x => x.text).sort((a, b) => a.localeCompare(b));
  return { lines: sorted('line'), veils: sorted('veil') };
}
