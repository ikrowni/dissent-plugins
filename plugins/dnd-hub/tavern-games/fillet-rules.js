// fillet-rules.js — Five-Finger Fillet without the drawing: the pattern, the tempo, and judging a stab.
//
// Six gaps (0 = outside the thumb … 5 = outside the little finger). The knife goes back to the thumb gap between each
// finger, out and back, ever faster. Strike the lit gap on the beat; three misses and your run is over. The host runs
// first; strike more times than they did to win. Dexterity widens the moment that counts as "on the beat".

export const GAPS = 6, MISSES = 3;
export const PATTERN = [0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 4, 0, 3, 0, 2, 0, 1];
export const HOST_RUN = { novice: [14, 22], regular: [22, 32], shark: [32, 44] };

export const targetGap = beat => PATTERN[beat % PATTERN.length];

/** Beats a minute at beat n: quicker every half pattern; `slowed` takes 18 off (a cheat that worked). */
export const bpm = (beat, slowed = false) => Math.min(170, 70 + 5 * Math.floor(beat / 9)) - (slowed ? 18 : 0);

/** When each beat falls, in seconds from the start (the first beat after a short count-in). */
export function beatTimes(n, slowedFrom = Infinity, lead = 1.2) {
  const out = []; let t = lead;
  for (let b = 0; b < n; b++) { out.push(t); t += 60 / bpm(b, b >= slowedFrom); }
  return out;
}

/** The beat times again after a slowed count from beat `from` on (the beats before it stay where they were). */
export function retime(times, from) {
  const out = times.slice(0, from + 1);
  for (let b = from + 1; b < times.length; b++) out.push(out[b - 1] + 60 / bpm(b - 1, true));
  return out;
}

/** How far off the beat still counts (seconds), from the stat edge (-1..1). */
export const windowFor = edge => (120 + 60 * Math.max(-1, Math.min(1, edge || 0))) / 1000;

/** A strike at `gap`, `dt` seconds off the beat (negative = early): perfect, hit, or miss (wrong gap or off time). */
export function judge(gap, target, dt, win) {
  if (gap !== target || Math.abs(dt) > win) return 'miss';
  return Math.abs(dt) <= win / 3 ? 'perfect' : 'hit';
}

/** The host's run: how many clean strikes before their third miss. */
export function hostStrikes(skill = 'regular', rng = Math.random) {
  const [lo, hi] = HOST_RUN[skill] ?? HOST_RUN.regular;
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export const result = (mine, theirs) => (mine > theirs ? 'hero' : mine < theirs ? 'host' : 'draw');
