// book-parse.js — a whole book's lines → { monsters, spells, items, story, counts }. Pure.
// Stat blocks, spells and items claim their lines first; the story is what is left, so nothing lands twice.
// Ids are made unique within the book ("goblin", "goblin-2").
import { findMonsters } from './book-monsters.js';
import { findSpells, spellClasses } from './book-spells.js';
import { findItems } from './book-items.js';
import { findStory } from './book-story.js';
import { isScanned } from './book-scan.js';
import { mergeReadings } from './book-merge.js';
import { entryRegions, scoreRegion } from './book-snippet-geom.js';

// `scanLines`: a scan read again with our own OCR (book-ocr.js) passes `lines` = the OCR'd book and `scanLines` =
// the scan's own text; monsters are taken from both (book-merge.js). Nothing else is read twice.
// `scanned`: the caller knows (every page read by our OCR, book-screens.js bookReadPages); else it is judged from the lines.
export function parseBook(lines, { scanLines = null, outline = null, scanned: known = null } = {}) {
  const scanned = known ?? isScanned(lines);
  // Where each find sat on its page (book-snippet-geom.js): the review shows that part of the real page beside it.
  // Taken against the lines it was found in: a scan's second reading has its own lines.
  const withSrc = arr => e => {
    const out = { ...e, src: entryRegions(arr, e.lines) };
    if (e.scoreLine != null) { const r = scoreRegion(arr, e.scoreLine); if (r) out.scoreSrc = r; delete out.scoreLine; }
    return out;
  };
  const monsters = scanLines
    ? mergeReadings(findMonsters(lines).map(withSrc(lines)), findMonsters(scanLines).map(withSrc(scanLines)))
    : findMonsters(lines).map(withSrc(lines));
  const spells = findSpells(lines, spellClasses(lines)).map(withSrc(lines));
  const items = findItems(lines).map(withSrc(lines));
  const claimed = new Set();
  for (const e of [...monsters, ...spells, ...items]) if (e.lines) for (let i = e.lines[0]; i <= e.lines[1]; i++) claimed.add(i);
  const story = findStory(lines.filter((_, i) => !claimed.has(i)), { scanned, outline });
  // A scan's words were machine-read: nothing from one is "sure" (book-scan.js); the DM looks at each.
  if (scanned) for (const e of [...spells, ...items]) if (e.confidence === 'sure') { e.confidence = 'unsure'; e.problems = ['read from a scan', ...(e.problems || [])]; }
  for (const list of [monsters, spells, items]) uniqueIds(list);
  const sure = l => l.filter(e => e.confidence === 'sure').length;
  return { monsters, spells, items, story, scanned,
    counts: { monsters: monsters.length, spells: spells.length, items: items.length, story: story.length,
      unsure: monsters.length + spells.length + items.length - sure(monsters) - sure(spells) - sure(items) } };
}

function uniqueIds(list) {
  const seen = {};
  for (const e of list) { seen[e.id] = (seen[e.id] || 0) + 1; if (seen[e.id] > 1) e.id = `${e.id}-${seen[e.id]}`; }
}
