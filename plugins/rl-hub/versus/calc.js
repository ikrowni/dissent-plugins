// versus/calc.js — pure maths and formatting. No DOM, no module state.
// Everything here is covered by rl-hub-versus.test.js and must stay side-effect free.

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
}

export function calcPossessionFromTouches(blue, orange) {
  const total = blue + orange;
  if (total === 0) return { blue: 50, orange: 50 };
  return {
    blue:   Math.round(blue   / total * 100),
    orange: Math.round(orange / total * 100),
  };
}

export function calcOffDef(players) {
  const goals = players.reduce((s, p) => s + (p.goals  ?? 0), 0);
  const shots = players.reduce((s, p) => s + (p.shots  ?? 0), 0);
  const saves = players.reduce((s, p) => s + (p.saves  ?? 0), 0);
  const off   = goals + shots;
  const total = Math.max(off + saves, 1);
  return {
    off: Math.round(off   / total * 100),
    def: Math.round(saves / total * 100),
  };
}

export function calcShotAcc(players) {
  const goals = players.reduce((s, p) => s + (p.goals ?? 0), 0);
  const shots = players.reduce((s, p) => s + (p.shots ?? 0), 0);
  return Math.round(goals / Math.max(shots, 1) * 100);
}

export function normalizeBarPct(value, maxValue) {
  return Math.round(value / Math.max(maxValue, 1) * 100);
}

export function formatBallSpeed(uuPerSec) {
  return Math.round(uuPerSec / 100 * 3.6);
}

export function ballSpeedColor(kmh) {
  if (kmh >= 150) return 'max';
  if (kmh >= 80)  return 'fast';
  return 'slow';
}
