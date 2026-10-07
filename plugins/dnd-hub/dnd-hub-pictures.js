// dnd-hub-pictures.js — pictures pinned onto the map board (owner, 2026-10-04: "a way to pin images to the map
// board for a scene"): a ship on the sea, a wanted poster on the wall, the next room's drawing. The DM's Picture tool
// places, moves, sizes and removes them; every screen draws them above the map and under tokens, grid and fog, so a
// player sees one only where the fog is open.
//
// `mapData.pictures`: [{ id, fileId, mime, cx, cy, w (in grid squares), ar (height / width) }].
import { MAP, serverData, userId, effectiveGs } from './dnd-hub-state.js?v=20261015a';
import { genId, request, requestWithTransfer } from '../plugin-sdk.js';
import { realtimePublish } from './dnd-hub-publish.js';
import { saveHubDm } from './dnd-hub-storage.js?v=20261015a';
import { CLIENT_ID } from './dnd-hub-client-id.js';
import { guarded } from './lk-upload.js';

export const PICTURES_UPDATE = 'pictures:update';
const MIN_W = 0.5, MAX_W = 40;

// ── Drawing ───────────────────────────────────────────────────────────────────────────────────────────────────────
const _tex = new Map(); // fileId → Promise<PIXI.Texture>

function texture(fileId) {
  if (!_tex.has(fileId)) {
    _tex.set(fileId, (async () => {
      const r = await request('files:loadArrayBuffer', { fileId }, 60000);
      const url = URL.createObjectURL(new Blob([r.buffer], { type: r.mime || 'image/png' }));
      const img = new Image();
      await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error('picture failed to load')); img.src = url; });
      URL.revokeObjectURL(url);
      return PIXI.Texture.from(img);
    })().catch(e => { _tex.delete(fileId); throw e; }));
  }
  return _tex.get(fileId);
}

let _drawn = 0; // a newer draw wins over a slower older one
export async function renderPictures() {
  const layer = MAP.layers?.pictures;
  if (!layer) return;
  const n = ++_drawn;
  const list = MAP.mapData?.pictures || [];
  const gs = effectiveGs(MAP.mapData);
  const sprites = await Promise.all(list.map(async p => {
    try {
      const s = new PIXI.Sprite(await texture(p.fileId));
      s.anchor.set(0.5); s.x = p.cx; s.y = p.cy;
      s.width = p.w * gs; s.height = p.w * gs * (p.ar || 1);
      s.eventMode = 'none'; s.label = p.id;
      return s;
    } catch { return null; }
  }));
  if (n !== _drawn) return;
  layer.removeChildren().forEach(c => c.destroy());
  sprites.filter(Boolean).forEach(s => layer.addChild(s));
}

// ── Saving ────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function savePicturesAndBroadcast() {
  const camp = serverData?.campaigns?.[MAP.campaignId];
  if (!camp || !MAP.mapData) return;
  camp.maps[MAP.mapId] = MAP.mapData;
  await saveHubDm(serverData);
  await realtimePublish(PICTURES_UPDATE, { clientId: CLIENT_ID, type: PICTURES_UPDATE, campaignId: MAP.campaignId,
    mapId: MAP.mapId, pictures: MAP.mapData.pictures || [], fromUserId: userId });
  renderPictures();
}

// ── The DM's Picture tool ─────────────────────────────────────────────────────────────────────────────────────────
const world = e => {
  const rect = MAP.app.canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left - MAP.panX) / MAP.zoom, y: (e.clientY - rect.top - MAP.panY) / MAP.zoom };
};

/** The top picture under world point (x, y), or null. Pure: exported for the tests. */
export function pictureAt(pictures, x, y, gs) {
  for (let i = (pictures || []).length - 1; i >= 0; i--) {
    const p = pictures[i], hw = p.w * gs / 2, hh = p.w * gs * (p.ar || 1) / 2;
    if (Math.abs(x - p.cx) <= hw && Math.abs(y - p.cy) <= hh) return p;
  }
  return null;
}

