// ul-rng.js — a seeded random source (mulberry32). The game never calls Math.random, so one seed gives one run:
// tests can pin behaviour, and in co-op (piece 3) every machine can agree.
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const between = (r, a, b) => a + r() * (b - a);
