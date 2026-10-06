// book-monsters.js — stat blocks in a book's lines (book-layout.js) → monsters in the dnd-srd/monsters.json shape.
// Pure. A block starts at a name line followed by "Size type (subtype), alignment" and an Armor Class within three
// lines; it ends at the next block or at a heading bigger than "Actions". Each monster carries `confidence`
// ('sure' | 'unsure'), the `problems` that made it unsure, and `lines` [first, last] for the review screen.

import { isScanned, isScanAc, scanBlockHead, isScanHeading, scoresFitHp, scanName, scanSize, clean, textEntry, isScoreHeader, scanScores, scoreRows,
  sectionHeading } from './book-scan.js';

const SIZE_RE = /^(Tiny|Small|Medium|Large|Huge|Gargantuan)\s+([a-z][a-z ]*?)(?:\s*\(([^)]+)\))?\s*,\s*([a-z][a-z0-9 ()%,.-]*)$/i;
// 2014 labels, then the 2024 ones (SRD 5.2): "Resistances", "Vulnerabilities", one "Immunities" line for damage
// and conditions ("Poison; Poisoned"), "Gear", and "CR 1/4 (XP 50; PB +2)" for the challenge.
const LABELS = ['Saving Throws', 'Skills', 'Damage Vulnerabilities', 'Damage Resistances', 'Damage Immunities',
  'Condition Immunities', 'Senses', 'Languages', 'Challenge',
  'Resistances', 'Vulnerabilities', 'Immunities', 'Gear', 'CR'];
const AC_RE = /^(?:Armou?r Class|AC)\s+(\d+)(?:\s*\(([^)]+)\))?/;     // 2014 "Armor Class 15 (…)", 2024 "AC 15 Initiative +2 (12)"
const HP_RE = /^(?:Hit Points|HP)\s+(\d+)(?:\s*\(([^)]+)\))?/;
const SCORES_2024 = /\b(Str|Dex|Con|Int|Wis|Cha)\s*(\d+)\s+([+−–-]\d+)\s+([+−–-]?\d+)/gi; // score, modifier, save
// "Traits" heads the traits in 2024 books (SRD 5.2); taken for a chapter heading, it ended every block there.
const SECTIONS = { 'Traits': 'special_abilities', 'Actions': 'actions', 'Reactions': 'reactions', 'Legendary Actions': 'legendary_actions', 'Bonus Actions': 'bonus_actions' };
const ABIL = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
/**
 * How tall a line must be to be a heading in this book: 11.5 pt for the usual ~10 pt body text, and more in a book set
 * larger (Free5e's body is 12 pt: a fixed 11.5 ended every spell at its first line). Body = the size most text is in.
 */
export function headingSize(lines) {
  const n = {};
  for (const l of lines) { const k = (+l.size).toFixed(1); n[k] = (n[k] || 0) + (l.text || '').length; }
  const body = +(Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10);
  return Math.max(11.5, body + 1.5);
}

export const slug = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const num = s => Number(String(s).replace(/[−–]/g, '-').replace(/,/g, ''));

// Black Flag / Tales of the Valiant: "Aboleth CR 10" then "Large Aberration" (no alignment) and the Armor Class.
const BF_NAME = /^(.{2,50}?)\s+CR\s+([\d/]+)$/;
const BF_SIZE = /^(Tiny|Small|Medium|Large|Huge|Gargantuan)\s+([A-Za-z]+(?: [A-Za-z]+)?)(?:\s*\(([^)]+)\))?$/;
function bfHead(lines, i) {
  const n = (lines[i]?.text || '').match(BF_NAME), z = (lines[i + 1]?.text || '').match(BF_SIZE);
  if (!n || !z || !lines.slice(i + 2, i + 4).some(l => AC_RE.test(l.text))) return null;
  return { name: n[1].trim(), cr: n[2], size: z[1], type: z[2], subtype: z[3] || null };
}

/** True where line `i` starts a stat block (its size line follows, and an Armor Class soon after). */
export function isBlockStart(lines, i) {
  if (bfHead(lines, i)) return true;
  const size = sizeLine(lines, i + 1);
  if (!size) return false;
  if (lines[i].text.length > 60 || /[.:]$/.test(lines[i].text)) return false;
  return lines.slice(i + 1 + size.used, i + 4 + size.used).some(l => AC_RE.test(l.text));
}

