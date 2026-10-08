// book-items.js — magic items in a book's lines (book-layout.js) → the dnd-srd/magic-items.json shape. Pure.
// An item starts at a name line followed by "Wondrous item, rare (requires attunement …)"; the attunement note may
// wrap onto the next line. Its text runs to the next item or a bigger heading. `desc` starts with the type line, as
// the SRD's does.
import { slug, joinText, headingSize, isBlockStart, blockEnd } from './book-monsters.js';

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

// A long name wraps: "Amulet of Proof against Detection" + "and Location", both in the name's size, the type line
// under the second. How many lines above `i` are the name's start (0 or 1).
function nameAbove(lines, i) {
  const a = lines[i - 1], b = lines[i];
  return a && Math.abs(a.size - b.size) < 0.3 && a.page === b.page && a.text.length <= 60 && !/[.:,]$/.test(a.text)
    && /^[a-z]/.test(b.text) ? 1 : 0;
}

export function findItems(lines) {
  const HEADING = headingSize(lines);
  const out = [];
  const starts = i => isItemStart(lines, i) || (isItemStart(lines, i + 1) && nameAbove(lines, i + 1) === 1);
  for (let i = 0; i < lines.length; i++) {
    if (!isItemStart(lines, i)) continue;
    const head = i - nameAbove(lines, i);
    let end = i + 2;
    const skip = [];
    for (;;) {
      while (end < lines.length && !starts(end) && !(lines[end].size >= HEADING)) end++;
      // A stat block printed inside the item (the Giant Fly in Figurine of Wondrous Power): step over it, and the
      // item's text goes on after it.
      if (end < lines.length && !starts(end) && isBlockStart(lines, end)) {
        const last = blockEnd(lines, end);
        skip.push([end, last]);
        end = last + 1;
        continue;
      }
      break;
    }
    out.push(readItem(lines, head, end - 1, i, skip));
    i = end - 1;
  }
  return out;
}

function readItem(lines, start, last, nameLine = start, skip = []) {
  const name = lines.slice(start, nameLine + 1).map(l => l.text.trim()).join(' ');
  const ty = typeAt(lines, nameLine + 1);
  let typeLine = ty.text, k = nameLine + 1 + ty.used;
  // "(requires attunement by a" + "cleric or paladin)": an open bracket continues onto the next line.
  while (k <= last && (typeLine.match(/\(/g) || []).length > (typeLine.match(/\)/g) || []).length) typeLine = `${typeLine} ${lines[k++].text.trim()}`;
  const m = typeLine.match(TYPE_RE);
  const att = typeLine.match(/\(requires attunement\s*([^)]*)\)/i);
  let text = '';
  for (; k <= last; k++) if (!skip.some(([a, b]) => k >= a && k <= b)) text = joinText(text, lines[k].text.trim());
  const item = { id: slug(name), name, rarity: title(m[3].toLowerCase()), category: title(m[1].toLowerCase()),
    requires_attunement: att ? (att[1].trim() || true) : false, desc: `${typeLine}\n${text}` };
  const problems = text ? [] : ['no description'];
  return { ...item, confidence: problems.length ? 'unsure' : 'sure', problems, lines: [start, last] };
}
