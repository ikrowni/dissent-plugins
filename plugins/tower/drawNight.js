import { FH, WL, WR, WW } from "./tuning.js";

/**
 * The Night tower (spec §5), as in the mock the owner picked: a sky that darkens as you climb, stars and the
 * moon, a little town below (the websites' houses = nodes), stone walls, wooden beams, stone landings with a
 * hanging lantern, and the rising night mist. Draws in world units; the caller has scaled the canvas.
 */

const hash = (a, b) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const STARS = Array.from({ length: 160 }, (_, i) => ({ x: hash(i, 1) * WW, y: hash(i, 2) * 2400, r: 0.4 + hash(i, 3) * 1.3, tw: hash(i, 4) * 6 }));
const HOUSES = Array.from({ length: 9 }, (_, i) => ({ x: 20 + i * 70 + hash(i, 5) * 20, w: 44 + hash(i, 6) * 24, h: 34 + hash(i, 7) * 40, roof: hash(i, 8) > 0.4 }));
export const SERIF = '"Fraunces","Iowan Old Style",Georgia,serif';

/** The sky, in screen space (no camera translate). cam = world y at the top of the view; vh = view height. */
export function drawSky(c, cam, vh, floors, nowS, reduced) {
  const h = Math.max(0, Math.min(1, -cam / (floors * FH)));
  const g = c.createLinearGradient(0, 0, 0, vh);
  g.addColorStop(0, `rgb(${10 - h * 5},${12 - h * 6},${34 - h * 14})`);
  g.addColorStop(1, `rgb(${28 - h * 18},${30 - h * 18},${62 - h * 30})`);
  c.fillStyle = g;
  c.fillRect(0, 0, WW, vh);
  c.fillStyle = "#fff6e2";
  for (const s of STARS) {
    const y = (((s.y - cam * 0.12) % 2400) + 2400) % 2400;
    if (y > vh) continue;
    c.globalAlpha = reduced ? 0.6 : 0.45 + Math.sin(nowS * 1.6 + s.tw) * 0.3;
    c.fillRect(s.x, y, s.r, s.r);
  }
  c.globalAlpha = 1;
  const my = 70 + ((cam * 0.04) % 40);
  const mg = c.createRadialGradient(WW - 120, my, 0, WW - 120, my, 70);
  mg.addColorStop(0, "rgba(255,240,210,.35)");
  mg.addColorStop(1, "transparent");
  c.fillStyle = mg;
  c.fillRect(WW - 200, my - 80, 160, 160);
  c.fillStyle = "#f7ecd6";
  c.beginPath();
  c.arc(WW - 120, my, 16, 0, Math.PI * 2);
  c.fill();
  // The town below, at half parallax: in view at the start, gone after a few floors.
  const base = vh - 70 + (-cam - (vh - 110)) * 0.5;
  if (base - 120 < vh) {
    for (const hs of HOUSES) {
      c.fillStyle = "#0b0e20";
      c.fillRect(hs.x, base - hs.h, hs.w, hs.h + 200);
      if (hs.roof) {
        c.beginPath();
        c.moveTo(hs.x - 4, base - hs.h);
        c.lineTo(hs.x + hs.w / 2, base - hs.h - 20);
        c.lineTo(hs.x + hs.w + 4, base - hs.h);
        c.fill();
      }
      c.fillStyle = "rgba(255,190,118,.25)"; // the window's glow: a slightly bigger, faint rectangle
      c.fillRect(hs.x + 7, base - hs.h + 8, 11, 13);
      if (hs.w > 54) c.fillRect(hs.x + hs.w - 19, base - hs.h + 8, 11, 13);
      c.fillStyle = "#ffbe76";
      c.fillRect(hs.x + 9, base - hs.h + 10, 7, 9);
      if (hs.w > 54) c.fillRect(hs.x + hs.w - 17, base - hs.h + 10, 7, 9);
    }
  }
}

/** The stone walls, in world space. */
export function drawWalls(c, cam, vh) {
  c.fillStyle = "#211c2b";
  c.fillRect(0, cam, WL, vh);
  c.fillRect(WR, cam, WW - WR, vh);
  c.strokeStyle = "rgba(0,0,0,.45)";
  c.lineWidth = 1;
  c.beginPath();
  for (let y = Math.floor(cam / 26) * 26; y < cam + vh; y += 26) {
    c.moveTo(0, y); c.lineTo(WL, y); c.moveTo(WR, y); c.lineTo(WW, y);
    const off = (Math.round(y / 26) % 2) * 9;
    c.moveTo(off + 6, y); c.lineTo(off + 6, y + 26); c.moveTo(WR + off + 6, y); c.lineTo(WR + off + 6, y + 26);
  }
  c.stroke();
  c.fillStyle = "rgba(255,190,118,.18)";
  c.fillRect(WL - 2, cam, 2, vh);
  c.fillRect(WR, cam, 2, vh);
}

