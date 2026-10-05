// bones-grid-rules.js — Bones Grid's rules, with no drawing: boards, scores, smashing, and how the host plays.
//
// Each side has three columns of three. A die goes in one of your columns; matching faces in a column multiply
// (each die scores face × how many of that face the column holds, so two 4s = 16, three 4s = 36). Placing a die
// knocks every die of the same face out of your rival's FACING column. When either board is full, the higher total wins.

export const COLS = 3, ROWS = 3;

export const emptyBoard = () => Array.from({ length: COLS }, () => []);

export function columnScore(col) {
  const n = {};
  for (const v of col) n[v] = (n[v] || 0) + 1;
  return col.reduce((t, v) => t + v * n[v], 0);
}
export const boardScore = b => b.reduce((t, c) => t + columnScore(c), 0);
export const isFull = b => b.every(c => c.length >= ROWS);
export const openColumns = b => b.map((c, i) => (c.length < ROWS ? i : -1)).filter(i => i >= 0);

/** Place `face` in `col` of `mine`; returns the new boards and how many of the rival's dice were smashed. */
export function place(mine, theirs, col, face) {
  if (mine[col].length >= ROWS) throw new Error('column full');
  const m = mine.map((c, i) => (i === col ? [...c, face] : c));
  const smashed = theirs[col].filter(v => v === face).length;
  const t = theirs.map((c, i) => (i === col ? c.filter(v => v !== face) : c));
  return { mine: m, theirs: t, smashed };
}

/** What a move is worth to the mover: my gain plus what the rival loses. */
export function moveValue(mine, theirs, col, face) {
  const r = place(mine, theirs, col, face);
  return (boardScore(r.mine) - boardScore(mine)) + (boardScore(theirs) - boardScore(r.theirs));
}

/**
 * The host's column for `face`. 'novice' mostly picks at random; 'regular' takes the best move now;
 * 'shark' also weighs what the hero could do back (the average best reply over the six faces).
 */
export function hostMove(host, hero, face, skill = 'regular', rand = Math.random) {
  const cols = openColumns(host);
  if (cols.length === 1) return cols[0];
  if (skill === 'novice' && rand() < 0.6) return cols[Math.floor(rand() * cols.length)];
  let best = cols[0], bestV = -Infinity;
  for (const c of cols) {
    let v = moveValue(host, hero, c, face);
    if (skill === 'shark') {
      const r = place(host, hero, c, face);
      let reply = 0;
      for (let f = 1; f <= 6; f++) {
        const hc = openColumns(r.theirs);
        reply += hc.length ? Math.max(...hc.map(x => moveValue(r.theirs, r.mine, x, f))) : 0;
      }
      v -= reply / 6 * 0.6;
      if (isFull(r.mine) && boardScore(r.mine) > boardScore(r.theirs)) v += 1000; // finishing ahead wins
    }
    v += rand() * 0.01; // break ties without always leaning left
    if (v > bestV) { bestV = v; best = c; }
  }
  return best;
}

/** Rerolls a hero gets from their stat edge (-1..1): 0, 1, or 2. A negative edge gives the HOST one instead. */
export function rerolls(edge) {
  return { hero: edge >= 0.9 ? 2 : edge >= 0.4 ? 1 : 0, host: edge <= -0.4 ? 1 : 0 };
}

/** The end: 'hero', 'host', 'draw', or null while play goes on. */
export function winner(hero, host) {
  if (!isFull(hero) && !isFull(host)) return null;
  const a = boardScore(hero), b = boardScore(host);
  return a > b ? 'hero' : b > a ? 'host' : 'draw';
}
