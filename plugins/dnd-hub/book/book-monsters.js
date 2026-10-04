// book-monsters.js — stat blocks in a book's lines (book-layout.js) → monsters in the dnd-srd/monsters.json shape.
// Pure. A block starts at a name line followed by "Size type (subtype), alignment" and an Armor Class within three
// lines; it ends at the next block or at a heading bigger than "Actions". Each monster carries `confidence`
// ('sure' | 'unsure'), the `problems` that made it unsure, and `lines` [first, last] for the review screen.

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

/** Every stat block in `lines`. */
export function findMonsters(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isBlockStart(lines, i)) continue;
    let end = i + 2;
    while (end < lines.length && !isBlockStart(lines, end)
      && !(lines[end].size >= BLOCK_HEADING && !(lines[end].text in SECTIONS))) end++;
    out.push(readBlock(lines, i, end - 1));
    i = end - 1;
  }
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

function readBlock(lines, start, last) {
  const name = lines[start].text.trim();
  const sl = sizeLine(lines, start + 1);
  const [, size, type, subtype, alignment] = sl.match;
  const m = { id: slug(name), name, size: cap(size), type: type.trim().toLowerCase(), subtype: subtype ? subtype.trim() : null,
    alignment: alignment.trim().toLowerCase(), ac: null, ac_type: null, hp: null, hp_dice: null, speed: {},
    str: null, dex: null, con: null, int: null, wis: null, cha: null, saving_throws: [], skills: [],
    damage_resistances: [], damage_immunities: [], damage_vulnerabilities: [], condition_immunities: [], senses: {},
    languages: '', cr: null, xp: null, special_abilities: [], actions: [], reactions: [], legendary_actions: [] };
  const problems = [];
  const fields = {};
  const body = bodyFont(lines.slice(start + 1 + sl.used, last + 1));
  let i = start + 1 + sl.used, label = null, section = 'special_abilities', entry = null, intro = false;
  const close = () => { if (entry) m[section].push(entry); entry = null; };

  for (; i <= last; i++) {
    const t = lines[i].text.trim();
    let mm;
    if ((mm = t.match(/^Armor Class\s+(\d+)(?:\s*\(([^)]+)\))?/))) { m.ac = +mm[1]; m.ac_type = mm[2] || null; continue; }
    if ((mm = t.match(/^Hit Points\s+(\d+)(?:\s*\(([^)]+)\))?/))) { m.hp = +mm[1]; m.hp_dice = mm[2] ? mm[2].replace(/\s+/g, '').replace(/[−–]/g, '-') : null; continue; }
    if ((mm = t.match(/^Speed\s+(.+)/))) { m.speed = speedOf(mm[1]); continue; }
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
    if (t in SECTIONS) { close(); label = null; section = SECTIONS[t]; intro = section === 'legendary_actions'; if (!m[section]) m[section] = []; continue; }
    if (label && !entryStart(lines[i], body) && label !== 'Challenge') { fields[label] = joinText(fields[label], t); continue; }
    label = null;
    const e = entryStart(lines[i], body);
    if (e) { close(); intro = false; entry = { name: e.name, desc: e.rest }; continue; }
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

  if (m.ac == null) problems.push('no armour class');
  if (m.hp == null) problems.push('no hit points');
  if (ABIL.some(a => m[a] == null)) problems.push('ability scores not read');
  if (m.cr == null) problems.push('no challenge rating');
  if (!m.actions.length) problems.push('no actions');
  return { ...m, confidence: problems.length ? 'unsure' : 'sure', problems, lines: [start, last] };
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
