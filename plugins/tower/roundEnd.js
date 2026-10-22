import { MODES } from "./tuning.js";

/**
 * When a round is over from this machine's view, what it reports, and the live standings (spec §3.4, §3.7; the
 * report is the plugin's places, Dissent spec 2026-10-20-tower-plugin-design §3).
 * Pure: the round hands it a snapshot. 🔴 A report goes only when the round is OVER as I see it — never just
 * because I gave up or went out: the node settles 30 s after the FIRST report, so an early one would cut everyone
 * else's round short (piece 2's Give up did exactly that).
 */

const done = (p) => p.finishedMs !== null || p.quit;
const alive = (p) => p.outMs === null && !p.quit;
/** Out, or gave up (which counts as out then): for Last standing's order and report. */
const outAt = (p) => p.outMs ?? (p.quit ? p.quitMs : null);

export function roundOver(v) {
  if (v.players.length === 0) return false;
  if (v.mode === "last") return v.players.filter(alive).length <= (v.players.length > 1 ? 1 : 0);
  if (v.mode === "koth") {
    if (v.players.some((p) => p.crownMs >= MODES.crownWinMs)) return true;
    if (v.crownFirstMs !== null && v.raceMs - v.crownFirstMs >= MODES.crownMaxMs) return true;
    return v.players.every((p) => p.quit);
  }
  return v.players.every(done);
}

/** How long after the round is over from my view I report: the others' last claims (they ride in every position
 *  message) arrive meanwhile, so every copy ranks from the same numbers. Well under the node's 30 s. */
export const REPORT_DELAY_MS = 1500;

const clock = (ms) => {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}.${Math.floor((s % 1) * 10)}`;
};

/** A player's score for the leaderboard (higher is better) and how people see it. A finish always beats a floor. */
function scoreOf(v, p) {
  if (v.mode === "last") {
    const lasted = outAt(p) ?? v.raceMs;
    return { score: Math.max(0, Math.round(lasted)), label: `Lasted ${clock(lasted).slice(0, -2)}` };
  }
  if (v.mode === "koth") return { score: Math.round(p.crownMs), label: `Crown ${clock(p.crownMs).slice(0, -2)}` };
  if (p.finishedMs !== null) return { score: 10_000_000 - p.finishedMs, label: clock(p.finishedMs) };
  return { score: p.floor, label: `Floor ${p.floor}` };
}

/**
 * My report of the round (Dissent spec 2026-10-20-tower-plugin-design §3): every player ranked, ties sharing a place
 * (1, 1, 3), each with a score and its label. 🔴 Ranked only from what every player CLAIMED (their own finish, out
 * and crown times, carried in every message), so honest copies agree and the node can settle the round.
 */
export function placesOf(v) {
  const rows = standings(v);
  const key = (p) => v.mode === "last" ? String(outAt(p) ?? "standing")
    : v.mode === "koth" ? String(Math.round(p.crownMs))
    : p.finishedMs !== null ? `f${p.finishedMs}` : `floor${p.floor}`;
  let place = 0, prev = null;
  return rows.map((p, i) => {
    const k = key(p);
    if (k !== prev) { place = i + 1; prev = k; }
    return { user_id: p.id, place, ...scoreOf(v, p) };
  });
}

/** Live standings, as the node will order them (lobby/tower_settle.go `better`). */
export function standings(v) {
  const rows = [...v.players];
  return rows.sort((a, b) => {
    if (v.mode === "last") {
      const ao = outAt(a), bo = outAt(b);
      if ((ao === null) !== (bo === null)) return ao === null ? -1 : 1;
      if (ao !== null && bo !== null && ao !== bo) return bo - ao;
    } else if (v.mode === "koth") {
      if (a.crownMs !== b.crownMs) return b.crownMs - a.crownMs;
    } else {
      if ((a.finishedMs === null) !== (b.finishedMs === null)) return a.finishedMs === null ? 1 : -1;
      if (a.finishedMs !== null && b.finishedMs !== null && a.finishedMs !== b.finishedMs) return a.finishedMs - b.finishedMs;
    }
    return b.floor - a.floor;
  });
}
