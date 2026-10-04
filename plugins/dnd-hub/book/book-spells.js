// book-spells.js — spells in a book's lines (book-layout.js) → the dnd-srd/spells.json shape. Pure.
// A spell starts at a name line followed by "1st-level evocation" / "Evocation cantrip" (either may add
// "(ritual)") and a "Casting Time:" line soon after. Its text runs to the next spell or a bigger heading;
// "At Higher Levels." starts higher_level. `spellClasses` reads the class lists ("Wizard Spells" → names).
import { slug, joinText, headingSize } from './book-monsters.js';
import { titleCase } from './book-scan.js';

const LEVEL_RE = /^(\d)(?:st|nd|rd|th)-level\s+([a-z]+)(\s*\(ritual\))?$/i;
const CANTRIP_RE = /^([a-z]+)\s+cantrip(\s*\(ritual\))?$/i;
// 2024 (SRD 5.2): "Level 3 Evocation (Sorcerer, Wizard)" / "Evocation Cantrip (Sorcerer, Wizard)"; the class list
// can wrap onto the next line. A ritual says so in its casting time ("Action or Ritual").
const LEVEL_2024 = /^Level\s+(\d)\s+([A-Za-z]+)\s*\(([^)]*)(\))?$/;
const CANTRIP_2024 = /^([A-Za-z]+)\s+Cantrip\s*\(([^)]*)(\))?$/;
// Black Flag / Tales of the Valiant: "3rd-Circle Arcane (Evocation)", "Arcane and Wyrd Cantrip (Illusion)",
// "2nd-Circle Divine Ritual (Divination)"; a long source list wraps the "(School)" onto the next line. The sources
// (Arcane, Divine, Primordial, Wyrd) are not 5e classes, so `classes` stays empty.
const SCHOOLS = 'Abjuration|Conjuration|Divination|Enchantment|Evocation|Illusion|Necromancy|Transmutation';
const CIRCLE = new RegExp(`^(\\d)(?:st|nd|rd|th)-Circle\\s+([A-Za-z ,]+?)(\\s+Ritual)?\\s*\\((${SCHOOLS})\\)$`, 'i');
const CIRCLE_CANTRIP = new RegExp(`^([A-Za-z ,]+?)\\s+Cantrip\\s*\\((${SCHOOLS})\\)$`, 'i');
const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** The level line at `i` (2024 ones may wrap): { level, school, ritual, classes?, used }. */
function levelAt(lines, i) {
  const t = lines[i]?.text || '';
  // Black Flag, its "(School)" maybe on the next line.
  for (const [text, used] of [[t, 1], [`${t} ${lines[i + 1]?.text || ''}`, 2]]) {
    let c = text.match(CIRCLE);
    if (c) return { level: +c[1], school: cap(c[4]), ritual: !!c[3], classes: [], used };
    if ((c = text.match(CIRCLE_CANTRIP))) return { level: 0, school: cap(c[2]), ritual: false, classes: [], used };
  }
  let m = t.match(LEVEL_2024), level, school, list, closed;
  if (m) [level, school, list, closed] = [+m[1], m[2], m[3], m[4]];
  else if ((m = t.match(CANTRIP_2024))) [level, school, list, closed] = [0, m[1], m[2], m[3]];
  else { const lv = levelLine(t); return lv && { ...lv, used: 1 }; }
  let used = 1;
  if (!closed && lines[i + 1] && /^[A-Za-z ,]+\)$/.test(lines[i + 1].text)) { list = `${list} ${lines[i + 1].text.slice(0, -1)}`; used = 2; }
  return { level, school: cap(school), ritual: false, classes: list.split(/,\s*/).map(c => c.trim()).filter(Boolean), used };
}

function levelLine(t) {
  let m = t.match(LEVEL_RE);
  if (m) return { level: +m[1], school: cap(m[2]), ritual: !!m[3] };
  m = t.match(CANTRIP_RE);
  if (m) return { level: 0, school: cap(m[1]), ritual: !!m[2] };
  return null;
}

export function isSpellStart(lines, i) {
  const lv = levelAt(lines, i + 1);
  if (!lv) return false;
  if (lines[i].text.length > 50 || /[.:,]$/.test(lines[i].text)) return false;
  return lines.slice(i + 1 + lv.used, i + 3 + lv.used).some(l => /^Casting Time:/.test(l.text));
}

/** Every spell in `lines`. `classes` (from spellClasses): lower-case name → class names. */
export function findSpells(lines, classes = {}) {
  const HEADING = headingSize(lines);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isSpellStart(lines, i)) continue;
    let end = i + 2;
    while (end < lines.length && !isSpellStart(lines, end) && !(lines[end].size >= HEADING)) end++;
    out.push(readSpell(lines, i, end - 1, classes));
    i = end - 1;
  }
  return out;
}

