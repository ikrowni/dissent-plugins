// dnd-hub-weather-model.js — the map's weather as particles (pure; dnd-hub-weather.js draws them).
// A map's weather: { kind, strength } on mapData.weather, set by the DM (Weather in the toolbar), seen by everyone.

export const WEATHER = {
  none:   { label: 'Clear' },
  rain:   { label: 'Rain',    count: 260, speed: [9, 14],   drift: 2.2,  size: [10, 18], colour: '170,190,220', alpha: 0.45, shape: 'streak' },
  storm:  { label: 'Storm',   count: 420, speed: [13, 19],  drift: 4.5,  size: [14, 24], colour: '170,190,220', alpha: 0.55, shape: 'streak', flashes: true },
  snow:   { label: 'Snow',    count: 220, speed: [0.6, 1.6], drift: 0.6, size: [1.5, 3.5], colour: '240,245,255', alpha: 0.85, shape: 'flake', sway: 1.2 },
  fog:    { label: 'Fog',     count: 14,  speed: [0.15, 0.4], drift: 0.35, size: [180, 340], colour: '200,205,215', alpha: 0.10, shape: 'cloud' },
  embers: { label: 'Embers',  count: 90,  speed: [-1.4, -0.5], drift: 0.4, size: [1.2, 2.8], colour: '255,170,70', alpha: 0.9, shape: 'spark', sway: 0.8 },
  ash:    { label: 'Ash',     count: 140, speed: [0.3, 0.9], drift: 0.5,  size: [1.5, 3], colour: '150,145,140', alpha: 0.7, shape: 'flake', sway: 0.9 },
};
export const KINDS = Object.keys(WEATHER);

/** A stored weather value, made safe: unknown kinds are clear; strength between 0.2 and 1 (default 0.6). */
export function normWeather(w) {
  const kind = KINDS.includes(w?.kind) ? w.kind : 'none';
  const s = Number(w?.strength);
  return { kind, strength: Number.isFinite(s) ? Math.min(1, Math.max(0.2, s)) : 0.6 };
}

const between = ([a, b], rng) => a + (b - a) * rng();

/** One particle anywhere in a w×h area (`fresh`: start just outside the edge it flows in from). */
export function spawn(kind, w, h, rng = Math.random, fresh = false) {
  const k = WEATHER[kind];
  const vy = between(k.speed, rng);
  return { x: rng() * (w + 200) - 100, y: fresh ? (vy > 0 ? -20 - rng() * 60 : h + 20 + rng() * 60) : rng() * h,
    vy, vx: k.drift * (0.5 + rng() * 0.5) * (kind === 'fog' ? (rng() < 0.5 ? -1 : 1) : 1),
    size: between(k.size, rng), phase: rng() * Math.PI * 2, a: k.alpha * (0.5 + rng() * 0.5) };
}

/** How many particles for this strength. */
export const countFor = (kind, strength) => Math.round((WEATHER[kind]?.count || 0) * normWeather({ kind, strength }).strength);

/** Move a particle on by `dt` frames (60 per second); true when it has left the area and should be respawned. */
export function step(p, kind, dt, w, h) {
  const k = WEATHER[kind];
  p.phase += 0.02 * dt;
  p.x += (p.vx + (k.sway ? Math.sin(p.phase) * k.sway : 0)) * dt;
  p.y += p.vy * dt;
  return p.y > h + 40 || p.y < -80 || p.x > w + 400 || p.x < -400;
}
