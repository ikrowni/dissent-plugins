// ⚠️ GENERATED FILE — DO NOT EDIT.
//
// Vendored from plugins/lk-srd-edition.js by scripts/vendor-shared.mjs.
// Edit that file and re-run the script; `--check` fails the deploy if this copy drifts.
//
// It is a copy because a mirror may only serve files from under this plugin's own
// directory, so importing '../lk-srd-edition.js' directly would make the plugin unmirrorable.

// lk-srd-edition.js — the bundled SRD lists (spells, monsters, magic items) for the table's rules (Table rules → Rules:
// 2014 or 2024, lk-table-rules.js). The 2014 lists are SRD 5.1, the 2024 ones SRD 5.2.1 (scripts/build-srd-2024.mjs),
// both CC-BY-4.0. A plugin browses its edition's list; a lookup by id also finds the other edition's, so what was
// saved under the other rules (a 2014 goblin in an encounter, a 2014 hero's spells) still opens. Pure but `loadSrd`.

/** The file one list lives in: "spells.json" (2014) or "spells-2024.json". */
export const srdFile = (name, edition) => (edition === '2024' ? `${name}-2024.json` : `${name}.json`);

/**
 * The edition's list, each entry marked with its `edition`, followed by the other edition's entries whose id the
 * first lacks, marked `otherEdition` as well (found by id, never listed: `browsable`).
 */
export function withOtherEdition(mine, other, edition) {
  const otherEd = edition === '2024' ? '2014' : '2024';
  const ids = new Set((mine || []).map(x => x.id));
  return [...(mine || []).map(x => ({ ...x, edition })),
    ...(other || []).filter(x => !ids.has(x.id)).map(x => ({ ...x, edition: otherEd, otherEdition: true }))];
}

/** What a list shows: the table's edition only (and anything else merged in, a book's monsters). */
export const browsable = list => (list || []).filter(x => !x.otherEdition);

const _cache = new Map();
/**
 * Both editions of `name` from `base` (a plugin's own dnd-srd/ URL), as `withOtherEdition` for `edition`. Each file
 * is fetched once; a file that fails to load is an empty list (the plugin still opens).
 */
export async function loadSrd(base, name, edition, fetchFn = fetch) {
  const get = file => {
    const url = base + file;
    if (!_cache.has(url)) _cache.set(url, fetchFn(url).then(r => (r.ok ? r.json() : [])).catch(() => []));
    return _cache.get(url);
  };
  const ed = edition === '2024' ? '2024' : '2014';
  const [mine, other] = await Promise.all([get(srdFile(name, ed)), get(srdFile(name, ed === '2024' ? '2014' : '2024'))]);
  return withOtherEdition(mine, other, ed);
}