function readSpell(lines, start, last, classes) {
  // Some books set spell names in capitals ("FIREBALL", Black Flag).
  const raw = lines[start].text.trim(), name = /[a-z]/.test(raw) ? raw : titleCase(raw);
  const lv = levelAt(lines, start + 1);
  const s = { id: slug(name), name, level: lv.level, school: lv.school, casting_time: '', range: '', components: [],
    material: null, ritual: lv.ritual, concentration: false, duration: '', desc: '', higher_level: null,
    classes: lv.classes || classes[name.toLowerCase()] || classes[raw.toLowerCase()] || [], damage_type: null };
  let into = 'desc';
  for (let i = start + 1 + lv.used; i <= last; i++) {
    const t = lines[i].text.trim();
    let m;
    if ((m = t.match(/^Casting Time:\s*(.+)/))) { s.casting_time = m[1]; into = 'casting'; continue; }
    if ((m = t.match(/^Range:\s*(.+)/))) { s.range = m[1]; into = 'desc'; continue; }
    if (into === 'casting') { s.casting_time = joinText(s.casting_time, t); continue; } // "1 reaction, which you take when you" wraps
    if ((m = t.match(/^Components?:\s*(.+)/))) { comps(s, m[1]); into = 'components'; continue; }
    if ((m = t.match(/^Duration:\s*(.+)/))) { s.duration = m[1]; s.concentration = /^Concentration/i.test(m[1]); into = 'desc'; continue; }
    // A material list can wrap: "M (a sprinkling of" / "holy water)".
    if (into === 'components' && s.material && !s.material.endsWith(')')) { s.material = `${s.material} ${t}`; if (t.endsWith(')')) s.material = s.material.slice(0, -1); continue; }
    // By its words, not its font: some books set it in the body font.
    // 2014 "At Higher Levels.", 2024 "Using a Higher-Level Spell Slot." and "Cantrip Upgrade.".
    if ((m = t.match(/^(?:At Higher Levels|Using a Higher-Level Spell Slot|Cantrip Upgrade)\.\s*(.*)/i))) { into = 'higher_level'; s.higher_level = m[1]; continue; }
    if (into === 'higher_level') s.higher_level = joinText(s.higher_level, t);
    else { into = 'desc'; s.desc = joinText(s.desc, t); }
  }
  // 2024: "Action or Ritual" is how a ritual is marked; the ritual part is not the casting time.
  if (/\bor Ritual$/i.test(s.casting_time)) { s.ritual = true; s.casting_time = s.casting_time.replace(/\s*or Ritual$/i, ''); }
  const dmg = s.desc.match(/\b(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder) damage\b/i);
  if (dmg) s.damage_type = cap(dmg[1]);
  const problems = [];
  if (!s.casting_time) problems.push('no casting time');
  if (!s.range) problems.push('no range');
  if (!s.duration) problems.push('no duration');
  if (!s.desc) problems.push('no description');
  return { ...s, confidence: problems.length ? 'unsure' : 'sure', problems, lines: [start, last] };
}

function comps(s, text) {
  const m = text.match(/^([VSM ,]+?)(?:\s*\((.*))?$/);
  s.components = (m ? m[1] : text).split(/[,\s]+/).filter(c => /^[VSM]$/.test(c));
  if (m && m[2] != null) s.material = m[2].endsWith(')') ? m[2].slice(0, -1) : m[2];
}

/**
 * Class spell lists: a heading "<Class> Spells", then level headings ("1st Level", "Cantrips (0 Level)") and one
 * spell name per line. Returns lower-case spell name → class names.
 */
export function spellClasses(lines) {
  const HEADING = headingSize(lines);
  const out = {};
  let cls = null, listSize = 0;
  for (const l of lines) {
    const t = l.text.trim();
    const m = t.match(/^(.+?) Spells$/);
    if (m && l.size >= HEADING && !/^Spell/.test(m[1])) { cls = m[1]; listSize = l.size; continue; }
    if (!cls) continue;
    if (l.size >= listSize) { cls = null; continue; }       // another section of the same rank
    if (l.size >= HEADING) continue;                         // a level heading
    if (t.length > 45 || /[.:]$/.test(t)) { cls = null; continue; } // a paragraph: the list is over
    (out[t.toLowerCase()] ||= []).includes(cls) || out[t.toLowerCase()].push(cls);
  }
  return out;
}
