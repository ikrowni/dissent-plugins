// book-bundle.js — what to do with each file of a bundle the DM dropped in (a zip, several files, a folder). Pure.
//
// A bought adventure is often several files: the book's PDF, a maps PDF, a folder of handout or card images
// ("Tarokka Deck/Abjurer.png"), and odds and ends (a readme, a licence, __MACOSX copies). Every PDF is read and
// they become ONE book; images become pictures, grouped by their folder; .lkpack copies open as they always did; the
// rest is listed as left out, so the DM can see nothing was lost silently.

const IMAGE = /\.(png|jpe?g|webp|gif|bmp)$/i;
// Copies a Mac or Windows adds to an archive, never the DM's content.
const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$|\._)/i;

const base = p => p.split('/').pop();
const folder = p => p.split('/').slice(0, -1).pop() || '';
/** "Abjurer.png" → "Abjurer"; "Tarokka_Deck-03.jpg" → "Tarokka Deck 03". */
export const niceName = file => base(file).replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * `items`: [{ path, size }] ("Curse/Maps/Castle.pdf", sizes in bytes). Returns { pdfs, images, packs, skipped },
 * each keeping the item; images also get `group` (their folder's name, '' at the top) and `name`. PDFs are read
 * smallest first, so the book itself (not a 900 MB maps pack) is read and shown first.
 */
export function planBundle(items) {
  const out = { pdfs: [], images: [], packs: [], skipped: [] };
  for (const it of items) {
    const p = String(it.path || '').replace(/\\/g, '/');
    if (JUNK.test(p)) continue;
    if (/\.pdf$/i.test(p)) out.pdfs.push(it);
    else if (IMAGE.test(p)) out.images.push({ ...it, group: niceName(folder(p)), name: niceName(p) });
    else if (/\.lkpack$/i.test(p)) out.packs.push(it);
    else out.skipped.push(it);
  }
  out.pdfs.sort((a, b) => a.size - b.size);
  out.images.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return out;
}

/** A book's title from its bundle: the zip's or folder's name, else the first PDF's. */
export function bundleTitle(sourceName, plan) {
  const t = niceName(sourceName || '') || (plan.pdfs[0] ? niceName(plan.pdfs[0].path) : '');
  return t.slice(0, 80) || 'Imported book';
}

/**
 * Several PDFs' finds as one book: lists joined, each id unique across the whole book ("goblin", "goblin-2"), and
 * story sections from a second PDF on keep their chapter but say which file they came from in it.
 */
export function mergeParsed(parts) {
  const out = { monsters: [], spells: [], items: [], story: [], images: [] };
  const seen = {};
  const unique = (kind, e) => {
    let id = e.id, n = 1;
    while (seen[`${kind}:${id}`]) id = `${e.id}-${++n}`; // "goblin-2" may already be taken by the first PDF
    seen[`${kind}:${id}`] = true;
    return id === e.id ? e : { ...e, id };
  };
  parts.forEach(({ parsed, source }, n) => {
    for (const kind of Object.keys(out)) {
      for (const e of parsed[kind] || []) {
        let x = unique(kind, e);
        if (kind === 'story' && n > 0 && source) x = { ...x, chapter: x.chapter ? `${source}: ${x.chapter}` : source };
        out[kind].push(x);
      }
    }
  });
  return out;
}