/** One ledge, in world space; `iceMs` is the race clock, for Slick's frost. */
export function drawLedge(c, p, nowS, reduced, iceMs = -1) {
  drawLedgeBody(c, p, nowS, reduced);
  if ((p.slickUntil ?? -Infinity) > iceMs) { c.fillStyle = "rgba(190,225,255,.55)"; c.fillRect(p.x, p.y - 1, p.w, 5); }
}

function drawLedgeBody(c, p, nowS, reduced) {
  if (p.type === "ground") { // the tower's foundation: nothing shows through below the ground floor
    c.fillStyle = "#16121e"; c.fillRect(0, p.y, WW, 400);
  }
  if (p.type === "ground" || p.type === "landing") {
    c.fillStyle = "#3a3446"; c.fillRect(p.x, p.y, p.w, 16);
    c.fillStyle = "#57506a"; c.fillRect(p.x, p.y, p.w, 2.5);
    c.strokeStyle = "rgba(0,0,0,.35)"; c.lineWidth = 1;
    c.beginPath();
    for (let x = p.x + 30; x < p.x + p.w; x += 46) { c.moveTo(x, p.y + 3); c.lineTo(x, p.y + 16); }
    c.stroke();
    if (p.type !== "landing") return;
    const lx = p.x + p.w / 2, ly = p.y + 34;
    c.save();
    c.globalCompositeOperation = "lighter";
    const lg = c.createRadialGradient(lx, ly, 0, lx, ly, 150);
    lg.addColorStop(0, `rgba(255,170,90,${0.32 + (reduced ? 0 : Math.sin(nowS * 5 + p.floor) * 0.04)})`);
    lg.addColorStop(1, "transparent");
    c.fillStyle = lg;
    c.fillRect(lx - 150, ly - 150, 300, 300);
    c.restore();
    c.strokeStyle = "#1b1622"; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(lx, p.y + 16); c.lineTo(lx, ly - 8); c.stroke();
    c.fillStyle = "#ffcf8f"; c.fillRect(lx - 5, ly - 8, 10, 13); // the glow is the radial gradient above
    c.fillStyle = "#1b1622"; c.fillRect(lx - 7, ly - 10, 14, 3); c.fillRect(lx - 7, ly + 5, 14, 3);
    c.fillStyle = "rgba(243,230,207,.55)"; c.font = `italic 13px ${SERIF}`; c.textAlign = "left";
    c.fillText(`${p.floor}`, p.x + 10, p.y + 30);
    return;
  }
  if (p.type === "move") {
    c.strokeStyle = "rgba(160,150,170,.6)"; c.lineWidth = 1; c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(p.x + 10, p.y); c.lineTo(p.x + 10, p.y - 60); c.moveTo(p.x + p.w - 10, p.y); c.lineTo(p.x + p.w - 10, p.y - 60); c.stroke();
    c.setLineDash([]);
  }
  c.fillStyle = "#5b3d26"; c.fillRect(p.x, p.y, p.w, 11);
  c.fillStyle = "#8a5d36"; c.fillRect(p.x, p.y, p.w, 2.5);
  c.fillStyle = "#2c1c10"; c.fillRect(p.x, p.y + 9, p.w, 2);
  c.fillStyle = "#c99a4b"; c.fillRect(p.x + 5, p.y + 5, 2, 2); c.fillRect(p.x + p.w - 7, p.y + 5, 2, 2);
  if (p.type === "spring") {
    c.strokeStyle = "#c99a4b"; c.lineWidth = 2;
    c.beginPath();
    for (let i = 0; i <= 6; i++) c.lineTo(p.x + 16 + (i * (p.w - 32)) / 6, p.y - 2 - (i % 2) * 7);
    c.stroke();
  }
}

/** The top: a brass post with a glowing lantern. */
export function drawTop(c, y, nowS) {
  const x = WW / 2;
  c.fillStyle = "#c99a4b"; c.fillRect(x - 2, y - 60, 4, 60);
  const g = c.createRadialGradient(x, y - 70, 0, x, y - 70, 40);
  g.addColorStop(0, "rgba(255,190,118,.5)");
  g.addColorStop(1, "rgba(255,190,118,0)");
  c.fillStyle = g; c.fillRect(x - 40, y - 110, 80, 80);
  c.fillStyle = "#ffcf8f";
  c.beginPath(); c.arc(x, y - 70, 12 + Math.sin(nowS * 4), 0, Math.PI * 2); c.fill();
  c.fillStyle = "#f3e6cf"; c.font = `italic 24px ${SERIF}`; c.textAlign = "center";
  c.fillText("The top of the tower", x, y - 96);
}

