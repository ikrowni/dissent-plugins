// book-ocr-lines.js — the pure half of reading a scanned book again with our own OCR (book-ocr.js runs Tesseract).
//
// A scan's own text layer (book-scan.js) is often poor: columns run together, numbers misread. Tesseract, run on
// the page picture with automatic page layout, finds the columns itself and reads more cleanly. It is slow (a few
// seconds a page), so only the pages that matter are read again: those whose text layer shows stat-block signs,
// and the page after each (a block can run on).

/** Pages worth reading again: stat-block signs in the scan's own text, loosely matched, plus the next page. */
export function pagesToRead(lines, pageCount) {
  const hit = new Set();
  // Not "Challenge": it is everywhere in an adventure's prose (96 pages of Curse of Strahd, against 20 with blocks).
  for (const l of lines) if (/Armou?r\s*C[l1]ass\s*\d|Hit\s*Po[il1ı]nts\s*\d|STR\s+DEX\s+CON/i.test(l.text)) hit.add(l.page);
  const out = new Set();
  for (const p of hit) { out.add(p); if (p + 1 <= pageCount) out.add(p + 1); }
  return [...out].sort((a, b) => a - b);
}

/**
 * Tesseract's TSV (level 5 rows = words, grouped by block / paragraph / line) → lines in book-layout.js's shape:
 * { text, size, runs: [{ text, font: 'ocr' }], page, x, y, w, fromTop, indent } — `y` is the line's TOP, measured from the
 * top of the page (`fromTop`), unlike pdf.js lines (book-layout.js). `scale` = pixels per PDF point of the
 * picture read. A line's size is its median word height in points over WORD_EM (a word box spans about this much
 * of the font size), so headings and body text land near the sizes the scan's own layer reports.
 */
export const WORD_EM = 0.9;
export function tsvToLines(tsv, page, scale) {
  const groups = new Map();
  for (const row of String(tsv).split('\n')) {
    const c = row.split('\t');
    if (c[0] !== '5' || c.length < 12) continue;
    const text = c.slice(11).join('\t').trim();
    if (!text || +c[10] < 0) continue;
    const key = `${c[2]}.${c[3]}.${c[4]}`;
    const g = groups.get(key) || { words: [], heights: [], left: Infinity, top: Infinity, right: -Infinity, block: +c[2], par: +c[3] };
    g.words.push(text); g.heights.push(+c[9]);
    g.left = Math.min(g.left, +c[6]); g.top = Math.min(g.top, +c[7]); g.right = Math.max(g.right, +c[6] + +c[8]);
    groups.set(key, g);
  }
  const out = [];
  let prev = null;
  for (const g of groups.values()) {
    const h = [...g.heights].sort((a, b) => a - b)[Math.floor(g.heights.length / 2)];
    const text = g.words.join(' ');
    const line = { text, size: +(h / scale / WORD_EM).toFixed(1), runs: [{ text, font: 'ocr' }], page,
      x: +(g.left / scale).toFixed(1), y: +(g.top / scale).toFixed(1), w: +((g.right - g.left) / scale).toFixed(1),
      fromTop: true, indent: false };
    // A paragraph's first line, set in from the one before it in the same column, is an indent.
    line.indent = !!prev && prev.par !== `${g.block}.${g.par}` && Math.abs(line.x - prev.x) < 40 && line.x - prev.x > 3;
    out.push(line);
    prev = { par: `${g.block}.${g.par}`, x: line.x };
  }
  return out;
}

/** The book's lines with `pages` replaced by what was read again; pages read again keep their place. */
export function replacePages(lines, byPage) {
  const out = [];
  const done = new Set();
  for (const l of lines) {
    if (!byPage.has(l.page)) { out.push(l); continue; }
    if (!done.has(l.page)) { out.push(...byPage.get(l.page)); done.add(l.page); }
  }
  return out;
}

/**
 * A page picture (RGBA bytes, in place) turned black and white before OCR: ink stays, a stat block's tinted,
 * textured parchment goes white. Without it Tesseract lost the left edge of every block's first lines
 * ("ICTAVIO", "edium humanoid"). 140 read best of 140 / 170 / 200 on Curse of Strahd.
 */
export const INK = 140;
export function blackAndWhite(rgba, threshold = INK) {
  for (let i = 0; i < rgba.length; i += 4) {
    const v = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2] < threshold ? 0 : 255;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = v; rgba[i + 3] = 255;
  }
  return rgba;
}
