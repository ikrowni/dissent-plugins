// core/pack.js — images out of the packed art files.
//
// The build (scripts/sts2-data.mjs) concatenates ~1300 images into ≤2 MB packs because the
// node caps a plugin at 256 files. This fetches a pack once per session, slices one image
// out by offset, and hands back a blob: URL — both permitted by the plugin CSP (connect-src
// the asset origin, img-src blob:).
//
// ⚠️ Every URL made here must be revoked (releaseAll) when the view that asked goes away, or
// a long browsing session holds every image it ever showed.

export function createPackReader({
  index,
  base = 'art/',
  fetchFn = (u) => fetch(u),
  makeUrl = (b) => URL.createObjectURL(b),
  revokeUrl = (u) => URL.revokeObjectURL(u),
}) {
  const packs = new Map(); // name -> Promise<ArrayBuffer>
  const urls = new Map(); // id -> url

  function pack(name) {
    if (!packs.has(name)) {
      packs.set(name, fetchFn(base + name).then((r) => {
        if (!r.ok) throw new Error(`pack ${name}: ${r.status}`);
        return r.arrayBuffer();
      }).catch((e) => { packs.delete(name); throw e; }));
    }
    return packs.get(name);
  }

  async function blob(id) {
    const e = index[id];
    if (!e) return null;
    const buf = await pack(e.pack);
    return new Blob([buf.slice(e.offset, e.offset + e.length)], { type: 'image/webp' });
  }

  return {
    blob,
    async url(id) {
      if (urls.has(id)) return urls.get(id);
      const b = await blob(id);
      if (!b) return null;
      const u = makeUrl(b);
      urls.set(id, u);
      return u;
    },
    releaseAll() {
      for (const u of urls.values()) revokeUrl(u);
      urls.clear();
    },
  };
}
