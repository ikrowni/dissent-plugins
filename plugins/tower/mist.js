import { FH, MIST } from "./tuning.js";

/**
 * The rising mist (spec §3.3). Starts MIST.startMs after GO, rises at a fixed speed that grows every
 * MIST.stepMs ("Hurry up!"), and races up ×MIST.catchUpMult while it is more than MIST.catchUpFloors behind
 * the leader. Never past two floors under the top. Up is negative. `extraSpeed`: last standing's +6 per player out.
 */
export function stepMist(y, raceMs, leaderY, topFloor, dt, extraSpeed = 0) {
  if (raceMs < MIST.startMs) return y;
  let speed = MIST.speed + MIST.stepSpeed * Math.floor(raceMs / MIST.stepMs) + extraSpeed;
  if (leaderY !== null && y - leaderY > FH * MIST.catchUpFloors) speed *= MIST.catchUpMult;
  return Math.max(y - speed * dt, -(topFloor - 2) * FH);
}

/** The "Hurry up!" level: how many speed-ups have happened by raceMs. */
export const mistLevel = (raceMs) => Math.floor(raceMs / MIST.stepMs);
