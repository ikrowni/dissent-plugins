import { describe, it, expect } from 'vitest';
import { makeEnemy } from './ul-enemies.js';
import { hurtEnemy } from './ul-combat.js';
import { GNAW_BITERS } from './ul-gnawer.js';
import { GLASS_TIME } from './ul-hazards.js';
import { settled, flatRoom, run, idle, press } from './tests/kit.js';

/** A wide flat room, the player at the left, enemies added on the floor. */
function arena(add, width = 60) {
  const S = settled(flatRoom(width, 10));
  for (const [ch, x] of add) S.enemies.push(...makeEnemy(S, ch, x, 8 * 24 + 12));
  run(S, 0.3); S.fx = [];
  return S;
}

describe('Gnawers', () => {
  it('come as a pack of three to five', () => {
    for (let seed = 1; seed < 30; seed++) {
      const S = settled(flatRoom(40, 10), { seed }), n = makeEnemy(S, 'r', 300, 204).length;
      expect(n).toBeGreaterThanOrEqual(3); expect(n).toBeLessThanOrEqual(5);
    }
  });
  it('bite, but never more than two at once, and outside the attack tokens', () => {
    const S = arena([['r', 200], ['r', 220]]);
    let most = 0;
    run(S, 5, () => { most = Math.max(most, S.enemies.filter((e) => e.state === 'bite' || e.state === 'attack-g').length); return idle(); });
    expect(most).toBe(GNAW_BITERS);
    expect(S.player.hp).toBeLessThan(100);
  });
  it('scatter from a thrown lantern', () => {
    const S = arena([['r', 300]]);
    S.lantern = { state: 'rest', x: S.enemies[0].x + 20, y: S.enemies[0].y, hitSet: new Set() };
    run(S, 0.2);
    expect(S.enemies.every((e) => e.state === 'flee')).toBe(true);
  });
});

describe('the Bottler', () => {
  it('lobs a bottle with a red tell that hits you if you stand still', () => {
    const S = arena([['b', 400]]);
    let wound = false, sawBottle = false;
    run(S, 4, () => { if (S.enemies[0].state === 'windup' && S.enemies[0].mode === 'throw') wound = true; if (S.shots.length) sawBottle = true; return idle(); });
    expect(wound && sawBottle).toBe(true);
    expect(S.player.hp).toBeLessThan(100);
  });
  it('leaves glass where a bottle misses and breaks on the floor', () => {
    const S = arena([['b', 420]]);
    for (let i = 0; i < 600 && !S.shots.length; i++) run(S, 1 / 120);
    expect(S.shots.length).toBe(1);
    S.player.x += 300; // out from under it
    run(S, 1.2);
    expect(S.hazards.length).toBeGreaterThan(0);
    expect(S.hazards.every((h) => h.kind === 'glass')).toBe(true);
  });
  it('glass hurts you if you stand in it, and clears after a while', () => {
    const S = arena([]);
    S.hazards.push({ kind: 'glass', x: S.player.x - 4, y: S.player.y + S.player.h - 6, w: 24, h: 6, t: GLASS_TIME });
    run(S, 0.05);
    expect(S.player.hp).toBe(90);
    run(S, GLASS_TIME);
    expect(S.hazards).toEqual([]);
  });
});

describe('the Lid-bearer', () => {
  it('takes nothing from the front and everything from behind', () => {
    const S = arena([['l', 300]]), e = S.enemies[0];
    e.face = -1; // facing the player, who is to the left
    expect(hurtEnemy(S, e, 20, 10, 0, e.x - 30)).toBe('shielded');
    expect(e.hp).toBe(70);
    hurtEnemy(S, e, 20, 10, 0, e.x + e.w + 30);
    expect(e.hp).toBe(50);
  });
  it('drops the lid for 2.5 s when you parry his shove', () => {
    const S = arena([['l', 120]]), e = S.enemies[0];
    let parried = false;
    run(S, 6, () => {
      const parryNow = e.state === 'windup' && e.t < 0.1;
      if (S.stats.parries) parried = true;
      return press({ block: true, blockPress: parryNow });
    });
    expect(parried).toBe(true);
    expect(e.lidDownT).toBeGreaterThan(0);
    expect(hurtEnemy(S, e, 10, 0, 0, e.face > 0 ? e.x + e.w + 20 : e.x - 20)).not.toBe('shielded');
  });
  it('turns his lid toward a thrown lantern behind him', () => {
    const S = arena([['l', 300]]), e = S.enemies[0];
    e.face = -1;
    S.lantern = { state: 'rest', x: e.x + 150, y: e.y + 20, hitSet: new Set() };
    run(S, 0.8);
    expect(e.face).toBe(1);
  });
});
