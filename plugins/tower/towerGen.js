import { FH, WL, WR, WW } from "./tuning.js";

/**
 * The tower (spec §4): hand-made sections shuffled by the round's seed, so every machine builds the same
 * tower and no two rounds are alike. Pure: (seed, floors) → ledges. Every 10th floor is a full-width stone
 * landing; the first section is always the gentle zigzag.
 */

/** mulberry32: small, fast, the same on every machine. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const SECTIONS = {
  zigzag(r, st, f, i, add) {
    const w = 150 + r() * 40;
    const side = (i + st.flip) % 2;
    add({ floor: f, type: "plain", x: side ? WR - w - 20 - r() * 70 : WL + 20 + r() * 70, w });
  },
  stairs(r, st, f, i, add) {
    if (i === 0) st.dir = r() < 0.5 ? 1 : -1;
    let cx = st.lastX + st.dir * (100 + r() * 40);
    if (cx > WR - 80 || cx < WL + 80) {
      st.dir *= -1;
      cx = st.lastX + st.dir * 120;
    }
    add({ floor: f, type: "plain", x: cx - 60, w: 120 });
  },
  gaps(r, st, f, i, add) {
    if (i % 2 === 0) add({ floor: f, type: "plain", x: WL + 30 + r() * (WR - WL - 300), w: 220 + r() * 30 });
  },
  movers(r, st, f, i, add) {
    if (i % 3 === 2) {
      add({ floor: f, type: "plain", x: WL + 60 + r() * 360, w: 150 });
      return;
    }
    const range = 90 + r() * 70;
    const x0 = WL + 55 + range + r() * (WR - WL - 110 - 2 * range);
    add({ floor: f, type: "move", w: 110, x: x0 - 55, x0, range, spd: 0.7 + r() * 0.7, ph: r() * 6.28 });
  },
  // A spring throws you about 3½ floors straight up; the ledge it aims at sits within steering reach of it
  // (the climbable test found towers where a spring threw you somewhere with nothing in reach).
  springs(r, st, f, i, add) {
    const k = i % 4;
    const near = (w, spread) => clamp(st.lastX + (r() - 0.5) * spread, WL + w / 2 + 10, WR - w / 2 - 10) - w / 2;
    if (k === 1) add({ floor: f, type: "spring", x: near(84, 300), w: 84 });
    else if (k === 0) add({ floor: f, type: "plain", x: near(140, 360), w: 140 });
    else if (k === 3) add({ floor: f, type: "plain", x: near(130, 260), w: 130 });
  },
  twins(r, st, f, i, add) {
    add({ floor: f, type: "plain", x: WL + 24 + r() * 50, w: 120 });
    add({ floor: f, type: "plain", x: WR - 144 - r() * 50, w: 120 });
  },
  narrow(r, st, f, i, add) {
    const w = 72 + r() * 30;
    const cx = clamp(st.lastX + (r() - 0.5) * 380, WL + 60, WR - 60);
    add({ floor: f, type: "plain", x: cx - w / 2, w });
  },
};

export const SECTION_NAMES = Object.keys(SECTIONS);

/** Builds the tower for a round. floors is a multiple of 10 (50/100/150); the top floor is a landing. */
export function genTower(seed, floors) {
  const r = rng(seed);
  const ledges = [];
  const byFloor = [];
  const st = { lastX: WW / 2, dir: 1, flip: 0 };
  const add = (l) => {
    const x = clamp(l.x, WL, WR - l.w);
    const ledge = { ...l, x, id: ledges.length, y: -l.floor * FH, j: Array.from({ length: 8 }, () => r() * 2.4 - 1.2) };
    if (ledge.type === "move") ledge.dx = 0;
    ledges.push(ledge);
    (byFloor[ledge.floor] ||= []).push(ledge);
    st.lastX = x + l.w / 2;
  };
  add({ floor: 0, type: "ground", x: WL, w: WR - WL });
  for (let base = 1; base <= floors; base += 10) {
    const name = base === 1 ? "zigzag" : SECTION_NAMES[Math.floor(r() * SECTION_NAMES.length)];
    st.flip = r() < 0.5 ? 0 : 1;
    for (let i = 0; i < 9; i++) SECTIONS[name](r, st, base + i, i, add);
    add({ floor: base + 9, type: "landing", x: WL, w: WR - WL, section: name });
  }
  return { seed, floors, ledges, byFloor };
}

/** Moves the movers to time t (seconds since GO). Every machine computes the same positions. */
export function moveLedges(t, timeS) {
  for (const l of t.ledges) {
    if (l.type !== "move") continue;
    const nx = (l.x0) - l.w / 2 + Math.sin(timeS * (l.spd) + (l.ph)) * (l.range);
    l.dx = nx - l.x;
    l.x = nx;
  }
}

export const floorOf = (y) => Math.round(-y / FH);

/**
 * Puts the pick-up crates on the tower (spec §3.6): 1–2 on plain ledges per 10-floor section, or 60% of them in
 * Chaos. 🔴 A SEPARATE random stream from the ledges: the ledges stay exactly what piece 2 built from the same seed,
 * so a client that predates crates still climbs the same tower as everyone else.
 */
export function placeCrates(t, chaos, share) {
  const r = rng((t.seed ^ 0x9e3779b9) >>> 0);
  for (let base = 1; base <= t.floors; base += 10) {
    const plain = [];
    for (let f = base; f < base + 9; f++) for (const l of t.byFloor[f] ?? []) if (l.type === "plain") plain.push(l);
    const n = chaos ? Math.ceil(plain.length * share) : 1 + (r() < 0.5 ? 1 : 0);
    for (let k = 0; k < n && plain.length; k++) plain.splice(Math.floor(r() * plain.length), 1)[0].crate = true;
  }
}
