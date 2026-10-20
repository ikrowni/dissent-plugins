// ul-fx.js — what the game logic wants seen or heard. Logic only pushes events; the renderer and the sound code
// take them each frame. That keeps every rule testable without a canvas or an audio context.
//   { k: 'sfx', n }                       a named sound (ul-sound.js)
//   { k: 'text', x, y, s, col }           a floating word ("parried!")
//   { k: 'burst', x, y, n, col, glow, grav, spread }   sparks or ash
//   { k: 'shake', a }                     screen shake, pixels (the renderer skips it under reduced motion)
export const sfx = (S, n) => S.fx.push({ k: 'sfx', n });
export const text = (S, x, y, s, col) => S.fx.push({ k: 'text', x, y, s, col });
export const burst = (S, x, y, n, col, opts = {}) => S.fx.push({ k: 'burst', x, y, n, col, ...opts });
export const shake = (S, a) => S.fx.push({ k: 'shake', a });
/** The renderer and sound code call this once a frame. */
export function takeFx(S) { const out = S.fx; S.fx = []; return out; }
