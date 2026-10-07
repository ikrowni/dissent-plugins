// lk-prep.js — the DM's session prep board: eight short steps that keep prep to what a session needs (owner,
// 2026-10-07; research: DM burnout ends campaigns; the eight-step method is Sly Flourish's, the wording here is ours).
//
// ⚠️ SOURCE; vendored into dnd-master (scripts/vendor-shared.mjs). The board is DM-only (`campaign.prep`, a secret in
// lk-secrets.js). Pure.

export const PREP_STEPS = [
  { id: 'heroes', name: 'The heroes', hint: 'Who they are and what they want. (Read from the party.)' },
  { id: 'start', name: 'Strong start', hint: 'Open with something happening.' },
  { id: 'scenes', name: 'Possible scenes', hint: 'A few things that might happen. Tick them as they do.' },
  { id: 'clues', name: 'Secrets and clues', hint: 'Short truths the heroes can find anywhere. Tick each one found.' },
  { id: 'places', name: 'Places', hint: 'Where it may happen, with one striking detail each.' },
  { id: 'npcs', name: 'NPCs', hint: 'Who they may meet.' },
  { id: 'monsters', name: 'Monsters', hint: 'What they may fight.' },
  { id: 'treasure', name: 'Treasure', hint: 'What they may find.' },
];
export const LISTS = ['scenes', 'clues', 'places', 'npcs', 'monsters', 'treasure'];
const MAX_LINES = 30;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
let _n = 0;
const newId = () => `${Date.now().toString(36)}${(++_n).toString(36)}`;

/** A board as it may be stored. `ref` points a line at the real thing ('actor:<id>', 'item:<id>'). */
export function cleanPrep(p) {
  const lists = {};
  for (const k of LISTS) {
    lists[k] = (Array.isArray(p?.lists?.[k]) ? p.lists[k] : [])
      .map(l => ({ id: str(l?.id, 40), text: str(l?.text, 200), done: !!l?.done, ref: str(l?.ref, 60) || null }))
      .filter(l => l.id && l.text)
      .slice(0, MAX_LINES);
  }
  return { start: str(p?.start, 500), lists };
}

export function addLine(prep, list, text, ref = null) {
  const p = cleanPrep(prep);
  if (!LISTS.includes(list) || !str(text, 200)) return p;
  p.lists[list] = [...p.lists[list], { id: newId(), text, ref }];
  return cleanPrep(p);
}

export function toggleLine(prep, list, id) {
  const p = cleanPrep(prep);
  if (p.lists[list]) p.lists[list] = p.lists[list].map(l => (l.id === id ? { ...l, done: !l.done } : l));
  return p;
}

export function removeLine(prep, list, id) {
  const p = cleanPrep(prep);
  if (p.lists[list]) p.lists[list] = p.lists[list].filter(l => l.id !== id);
  return p;
}

/** Ready for next session: found clues and played scenes go, the strong start empties, everything else stays unticked. */
export function clearDone(prep) {
  const p = cleanPrep(prep);
  p.start = '';
  for (const k of LISTS) {
    p.lists[k] = (k === 'clues' || k === 'scenes') ? p.lists[k].filter(l => !l.done) : p.lists[k].map(l => ({ ...l, done: false }));
  }
  return p;
}

export function prepCounts(prep) {
  const c = cleanPrep(prep).lists.clues;
  return { clues: c.length, found: c.filter(l => l.done).length };
}
