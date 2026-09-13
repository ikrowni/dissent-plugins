// scripts/sts2/pack.mjs — pack many small images into a few files.
//
// WHY: the node caps a plugin at 256 resources of at most 2 MB each
// (dissent-core registry_integrity.go, mirrored in scripts/declare-resources.mjs). STS2 has
// about a thousand images; as separate files the plugin is refused at verification, which
// looks like a broken plugin rather than a size error. Packs are plain concatenations; the
// plugin slices one image out by offset (plugins/sts2-companion/core/pack.js).

/** Below the node's 2 MB cap, leaving room for the declare-resources size check's rounding. */
export const MAX_PACK_BYTES = 1_900_000;

/**
 * @param {{ id: string, group: string, bytes: Uint8Array }[]} images  in the order to pack
 * @returns {{ packs: { name: string, bytes: Uint8Array }[], index: Record<string, { pack: string, offset: number, length: number }> }}
 */
export function packImages(images, { maxBytes = MAX_PACK_BYTES } = {}) {
  const index = {};
  const packs = [];
  const open = new Map(); // group -> { name, parts, size, seq }
  const seq = new Map();

  const close = (group) => {
    const cur = open.get(group);
    if (!cur) return;
    const bytes = new Uint8Array(cur.size);
    let at = 0;
    for (const part of cur.parts) { bytes.set(part, at); at += part.length; }
    packs.push({ name: cur.name, bytes });
    open.delete(group);
  };

  for (const { id, group, bytes } of images) {
    if (index[id]) throw new Error(`duplicate image id ${id}`);
    if (bytes.length > maxBytes) throw new Error(`image ${id} is ${bytes.length} bytes, over the ${maxBytes} pack cap`);
    let cur = open.get(group);
    if (cur && cur.size + bytes.length > maxBytes) { close(group); cur = undefined; }
    if (!cur) {
      const n = seq.get(group) ?? 0;
      seq.set(group, n + 1);
      cur = { name: `${group}-${String(n).padStart(2, '0')}.pack`, parts: [], size: 0 };
      open.set(group, cur);
    }
    index[id] = { pack: cur.name, offset: cur.size, length: bytes.length };
    cur.parts.push(bytes);
    cur.size += bytes.length;
  }
  for (const group of [...open.keys()]) close(group);
  packs.sort((a, b) => a.name.localeCompare(b.name));
  return { packs, index };
}
