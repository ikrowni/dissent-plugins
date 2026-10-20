// ul-figures.js — the silhouettes (spec §12): dark shapes on a skeleton, drawn in code. Each draw function only
// builds and fills paths in the current fillStyle/strokeStyle, so the renderer can draw a shape twice: once in
// lantern colour nudged toward the light (the rim), once in black over it.

/** The Lamplighter. st: { air, hang, roll (0..1 through a roll), block, atk: { prog, n } | null }. */
export function drawLamplighter(g, x, feet, face, ph, run, st, t) {
  g.save(); g.translate(x, feet); g.scale(face, 1);
  if (st.roll) {
    g.rotate(st.roll * Math.PI * 2);
    g.beginPath(); g.arc(0, -11, 11, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(-6, -20); g.lineTo(-14, -26); g.lineTo(-4, -18); g.fill();
    g.restore(); return;
  }
  const sw = Math.sin(ph) * 0.65 * run, sw2 = Math.sin(ph + Math.PI) * 0.65 * run, bob = Math.abs(Math.sin(ph)) * 1.5 * run;
  const air = st.air ? 0.5 : 0, hang = st.hang;
  if (st.block && !air) g.translate(0, 3); // the guard sits lower
  g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 4.2;
  const leg = (a, lift) => {
    g.beginPath(); g.moveTo(0, -17 - bob);
    const kx = Math.sin(a) * 9, ky = -9 - bob - lift;
    g.lineTo(kx, ky); g.lineTo(kx + Math.sin(a - 0.6 - air) * 9, -bob * 0.3 - lift * 0.4 + (hang ? -6 : 0)); g.stroke();
  };
  if (hang) { leg(-0.2, 2); leg(0.25, 0); }
  else if (st.block && !air) { leg(0.55, 1); leg(-0.5, 0); } // feet apart, braced
  else { leg(sw - air, air * 6); leg(sw2 + air, 0); }
  const flut = Math.sin(t * 6 + x * 0.1) * 1.4 * (run + air);
  g.beginPath();
  g.moveTo(-5.5, -34 - bob); g.lineTo(6, -34 - bob); g.lineTo(8 + flut, -12 - bob * 0.5); g.lineTo(2, -14 - bob * 0.5); g.lineTo(-11 - flut * 1.6, -11 - bob * 0.5);
  g.closePath(); g.fill();
  g.beginPath(); g.arc(1, -39 - bob, 6, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(-3, -45 - bob); g.quadraticCurveTo(-10, -46 - bob, -13 - flut, -38 - bob); g.lineTo(-4, -36 - bob); g.fill();
  g.lineWidth = 3.4;
  if (hang) {
    g.beginPath(); g.moveTo(3, -33); g.lineTo(9, -42); g.stroke();
    g.beginPath(); g.moveTo(-2, -33); g.lineTo(7, -43); g.stroke();
    g.restore(); return;
  }
  if (st.block) {
    g.beginPath(); g.moveTo(4, -32); g.lineTo(11, -27); g.lineTo(8, -21); g.stroke();      // bent front arm
    const bx = 8, by = -21, ba = -1.0;                                                       // blade up and forward
    g.lineWidth = 2.6; g.beginPath(); g.moveTo(bx - Math.cos(ba) * 5, by - Math.sin(ba) * 5); g.lineTo(bx + Math.cos(ba) * 27, by + Math.sin(ba) * 27); g.stroke();
    g.lineWidth = 3.4; g.beginPath(); g.moveTo(bx - 4, by - 2); g.lineTo(bx + 4, by + 2); g.stroke();   // crossguard
    g.lineWidth = 3.2; g.beginPath(); g.moveTo(-3, -32); g.lineTo(-10, -24); g.stroke();   // the lantern hand, pulled back
    g.restore(); return;
  }
  let a = 0.9 + sw * 0.3;
  if (st.atk) { const k = st.atk.prog, n = st.atk.n; a = n === 2 ? -1.9 + k * 3.6 : n === 3 ? -2.6 + k * 4.2 : 2.2 - k * 3.8; }
  const sx = 4, sy = -32 - bob, hx = sx + Math.cos(a) * 9, hy = sy + Math.sin(a) * 9 + 6;
  g.beginPath(); g.moveTo(sx, sy); g.lineTo(hx, hy); g.stroke();
  const ba = a - 0.25;
  g.lineWidth = 2.4; g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + Math.cos(ba) * 24, hy + Math.sin(ba) * 24); g.stroke();
  g.lineWidth = 3.4; g.beginPath();
  g.moveTo(hx - Math.cos(ba + 1.57) * 4, hy - Math.sin(ba + 1.57) * 4); g.lineTo(hx + Math.cos(ba + 1.57) * 4, hy + Math.sin(ba + 1.57) * 4); g.stroke();
  g.lineWidth = 3.2; g.beginPath(); g.moveTo(-3, -32 - bob); g.lineTo(-9, -25 - bob); g.stroke(); // the lantern hand
  g.restore();
}

/** The lantern: a little cage with a glowing core. Drawn over the darkness. */
export function drawLanternCage(g, x, y, swing, lit, rgb) {
  g.save(); g.translate(x, y); g.rotate(swing);
  g.strokeStyle = '#050505'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(0, -7); g.lineTo(0, -3); g.stroke();
  g.fillStyle = '#050505'; g.fillRect(-4, -3, 8, 2); g.fillRect(-4, 6, 8, 2);
  if (lit) { g.shadowColor = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`; g.shadowBlur = 14; }
  g.fillStyle = lit ? `rgb(${rgb[0]},${Math.min(255, rgb[1] + 40)},${Math.min(255, rgb[2] + 90)})` : '#3a2a1a';
  g.fillRect(-3, -1, 6, 7); g.shadowBlur = 0;
  g.fillStyle = '#050505'; g.fillRect(-0.6, -1, 1.2, 7);
  g.restore();
}

function shade(g, e, T) {
  const c = e.x + e.w / 2, b = e.y + e.h, f = e.face, t = e.anim;
  const wind = e.state === 'windup' ? 1 - Math.max(0, e.t) / T.tell : 0, lunge = e.state === 'attack' ? 1 : 0;
  g.beginPath();
  g.moveTo(c - 6, b); g.lineTo(c - 8 + Math.sin(t * 9) * 1.5, b - 18);
  g.quadraticCurveTo(c - 10 - wind * 4 * f, b - 40, c - 2 - wind * 6 * f, b - 46 + wind * 4);
  g.quadraticCurveTo(c + 6 * f, b - 50 + wind * 4, c + 7 * f, b - 40 + wind * 3);
  const reach = 10 - wind * 4 + lunge * 16;
  g.lineTo(c + (reach + 8) * f, b - 30 + Math.sin(t * 7) * 2); g.lineTo(c + (reach + 14) * f, b - 24);
  g.lineTo(c + (reach + 6) * f, b - 26); g.lineTo(c + (reach + 10) * f, b - 20); g.lineTo(c + 5 * f, b - 26);
  g.lineTo(c + 8, b - 10);
  for (let i = 0; i < 4; i++) g.lineTo(c + 7 - i * 4.5, b - (i % 2 ? 0 : 4));
  g.closePath(); g.fill();
}
function moth(g, e) {
  const c = e.x + e.w / 2, m = e.y + e.h / 2, flap = Math.sin(e.anim * (e.state === 'windup' ? 34 : 18)), f = e.face;
  g.beginPath(); g.ellipse(c, m, 4.5, 9, f * 0.5, 0, Math.PI * 2); g.fill();
  for (const s of [-1, 1]) {
    g.beginPath(); g.moveTo(c, m - 3);
    g.quadraticCurveTo(c + s * 22, m - 18 * flap - 8, c + s * 26, m - 4 * flap); g.quadraticCurveTo(c + s * 16, m + 6, c, m + 3); g.fill();
  }
  g.lineWidth = 1; g.beginPath(); g.moveTo(c + f * 2, m - 8); g.lineTo(c + f * 8, m - 15); g.moveTo(c + f, m - 8); g.lineTo(c + f * 3, m - 16); g.stroke();
}
function snuffer(g, e, T) {
  const c = e.x + e.w / 2, b = e.y + e.h, f = e.face, wind = e.state === 'windup' ? 1 - Math.max(0, e.t) / (T.tell * 1.35) : 0;
  const breath = e.state === 'breath' ? 1 : 0, stepY = Math.sin(e.anim * 5) * (Math.abs(e.vx) > 5 ? 2 : 0);
  g.beginPath();
  g.moveTo(c - 15, b); g.lineTo(c - 13, b - 6 + stepY);
  g.quadraticCurveTo(c - 20, b - 30 - wind * 6, c - 2, b - 32 - wind * 8);
  g.quadraticCurveTo(c + 12 * f, b - 30 - wind * 6, c + 14 * f, b - 20);
  const mouth = 4 + wind * 7 + breath * 9;
  g.lineTo(c + (22 + breath * 4) * f, b - 20 - mouth); g.lineTo(c + (22 + breath * 4) * f, b - 12 + mouth * 0.4); g.lineTo(c + 13 * f, b - 10);
  g.lineTo(c + 12, b - 4 - stepY); g.lineTo(c + 13, b); g.closePath(); g.fill();
}
/** kind → draw(g, e, T). */
export const ENEMY_SHAPES = { shade, moth, snuffer };
/** kind → its attack's tell colour name (spec §7.2). */
export const TELL_OF = { shade: 'white', moth: 'red', snuffer: 'violet' };
export const EYES = { shade: 'rgba(200,225,255,0.95)', moth: 'rgba(255,180,90,0.9)', snuffer: 'rgba(190,150,255,0.95)' };
