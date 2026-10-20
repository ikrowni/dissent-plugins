import { describe, it, expect } from 'vitest';
import { DT } from './ul-const.js';
import { newGame, step } from './ul-game.js';
import { hurtPlayer } from './ul-combat.js';
import { flatRoom, settled, run, idle, press } from './tests/kit.js';

const highest = (S, inp, seconds = 0.8) => {
  const y0 = S.player.y; let top = y0;
  run(S, seconds, (i) => { top = Math.min(top, S.player.y); return i === 0 ? inp : { ...idle(), jumpHeld: inp.jumpHeld }; });
  return y0 - top;
};

describe('jumping', () => {
  it('a held jump rises about 5.5 tiles (the mock tuning)', () => {
    const rise = highest(settled(flatRoom()), press({ jump: true, jumpHeld: true }));
    expect(rise).toBeGreaterThan(120);
    expect(rise).toBeLessThan(140);
  });
  it('a tapped jump goes much lower', () => {
    const rise = highest(settled(flatRoom()), press({ jump: true, jumpHeld: false }));
    expect(rise).toBeLessThan(40);
  });

  // a stone ledge three tiles wide (row 7), with a drop to the right
  // a stone ledge (row 3) with a seven-row drop to its right, long enough to still be falling 0.2 s later
  const ledge = ['##########', '#        #', '#        #', '#P       #', '####     #', '#        #', '#        #', '#        #', '#        #', '#        #', '#        #', '##########'];
  const walkOff = (wait) => {
    const S = settled(ledge);
    let off = -1, i = 0;
    while (i < 400) {
      const now = S.player.onGround ? -1 : (off < 0 ? (off = i) : off);
      const jump = now >= 0 && i - off === wait;
      step(S, press({ dir: 1, jump, jumpHeld: jump }), DT);
      if (jump) return S.player.vy < 0;
      i++;
    }
    return null;
  };
  it('still jumps just after running off an edge (coyote time)', () => { expect(walkOff(8)).toBe(true); });
  it('but not long after', () => { expect(walkOff(24)).toBe(false); }); // 0.2 s, past the 0.1 s grace

  it('a press just before landing jumps on landing (the buffer)', () => {
    const S = settled(flatRoom(30, 12));
    S.player.y -= 150; S.player.vy = 0;
    let pressed = false, jumped = false;
    for (let i = 0; i < 300 && !jumped; i++) {
      const fall = 11 * 24 - (S.player.y + S.player.h);
      const now = !pressed && fall < S.player.vy * 0.08 && S.player.vy > 0;
      if (now) pressed = true;
      const wasAir = !S.player.onGround;
      step(S, press({ jump: now, jumpHeld: pressed }), DT);
      if (pressed && wasAir && S.player.vy < 0) jumped = true;
    }
    expect(pressed).toBe(true);
    expect(jumped).toBe(true);
  });
});

describe('getting hit', () => {
  const enemy = (x) => ({ kind: 'shade', x, y: 0, w: 16, h: 46, state: 'attack', t: 0, vx: 0 });
  it('a roll dodges for its first iframes seconds, then not', () => {
    const S = settled(flatRoom());
    step(S, press({ roll: true }), DT);
    expect(hurtPlayer(S, enemy(200), 20, 'white', 200)).toBe('dodged');
    expect(S.player.hp).toBe(100);
    run(S, 0.25); // past the 0.22 s dodge window
    expect(hurtPlayer(S, enemy(200), 20, 'white', 200)).toBe('hit');
  });
  it('a block press opens the parry window: a white hit is parried and its attacker exposed', () => {
    const S = settled(flatRoom());
    const e = enemy(S.player.x + 40);
    step(S, press({ block: true, blockPress: true }), DT);
    expect(hurtPlayer(S, e, 20, 'white', e.x)).toBe('parried');
    expect(e).toMatchObject({ state: 'stagger', exposedT: 1.6 });
    expect(S.player.hp).toBe(100);
    expect(S.stats.parries).toBe(1);
  });
  it('red and violet can never be parried, even inside the window', () => {
    for (const kind of ['red', 'violet']) {
      const S = settled(flatRoom());
      const e = enemy(S.player.x + 40);
      step(S, press({ block: true, blockPress: true }), DT);
      expect(hurtPlayer(S, e, 20, kind, e.x)).toBe('hit');
      expect(e.state).toBe('attack');
    }
  });
  it('after the window, holding block takes 30% of a white hit; red goes straight through', () => {
    const S = settled(flatRoom());
    const e = enemy(S.player.x + 40);
    step(S, press({ block: true, blockPress: true }), DT);
    run(S, 0.2, press({ block: true }));
    expect(hurtPlayer(S, e, 20, 'white', e.x)).toBe('blocked');
    expect(S.player.hp).toBe(94);
    S.player.inv = 0;
    expect(hurtPlayer(S, e, 20, 'red', e.x)).toBe('hit');
    expect(S.player.hp).toBe(74);
  });
  it('a violet hit puts the lantern out for 4 s, block or not', () => {
    const S = settled(flatRoom());
    hurtPlayer(S, enemy(S.player.x + 40), 10, 'violet', S.player.x + 40);
    expect(S.player.snuffT).toBe(4);
  });
  it('spikes hurt and throw you up', () => {
    const S = newGame(['########', '#      #', '#      #', '#P     #', '#^^^^^^#', '########']);
    for (let i = 0; i < 120 && S.player.hp === 100; i++) step(S, idle(), DT);
    expect(S.player.hp).toBe(75);
    expect(S.player.vy).toBeLessThan(0);
  });
});

describe('oil and the Dark', () => {
  it('drains at the tuned rate', () => {
    const S = settled(flatRoom());
    const before = S.player.oil;
    run(S, 2);
    expect(before - S.player.oil).toBeCloseTo(1.4, 1);
  });
  it('at zero, the Dark waits 1.5 s, then hurts 6 a second, and kills', () => {
    const S = settled(flatRoom());
    S.player.oil = 0;
    run(S, 1.4);
    expect(S.player.hp).toBe(100);
    run(S, 1.1);
    expect(S.player.hp).toBeCloseTo(100 - 6, 0);
    S.player.hp = 1;
    run(S, 0.5);
    expect(S.player).toMatchObject({ dead: true, cause: 'the Dark' });
  });
});

describe('the flask', () => {
  it('heals 45 after a 0.8 s drink, once', () => {
    const S = settled(flatRoom());
    S.player.hp = 40;
    step(S, press({ flask: true }), DT);
    run(S, 0.7);
    expect(S.player.hp).toBe(40);
    run(S, 0.15);
    expect(S.player.hp).toBe(85);
    step(S, press({ flask: true }), DT);
    run(S, 1);
    expect(S.player.hp).toBe(85);
  });
});

describe('the sword', () => {
  it('chains three swings when pressed during each', () => {
    const S = settled(flatRoom());
    const seen = new Set();
    run(S, 1, (i) => { seen.add(S.player.atkN); return press({ attack: i % 20 === 0 && i < 60 }); });
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });
});