/** The "Size type (subtype), alignment" line at `i`, which may wrap onto a second line: { match, used }. */
function sizeLine(lines, i) {
  const a = lines[i], b = lines[i + 1];
  if (!a) return null;
  let m = a.text.match(SIZE_RE);
  // "…, any non-lawful" + "alignment": a short lower-case line that is not the Armor Class finishes the alignment.
  if (m && b && /^[a-z(][a-z0-9 ()%,.-]*$/.test(b.text) && b.text.length < 30) {
    const both = `${a.text} ${b.text}`.match(SIZE_RE);
    if (both) return { match: both, used: 2 };
  }
  if (m) return { match: m, used: 1 };
  if (b && !AC_RE.test(b.text) && /^(Tiny|Small|Medium|Large|Huge|Gargantuan)\s/.test(a.text) && b.text.length < 40) {
    m = `${a.text} ${b.text}`.match(SIZE_RE);
    if (m) return { match: m, used: 2 };
  }
  return null;
}

/** Every stat block in `lines`. A scanned book (book-scan.js) is read by text patterns instead. */
export function findMonsters(lines) {
  if (isScanned(lines)) return findScanned(lines);
  const BLOCK_HEADING = headingSize(lines); // a line this tall ends a block (a new name, a chapter heading)
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isBlockStart(lines, i)) continue;
    let end = i + 2;
    while (end < lines.length && !isBlockStart(lines, end)
      && !(lines[end].size >= BLOCK_HEADING && !sectionHeading(lines[end].text, SECTIONS))) end++;
    out.push(readBlock(lines, i, end - 1));
    i = end - 1;
  }
  return out;
}

/**
 * Stat blocks in a scan: each starts at an Armor Class line (with Hit Points under it), its size line and name
 * looked for above it past noise; it ends where the next one starts, at a name heading, 120 lines on, or after the next page.
 */
function findScanned(lines) {
  const acs = [];
  for (let i = 0; i < lines.length; i++) if (isScanAc(lines, i)) acs.push(i);
  const out = [];
  let floor = 0;
  acs.forEach((ac, n) => {
    const head = scanBlockHead(lines, ac, floor);
    let last = Math.min(lines.length - 1, ac + 120);
    if (acs[n + 1] != null) last = Math.min(last, scanBlockHead(lines, acs[n + 1], ac + 1).start - 1);
    while (last > ac && lines[last].page > lines[ac].page + 1) last--;
    // A name heading after the block's Actions ends it: the story after a block stays story. Before its Actions a
    // heading is a sidebar inside the layout ("RAHADIN'S TRAITS" sits between his traits and his actions).
    let acted = false;
    for (let k = ac + 3; k <= last; k++) {
      if (sectionHeading(lines[k].text, SECTIONS)) acted = true;
      else if (acted && isScanHeading(lines[k])) { last = k - 1; break; }
    }
    out.push(readBlock(lines, head.start, last, head));
    floor = last + 1;
  });
  return out;
}

