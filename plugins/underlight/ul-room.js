// ul-room.js — a room from rows of text, and what is at a tile.
import { TS } from './ul-const.js';

/** Spawn letters a room may hold. Anything else that isn't a tile is a mistake in the room, not air. */
export const SPAWN_LETTERS = 'PShmnXorblKF';

/**
 * '#' stone, '^' spikes (solid, hurt from above), '-' a thin ledge you can jump up through, ' ' air.
 * Letters are spawns (P you, S sconce, h Shade, m Moth, n Snuffer, r a pack of Gnawers, b Bottler, l Lid-bearer, X the stairs down,
 * o an oil cache, K the Rat King, F a camp's fire) and leave air behind.
 * Rows shorter than the widest are padded with air. Exactly one P.
 */
export function parseRoom(rows) {
  const cols = Math.max(...rows.map((r) => r.length));
  const tiles = [], spawns = [];
  rows.forEach((row, r) => {
    const line = [];
    for (let c = 0; c < cols; c++) {
      const ch = row[c] ?? ' ';
      if (ch === '#' || ch === '^' || ch === '-' || ch === ' ') { line.push(ch); continue; }
      if (!SPAWN_LETTERS.includes(ch)) throw new Error(`room row ${r} col ${c}: unknown "${ch}"`);
      line.push(' ');
      spawns.push({ ch, x: c * TS + TS / 2, y: r * TS + TS / 2 });
    }
    tiles.push(line);
  });
  const players = spawns.filter((s) => s.ch === 'P').length;
  if (players !== 1) throw new Error(`a room needs exactly one P, this one has ${players}`);
  return { cols, rows: rows.length, w: cols * TS, h: rows.length * TS, tiles, spawns };
}

/** Outside the room is stone, so nothing ever falls or walks out of it. */
export function tileAt(room, c, r) {
  return c < 0 || r < 0 || c >= room.cols || r >= room.rows ? '#' : room.tiles[r][c];
}
export const isSolidTile = (t) => t === '#' || t === '^';
export const solid = (room, c, r) => isSolidTile(tileAt(room, c, r));
export const solidPt = (room, x, y) => solid(room, Math.floor(x / TS), Math.floor(y / TS));
