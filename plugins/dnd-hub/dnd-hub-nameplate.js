// dnd-hub-nameplate.js — token name plates. Names were cut to 8 characters ("charlie_") at a fixed 9 px,
// which on a full-size map is a few screen pixels tall.

/** Whole name up to 16 characters; past that, cut at a word boundary where possible and add an ellipsis. */
export function plateText(name, max = 16) {
  const n = String(name || '').trim();
  if (!n) return '?';
  if (n.length <= max) return n;
  const cut = n.slice(0, max - 1);
  if (n[max - 1] === ' ') return cut + '…';        // the cut already falls between words
  const sp = cut.lastIndexOf(' ');
  return (sp >= 6 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

/** Font size in world units: a quarter of a grid square, never below 9. */
export function plateFontSize(gs) {
  return Math.max(9, Math.round(gs * 0.25));
}
