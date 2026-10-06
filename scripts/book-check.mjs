// book-check.mjs — run the LanternKeep book parser on a real PDF and report what it found.
//   node scripts/book-check.mjs ~/lanternkeep-test-pdfs/SRD_CC_v5.1.pdf
// With the SRD 5.1 PDF it also compares against the bundled SRD data (dnd-hub/dnd-srd): monsters, spells and
// items found by name, and the fields that disagree. The PDF never goes in a repo.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';
import { pageLines } from '../plugins/dnd-hub/book/book-layout.js';
import { parseBook } from '../plugins/dnd-hub/book/book-parse.js';
import { readOutline } from '../plugins/dnd-hub/book/book-outline.js';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/book-check.mjs <book.pdf>'); process.exit(2); }
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
const lines = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p); const vp = page.getViewport({ scale: 1 });
  lines.push(...pageLines({ items: (await page.getTextContent()).items, width: vp.width, height: vp.height }, p));
}
const outline = await readOutline(doc); // the bookmarks, as book-pdf.js reads them
const t = Date.now();
const b = parseBook(lines, { outline });
console.log(`bookmarks: ${outline.length}`);
if (process.argv.includes('--toc')) {
  let ch = null;
  for (const s of b.story) { if (s.chapter !== ch) { ch = s.chapter; console.log(`# ${ch}`); } if (s.title !== s.chapter) console.log(`   ${s.title}  (p${s.page})`); }
}
console.log(`${doc.numPages} pages, ${lines.length} lines, parsed in ${Date.now() - t} ms:`, JSON.stringify(b.counts));

const srd = f => JSON.parse(readFileSync(new URL(`../plugins/dnd-hub/dnd-srd/${f}.json`, import.meta.url)));
const compare = (kind, mine, theirs, fields) => {
  const by = Object.fromEntries(theirs.map(x => [x.id, x]));
  const matched = mine.filter(m => by[m.id]);
  const bad = {};
  for (const m of matched) for (const f of fields) if (String(m[f]).toLowerCase() !== String(by[m.id][f]).toLowerCase()) (bad[f] ||= []).push(m.id);
  console.log(`${kind}: ${matched.length} of ${theirs.length} bundled found by name;`,
    Object.entries(bad).map(([f, l]) => `${f} differs ×${l.length} (${l.slice(0, 3).join(', ')})`).join('; ') || 'no field differs');
};
compare('monsters', b.monsters, srd('monsters'), ['ac', 'hp', 'cr', 'str', 'dex', 'con', 'int', 'wis', 'cha', 'size', 'type']);
compare('spells', b.spells, srd('spells'), ['level', 'school', 'range', 'ritual']);
compare('items', b.items, srd('magic-items'), ['rarity']);
const g = b.monsters.find(m => m.id === 'goblin');
if (g) console.log('spot check Goblin:', JSON.stringify({ ac: g.ac, hp: g.hp, cr: g.cr }), g.ac === 15 && g.hp === 7 && g.cr === 0.25 ? 'OK' : 'WRONG');
