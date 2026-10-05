// dnd-hub-fog.js — fog-of-war rendering, brush tools, fog save/reset
import { MAP, userId, effectiveGs, hubFogKey } from './dnd-hub-state.js?v=20261014j';
import { storageSet } from '../plugin-sdk.js';
import { realtimePublish } from './dnd-hub-publish.js';
import { EV } from './dnd-hub-event-types.js?v=20261014j';
import { computeLitCells, lightPx, getEffectiveRadius } from './dnd-hub-lights.js?v=20261014j';
import { computeVisibilityPolygon, sightBlockers } from './dnd-hub-los.js?v=20261014j';
import { fogAlpha } from './dnd-hub-rules.js';
import { applyPlayerSight, applyFacing } from './dnd-hub-tokens.js?v=20261014j';
import { fogBefore, fogAfter } from './dnd-hub-undo.js';

export function renderFog() {
  const layers = MAP.layers;
  if (!layers?.fog || !MAP.mapData) return;

  if (MAP._shopFogHidden) {
    layers.fog.removeChildren();
    MAP._fogSprite = null;
    return;
  }

  if (MAP.isDM && !MAP.fogVisible) {
    layers.fog.removeChildren();
    MAP._fogSprite = null;
    applyFacing();
    return;
  }

  const gs = effectiveGs(MAP.mapData);
  const ox = (MAP._bgOffset?.x ?? 0) + (MAP.mapData.gridOffsetX || 0);
  const oy = (MAP._bgOffset?.y ?? 0) + (MAP.mapData.gridOffsetY || 0);
  const fogState = MAP.mapData.fogState || {};
  // The DM's fog clears every lit square. A player's does not work in squares at all: lit areas are cut out below as
  // the lights' own smooth shapes, clipped to what the player's heroes can see. Squares gave the fog staircase edges
  // and stray black blocks round a lit room (owner, 2026-10-05).
  const litCells = MAP.isDM ? computeLitCells(MAP.mapData.lights || [], MAP.mapData) : new Set();
  if (!MAP.isDM) MAP._litPolysWorld = []; // filled below with the lights this player can see
  const W = MAP.app.screen.width;
  const H = MAP.app.screen.height;
  const z = MAP.zoom || 1;
  const panX = MAP.panX || 0;
  const panY = MAP.panY || 0;

  // ── Canvas2D fog rendered at screen resolution ───────────────────────────────
  // Reuse the canvas element across frames to avoid per-frame allocation.
  // Recreate only when the screen size changes (e.g. window resize).
  let canvas = MAP._fogCanvas;
  if (!canvas || canvas.width !== W || canvas.height !== H) {
    canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    MAP._fogCanvas = canvas;
    // Texture must also be recreated when the canvas dimensions change
    if (MAP._fogTexture) { MAP._fogTexture.destroy(true); MAP._fogTexture = null; }
    MAP._fogSprite = null;
    layers.fog.removeChildren();
  }

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  // World → screen helpers (accounts for current pan/zoom)
  const wx2sx = wx => wx * z + panX;
  const wy2sy = wy => wy * z + panY;
  const cellPx = gs * z; // grid cell size in screen pixels

  // Compute which grid cells are on screen (with one-cell margin)
  const startCx = Math.floor((-panX / z - ox) / gs) - 1;
  const startCy = Math.floor((-panY / z - oy) / gs) - 1;
  const endCx   = Math.ceil(((W - panX) / z - ox) / gs) + 1;
  const endCy   = Math.ceil(((H - panY) / z - oy) / gs) + 1;

  // Draw all fog cells first; the polygon cutout below erases the visible area.
  // A player's squares go through a soft blur: the remembered (explored) area is kept in squares, and its edge was a
  // hard staircase. What a player sees NOW is the smooth cutout, so a square the DM's screen marks 'visible' counts
  // as explored here — it used to punch a square hole the round vision did not match.
  const player = !MAP.isDM;
  let cellCtx = ctx;
  // The blur reads past the canvas edge as empty, which thinned the fog along the screen's edges and showed a strip
  // of the map there (owner, 2026-10-05). The squares are drawn PAD px past every edge, then cropped.
  const blurPx = Math.max(2, Math.min(cellPx * 0.35, 18));
  const PAD = Math.ceil(blurPx * 3);
  const extra = player ? Math.ceil(PAD / cellPx) : 0;
  if (player) {
    let bc = MAP._fogCellCanvas;
    if (!bc || bc.width !== W + 2 * PAD || bc.height !== H + 2 * PAD) {
      bc = document.createElement('canvas'); bc.width = W + 2 * PAD; bc.height = H + 2 * PAD; MAP._fogCellCanvas = bc;
    }
    cellCtx = bc.getContext('2d');
    cellCtx.setTransform(1, 0, 0, 1, 0, 0);
    cellCtx.clearRect(0, 0, bc.width, bc.height);
    cellCtx.setTransform(1, 0, 0, 1, PAD, PAD);
  }
  for (let cy = startCy - extra; cy <= endCy + extra; cy++) {
    for (let cx = startCx - extra; cx <= endCx + extra; cx++) {
      // Lit cells are always clear (the DM's screen) — treat as visible regardless of fogState
      if (litCells.has(`${cx},${cy}`)) continue;
      let state = fogState[`${cx},${cy}`] ?? 'unexplored';
      if (player && state === 'visible') state = 'explored';
      const alpha = fogAlpha(state, MAP.isDM);
      if (!alpha) continue; // 'visible' — no fog
      cellCtx.fillStyle = `rgba(0,0,0,${alpha})`;
      // +0.5px overlap prevents hairline gaps between adjacent cells at non-integer zoom
      cellCtx.fillRect(wx2sx(ox + cx * gs), wy2sy(oy + cy * gs), cellPx + 0.5, cellPx + 0.5);
    }
  }
  if (player) {
    ctx.filter = `blur(${blurPx.toFixed(1)}px)`;
    ctx.drawImage(MAP._fogCellCanvas, -PAD, -PAD);
    ctx.filter = 'none';
  }

  // ── Vision cutout — smooth visibility polygon ────────────────────────────────
  // MAP.localVisiblePoly is an Array<{x,y}[]> — one wall-traced polygon per
  // player token computed by computeLocalPlayerLOS().  We draw all polygons as
  // filled paths onto visCanvas (they naturally union), blur inward only, then
  // punch the result out of the fog canvas.  Lit cells are added as tile rects on
  // the same visCanvas so illuminated areas also clear through.
  // Falls back to a smooth gradient circle before the first polygon is ready.
  if (!MAP.isDM && userId) {
    const myTokens = Object.values(MAP.mapData.tokens || {}).filter(
      t => t.type === 'player' && t.visible && t.userId === userId
    );
    if (myTokens.length > 0) {
      if (MAP.localVisiblePoly?.length > 0) {
        // ── Step 1: draw vision polygon(s) + lit cells onto visCanvas ──────────
        let vc = MAP._visCanvas;
        if (!vc || vc.width !== W || vc.height !== H) {
          vc = document.createElement('canvas');
          vc.width = W; vc.height = H;
          MAP._visCanvas = vc;
        }
        const vctx = vc.getContext('2d');
        vctx.clearRect(0, 0, W, H);
        vctx.fillStyle = 'black';

        // Each token's visibility polygon — smooth wall-traced shape.
        for (const poly of MAP.localVisiblePoly) {
          if (poly.length < 3) continue;
          vctx.beginPath();
          vctx.moveTo(wx2sx(poly[0].x), wy2sy(poly[0].y));
          for (let i = 1; i < poly.length; i++) {
            vctx.lineTo(wx2sx(poly[i].x), wy2sy(poly[i].y));
          }
          vctx.closePath();
          vctx.fill();
        }

        // Lit areas: each light's own shape (stopped by walls), clipped to what my heroes can see from where they
        // stand — a lit room behind a wall stays dark. Same canvas → same union with the vision.
        const lights = MAP.mapData.lights || [];
        if (lights.length && MAP.localSightPolys?.length) {
          let lc = MAP._litCanvas;
          if (!lc || lc.width !== W || lc.height !== H) { lc = document.createElement('canvas'); lc.width = W; lc.height = H; MAP._litCanvas = lc; }
          const lctx = lc.getContext('2d');
          lctx.clearRect(0, 0, W, H);
          lctx.fillStyle = 'black';
          const fill = (c, poly) => {
            c.beginPath();
            c.moveTo(wx2sx(poly[0].x), wy2sy(poly[0].y));
            for (let i = 1; i < poly.length; i++) c.lineTo(wx2sx(poly[i].x), wy2sy(poly[i].y));
            c.closePath(); c.fill();
          };
          const walls = sightBlockers(MAP.mapData);
          MAP._litPolysWorld = [];
          for (const raw of lights) {
            const l = lightPx(raw);
            const poly = computeVisibilityPolygon(l.x, l.y, getEffectiveRadius(l), walls);
            if (poly.length >= 3) { fill(lctx, poly); MAP._litPolysWorld.push(poly); }
          }
          lctx.globalCompositeOperation = 'destination-in';
          const sc = MAP._sightCanvas && MAP._sightCanvas.width === W && MAP._sightCanvas.height === H
            ? MAP._sightCanvas : (MAP._sightCanvas = Object.assign(document.createElement('canvas'), { width: W, height: H }));
          const sctx = sc.getContext('2d');
          sctx.clearRect(0, 0, W, H);
          sctx.fillStyle = 'black';
          for (const poly of MAP.localSightPolys) fill(sctx, poly);
          lctx.drawImage(sc, 0, 0);
          lctx.globalCompositeOperation = 'source-over';
          vctx.drawImage(lc, 0, 0);
        }

        // ── Step 2: inward-only blur on maskCanvas ──────────────────────────────
        let mc = MAP._maskCanvas;
        if (!mc || mc.width !== W || mc.height !== H) {
          mc = document.createElement('canvas');
          mc.width = W; mc.height = H;
          MAP._maskCanvas = mc;
        }
        const mctx = mc.getContext('2d');
        mctx.clearRect(0, 0, W, H);
        const maskBlur = Math.max(3, Math.min(cellPx * 0.30, 20));
        mctx.filter = `blur(${maskBlur.toFixed(1)}px)`;
        mctx.drawImage(vc, 0, 0);
        mctx.filter = 'none';
        // Crop back to original footprint — blur only bleeds inward, not past walls.
        mctx.globalCompositeOperation = 'destination-in';
        mctx.drawImage(vc, 0, 0);
        mctx.globalCompositeOperation = 'source-over';

        // ── Step 3: punch the blurred polygon out of the fog ───────────────────
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(mc, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        // Fallback smooth circle (before first polygon is computed / no tokens yet).
        ctx.globalCompositeOperation = 'destination-out';
        for (const token of myTokens) {
          const visionPx = ((token.visionRadius || 60) / 5) * gs * z;
          const sx = wx2sx(token.x);
          const sy = wy2sy(token.y);
          const grad = ctx.createRadialGradient(sx, sy, visionPx * 0.70, sx, sy, visionPx + cellPx);
          grad.addColorStop(0, 'rgba(0,0,0,1)');
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, W, H);
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  if (!MAP.isDM) applyPlayerSight(); // who is in sight right now (dnd-hub-tokens.js)
  applyFacing();                     // …and who faces whom

  // ── Upload canvas pixels to GPU ───────────────────────────────────────────────
  if (!MAP._fogTexture) {
    MAP._fogTexture = PIXI.Texture.from(canvas);
  } else {
    // Tell PixiJS the canvas pixels changed so it re-uploads to the GPU on next render.
    MAP._fogTexture.source.update();
  }

  // Reuse the sprite; create it once and just reposition on pan/zoom.
  if (!MAP._fogSprite) {
    MAP._fogSprite = new PIXI.Sprite(MAP._fogTexture);
    MAP._fogSprite.eventMode = 'none'; // never block pointer events to tokens below
    layers.fog.removeChildren();
    layers.fog.addChild(MAP._fogSprite);
  }

  // Reposition: the canvas covers the screen, but the fog layer inherits the
  // stage transform (pan × zoom). Counter it so the sprite stays screen-fixed.
  MAP._fogSprite.x = -panX / z;
  MAP._fogSprite.y = -panY / z;
  MAP._fogSprite.scale.set(1 / z);
}

export function applyBrushAt(e) {
  if (!MAP.mapData) return;
  const rect = MAP.app.canvas.getBoundingClientRect();
  const gs = effectiveGs(MAP.mapData);
  const ox = (MAP._bgOffset?.x ?? 0) + (MAP.mapData.gridOffsetX || 0);
  const oy = (MAP._bgOffset?.y ?? 0) + (MAP.mapData.gridOffsetY || 0);
  const z = MAP.zoom || 1;
  const cx = Math.floor(((e.clientX - rect.left - MAP.panX) / z - ox) / gs);
  const cy = Math.floor(((e.clientY - rect.top  - MAP.panY) / z - oy) / gs);
  const key = `${cx},${cy}`;
  const newState = MAP.activeTool === 'brush-reveal' ? 'visible' : 'unexplored';
  if (MAP.mapData.fogState[key] !== newState) {
    MAP.mapData.fogState[key] = newState;
    renderFog();
  }
}

export async function saveFogState() {
  if (!MAP.mapData || !MAP.campaignId || !MAP.mapId) return;
  await storageSet(hubFogKey(MAP.campaignId, MAP.mapId), MAP.mapData.fogState || {});
  const cells = Object.entries(MAP.mapData.fogState);
  await realtimePublish(EV.FOG_REVEAL, { type: EV.FOG_REVEAL, campaignId: MAP.campaignId, mapId: MAP.mapId, cells, fromUserId: userId });
}

export async function resetFog() {
  if (!confirm('Cover the whole map with fog again? (Ctrl+Z puts it back.)')) return;
  fogBefore();
  MAP.mapData.fogState = {};
  fogAfter();
  await storageSet(hubFogKey(MAP.campaignId, MAP.mapId), {});
  renderFog();
  await realtimePublish(EV.FOG_RESET, { type: EV.FOG_RESET, campaignId: MAP.campaignId, fromUserId: userId });
}
