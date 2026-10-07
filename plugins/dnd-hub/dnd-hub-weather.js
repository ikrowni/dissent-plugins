// dnd-hub-weather.js — weather over the map: rain, storm, snow, fog, embers, ash (dnd-hub-weather-model.js).
// The DM picks it in the toolbar (Weather); it is stored on the map (mapData.weather) and sent to every screen.
// The layer reads the open map's weather on every frame, so a map load or a change needs no other hook. With no
// weather it sleeps on a slow timer; with the page hidden it pauses. Reduced motion: a still tint, no particles.
import { MAP, serverData, userId } from './dnd-hub-state.js?v=20261014y';
import { saveHubDm } from './dnd-hub-storage.js?v=20261014y';
import { realtimePublish } from './dnd-hub-publish.js';
import { CLIENT_ID } from './dnd-hub-client-id.js';
import { WEATHER, KINDS, normWeather, spawn, step, countFor } from './dnd-hub-weather-model.js';

let cv = null, ctx = null, parts = [], kind = 'none', strength = 0, last = 0, flash = 0, running = false;
const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

/** Start the weather layer for the campaign view just drawn (safe to call again). */
export function startWeather() {
  const wrap = document.getElementById('map-canvas-wrap');
  if (!wrap) return;
  if (!cv || !wrap.contains(cv)) {
    cv = document.createElement('canvas');
    cv.id = 'lk-weather';
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6';
    wrap.appendChild(cv);
    ctx = cv.getContext('2d');
    kind = 'none'; strength = 0; parts = [];
  }
  if (!running) { running = true; tick(performance.now()); }
}

function size() {
  const d = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.max(1, Math.round(cv.clientWidth * d)), h = Math.max(1, Math.round(cv.clientHeight * d));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; return true; }
  return false;
}

function tick(t) {
  if (!cv || !document.body.contains(cv)) { running = false; cv = null; return; }
  const w = normWeather(MAP.mapData?.weather);
  const shown = !document.hidden && !document.getElementById('screen-campaign')?.classList.contains('hidden');
  const resized = size();
  if (w.kind !== kind || w.strength !== strength || resized) {
    kind = w.kind; strength = w.strength;
    parts = Array.from({ length: countFor(kind, strength) }, () => spawn(kind, cv.width, cv.height));
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (still() && kind !== 'none') tint();
  }
  if (kind === 'none' || !shown || still()) { setTimeout(() => tick(performance.now()), 600); return; }
  const dt = Math.min(3, (t - (last || t)) / 16.7 || 1);
  last = t;
  draw(dt);
  requestAnimationFrame(tick);
}

function draw(dt) {
  const k = WEATHER[kind], W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  for (const p of parts) {
    if (step(p, kind, dt, W, H)) Object.assign(p, spawn(kind, W, H, Math.random, true));
    const c = `rgba(${k.colour},${p.a.toFixed(3)})`;
    if (k.shape === 'streak') {
      ctx.strokeStyle = c; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * p.size / p.vy, p.y - p.size); ctx.stroke();
    } else if (k.shape === 'cloud') {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
      g.addColorStop(0, c); g.addColorStop(1, `rgba(${k.colour},0)`);
      ctx.fillStyle = g; ctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
    } else {
      if (k.shape === 'spark') { ctx.fillStyle = `rgba(${k.colour},${(p.a * 0.25).toFixed(3)})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 3, 0, 7); ctx.fill(); }
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
    }
  }
  // A storm's lightning: a soft, rare flash (never under reduced motion; this path does not run then).
  if (k.flashes) {
    if (Math.random() < 0.0016 * strength * dt) flash = 1;
    if (flash > 0.02) { ctx.fillStyle = `rgba(220,230,255,${(flash * 0.22).toFixed(3)})`; ctx.fillRect(0, 0, W, H); flash *= Math.pow(0.86, dt); }
  }
}

function tint() {
  const k = WEATHER[kind];
  ctx.fillStyle = `rgba(${k.colour},${kind === 'fog' ? 0.22 : 0.08})`;
  ctx.fillRect(0, 0, cv.width, cv.height);
}

// ── The DM's Weather popover ────────────────────────────────────────────────────────────────────────────────
export function toggleWeatherPanel() {
  const old = document.getElementById('weather-panel');
  if (old) { old.remove(); return; }
  const w = normWeather(MAP.mapData?.weather);
  const el = document.createElement('div');
  el.id = 'weather-panel'; el.className = 'lk-pop';
  el.innerHTML = `<div class="lk-pop-title">Weather on this map</div>
    <div class="lk-chips">${KINDS.map(k => `<button aria-pressed="${w.kind === k}" onclick="setWeather('${k}')">${WEATHER[k].label}</button>`).join('')}</div>
    <label class="lk-pop-row">Strength <input type="range" min="0.2" max="1" step="0.1" value="${w.strength}" onchange="setWeather(null, this.value)"></label>
    <div class="lk-pop-note">Everyone at the table sees it. It stays with this map.</div>`;
  document.getElementById('map-root')?.appendChild(el);
}

export async function setWeather(k, s) {
  if (!MAP.isDM || !MAP.mapData) return;
  const cur = normWeather(MAP.mapData.weather);
  const weather = normWeather({ kind: k ?? cur.kind, strength: s ?? cur.strength });
  MAP.mapData.weather = weather;
  document.querySelectorAll('#weather-panel .lk-chips button').forEach(b => b.setAttribute('aria-pressed', String(b.textContent === WEATHER[weather.kind].label)));
  const camp = serverData?.campaigns?.[MAP.campaignId];
  if (camp?.maps && MAP.mapId) { camp.maps[MAP.mapId] = MAP.mapData; saveHubDm(serverData).catch(() => {}); }
  await realtimePublish('map:weather', { type: 'map:weather', clientId: CLIENT_ID, campaignId: MAP.campaignId, mapId: MAP.mapId, weather, fromUserId: userId });
}
