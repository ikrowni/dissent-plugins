// plugins/dnd-hub/dnd-hub-frame.js
//
// The world frame: one unit = one pixel of the map IMAGE, origin at its top-left, on
// every screen. Zoom and pan fit it to the view.
//
// 🔴 WHY: positions used to be saved in each viewer's own canvas pixels, after the map
// was letterboxed into THAT viewer's window. Two windows of different sizes put the same
// token in different places relative to the map and its walls. That is how tokens ended
// up "through walls" and doors out of reach on some screens but not others.

/** Zoom/pan that shows the whole image centred in a W×H view. */
export function fitView(W, H, iw, ih) {
  const zoom = Math.min(W / iw, H / ih);
  return { zoom, panX: (W - iw * zoom) / 2, panY: (H - ih * zoom) / 2 };
}

/** The frame the OLD code used on a W×H canvas (needed to convert saved positions). */
export function legacyFrame(W, H, iw, ih) {
  const scale = Math.min(W / iw, H / ih);
  return { ox: (W - iw * scale) / 2, oy: (H - ih * scale) / 2, scale };
}

export function defaultGridSize(iw, ih) {
  return Math.max(20, Math.round(Math.max(iw, ih) / 25));
}

/** Convert a map saved in a legacy canvas frame to the image frame. Pure; idempotent. */
export function migrateMapToImageFrame(md, { ox, oy, scale }) {
  if (!md || md.coordFrame === 'image') return md;
  const m = JSON.parse(JSON.stringify(md));
  const px = (x, y) => ({ x: (x - ox) / scale, y: (y - oy) / scale });
  for (const t of Object.values(m.tokens || {})) {
    if (typeof t.x === 'number') Object.assign(t, px(t.x, t.y));
  }
  for (const p of m.pins || []) {
    if (typeof p.cx === 'number') { const q = px(p.cx, p.cy); p.cx = q.x; p.cy = q.y; }
  }
  for (const l of m.lights || []) if (typeof l.x === 'number') Object.assign(l, px(l.x, l.y));
  for (const z of m.audioZones || []) if (typeof z.x === 'number') Object.assign(z, px(z.x, z.y));
  if (m.wallFmt !== 'cell') {
    const seg = s => {
      if (typeof s.x1 !== 'number') return;
      const a = px(s.x1, s.y1), b = px(s.x2, s.y2);
      s.x1 = a.x; s.y1 = a.y; s.x2 = b.x; s.y2 = b.y;
    };
    (m.walls || []).forEach(seg);
    Object.values(m.doors || {}).forEach(seg);
  }
  if (!m.mapCellW) {
    if (typeof m.gridSize === 'number') m.gridSize = m.gridSize / scale;
  }
  if (typeof m.gridOffsetX === 'number') m.gridOffsetX /= scale;
  if (typeof m.gridOffsetY === 'number') m.gridOffsetY /= scale;
  m.coordFrame = 'image';
  return m;
}
