import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePack, compileMap } from '../lk-content-pack.js';
import { adjustedEncounterXp } from '../lk-rules5e.js';

const here = dirname(fileURLToPath(import.meta.url));
const pack = JSON.parse(readFileSync(join(here, 'lanternkeep-sample.json'), 'utf8'));
const srd = {
  monsters: JSON.parse(readFileSync(join(here, '..', 'dnd-srd', 'monsters.json'), 'utf8')),
  magicItems: JSON.parse(readFileSync(join(here, '..', 'dnd-srd', 'magic-items.json'), 'utf8')),
};
const xpOf = id => srd.monsters.find(m => m.id === id).xp;
const BANDS = { easy: [100, 199], medium: [200, 299], hard: [300, 399] }; // four level-1 heroes

describe('The Dark Lighthouse', () => {
  it('is a sound pack whose monsters and items exist in the SRD', () => {
    expect(validatePack(pack, srd)).toEqual([]);
  });
  it('each fight sits in its intended band for four level-1 heroes', () => {
    for (const e of pack.encounters) {
      const adj = adjustedEncounterXp(e.items.map(i => ({ xp: xpOf(i.id), count: i.count })), 4);
      const [lo, hi] = BANDS[e.difficulty];
      expect(adj, `${e.id} = ${adj}`).toBeGreaterThanOrEqual(lo);
      expect(adj, `${e.id} = ${adj}`).toBeLessThanOrEqual(hi);
    }
  });
  it('every spawn cell is inside a room of the map', () => {
    const m = pack.maps[0];
    const inside = (cx, cy) => m.rooms.some(r => cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h);
    for (const e of pack.encounters) {
      const n = e.items.reduce((s, i) => s + i.count, 0);
      expect(e.spawn).toHaveLength(n);
      for (const c of e.spawn) expect(inside(c.cx, c.cy), `${e.id} ${c.cx},${c.cy}`).toBe(true);
    }
  });
  it('the hook is for players; every room is DM-only; the lamp-room door starts locked', () => {
    expect(pack.story.find(s => s.id === 'hook').visibility).toBe('player');
    expect(pack.story.filter(s => s.id.startsWith('room')).every(s => s.visibility === 'dm')).toBe(true);
    expect(compileMap(pack.maps[0]).doors['door-lamp'].state).toBe('locked');
  });
});
