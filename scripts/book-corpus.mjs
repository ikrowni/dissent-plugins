// book-corpus.mjs — run the LanternKeep book parser over every PDF in ~/lanternkeep-test-pdfs and compare what it
// finds with scripts/book-corpus-baseline.json (counts only: never any text from the books, which are not ours to
// commit). A drop is a regression; a rise is an improvement to record with --update.
//   node scripts/book-corpus.mjs            # compare; exits 1 on any drop
//   node scripts/book-corpus.mjs --update   # write the new counts as the baseline
// The PDFs (free downloads from their publishers, and the owner's own scan) live outside every repo; where to get
// each one is in the baseline's `source`. A scan is read here from its own text layer only (no OCR in Node).
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { pageLines } from '../plugins/dnd-hub/book/book-layout.js';
import { parseBook } from '../plugins/dnd-hub/book/book-parse.js';

const DIR = `${process.env.HOME}/lanternkeep-test-pdfs`;
const BASE = new URL('./book-corpus-baseline.json', import.meta.url);
const base = existsSync(BASE) ? JSON.parse(readFileSync(BASE)) : {};
const update = process.argv.includes('--update');
const KEYS = ['monsters', 'sureMonsters', 'spells', 'sureSpells', 'items', 'story'];
let drops = 0;
for (const f of readdirSync(DIR).filter(f => f.endsWith('.pdf')).sort()) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(`${DIR}/${f}`)), verbosity: 0 }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p); const vp = page.getViewport({ scale: 1 });
    lines.push(...pageLines({ items: (await page.getTextContent()).items, width: vp.width, height: vp.height }, p));
  }
  const b = parseBook(lines);
  const now = { monsters: b.monsters.length, sureMonsters: b.monsters.filter(m => m.confidence === 'sure').length,
    spells: b.spells.length, sureSpells: b.spells.filter(s => s.confidence === 'sure').length, items: b.items.length, story: b.story.length };
  const was = base[f]?.counts;
  const diff = KEYS.map(k => (was && was[k] !== now[k] ? `${k} ${was[k]}→${now[k]}` : null)).filter(Boolean);
  const down = was ? KEYS.filter(k => now[k] < was[k]) : [];
  drops += down.length;
  console.log(`${down.length ? 'DROP' : was ? (diff.length ? 'UP  ' : 'same') : 'new '}  ${f.padEnd(30)} ${KEYS.map(k => `${k} ${now[k]}`).join(', ')}${diff.length ? `   (${diff.join(', ')})` : ''}`);
  base[f] = { ...(base[f] || {}), counts: now };
}
if (update) { writeFileSync(BASE, JSON.stringify(base, null, 2) + '\n'); console.log('baseline written'); }
process.exit(drops && !update ? 1 : 0);
