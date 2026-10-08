// build-srd-2024.mjs — the bundled 2024 data (Table rules → Rules: 2024) from the System Reference Document 5.2.1.
//   node scripts/build-srd-2024.mjs ~/lanternkeep-test-pdfs/srd-5.2.1.pdf
// Reads the PDF with LanternKeep's own book parser (the one a DM's book import uses) and writes
// plugins/dnd-hub/dnd-srd/{spells,monsters,magic-items}-2024.json beside the 2014 files, in the same shapes.
// SRD 5.2.1 is CC-BY-4.0: its wording is used as-is (owner, 2026-10-08) and credited (dnd-hub-credits.js).
// The PDF never goes in the repo: https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf
// Run vendor-shared.mjs afterwards: the DM and player plugins carry their own copies.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { pageLines } from '../plugins/dnd-hub/book/book-layout.js';
import { parseBook } from '../plugins/dnd-hub/book/book-parse.js';
import { readOutline } from '../plugins/dnd-hub/book/book-outline.js';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/build-srd-2024.mjs <SRD_CC_v5.2.1.pdf>'); process.exit(2); }
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
const lines = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p); const vp = page.getViewport({ scale: 1 });
  lines.push(...pageLines({ items: (await page.getTextContent()).items, width: vp.width, height: vp.height }, p));
}
const b = parseBook(lines, { outline: await readOutline(doc) });

// What the parser adds for the import review (where it read each one, how sure it is) is not data.
const clean = ({ confidence, problems, lines: _l, src, page, scoreLine, noCr, ...rest }) => rest;
// A stat block with no challenge rating is a summon printed with its spell or item (Animated Object, Avatar of Death):
// the 2014 data has none of those either.
const monsters = b.monsters.filter(m => m.cr != null);
// Checked by hand against the PDF: the Giant Fly (a figurine's mount) has no actions at all.
const CHECKED = { 'giant-fly': ['no actions'] };
const unsure = [...monsters, ...b.spells, ...b.items]
  .filter(x => x.confidence !== 'sure' && !x.problems.every(p => CHECKED[x.id]?.includes(p)));
if (unsure.length) {
  console.error('not sure of:', unsure.map(x => `${x.name} (${x.problems.join(', ')})`).join('; '));
  process.exit(1);
}
const out = { spells: b.spells, monsters, 'magic-items': b.items };
for (const [name, list] of Object.entries(out)) {
  const ids = new Set();
  for (const x of list) { if (ids.has(x.id)) { console.error(`two ${name} called ${x.id}`); process.exit(1); } ids.add(x.id); }
  const data = list.map(clean).sort((x, y) => x.name.localeCompare(y.name));
  // The 2014 data writes "Hunter's Mark" with a straight apostrophe; the PDF's curly one would not match a search.
  writeFileSync(new URL(`../plugins/dnd-hub/dnd-srd/${name}-2024.json`, import.meta.url), JSON.stringify(data).replace(/[‘’]/g, "'"));
  console.log(`${name}-2024.json: ${data.length}`);
}
console.log(`left out (no challenge rating): ${b.monsters.filter(m => m.cr == null).map(m => m.name).join(', ')}`);