/** The font most of these lines' text is set in: the body text. Entry names stand out from it. */
export function bodyFont(lines) {
  const n = {};
  for (const l of lines) for (const r of l.runs || []) n[r.font] = (n[r.font] || 0) + r.text.length;
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * The entry a line starts ("Name. text"), or null: a first run NOT in the body font, starting with a capital and
 * ending with a full stop. (A wrapped line such as "one target. Hit: 5 …" also has a run ending in a full stop, but
 * in the body font.)
 */
export function entryStart(line, body) {
  const r = line.runs || [];
  if (!r.length || r[0].font === body || !/^[A-Z0-9]/.test(r[0].text) || !/\.$/.test(r[0].text) || r[0].text.length > 70) return null;
  return { name: r[0].text.replace(/\.$/, '').trim(), rest: line.text.slice(r[0].text.length).trim() };
}

/**
 * Two wrapped lines as one text. A line ending in a hyphen: after a digit it is a compound ("10-" + "foot" →
 * "10-foot"); after a letter it is a word broken at the line end ("spell-" + "casting" → "spellcasting").
 */
export const joinText = (a, b) => (!a ? b : !a.endsWith('-') ? `${a} ${b}`
  : /\d-$/.test(a) ? a + b : /^[a-z]/.test(b) ? a.slice(0, -1) + b : a + b);

// `scan` ({ nameAt, sizeAt }, book-scan.js) = a scanned book: name and size from those lines when read, entries
// by text pattern, ability scores only when plausible, and never "sure".
function readBlock(lines, start, last, scan = null) {
  let name, size, type, subtype, alignment, first, bf = null;
  if (scan) {
    name = scan.nameAt >= 0 ? scanName(lines[scan.nameAt].text) : null;
    const sz = scan.sizeAt >= 0 ? scanSize(lines[scan.sizeAt].text) : null;
    ({ size = null, type = null, subtype = null, alignment = '' } = sz || {});
    first = Math.max(scan.nameAt, scan.sizeAt, start - 1) + 1;
  } else if ((bf = bfHead(lines, start))) {
    ({ name, size, type, subtype } = bf); alignment = ''; first = start + 2;
  } else {
    name = lines[start].text.trim();
    const sl = sizeLine(lines, start + 1);
    [, size, type, subtype, alignment] = sl.match;
    first = start + 1 + sl.used;
  }
  const shown = name || `Unnamed (page ${lines[start].page})`;
  const m = { id: slug(shown), name: shown, size: size ? cap(size) : null, type: type ? type.trim().toLowerCase() : null,
    subtype: subtype ? subtype.trim() : null, alignment: (alignment || '').trim().toLowerCase(), ac: null, ac_type: null, hp: null, hp_dice: null, speed: {},
    str: null, dex: null, con: null, int: null, wis: null, cha: null, saving_throws: [], skills: [],
    damage_resistances: [], damage_immunities: [], damage_vulnerabilities: [], condition_immunities: [], senses: {},
    languages: '', cr: null, xp: null, special_abilities: [], actions: [], reactions: [], legendary_actions: [] };
  const problems = [];
  const fields = {};
  const body = bodyFont(lines.slice(first, last + 1));
  const entryAt = k => (scan ? textEntry(lines[k].text) : entryStart(lines[k], body));
  let i = first, label = null, section = 'special_abilities', entry = null, intro = false, entryX = null, scored = false, actionsX = null;
  const close = () => { if (entry) m[section].push(entry); entry = null; };

  for (; i <= last; i++) {
    const t = scan ? clean(lines[i].text) : lines[i].text.trim();
    let mm;
    // A scan: a second Armor Class / Hit Points / Challenge / score row is another creature's (two columns run
    // together), so this block ends there rather than taking its numbers.
    if (scan && ((m.ac != null && /^Armou?r Class\s*\d/.test(t)) || (m.hp != null && /^Hit Points\s*\d/.test(t))
      || (m.cr != null && /^Challenge\s*[\d/]/.test(t)) || (scored && isScoreHeader(t)))) break;
    // The first one only: an action's wrapped text can start "AC 10, 5 hit points" (the ettercap's webbing).
    if (m.ac == null && (mm = t.match(AC_RE))) { m.ac = +mm[1]; m.ac_type = mm[2] || null; continue; }
    if (m.hp == null && (mm = t.match(HP_RE))) { m.hp = +mm[1]; m.hp_dice = mm[2] ? mm[2].replace(/\s+/g, '').replace(/[−–]/g, '-') : null; continue; }
    if ((mm = t.match(/^Speed\s+(.+)/))) { m.speed = speedOf(mm[1]); continue; }
    if (scan && isScoreHeader(t)) {
      scored = true;
      const nums = scanScores(scoreRows(lines.slice(i + 1, Math.min(last, i + 4) + 1).map(l => l.text))) || [];
      ABIL.forEach((a, k) => { m[a] = nums[k] ?? null; });
      continue;
    }
    // 2024: "Str 8 −1 −1 Dex 15 +2 +2 Con 10 +0 +0" on two lines; a save above the modifier is a proficiency.
    if (!scan && /^Str\s*\d+\s+[+−–-]\d/i.test(t)) {
      for (const k of [i, i + 1]) for (const x of (lines[k]?.text || '').matchAll(SCORES_2024)) {
        const a = x[1].toLowerCase(), mod = num(x[3]), save = num(x[4]);
        m[a] = +x[2];
        if (save !== mod && !m.saving_throws.some(s => s.ability === a)) m.saving_throws.push({ ability: a, bonus: save });
      }
      if (/^Int\s*\d/i.test(lines[i + 1]?.text || '')) i++;
      continue;
    }
    // Black Flag gives modifiers only ("+5 −1 +6 +8 +6 +4"): a score is 10 + twice its modifier.
    if (bf && /^STR\s+DEX\s+CON\s+INT\s+WIS\s+CHA$/.test(t) && /^([+−–-]\d+\s*){6}$/.test((lines[i + 1]?.text || '').trim())) {
      lines[i + 1].text.trim().split(/\s+/).forEach((x, k) => { m[ABIL[k]] = 10 + 2 * num(x); });
      i++;
      continue;
    }
    if (bf && (mm = t.match(/^(Resistant|Immune|Vulnerable)\s+(.+)/))) {
      fields[mm[1]] = mm[2].split('|')[0].trim(); // "Resistant acid | Aberrant Resilience": the part after | is a trait's name
      continue;
    }
    if (/^STR\s+DEX\s+CON\s+INT\s+WIS\s+CHA$/.test(t)) {
      const nums = [];
      for (let k = i + 1; k <= Math.min(last, i + 3) && nums.length < 6; k++) {
        for (const x of lines[k].text.matchAll(/(\d+)\s*\(\s*[+−–-]?\d+\s*\)/g)) nums.push(+x[1]);
        if (nums.length >= 6) i = k;
      }
      ABIL.forEach((a, k) => { m[a] = nums[k] ?? null; });
      continue;
    }
    const lab = LABELS.find(l => t === l || t.startsWith(l + ' '));
    if (lab && !m.cr) { label = lab; fields[lab] = t.slice(lab.length).trim(); continue; }
    const sec = sectionHeading(t, SECTIONS);
    if (sec) { close(); label = null; section = sec; intro = section === 'legendary_actions'; if (!m[section]) m[section] = []; continue; }
    if (label && !entryAt(i) && label !== 'Challenge' && label !== 'CR') { fields[label] = joinText(fields[label], t); continue; }
    label = null;
    const e = entryAt(i);
    // A scan, after the actions: an entry in another column, or the "Ideal." of a roleplaying sidebar, is not this
    // creature's (NPC pages put a "<Name>'s Traits" box and more story right after the block).
    if (e && scan && section === 'actions' && m.actions.length + (entry ? 1 : 0) > 0
      && (/^(Ideal|Bond|Flaw)$/.test(e.name) || Math.abs((lines[i].x ?? entryX) - (actionsX ?? entryX)) > 60)) break;
    if (e) { close(); intro = false; entry = { name: e.name, desc: e.rest }; entryX = lines[i].x; if (section === 'actions') actionsX ??= entryX; continue; }
    // In a scan, a line in another column is not this entry's text (a story sidebar beside the block).
    if (entry && scan && Math.abs((lines[i].x ?? entryX) - entryX) > 60) { close(); continue; }
    if (entry) entry.desc = joinText(entry.desc, t);
    else if (intro) m.legendary_desc = joinText(m.legendary_desc || '', t);
  }
  close();

  // 2014 "+4 to hit", 2024 "Melee Attack Roll: +4".
  for (const a of m.actions) { const hit = a.desc.match(/([+−–-]\d+)\s+to hit/) || a.desc.match(/Attack Roll:\s*([+−–-]\d+)/); a.attack_bonus = hit ? num(hit[1]) : null; }
  const list = s => (s || '').split(/;\s*|,\s*(?![^;]*\bfrom\b)/).map(x => x.trim().replace(/^and\s+/, '')).filter(Boolean);
  m.saving_throws = m.saving_throws.length ? m.saving_throws : (fields['Saving Throws'] || '').split(/,\s*/).map(s => s.match(/^(\w{3})\w*\s+([+−–-]\d+)/)).filter(Boolean)
    .map(x => ({ ability: x[1].toLowerCase(), bonus: num(x[2]) }));
  m.skills = (fields['Skills'] || '').split(/,\s*/).map(s => s.match(/^(.+?)\s+([+−–-]\d+)$/)).filter(Boolean)
    .map(x => ({ name: x[1], bonus: num(x[2]) }));
  // 2024 puts damage and conditions on one "Immunities" line, split by a semicolon: "Poison; Poisoned".
  const [imm24, cond24] = (fields['Immunities'] || '').split(/;\s*/);
  const [immBf, condBf] = (fields['Immune'] || '').split(/;\s*/);
  m.damage_resistances = list(fields['Damage Resistances'] || fields['Resistances'] || fields['Resistant']);
  m.damage_immunities = list(fields['Damage Immunities'] || imm24 || immBf);
  m.damage_vulnerabilities = list(fields['Damage Vulnerabilities'] || fields['Vulnerabilities'] || fields['Vulnerable']);
  m.condition_immunities = list(fields['Condition Immunities'] || cond24 || condBf).map(cap);
  for (const s of (fields['Senses'] || '').split(/[,;]\s*/)) {
    const pp = s.match(/^passive Perception\s+(\d+)/i);
    const sv = s.match(/^([a-z]+)\s+(.+)$/i);
    if (pp) m.senses.passive_perception = +pp[1]; else if (sv) m.senses[sv[1].toLowerCase()] = sv[2];
  }
  m.languages = /^[—–-]$/.test((fields['Languages'] || '').trim()) ? '' : (fields['Languages'] || '');
  // "6 (2,300 xp) or 8 (3,900 XP) if paired …": the first is the CR. A misprinted CR ("2o (25,000 XP)") comes from its XP.
  const ch = (fields['Challenge'] || '').match(/^([\dOo/]+)\s*\(([\d,]+)\s*XP\)/i)
    || (fields['CR'] || '').match(/^([\dOo/]+)\s*\((?:XP\s*)?([\d,]+)/i); // 2024: "CR 1/4 (XP 50; PB +2)"; one says "(700 XP; …)"
  const crOf = c => (c.includes('/') ? num(c.split('/')[0]) / num(c.split('/')[1]) : num(c));
  if (!ch && bf) m.cr = crOf(bf.cr);
  if (ch) {
    m.xp = num(ch[2]);
    m.cr = /^[\d/]+$/.test(ch[1]) ? crOf(ch[1]) : (CR_BY_XP[m.xp] ?? null);
  }
  // "Challenge —": a creature with no challenge rating (a familiar, a summon). Not a problem.
  if (m.cr == null && /^[—–-]/.test((fields['Challenge'] || fields['CR'] || '').trim())) m.noCr = true;

  if (scan && m.con != null && !scoresFitHp(m.con, m.hp_dice)) for (const a of ABIL) m[a] = null;
  const out = { ...m, lines: [start, last], page: lines[start].page };
  if (scan) { out.scan = true; out.unnamed = !name; out.farName = !!(name && scan.far); }
  return withProblems(out);
}

/** The SRD's XP for each challenge rating, the other way round: a misprinted CR is read from its XP. */
const CR_BY_XP = { 10: 0, 25: 0.125, 50: 0.25, 100: 0.5, 200: 1, 450: 2, 700: 3, 1100: 4, 1800: 5, 2300: 6, 2900: 7, 3900: 8,
  5000: 9, 5900: 10, 7200: 11, 8400: 12, 10000: 13, 11500: 14, 13000: 15, 15000: 16, 18000: 17, 20000: 18, 22000: 19,
  25000: 20, 33000: 21, 41000: 22, 50000: 23, 62000: 24, 75000: 25, 90000: 26, 105000: 27, 120000: 28, 135000: 29, 155000: 30 };

/** A monster's `problems` and `confidence`, from its fields (again after two readings of a scan are merged). */
export function withProblems(m) {
  const problems = [];
  if (m.scan) problems.push('read from a scan');
  if (m.scan && m.unnamed) problems.push('name not read');
  if (m.scan && m.farName) problems.push('check the name');
  if (m.scan && !m.size) problems.push('size not read');
  if (m.ac == null) problems.push('no armour class');
  if (m.hp == null) problems.push('no hit points');
  if (ABIL.some(a => m[a] == null)) problems.push('ability scores not read');
  if (m.cr == null && !m.noCr) problems.push('no challenge rating');
  if (!m.actions.length) problems.push('no actions');
  // A scan's reading is ticked only when it checks itself (owner, 2026-10-06: a whole scanned book came out unticked):
  // nothing else missing, the hit points are the average of the hit dice, and Constitution gives the dice's bonus.
  // "read from a scan" stays on it as a note.
  const checked = m.scan && problems.length === 1 && hpIsDiceAverage(m.hp, m.hp_dice) && scoresFitHp(m.con, m.hp_dice);
  return { ...m, confidence: problems.length && !checked ? 'unsure' : 'sure', problems };
}

/** Whether `hp` is the average of `dice` ("8d12+40" → 92), the way every stat block prints it. False when unreadable. */
export function hpIsDiceAverage(hp, dice) {
  const d = String(dice || '').replace(/\s+/g, '').replace(/[−–]/g, '-').match(/^(\d+)d(\d+)(?:([+-])(\d+))?$/);
  if (!d || hp == null) return false;
  const avg = Math.floor(+d[1] * (+d[2] + 1) / 2 + (d[3] === '-' ? -d[4] : +(d[4] || 0)));
  return avg === hp;
}

function speedOf(s) {
  const out = {};
  for (const part of s.split(/,\s*/)) {
    const mm = part.match(/^(?:([a-z]+)\s+)?(\d+\s*ft\.?)(.*)$/i);
    if (!mm) continue;
    let extra = mm[3].trim();
    if (/\(hover\)/i.test(extra)) { out.hover = true; extra = extra.replace(/\(hover\)/i, '').trim(); }
    out[(mm[1] || 'walk').toLowerCase()] = (mm[2].replace(/\s+/, ' ') + (extra ? ' ' + extra : '')).trim().replace(/ft$/, 'ft.');
  }
  return out;
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
