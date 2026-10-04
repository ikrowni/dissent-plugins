// book-merge.js — two readings of a scanned book's monsters made into one. Pure.
//
// A scan is read twice: our own OCR (book-ocr.js, clean columns and names) and the scan's own text layer (often
// right about a number row OCR garbled, and the other way round). The same creature is found in both by its page
// and its Armor Class + Hit Points (or its name); the OCR reading is kept, and whatever it lacks is taken from the
// other. A creature only the scan's own text found is kept too.
import { withProblems, slug } from './book-monsters.js';

const ABIL = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const LISTS = ['special_abilities', 'actions', 'reactions', 'legendary_actions', 'saving_throws', 'skills',
  'damage_resistances', 'damage_immunities', 'damage_vulnerabilities', 'condition_immunities'];

// Same page (or the next), and the same Armor Class with Hit Points and challenge agreeing where both were read
// (a reading that lost the HP still matches: Pidlwick II came out twice otherwise), or the same name.
const agree = (x, y) => x == null || y == null || x === y;
const same = (a, b) => Math.abs((a.page ?? 0) - (b.page ?? 0)) <= 1
  && ((a.ac != null && a.ac === b.ac && agree(a.hp, b.hp) && agree(a.cr, b.cr) && (a.hp != null || b.hp != null || a.cr != null))
    || (!a.unnamed && !b.unnamed && slug(a.name) === slug(b.name)));

/** `primary` (OCR) filled in from `secondary` (the scan's own text). Secondary-only finds have `lines: null`. */
export function mergeReadings(primary, secondary) {
  const used = new Set();
  const out = primary.map(a => {
    const b = secondary.find((x, k) => !used.has(k) && same(a, x));
    if (!b) return a;
    used.add(secondary.indexOf(b));
    const m = { ...a };
    if ((m.unnamed && !b.unnamed) || (m.farName && !b.unnamed && !b.farName)) Object.assign(m, { name: b.name, unnamed: false, farName: b.farName });
    if (!m.size && b.size) Object.assign(m, { size: b.size, type: b.type, subtype: b.subtype, alignment: b.alignment });
    if (ABIL.some(k => m[k] == null) && ABIL.every(k => b[k] != null)) for (const k of ABIL) m[k] = b[k];
    for (const [k, k2] of [['ac', 'ac_type'], ['hp', 'hp_dice'], ['cr', 'xp']]) if (m[k] == null && b[k] != null) { m[k] = b[k]; m[k2] = b[k2]; }
    if (!Object.keys(m.speed || {}).length) m.speed = b.speed;
    if (!Object.keys(m.senses || {}).length) m.senses = b.senses;
    if (!m.languages) m.languages = b.languages;
    for (const k of LISTS) if (!(m[k] || []).length && (b[k] || []).length) m[k] = b[k];
    m.id = slug(m.name);
    return withProblems(m);
  });
  secondary.forEach((b, k) => { if (!used.has(k)) out.push({ ...b, lines: null }); });
  return out;
}
