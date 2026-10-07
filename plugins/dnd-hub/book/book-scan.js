// book-scan.js — reading a SCANNED book: pages that are pictures, with a machine-read (OCR) text layer on top.
// Pure. Found on a real Curse of Strahd scan (2026-10-04): the whole book is one "font" (no bold, so entry names
// look like body text), stray noise lines sit between a name and its size line ("is wa"), names come out in
// mixed case with junk on the end ("GUARDIAN PorTRAIT et"), the "+" of a modifier reads as a 4 ("14(42)"), two
// columns can merge into one line, and some blocks are pure noise. So a scan is read by text patterns alone, and
// a number is taken only when it is plausible. Nothing read from a scan is ever "sure".

/** A book whose text has no styles at all: one font, no line mixing two. Real digital books have many. */
export function isScanned(lines) {
  if (lines.length < 200) return false;
  const fonts = new Set();
  for (const l of lines) {
    if ((l.runs || []).length > 1) return false;
    for (const r of l.runs || []) fonts.add(r.font);
  }
  return fonts.size <= 2;
}

const SIZES = 'Tiny|Small|Medium|Large|Huge|Gargantuan';
// The alignment is optional: 2021-style books print only "Huge Plant" (Van Richten's Guide to Ravenloft).
const SIZE_SCAN = new RegExp(`^(${SIZES})\\s+([a-z]+(?: [a-z]+)?)\\s*(?:\\(([^)]*)\\))?\\s*(?:,\\s*(.*))?$`, 'i');
const ALIGN = /\b(unaligned|any(?: [a-z-]+)? alignment|(?:lawful|neutral|chaotic) (?:good|neutral|evil)|neutral)\b/i;

/** Leading OCR junk off a line: quotes, dashes, stray marks ("“Armor Class 15", "_ Challenge 11"). */
export const clean = t => String(t).replace(/^[^A-Za-z0-9]+/, '').trim();

/** "Medium humanoid (elf), lawful evil" read loosely from a scan line: { size, type, subtype, alignment } or null. */
export function scanSize(text) {
  const m = clean(text).match(SIZE_SCAN);
  if (!m) return null;
  return { size: m[1], type: m[2], subtype: m[3] || null, alignment: ((m[4] || '').match(ALIGN) || [])[1] || '' };
}

const SMALL = new Set(['of', 'the', 'a', 'an', 'and', 'to', 'in', 'on', 'with', 'von', 'van', 'de']);

/**
 * A stat block's name from a scan line, or null when the line does not look like one. Names are printed in
 * capitals, so a candidate is mostly upper-case letters with no digits; junk words in lower case at the end are
 * dropped, and the rest is set in title case ("GUARDIAN PorTRAIT et" → "Guardian Portrait").
 */
