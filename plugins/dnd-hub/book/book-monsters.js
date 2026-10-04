// book-monsters.js — stat blocks in a book's lines (book-layout.js) → monsters in the dnd-srd/monsters.json shape.
// Pure. A block starts at a name line followed by "Size type (subtype), alignment" and an Armor Class within three
// lines; it ends at the next block or at a heading bigger than "Actions". Each monster carries `confidence`
// ('sure' | 'unsure'), the `problems` that made it unsure, and `lines` [first, last] for the review screen.

import { isScanned, isScanAc, scanBlockHead, isScanHeading, scoresFitHp, scanName, scanSize, clean, textEntry, isScoreHeader, scanScores,
  sectionHeading } from './book-scan.js';

const SIZE_RE = /^(Tiny|Small|Medium|Large|Huge|Gargantuan)\s+([a-z][a-z ]*?)(?:\s*\(([^)]+)\))?\s*,\s*([a-z][a-z0-9 ()%,.-]*)$/i;
const LABELS = ['Saving Throws', 'Skills', 'Damage Vulnerabilities', 'Damage Resistances', 'Damage Immunities',
  'Condition Immunities', 'Senses', 'Languages', 'Challenge'];
const SECTIONS = { 'Actions': 'actions', 'Reactions': 'reactions', 'Legendary Actions': 'legendary_actions', 'Bonus Actions': 'bonus_actions' };
const ABIL = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const BLOCK_HEADING = 11.5; // a line this tall ends a block (a new name, a chapter heading)

export const slug = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const num = s => Number(String(s).replace(/[−–]/g, '-').replace(/,/g, ''));

/** True where line `i` starts a stat block (its size line follows, and an Armor Class soon after). */
export function isBlockStart(lines, i) {
  const size = sizeLine(lines, i + 1);
  if (!size) return false;
  if (lines[i].text.length > 60 || /[.:]$/.test(lines[i].text)) return false;
  return lines.slice(i + 1 + size.used, i + 4 + size.used).some(l => /^Armor Class\b/.test(l.text));
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
  if (b && !/^Armor Class\b/.test(b.text) && /^(Tiny|Small|Medium|Large|Huge|Gargantuan)\s/.test(a.text) && b.text.length < 40) {
    m = `${a.text} ${b.text}`.match(SIZE_RE);
    if (m) return { match: m, used: 2 };
  }
  return null;
}

/** Every stat block in `lines`. A scanned book (book-scan.js) is read by text patterns instead. */
export function findMonsters(lines) {
  if (isScanned(lines)) return findScanned(lines);
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
  let name, size, type, subtype, alignment, first;
  if (scan) {
    name = scan.nameAt >= 0 ? scanName(lines[scan.nameAt].text) : null;
    const sz = scan.sizeAt >= 0 ? scanSize(lines[scan.sizeAt].text) : null;
    ({ size = null, type = null, subtype = null, alignment = '' } = sz || {});
    first = Math.max(scan.nameAt, scan.sizeAt, start - 1) + 1;
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
    if (scan && ((m.ac != null && /^Armor Class\s*\d/.test(t)) || (m.hp != null && /^Hit Points\s*\d/.test(t))
      || (m.cr != null && /^Challenge\s*[\d/]/.test(t)) || (scored && isScoreHeader(t)))) break;
    if ((mm = t.match(/^Armor Class\s+(\d+)(?:\s*\(([^)]+)\))?/))) { m.ac = +mm[1]; m.ac_type = mm[2] || null; continue; }
    if ((mm = t.match(/^Hit Points\s+(\d+)(?:\s*\(([^)]+)\))?/))) { m.hp = +mm[1]; m.hp_dice = mm[2] ? mm[2].replace(/\s+/g, '').replace(/[−–]/g, '-') : null; continue; }
    if ((mm = t.match(/^Speed\s+(.+)/))) { m.speed = speedOf(mm[1]); continue; }
    if (scan && isScoreHeader(t)) {
      scored = true;
      const nums = scanScores(lines.slice(i + 1, Math.min(last, i + 2) + 1).map(l => l.text)) || [];
      ABIL.forEach((a, k) => { m[a] = nums[k] ?? null; });
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
    if (label && !entryAt(i) && label !== 'Challenge') { fields[label] = joinText(fields[label], t); continue; }
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

  for (const a of m.actions) a.attack_bonus = (a.desc.match(/([+−–-]\d+)\s+to hit/) || [])[1] != null ? num(a.desc.match(/([+−–-]\d+)\s+to hit/)[1]) : null;
  const list = s => (s || '').split(/;\s*|,\s*(?![^;]*\bfrom\b)/).map(x => x.trim().replace(/^and\s+/, '')).filter(Boolean);
  m.saving_throws = (fields['Saving Throws'] || '').split(/,\s*/).map(s => s.match(/^(\w{3})\w*\s+([+−–-]\d+)/)).filter(Boolean)
    .map(x => ({ ability: x[1].toLowerCase(), bonus: num(x[2]) }));
  m.skills = (fields['Skills'] || '').split(/,\s*/).map(s => s.match(/^(.+?)\s+([+−–-]\d+)$/)).filter(Boolean)
    .map(x => ({ name: x[1], bonus: num(x[2]) }));
  m.damage_resistances = list(fields['Damage Resistances']);
  m.damage_immunities = list(fields['Damage Immunities']);
  m.damage_vulnerabilities = list(fields['Damage Vulnerabilities']);
  m.condition_immunities = list(fields['Condition Immunities']).map(cap);
  for (const s of (fields['Senses'] || '').split(/,\s*/)) {
    const pp = s.match(/^passive Perception\s+(\d+)/i);
    const sv = s.match(/^([a-z]+)\s+(.+)$/i);
    if (pp) m.senses.passive_perception = +pp[1]; else if (sv) m.senses[sv[1].toLowerCase()] = sv[2];
  }
  m.languages = /^[—–-]$/.test((fields['Languages'] || '').trim()) ? '' : (fields['Languages'] || '');
  const ch = (fields['Challenge'] || '').match(/^([\d/]+)\s*\(([\d,]+)\s*XP\)/);
  if (ch) { m.cr = ch[1].includes('/') ? num(ch[1].split('/')[0]) / num(ch[1].split('/')[1]) : num(ch[1]); m.xp = num(ch[2]); }

  if (scan && m.con != null && !scoresFitHp(m.con, m.hp_dice)) for (const a of ABIL) m[a] = null;
  const out = { ...m, lines: [start, last], page: lines[start].page };
  if (scan) { out.scan = true; out.unnamed = !name; out.farName = !!(name && scan.far); }
  return withProblems(out);
}

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
  if (m.cr == null) problems.push('no challenge rating');
  if (!m.actions.length) problems.push('no actions');
  return { ...m, confidence: problems.length ? 'unsure' : 'sure', problems };
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
