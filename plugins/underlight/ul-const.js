// ul-const.js — the numbers every module shares. Tuned in the mock (docs/design/underlight-mock.html);
// the owner played it on 2026-10-19 and said it feels right, so these are the mock's defaults unchanged.
export const TS = 24;          // one tile, in world units
export const DT = 1 / 120;     // one fixed step
export const VIEW_H = 432;     // world units visible top to bottom, whatever the panel's size
export const SWING = 0.3;      // one sword swing, seconds
export const MAX_STEPS = 12;   // steps per frame before the clock gives up (a stalled tab)

export const DEFAULT_TUNE = Object.freeze({
  run: 230, accel: 2200, airAccel: 1500, decel: 2800, gravity: 2400, fallMult: 1.5, jump: 800,
  coyote: 100, buffer: 120, rollSpeed: 430, rollTime: 0.32, iframes: 0.22, rollCd: 0.35, parry: 0.15,
  tell: 0.6, tokens: 2, drain: 0.7, dark: 0.9, hitstop: 55,
});

/** What an attack's glow tells you (spec §7.2): white block or parry, red dodge, violet puts your light out. */
export const TELL = Object.freeze({ white: '#f4f1ea', red: '#ff4b3a', violet: '#a774ff' });
