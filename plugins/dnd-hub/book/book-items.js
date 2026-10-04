// book-items.js — magic items in a book's lines (book-layout.js) → the dnd-srd/magic-items.json shape. Pure.
// An item starts at a name line followed by "Wondrous item, rare (requires attunement …)"; the attunement note may
// wrap onto the next line. Its text runs to the next item or a bigger heading. `desc` starts with the type line, as
// the SRD's does.
import { slug, joinText, headingSize } from './book-monsters.js';

const TYPE_RE = /^(armor|weapon|wondrous item|ring|rod|staff|wand|potion|scroll)\b((?:\s*\([^)]*\))?[^,(]*),\s*(common|uncommon|rare|very rare|legendary|artifact|rarity varies)\b(.*)$/i;
const title = s => s.replace(/\b\w/g, c => c.toUpperCase());

// The type line, which may wrap after its comma: "Weapon (Glaive, Greatsword, Longsword, or Scimitar)," +
// "Legendary (Requires Attunement)" (SRD 5.2's Vorpal Sword). { text, used } or null.
function typeAt(lines, i) {
  const a = lines[i]?.text.trim() || '', b = lines[i + 1]?.text.trim() || '';
  if (TYPE_RE.test(a)) return { text: a, used: 1 };
  if (/,$/.test(a) && TYPE_RE.test(`${a} ${b}`)) return { text: `${a} ${b}`, used: 2 };
  return null;
}

export function isItemStart(lines, i) {
  return !!lines[i + 1] && !!typeAt(lines, i + 1) && lines[i].text.length <= 60 && !/[.:,]$/.test(lines[i].text)
    && lines[i].size > (lines[i + 1].size || 0);
}

export function findItems(lines) {
  const HEADING = headingSize(lines);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isItemStart(lines, i)) continue;
    let end = i + 2;
    while (end < lines.length && !isItemStart(lines, end) && !(lines[end].size >= HEADING)) end++;
    out.push(readItem(lines, i, end - 1));
    i = end - 1;
  }
  return out;
}

function readItem(lines, start, last) {
  const name = lines[start].text.trim();
  const ty = typeAt(lines, start + 1);
  let typeLine = ty.text, k = start + 1 + ty.used;
  // "(requires attunement by a" + "cleric or paladin)": an open bracket continues onto the next line.
  while (k <= last && (typeLine.match(/\(/g) || []).length > (typeLine.match(/\)/g) || []).length) typeLine = `${typeLine} ${lines[k++].text.trim()}`;
  const m = typeLine.match(TYPE_RE);
  const att = typeLine.match(/\(requires attunement\s*([^)]*)\)/i);
  let text = '';
  for (; k <= last; k++) text = joinText(text, lines[k].text.trim());
  const item = { id: slug(name), name, rarity: title(m[3].toLowerCase()), category: title(m[1].toLowerCase()),
    requires_attunement: att ? (att[1].trim() || true) : false, desc: `${typeLine}\n${text}` };
  const problems = text ? [] : ['no description'];
  return { ...item, confidence: problems.length ? 'unsure' : 'sure', problems, lines: [start, last] };
}
