import { describe, it, expect } from 'vitest';
import { newGame } from './ul-game.js';
import { hurtEnemy } from './ul-combat.js';
import { KING_HP, WAVE_DMG } from './ul-ratking.js';
import { RAT_KING_ARENA } from './biomes/cellars-arena.js';
import { solve } from './ul-solver.js';
import { targetsOf } from './ul-level.js';
import { parseRoom } from './ul-room.js';
import { DEFAULT_TUNE } from './ul-const.js';
import { run, idle, press, settled, flatRoom } from './tests/kit.js';

const arena = (seed = 1) => newGame(RAT_KING_ARENA, { seed, litSconces: true });
const parts = (S) => S.enemies.filter((e) => !e.dead && e.kind === 'king');
const quiet = (S) => { for (const p of parts(S)) { p.cd = 99; p.state = 'idle'; } }; // stop it attacking while we look

describe('the arena', () => {
  it('can be crossed: the stairs and every sconce in reach', () => {
    const room = parseRoom(RAT_KING_ARENA), res = solve(room, DEFAULT_TUNE, room.spawns.find((s) => s.ch === 'P'), targetsOf(room));
    expect(res.exitOk).toBe(true); expect(res.missing).toEqual([]); expect(res.trapped).toEqual([]);
  });
  it('starts lit, with the King, and the stairs shut while it lives', () => {
    const S = arena();
    expect(S.sconces.every((s) => s.lit)).toBe(true);
    expect(S.boss).toMatchObject({ phase: 1, hp: KING_HP, dead: false });
    S.player.x = S.exit.x - 9; S.player.y = S.exit.y + 12 - 40;
    quiet(S); run(S, 0.3);
    expect(S.over).toBe(null);
  });
});

describe('the Rat King', () => {
  it('takes damage into one pool, from any part', () => {
    const S = arena(), [c] = parts(S);
    hurtEnemy(S, c, 20, 0, 0);
    expect(S.boss.hp).toBe(KING_HP - 20);
  });
  it('tears into two halves at two thirds, and knots back together at one third', () => {
    const S = arena();
    S.boss.hp = KING_HP * 0.6; run(S, 0.05);
    expect(S.boss.phase).toBe(2);
    expect(parts(S).map((p) => p.form)).toEqual(['half', 'half']);
    S.boss.hp = KING_HP * 0.3; run(S, 0.05);
    expect(S.boss.phase).toBe(3);
    expect(parts(S).map((p) => p.form)).toEqual(['crown']);
  });
  it('in its last phase eats the arena\'s lights', () => {
    const S = arena();
    S.boss.hp = KING_HP * 0.6; run(S, 0.05); S.boss.hp = KING_HP * 0.3; run(S, 0.05);
    run(S, 1.3); // the roar
    for (const p of parts(S)) p.cd = 99; // only hunger, no attacks
    S.player.x = 30;
    run(S, 12, () => idle());
    expect(S.sconces.filter((s) => s.lit).length).toBeLessThan(6);
  });
  it('staggers, exposed, when you light a sconce near it in the dark', () => {
    const S = arena();
    S.boss.hp = KING_HP * 0.6; run(S, 0.05); S.boss.hp = KING_HP * 0.3; run(S, 0.05);
    const [k] = parts(S), s = S.sconces.reduce((a, b) => (Math.abs(b.x - k.x) < Math.abs(a.x - k.x) ? b : a));
    s.lit = false; k.state = 'idle';
    S.lantern = { state: 'rest', x: s.x + 10, y: s.y, vx: 0, vy: 0, hitSet: new Set() };
    run(S, 0.02);
    expect(s.lit).toBe(true);
    expect(k.state).toBe('stagger'); expect(k.exposedT).toBeGreaterThan(1.5);
  });
  it('slams a shockwave along the floor that hits you standing and misses you jumping', () => {
    for (const jump of [false, true]) {
      const S = arena(), [k] = parts(S);
      S.player.x = k.x - 200; quiet(S);
      k.state = 'windup'; k.move = 'slam'; k.t = 0; k.cd = 99;
      let sawWave = false;
      run(S, 2, (i) => {
        const w = S.hazards.find((h) => h.kind === 'wave' && h.vx < 0);
        if (w) sawWave = true;
        const close = w && w.x - (S.player.x + S.player.w) < 60 && w.x > S.player.x;
        return press({ jump: jump && close && S.player.onGround, jumpHeld: jump });
      });
      expect(sawWave).toBe(true);
      expect(S.player.hp, jump ? 'jumped' : 'stood').toBe(jump ? 100 : 100 - WAVE_DMG);
    }
  });
  it('dies all at once, drops oil, and opens the stairs', () => {
    const S = arena();
    S.boss.hp = 0; run(S, 0.05);
    expect(S.boss.dead).toBe(true);
    expect(parts(S)).toEqual([]);
    expect(S.drops.length).toBeGreaterThan(0);
    S.player.x = S.exit.x - 9; S.player.y = S.exit.y + 12 - 40;
    run(S, 0.2);
    expect(S.over).toBe('exit');
  });
});

describe('a thrown lantern', () => {
  it('lights an unlit sconce it lands beside, anywhere', () => {
    const S = settled(['#'.repeat(20), ...Array(6).fill('#' + ' '.repeat(18) + '#'), '#P       S        #', '#'.repeat(20)]);
    const s = S.sconces[0];
    S.lantern = { state: 'rest', x: s.x + 20, y: s.y + 6, vx: 0, vy: 0, hitSet: new Set() };
    run(S, 0.02);
    expect(s.lit).toBe(true);
  });
});