/** A picture's new width after "smaller" / "bigger", kept within reason. Pure. */
export const resized = (w, factor) => Math.round(Math.min(MAX_W, Math.max(MIN_W, w * factor)) * 100) / 100;

let _drag = null;
export function pictureToolDown(e) {
  if (!MAP.isDM || !MAP.mapData || e.button !== 0) return;
  const at = world(e);
  const hit = pictureAt(MAP.mapData.pictures, at.x, at.y, effectiveGs(MAP.mapData));
  if (!hit) { choosePicture(at); return; }
  _drag = { id: hit.id, from: at, start: { x: hit.cx, y: hit.cy }, moved: false };
}
export function pictureToolMove(e) {
  if (!_drag) return;
  const at = world(e), p = MAP.mapData?.pictures?.find(x => x.id === _drag.id);
  if (!p) { _drag = null; return; }
  const dx = at.x - _drag.from.x, dy = at.y - _drag.from.y;
  if (!_drag.moved && Math.hypot(dx, dy) < 4) return;
  _drag.moved = true;
  p.cx = _drag.start.x + dx; p.cy = _drag.start.y + dy;
  const s = MAP.layers.pictures.children.find(c => c.label === p.id);
  if (s) { s.x = p.cx; s.y = p.cy; }
}
export async function pictureToolUp() {
  const d = _drag; _drag = null;
  if (!d) return;
  if (d.moved) await savePicturesAndBroadcast();
  else showPictureMenu(d.id);
}

function choosePicture(at) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp,image/gif';
  input.onchange = () => { const f = input.files?.[0]; if (f) addPicture(f, at).catch(err => { if (!err?.shown) alert('Upload failed: ' + (err?.message || err)); }); };
  input.click();
}

async function addPicture(file, at) {
  const buf = await file.arrayBuffer();
  const mime = file.type || 'image/png';
  const ar = await new Promise(ok => {
    const url = URL.createObjectURL(new Blob([buf], { type: mime }));
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img.naturalWidth ? img.naturalHeight / img.naturalWidth : 1); };
    img.onerror = () => { URL.revokeObjectURL(url); ok(1); };
    img.src = url;
  });
  const res = await guarded(requestWithTransfer)('files:upload', { name: file.name, mime, size: buf.byteLength, dmOnly: false,
    data: buf, attachContext: `campaign:${MAP.campaignId}` }, [buf], 120000);
  if (!res?.id) throw new Error('the upload returned no file');
  (MAP.mapData.pictures ||= []).push({ id: genId(), fileId: res.id, mime, cx: at.x, cy: at.y, w: 4, ar: Math.round(ar * 1000) / 1000 });
  await savePicturesAndBroadcast();
}

function showPictureMenu(id) {
  document.getElementById('picture-menu')?.remove();
  const p = MAP.mapData?.pictures?.find(x => x.id === id);
  if (!p) return;
  const d = document.createElement('div');
  d.id = 'picture-menu'; d.className = 'lk-pop lk-picture-menu';
  d.innerHTML = `<div class="lk-pop-title">Picture on the map</div>
    <div class="lk-chips"><button data-act="smaller">Smaller</button><button data-act="bigger">Bigger</button>
      <button data-act="front">To the front</button><button data-act="remove">Remove</button><button data-act="done">Done</button></div>
    <div class="lk-pop-note">Drag a picture with this tool to move it. Players see it where the fog is open.</div>`;
  d.onclick = async e => {
    const act = e.target?.dataset?.act;
    if (!act) return;
    const list = MAP.mapData.pictures;
    if (act === 'done') { d.remove(); return; }
    if (act === 'remove') { MAP.mapData.pictures = list.filter(x => x.id !== id); d.remove(); }
    if (act === 'smaller') p.w = resized(p.w, 1 / 1.25);
    if (act === 'bigger') p.w = resized(p.w, 1.25);
    if (act === 'front') { MAP.mapData.pictures = [...list.filter(x => x.id !== id), p]; }
    await savePicturesAndBroadcast();
  };
  document.getElementById('map-root')?.appendChild(d);
}
