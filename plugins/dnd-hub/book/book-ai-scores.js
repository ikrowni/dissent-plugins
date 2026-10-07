// book-ai-scores.js — "Read the missing scores with on-device AI": a scanned creature whose score row the importer
// could not read gets that strip of the real page read by the DM's own PC (plugin capability `ai.read`, Windows
// desktop app; spec 2026-10-06 on-device AI §5.1c). Measured on the rows this importer leaves unread (strips placed by
// scoreRegion, two tries): Ravenloft 19 of 23, Strahd 6 of 11 — all 25 correct. Nothing changes when it is unavailable.
import { request } from '../../plugin-sdk.js';
import { withProblems } from './book-monsters.js';
import { regionPng } from './book-snippets.js';

const ABIL = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const PAIR = /(\d{1,2})\s*[.,:;'"=~_|-]*\(\s*([+\-–—−~]?)\s*(\d{1,2})\s*\)/g;

/**
 * Six scores from the AI's reading of a score row, or null. 🔴 Strict: EXACTLY six "score (modifier)" pairs, and
 * every modifier matches its score ignoring the sign. The model often reads "−1" as "+1" (so the sign is ignored),
 * and sometimes repeats a value — seven pairs, which a first-six rule would take, wrongly (2 of 7 hand-checked rows).
 */
export function scoresFromReading(text) {
  const pairs = [...String(text || '').matchAll(PAIR)].map(x => ({ v: +x[1], mod: +x[3] }));
  if (pairs.length !== 6) return null;
  const fits = ({ v, mod }) => v >= 1 && v <= 30 && Math.abs(Math.floor((v - 10) / 2)) === mod;
  return pairs.every(fits) ? pairs.map(p => p.v) : null;
}

const missing = m => m.scoreSrc && ABIL.some(a => m[a] == null);
/** The creatures it could help: scanned, a placed score row, scores unread. */
export const needsScores = monsters => (monsters || []).filter(missing);

/** The strip without its bottom 15%: a second try when the first reading picked up the line below ("Saving Thr…")
 *  or repeated a value. On Ravenloft it turned 16 of 23 into 19; the two tries never disagreed on a value. */
export async function trimBottom(png, share = 0.15) {
  const bmp = await createImageBitmap(png);
  try {
    const h = Math.max(1, Math.round(bmp.height * (1 - share)));
    const c = new OffscreenCanvas(bmp.width, h);
    c.getContext('2d').drawImage(bmp, 0, 0);
    return await c.convertToBlob({ type: 'image/png' });
  } finally { bmp.close?.(); }
}

/**
 * Read each one's strip and fill its scores where the reading checks itself (the strip, then the strip trimmed). `pdfOf(m)`: the PDF the creature came
 * from. `note(text)`: progress. Returns { read, of, why } — `why` set when the AI could not run at all.
 */
export async function readMissingScores(monsters, pdfOf, note, stillHere = () => true, trim = trimBottom) {
  const list = needsScores(monsters);
  let read = 0, done = 0;
  for (const m of list) {
    const pdf = pdfOf(m);
    const png = pdf ? await regionPng(pdf, m.scoreSrc).catch(() => null) : null;
    let six = null;
    for (let attempt = 0; png && !six && attempt < 2; attempt++) {
      const image = attempt ? await trim(png).catch(() => null) : png;
      if (!image) break;
      let r;
      try { r = await request('ai.read', { image }, 15 * 60000); } catch (err) {
        const msg = String(err?.message || err);
        return { read, of: list.length, why: /not granted|no longer declared/.test(msg) ? 'LanternKeep has not been allowed to read pictures with on-device AI on this server yet.'
          : /unknown action/.test(msg) ? 'Update the Dissent app to use on-device AI.' : `On-device AI could not run (${msg}).` };
      }
      if (!stillHere()) return { read, of: list.length, why: null };
      if (!r.available) return { read, of: list.length, why: `On-device AI is not available: ${r.why}.` };
      six = scoresFromReading(r.text);
    }
    if (six) {
      const { confidence: _c, problems: _p, ...rest } = m;
      ABIL.forEach((a, k) => { rest[a] = six[k]; });
      delete rest.scoreSrc;
      monsters[monsters.indexOf(m)] = { ...withProblems(rest), aiScores: true };
      read++;
    }
    note(`Reading scores… ${++done} of ${list.length}`);
  }
  return { read, of: list.length, why: null };
}
