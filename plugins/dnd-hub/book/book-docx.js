// book-docx.js — a Word file (.docx) as the lines the book readers take (book-layout.js's shape). Pure.
//
// A homebrew monster manual is often a Word file (the owner's friend's "Arcane Ascension Monster Manual", 2026-10-06):
// 5e stat blocks, set with Word headings for names, bold labels with colons ("Armor Class: 17"), a table for the
// scores, bold "Name." for traits and actions. Each paragraph becomes lines (split at its line breaks) keeping bold and
// italic as fonts; a table row becomes one line; headings get heading sizes. A Word file has no pages: it gives its
// creatures, spells, items and pictures, not a page view or an index.

const HEADING = { Title: 22, Heading1: 18, Heading2: 14, Heading3: 12, Heading4: 11 };
const BODY = 10;
// Labels a stat block uses; Word files often add a colon ("Hit Points: 52"), which the readers do not expect.
const LABELS = ['Armor Class', 'Armour Class', 'Hit Points', 'Speed', 'Saving Throws', 'Skills', 'Damage Resistances',
  'Damage Immunities', 'Damage Vulnerabilities', 'Condition Immunities', 'Senses', 'Languages', 'Challenge', 'Proficiency Bonus'];
const LABEL_COLON = new RegExp(`^(${LABELS.join('|')}):\\s*`, 'i');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const xmlText = s => String(s).replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === '#'
  ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITIES[e] ?? m));

// Emoji and their joiners/variation selectors: decoration in a heading, never part of a name.
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;

