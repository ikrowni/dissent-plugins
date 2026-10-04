// book-drop.js — the files in a drop, folders included. A dropped folder arrives as an entry to walk, not as files;
// each file found gets `relPath` ("Curse/Tarokka Deck/Abjurer.png") so its folder can name a picture set.

/** Every File in a drop's DataTransfer, walking folders. */
export async function filesFromDrop(dt) {
  const entries = [...(dt?.items || [])].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...(dt?.files || [])];
  const out = [];
  const walk = async (entry, path) => {
    if (entry.isFile) {
      const f = await new Promise((ok, fail) => entry.file(ok, fail));
      f.relPath = path + f.name;
      out.push(f);
      return;
    }
    const reader = entry.createReader();
    // readEntries answers in batches (about 100 at a time) until it answers with none.
    for (;;) {
      const batch = await new Promise((ok, fail) => reader.readEntries(ok, fail));
      if (!batch.length) break;
      for (const e of batch) await walk(e, `${path}${entry.name}/`);
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}