/** The night mist, rising from below: three layers of waves. World space. */
export function drawMist(c, ty, cam, vh, nowS) {
  const colours = ["rgba(150,170,215,.22)", "rgba(110,130,185,.35)", "rgba(40,48,86,.92)"];
  for (let k = 0; k < 3; k++) {
    c.fillStyle = colours[k];
    c.beginPath();
    c.moveTo(WL, cam + vh + 10);
    for (let x = WL; x <= WR; x += 10) c.lineTo(x, ty + k * 16 + Math.sin(x * 0.03 + nowS * (1 + k * 0.4) + k) * 7);
    c.lineTo(WR, cam + vh + 10);
    c.closePath();
    c.fill();
  }
}

/** A player's name above their head. World space. */
export function drawName(c, name, x, y) {
  c.fillStyle = "#f3e6cf"; c.globalAlpha = 0.8; c.font = `12px ${SERIF}`; c.textAlign = "center";
  c.fillText(name, x, y - 58); c.globalAlpha = 1;
}

/** Edge markers, laid out by layoutMarkers. Screen space in world units; topY clears the HUD. */
export function drawMarkers(c, ms, topY, vh) {
  c.font = `12px ${SERIF}`;
  c.textAlign = "center";
  for (const m of ms) {
    const y = m.up ? topY : vh - 16;
    c.fillStyle = "rgba(12,14,30,.82)";
    c.beginPath();
    c.roundRect(m.x - m.w / 2, y - 11, m.w, 22, 11);
    c.fill();
    c.strokeStyle = m.color; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = "#f3e6cf";
    c.fillText(m.label, m.x, y + 4);
  }
}

/** A pick-up crate on its ledge: a small wooden box with a glowing "?". World space. */
export function drawCrate(c, x, y, nowS) {
  const g = c.createRadialGradient(x, y - 11, 0, x, y - 11, 22);
  g.addColorStop(0, `rgba(255,190,118,${0.25 + Math.sin(nowS * 4) * 0.08})`);
  g.addColorStop(1, "rgba(255,190,118,0)");
  c.fillStyle = g; c.fillRect(x - 22, y - 33, 44, 44);
  c.fillStyle = "#6b4a2a"; c.fillRect(x - 11, y - 22, 22, 22);
  c.strokeStyle = "#2c1c10"; c.lineWidth = 1.5; c.strokeRect(x - 11, y - 22, 22, 22);
  c.beginPath(); c.moveTo(x - 11, y - 22); c.lineTo(x + 11, y); c.stroke();
  c.fillStyle = "#ffcf8f"; c.font = `bold 14px ${SERIF}`; c.textAlign = "center"; c.fillText("?", x, y - 6);
}

/** A thrown bomb, its fuse blinking. World space. */
export function drawBomb(c, x, y, t) {
  c.fillStyle = "#15131c"; c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.fill();
  c.fillStyle = Math.floor(t * 12) % 2 ? "#ffcf6a" : "#ff5a36"; c.fillRect(x + 3, y - 11, 3, 3);
}

/** A blast ring, fading over `k` (1 → 0). World space. */
export function drawBlast(c, x, y, k) {
  c.strokeStyle = `rgba(255,210,122,${k})`; c.lineWidth = 3;
  c.beginPath(); c.arc(x, y, 130 * (1 - k) + 10, 0, Math.PI * 2); c.stroke();
}

/** King of the hill: the crown over the top ledge. World space. */
export function drawCrown(c, y, nowS) {
  const x = WW / 2, by = y - 120 + Math.sin(nowS * 2) * 3;
  c.fillStyle = "#e9c47c"; c.strokeStyle = "#7a5520"; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(x - 18, by); c.lineTo(x - 18, by - 14); c.lineTo(x - 9, by - 6); c.lineTo(x, by - 18);
  c.lineTo(x + 9, by - 6); c.lineTo(x + 18, by - 14); c.lineTo(x + 18, by); c.closePath(); c.fill(); c.stroke();
}

/** Ink on my screen: dark blots, fading out over the last 0.8 s. Screen space in world units. */
export function drawInk(c, vh, leftMs, seed) {
  c.globalAlpha = Math.min(1, leftMs / 800) * 0.92;
  c.fillStyle = "#121026";
  for (let b = 0; b < 6; b++) {
    const bx = hash(b, seed) * WW, by = (0.15 + hash(b + 9, seed) * 0.7) * vh, r = 50 + hash(b + 17, seed) * 90;
    c.beginPath();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, rr = r * (0.65 + hash(i, b + seed) * 0.5);
      c.lineTo(bx + Math.cos(a) * rr, by + Math.sin(a) * rr);
    }
    c.fill();
  }
  c.globalAlpha = 1;
}