/** A heading as a stat-block name: emoji gone; a trailing "(CR 3)" taken off and returned. */
export function headingName(text) {
  const t = text.replace(EMOJI, '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.*?)\s*\(\s*CR\s*([\d/]+)\s*\)\s*$/i);
  return m ? { name: m[1].trim(), cr: m[2] } : { name: t, cr: null };
}

function fontOf(rpr) {
  const b = /<w:b\/>|<w:b w:val="(?:1|true|on)"\/>/.test(rpr), i = /<w:i\/>|<w:i w:val="(?:1|true|on)"\/>/.test(rpr);
  return b && i ? 'bi' : b ? 'bold' : i ? 'italic' : 'body';
}

/** One paragraph's runs, as [[{ text, font }]] — one array per line (its line breaks split it). */
function paragraphLines(p) {
  const lines = [[]];
  for (const r of p.match(/<w:r[ >][\s\S]*?<\/w:r>/g) || []) {
    const font = fontOf((r.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0]);
    for (const piece of r.match(/<w:br[^>]*\/>|<w:tab\/>|<w:t[^>]*>[^<]*<\/w:t>/g) || []) {
      if (piece.startsWith('<w:br')) { lines.push([]); continue; }
      const text = piece.startsWith('<w:tab') ? ' ' : xmlText(piece.replace(/<[^>]+>/g, ''));
      const cur = lines[lines.length - 1], last = cur[cur.length - 1];
      if (last && last.font === font) last.text += text; else cur.push({ text, font });
    }
  }
  return lines.map(runs => runs.filter(r => r.text !== '')).filter(runs => runs.some(r => r.text.trim()));
}

/**
 * `documentXml` (word/document.xml) → { lines, pictures: [{ rid, name }] }. Lines are in book-layout's shape; `page` is a
 * running count (one per 60 paragraphs) only so the readers' "a block ends a page later" limits behave. `pictures`: the
 * drawings in document order, each named after the heading above it (the creature it shows), with its relationship id
 * (word/_rels/document.xml.rels maps it to a file in word/media).
 */
export function docxLines(documentXml) {
  const body = documentXml.slice(documentXml.indexOf('<w:body'));
  const blocks = body.match(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g) || [];
  const lines = [], pictures = [];
  let heading = '', n = 0;
  const push = (runs, size, para) => {
    const clean = runs.map(r => ({ text: r.text.replace(/\s+/g, ' '), font: r.font }));
    let text = clean.map(r => r.text).join('').replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (LABEL_COLON.test(text)) { // "Armor Class: 17" → "Armor Class 17", in the text and in its label run
      text = text.replace(LABEL_COLON, (m, l) => `${l} `);
      if (clean[0]) clean[0].text = clean[0].text.replace(/:\s*$/, '').replace(LABEL_COLON, (m, l) => `${l} `);
    }
    lines.push({ text, size, runs: clean.map(r => ({ text: r.text.trim(), font: r.font })).filter(r => r.text),
      page: 1 + Math.floor(para / 60), x: 0, y: 0, w: 0 });
  };
  for (const b of blocks) {
    n++;
    if (b.startsWith('<w:tbl>')) {
      for (const row of b.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []) {
        const cells = (row.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [])
          .map(c => (c.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).flatMap(paragraphLines).flat().map(r => r.text).join(' ').trim());
        if (cells.some(Boolean)) push([{ text: cells.join(' '), font: 'body' }], BODY, n);
      }
      continue;
    }
    const style = (b.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
    const size = HEADING[style] || BODY;
    for (const rid of b.match(/r:embed="([^"]+)"/g) || []) pictures.push({ rid: rid.slice(9, -1), name: heading || 'Picture' });
    for (const runs of paragraphLines(b)) {
      if (HEADING[style]) {
        const h = headingName(runs.map(r => r.text).join(''));
        heading = h.name;
        push([{ text: h.name, font: 'bold' }], size, n);
        if (h.cr) lines[lines.length - 1].cr = h.cr;
      } else push(runs, size, n);
    }
  }
  return { lines: tidy(lines), pictures };
}

const ABIL = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const ONE_SCORE = /^(STR|DEX|CON|INT|WIS|CHA)\s*:?\s*(\d{1,2}\s*\([+\-–−]?\d+\))$/i;
const NAME_ALONE = /^[A-Z0-9][^.]{0,60}\.$/;

/**
 * Two other ways Word manuals set a block (Arcane Ascension, later entries): one score a line ("STR 16 (+3)" six times)
 * → the header line and the score line the readers know; and a trait or action name alone ("Bite.") above its text →
 * one line, the name as its own run (bold italic, as books set it).
 */
function tidy(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const six = lines.slice(i, i + 6).map(l => l.text.match(ONE_SCORE));
    if (six.length === 6 && six.every((m, k) => m && m[1].toUpperCase() === ABIL[k])) {
      const base = lines[i];
      out.push({ ...base, text: ABIL.join(' '), runs: [{ text: ABIL.join(' '), font: 'bold' }] });
      const row = six.map(m => m[2].replace(/\s+/g, ' ')).join(' ');
      out.push({ ...base, text: row, runs: [{ text: row, font: 'body' }] });
      i += 5;
      continue;
    }
    const l = lines[i], next = lines[i + 1];
    // A name has no colon and no dice: "Hit: 8 (1d8 + 3) piercing damage." on a line of its own is the end of an attack.
    if (NAME_ALONE.test(l.text) && l.text.split(' ').length <= 8 && !/:|\d+d\d+/.test(l.text) && l.size === next?.size && next && !NAME_ALONE.test(next.text)
      && !/^(Armou?r Class|Hit Points|Speed|Challenge|Senses|Languages)\b/i.test(l.text)) {
      out.push({ ...l, text: `${l.text} ${next.text}`, runs: [{ text: l.text, font: 'bi' }, { text: next.text, font: 'body' }] });
      i++;
      continue;
    }
    // "Bite. Melee Weapon Attack: …" with the name in the same bold run as its text: the Title-Case name before the first
    // full stop is the entry's
    // name ("Strange Scepter.", "Hellrend (Greatsword)."). Prose ("The kuo-toa makes two attacks.") is not Title Case.
    // A section heading with a note ("Actions (2 attacks)") is the heading the readers know.
    const sec = l.text.length <= 40 && l.text.match(/^(Actions|Bonus Actions|Reactions|Legendary Actions|Lair Actions|Traits)\b\s*[(:–—-]/i);
    if (sec) { out.push({ ...l, text: sec[1], runs: [{ text: sec[1], font: 'bold' }] }); continue; }
    // Every Word line starts a paragraph (no wrapped lines), so this holds in any font: some manuals set it plain.
    const first = l.runs[0], one = first && first.text.match(NAME_LEAD);
    if (one && one[1].split(' ').length <= 6) {
      out.push({ ...l, runs: [{ text: `${one[1]}.`, font: 'bi' }, { text: one[2], font: 'body' }, ...l.runs.slice(1)] });
      continue;
    }
    out.push(l);
  }
  return out;
}
const NAME_LEAD = /^([A-Z][\w'’-]*(?:\s+(?:[A-Z(][\w'’()\/-]*|of|the|and|or))*)\.\s+(\S.*)$/;

/** word/_rels/document.xml.rels → relationship id → path inside the .docx ("word/media/image3.png"). */
export function docxRels(relsXml) {
  const out = {};
  for (const m of String(relsXml).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = (m[0].match(/\bId="([^"]+)"/) || [])[1], target = (m[0].match(/\bTarget="([^"]+)"/) || [])[1];
    if (id && target && !/^https?:/i.test(target)) out[id] = `word/${target.replace(/^\.?\//, '').replace(/^word\//, '')}`;
  }
  return out;
}
