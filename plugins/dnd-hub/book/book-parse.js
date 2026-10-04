// book-parse.js — a whole book's lines → { monsters, spells, items, story, counts }. Pure.
// Stat blocks, spells and items claim their lines first; the story is what is left, so nothing lands twice.
// Ids are made unique within the book ("goblin", "goblin-2").
import { findMonsters } from './book-monsters.js';
import { findSpells, spellClasses } from './book-spells.js';
import { findItems } from './book-items.js';
import { findStory } from './book-story.js';
import { isScanned } from './book-scan.js';

export function parseBook(lines) {
  const scanned = isScanned(lines);
  const monsters = findMonsters(lines);
  const spells = findSpells(lines, spellClasses(lines));
  const items = findItems(lines);
  const claimed = new Set();
  for (const e of [...monsters, ...spells, ...items]) for (let i = e.lines[0]; i <= e.lines[1]; i++) claimed.add(i);
  const story = findStory(lines.filter((_, i) => !claimed.has(i)), { scanned });
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
