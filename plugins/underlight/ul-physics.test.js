import { describe, it, expect } from 'vitest';
import { parseRoom } from './ul-room.js';
import { moveX, moveY, groundAhead, wallAhead, standingOnOneWay, tryHang } from './ul-physics.js';

const body = (x, y, w = 18, h = 40) => ({ x, y, w, h, vx: 0, vy: 0 });

describe('moveX', () => {
  const room = parseRoom(['#####', '#P  #', '#   #', '#####']);
  it('stops flush against a wall on the right and says so', () => {
    const e = body(30, 26); e.vx = 100;
    moveX(room, e, 50);
    expect(e.x).toBe(4 * 24 - 18);
    expect([e.vx, e.hitWall]).toEqual([0, 1]);
  });
  it('stops flush against a wall on the left', () => {
    const e = body(30, 26);
    moveX(room, e, -20);
    expect([e.x, e.hitWall]).toEqual([24, -1]);
  });
});

describe('moveY', () => {
  const room = parseRoom(['#####', '#P  #', '#   #', '# - #', '#   #', '##^##']);
  it('lands on stone, falling a game step at a time', () => {
    const e = body(26, 40, 18, 40);
    for (let i = 0; i < 40 && !e.onGround; i++) moveY(room, e, 8, true); // 8 = 950 / 120, the fastest fall
    expect(e.onGround).toBe(true);
    expect(e.y + e.h).toBe(5 * 24);
  });
  it('lands on a thin ledge coming down from above it', () => {
    const e = body(50, 20, 10, 40); // bottom at 60, ledge top at 72
    moveY(room, e, 20, true);
    expect([e.onGround, e.y + e.h]).toEqual([true, 72]);
  });
  it('passes through a thin ledge from below, and while dropping', () => {
    const up = body(50, 80, 10, 20);
    moveY(room, up, -20, true);
    expect(up.y).toBe(60);
    const drop = body(50, 20, 10, 40);
    moveY(room, drop, 20, false);
    expect(drop.onGround).toBe(false);
  });
  it('flags landing on spikes', () => {
    const e = body(50, 60, 10, 40);
    moveY(room, e, 40, true);
    expect(e.spiked).toBe(true);
  });
  it('bumps its head on stone above', () => {
    const e = body(26, 30, 18, 40);
    moveY(room, e, -20, true);
    expect([e.y, e.vy]).toEqual([24, 0]);
  });
});

describe('walking sense', () => {
  // you stand on the stone at row 2, col 1; col 2 is a gap; col 3 is a wall at body height
  const room = parseRoom(['#####', '#P #', '## ##', '#####']);
  it('sees the floor end under the front foot', () => {
    expect(groundAhead(room, body(24, 8), 1)).toBe(true);   // front foot at 44, still col 1
    expect(groundAhead(room, body(30, 8), 1)).toBe(false);  // front foot at 50, the gap
  });
  it('sees a wall coming', () => {
    expect(wallAhead(room, body(30, 8), 1)).toBe(false);    // probe at 50, col 2 air
    expect(wallAhead(room, body(53, 8), 1)).toBe(true);     // probe at 73, col 3 stone
  });
  it('knows when you stand only on thin ledges', () => {
    const ledges = parseRoom(['#P #', '#--#', '#  #']);
    expect(standingOnOneWay(ledges, body(26, 0, 18, 24))).toBe(true);
    const mixed = parseRoom(['#P #', '#-##']);
    expect(standingOnOneWay(mixed, body(40, 0, 18, 24))).toBe(false); // feet over col 1 (ledge) and col 2 (stone)
  });
});

describe('tryHang', () => {
  // a wall two tiles high at col 5 (rows 3-4), with two rows of air above it
  const room = parseRoom(['#######', '#     #', '#P    #', '#    ##', '#    ##', '#######']);
  it('grabs the edge when your hands are near its top, and snaps to it', () => {
    const e = body(5 * 24 - 18, 72 - 10); // touching col 5, head 10 above its top
    expect(tryHang(room, e, 1)).toEqual({ side: 1, tx: 120, ty: 72 });
    expect(e.y).toBe(68);
  });
  it('does not grab a wall with no room above it', () => {
    const shut = parseRoom(['#######', '#     #', '#P   ##', '#    ##', '#    ##', '#######']);
    expect(tryHang(shut, body(5 * 24 - 18, 48 - 10), 1)).toBe(null);
  });
  it('does not grab when the top is far from your hands', () => {
    expect(tryHang(room, body(5 * 24 - 18, 72 + 30), 1)).toBe(null);
  });
});
