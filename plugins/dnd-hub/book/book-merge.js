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
    || (!!a.name && !a.unnamed && !b.unnamed && slug(a.name) === slug(b.name)));

/** `primary` (OCR) filled in from `secondary` (the scan's own text). Secondary-only finds have `lines: null`. */
export function mergeReadings(primary, secondary) {
  const used = new Set();
  const out = primary.map(a => {
    const b = secondary.find((x, k) => !used.has(k) && same(a, x));
    if (!b) return a;
    used.add(secondary.indexOf(b));
    return fillFrom(a, b, true);
  });
  secondary.forEach((b, k) => { if (!used.has(k)) out.push({ ...b, lines: null }); });
  return out;
}

const allCaps = s => /[A-Z]/.test(s || '') && s === String(s).toUpperCase();

/** `a` with what it lacks taken from `b` (the same creature read elsewhere). `sameDoc`: b's page regions are a's PDF's. */
function fillFrom(a, b, sameDoc) {
    const m = { ...a };
    if ((m.unnamed && !b.unnamed) || (m.farName && !b.unnamed && !b.farName)) Object.assign(m, { name: b.name, unnamed: false, farName: b.farName });
    if (!m.size && b.size) Object.assign(m, { size: b.size, type: b.type, subtype: b.subtype, alignment: b.alignment });
    if (ABIL.some(k => m[k] == null) && ABIL.every(k => b[k] != null)) for (const k of ABIL) m[k] = b[k];
    // Still unread: keep a place the review can cut the score row from (book-ai-scores.js), from either reading of
    // this PDF (another PDF's region would be cut from the wrong file).
    if (ABIL.some(k => m[k] == null)) { if (sameDoc) m.scoreSrc ??= b.scoreSrc; } else delete m.scoreSrc;
    if (b.aiScores && ABIL.every(k => m[k] === b[k])) m.aiScores = true;
    for (const [k, k2] of [['ac', 'ac_type'], ['hp', 'hp_dice'], ['cr', 'xp']]) if (m[k] == null && b[k] != null) { m[k] = b[k]; m[k2] = b[k2]; }
    if (!Object.keys(m.speed || {}).length) m.speed = b.speed;
    if (!Object.keys(m.senses || {}).length) m.senses = b.senses;
    if (!m.languages) m.languages = b.languages;
    for (const k of LISTS) if (!(m[k] || []).length && (b[k] || []).length) m[k] = b[k];
    // An ALL-CAPS name (one copy's text layer set the small caps as capitals) gives way to the other's.
    if (!sameDoc && allCaps(m.name) && !b.unnamed && !allCaps(b.name)) m.name = b.name;
    if (sameDoc) m.id = slug(m.name);
    const { confidence: _c, problems: _p, ...rest } = m;
    return withProblems(rest);
}

/**
 * The same creature found in two PDFs of one import — the same book twice ("smaller" and "larger" copies of a scan):
 * one entry, the reading with fewer problems filled in from the other (one copy reads the challenge rating, the other
 * the scores). Only across PDFs: two creatures of one PDF are never merged here.
 */
export function mergeCopies(monsters) {
  const out = [];
  for (const m of monsters) {
    const k = out.findIndex(o => o.doc !== m.doc && !o.copies?.includes(m.doc) && same(o, m));
    if (k < 0) { out.push(m); continue; }
    const o = out[k];
    const [base, other] = (m.problems || []).length < (o.problems || []).length ? [m, o] : [o, m];
    out[k] = { ...fillFrom(base, other, false), copies: [...(o.copies || []), m.doc] };
  }
  return out.map(({ copies: _, ...e }) => e);
}

// An item name the OCR spelled differently ("!CON OF RAVENLOFT", "IcoN OF RAVENLOFT"): letters only, OCR look-alikes folded.
const itemKey = n => String(n || '').toLowerCase().replace(/[!|1]/g, 'i').replace(/0/g, 'o').replace(/[^a-z]/g, '');

/** The same magic item from two PDFs of one import: the surer one kept. */
export function mergeItemCopies(items) {
  const out = [];
  for (const e of items) {
    const k = out.findIndex(o => o.doc !== e.doc && itemKey(o.name) === itemKey(e.name) && Math.abs((o.page ?? 0) - (e.page ?? 0)) <= 2);
    if (k < 0) { out.push(e); continue; }
    const o = out[k];
    const better = (e.confidence === 'sure') !== (o.confidence === 'sure') ? (e.confidence === 'sure' ? e : o)
      : (e.problems || []).length < (o.problems || []).length ? e : o;
    out[k] = allCaps(better.name) && !allCaps((better === e ? o : e).name) && (better === e ? o : e).name ? { ...better, name: (better === e ? o : e).name } : better;
  }
  return out;
}
