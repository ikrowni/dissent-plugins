// book-spells.js — spells in a book's lines (book-layout.js) → the dnd-srd/spells.json shape. Pure.
// A spell starts at a name line followed by "1st-level evocation" / "Evocation cantrip" (either may add
// "(ritual)") and a "Casting Time:" line soon after. Its text runs to the next spell or a bigger heading;
// "At Higher Levels." starts higher_level. `spellClasses` reads the class lists ("Wizard Spells" → names).
import { slug, joinText } from './book-monsters.js';

const LEVEL_RE = /^(\d)(?:st|nd|rd|th)-level\s+([a-z]+)(\s*\(ritual\))?$/i;
const CANTRIP_RE = /^([a-z]+)\s+cantrip(\s*\(ritual\))?$/i;
const HEADING = 11.5;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

function levelLine(t) {
  let m = t.match(LEVEL_RE);
  if (m) return { level: +m[1], school: cap(m[2]), ritual: !!m[3] };
  m = t.match(CANTRIP_RE);
  if (m) return { level: 0, school: cap(m[1]), ritual: !!m[2] };
  return null;
}

export function isSpellStart(lines, i) {
  if (!lines[i + 1] || !levelLine(lines[i + 1].text)) return false;
  if (lines[i].text.length > 50 || /[.:,]$/.test(lines[i].text)) return false;
  return lines.slice(i + 2, i + 4).some(l => /^Casting Time:/.test(l.text));
}

/** Every spell in `lines`. `classes` (from spellClasses): lower-case name → class names. */
export function findSpells(lines, classes = {}) {
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
  const name = lines[start].text.trim();
  const lv = levelLine(lines[start + 1].text);
  const s = { id: slug(name), name, level: lv.level, school: lv.school, casting_time: '', range: '', components: [],
    material: null, ritual: lv.ritual, concentration: false, duration: '', desc: '', higher_level: null,
    classes: classes[name.toLowerCase()] || [], damage_type: null };
  let into = 'desc';
  for (let i = start + 2; i <= last; i++) {
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
    if ((m = t.match(/^At Higher Levels\.\s*(.*)/i))) { into = 'higher_level'; s.higher_level = m[1]; continue; }
    if (into === 'higher_level') s.higher_level = joinText(s.higher_level, t);
    else { into = 'desc'; s.desc = joinText(s.desc, t); }
  }
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