export function scanName(text) {
  // "|" is the OCR's mark of two columns run together: the name is the part before it.
  const t = clean(String(text).split('|')[0]).replace(/(\w)"(\w)/g, '$1’$2');
  // Not a stat line, and not a chapter or the page's running footer ("APPENDIX D | MONSTERS AND NPCS").
  if (!t || /\d/.test(t) || SIZE_SCAN.test(t) || /^(Armou?r Class|Hit Points|Speed|Appendix|Chapter)\b/i.test(t)) return null;
  const words = t.split(/\s+/).map(w => w.replace(/[^A-Za-z'’,-]/g, '').replace(/^,+/, '')).filter(Boolean);
  while (words.length > 1 && /^[a-z'’,-]+$/.test(words[words.length - 1])) words.pop();
  words[words.length - 1] = words[words.length - 1].replace(/,+$/, '');
  const letters = words.join('').replace(/[^A-Za-z]/g, '');
  const upper = letters.replace(/[^A-Z]/g, '').length;
  if (letters.length < 3 || upper / letters.length < 0.6) return null;
  return titleCase(words.join(' '));
}

/** "THE OLD MILL" → "The Old Mill"; small joining words stay small after the first. */
export function titleCase(text) {
  return String(text).split(/\s+/).filter(Boolean).map((w, i) => {
    const lw = w.toLowerCase();
    // Capital after a hyphen, and after an apostrophe only before more letters ("D’Avenir", but "Strahd’s").
    return i > 0 && SMALL.has(lw) ? lw : lw.replace(/(^|-)([a-z])/g, (_, p, c) => p + c.toUpperCase())
      .replace(/(['’])([a-z])(?=[a-z])/g, (_, p, c) => p + c.toUpperCase());
  }).join(' ');
}

/** True where line `i` is a stat block's Armor Class line: at the start of the line, Hit Points just after. */
export function isScanAc(lines, i) {
  if (!/^Armou?r Class\s*\d+/.test(clean(lines[i].text))) return false;
  return lines.slice(i + 1, i + 3).some(l => /^Hit Points\s*\d+/.test(clean(l.text)));
}

/**
 * Where a scanned stat block begins, given its Armor Class line `ac`: the size line up to four lines above, and
 * the name up to three lines above that (noise lines in between are skipped). { start, nameAt, sizeAt }; either
 * may be -1 when it could not be read.
 */
export function scanBlockHead(lines, ac, floor = 0) {
  let sizeAt = -1, nameAt = -1;
  for (let k = ac - 1; k >= Math.max(floor, ac - 6); k--) if (scanSize(lines[k].text)) { sizeAt = k; break; }
  const from = sizeAt >= 0 ? sizeAt : ac;
  for (let k = from - 1; k >= Math.max(floor, from - 3); k--) if (scanName(lines[k].text)) { nameAt = k; break; }
  // Two columns: the name can sit at the top of the other column, well above. The nearest big heading since the
  // last block, then (Ezmerelda's name was 40 lines up).
  let far = false;
  if (nameAt < 0) for (let k = from - 1; k >= Math.max(floor, from - 60); k--) if (isScanHeading(lines[k])) { nameAt = k; far = true; break; }
  return { start: nameAt >= 0 ? nameAt : sizeAt >= 0 ? sizeAt : ac, nameAt, sizeAt, far };
}

/** A name heading in a scan: name-like text set well above body size, and not "ACTIONS" or the STR DEX row. */
/** A keyed area's key: "12. ", "23A. ", Strahd's "Q12. " (a scan reads its 1 as l or I: "Ql2. "). One real digit. */
export const AREA_KEY = /^[A-Z]{0,2}[0-9lI]{0,2}\d[A-Z]?\.\s+/;

export function isScanHeading(line) {
  const t = clean(line.text);
  const chapter = /^(chapter|appendix)\b/i.test(t) && t.length <= 60; // "CHAPTER 2: …" has a number in it
  // A keyed area ("Q12. DINING HALL") is a heading by its words; the key's digits are not a stat line's.
  return line.size >= 11.5 && (chapter || !!scanName(t.replace(AREA_KEY, ''))) && !isScoreHeader(t)
    && !/^(actions|reactions|legendary actions|bonus actions)$/i.test(t.replace(/[^A-Za-z ]+$/, '').trim());
}

/**
 * Do the scores agree with the hit points? A creature's hit dice bonus is its Constitution modifier times the
 * number of dice ("18d8 + 54" → +3 → CON 16 or 17). Two columns merged in a scan can hand a block its
 * neighbour's scores; those almost never pass this. True when it cannot be checked (no dice read).
 */
export function scoresFitHp(con, hpDice) {
  const m = String(hpDice || '').match(/^(\d+)d\d+(?:([+-])(\d+))?$/);
  if (!m || con == null) return true;
  const bonus = m[2] ? (m[2] === '-' ? -1 : 1) * +m[3] : 0;
  return Math.floor((con - 10) / 2) * +m[1] === bonus;
}

/**
 * An entry written "Name. Text" when there is no bold to go by: up to six words before the full stop, each
 * capitalised except small joining words or a parenthesis ("Mask of the Wild.", "Bite (Bat Form Only).").
 */
export function textEntry(text) {
  const m = clean(text).match(/^([A-Z][A-Za-z'’-]*(?:\s+(?:[A-Z(][A-Za-z0-9'’()/-]*|of|the|a|an|and|in|on|with|to)){0,5})\.\s+(\S.*)$/);
  if (!m || /:/.test(m[1])) return null;
  return { name: m[1], rest: m[2] };
}

/** True for a scan line that heads the ability scores: four or more of STR DEX CON INT WIS CHA on it. */
export const isScoreHeader = t => (String(t).match(/\b(STR|DEX|CON|INT|WIS|CHA)\b/gi) || []).length >= 4;

/**
 * The six ability scores after a header, from the next one or two lines, or null. Only the number before each
 * "(" is used (a modifier's "+" often reads as a 4), and only when all six are there and between 1 and 30.
 */
/**
 * The lines holding a scan's scores, from the lines under its "STR DEX …" header: the header can be split ("STR DEX CON
 * INT WIS" then "CHA" alone, Ravenloft), so lines of ability names only are skipped; the next two are the scores.
 */
export const scoreRows = texts => texts.filter(x => !/^\W*(?:(?:STR|DEX|CON|INT|WIS|CHA)\W*)+$/i.test(x)).slice(0, 2);

// A modifier is at most 10. "43" is "+3" with its "+" read as a 4 ("17(43)"); any other two digits are unreadable.
const modOf = d => (d == null || +d <= 10 ? (d == null ? null : +d) : /^4\d$/.test(d) ? +d[1] : NaN);

export function scanScores(texts) {
  for (let n = 1; n <= Math.min(3, texts.length); n++) {
    // A score, maybe OCR marks ("=14. (+2)"), then its modifier in brackets.
    const found = [...texts.slice(0, n).join(' ').matchAll(/(\d{1,2})[\s.,:;'"=~_|-]*\(\s*([+\-–—−~]?)\s*(\d{1,2})?/g)]
      .map(x => ({ v: +x[1], mod: x[3] == null ? null : (/[-–—−~]/.test(x[2]) ? -modOf(x[3]) : modOf(x[3])) }));
    if (found.length < 6) continue;
    const six = found.slice(0, 6);
    if (!six.every(f => f.v >= 1 && f.v <= 30)) return null;
    // A stat block's modifier is (score − 10) / 2 rounded down. 🔴 One that does not fit means a number was misread
    // ("22 (+6)" read as "2 (+6)", Rahadin): the row is not taken — a wrong score is worse than an unread one, which
    // the DM (or the on-device AI) fills in. The sign is not trusted: OCR reads "−1" as "+1" or "~1".
    // One modifier off by exactly one is a printing slip, not a misread (Iron Route prints "11 (+1)").
    const off = f => Math.abs(Math.abs(f.mod) - Math.abs(Math.floor((f.v - 10) / 2)));
    const read = six.filter(f => f.mod != null && !Number.isNaN(f.mod));
    if (read.some(f => off(f) > 1) || read.filter(f => off(f) === 1).length > 1) return null;
    return read.length >= 4 || !read.length ? six.map(f => f.v) : null;
  }
  return looseScores(texts.slice(0, 2).join(' '));
}

// The OCR reads "(" and "+" as 4 in a scanned score row (Ravenloft: "10440)" is 10 (+0), "1341)" 13 (+1), "12(41)"
// 12 (+1)). Each token is read loosely, and the row counts only if every modifier then agrees with its score.
function looseScores(text) {
  const out = [];
  for (const tok of text.split(/\s+/)) {
    const m = tok.replace(/[^\d()+\-–—−~]/g, '').match(/^(\d{1,2})[(4]?([+\-–—−~4]?)(\d)\)$/);
    if (!m) continue;
    const v = +m[1], mod = /[-–—−~]/.test(m[2]) ? -m[3] : +m[3];
    if (v < 1 || v > 30 || mod !== Math.floor((v - 10) / 2)) return null;
    out.push(v);
  }
  return out.length === 6 ? out : null;
}

/** An "ACTIONS" / "Legendary Actions" heading, any case, with OCR marks around it: the section key, or null. */
export function sectionHeading(text, sections) {
  const t = String(text).replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '').toLowerCase();
  return Object.entries(sections).find(([k]) => k.toLowerCase() === t)?.[1] ?? null;
}
