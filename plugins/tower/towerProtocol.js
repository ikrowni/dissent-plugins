/**
 * What the Tower's machines say to each other through the node's relay (spec §10). The node passes messages
 * on without reading them (≤ 1 KB, ≤ 20 a second per player), so everything received is checked here: an
 * unknown kind or a bad field is dropped.
 *
 *   p    20 a second: where I am and how I look.     t = ms since my GO
 *   fin   I reached the top.
 *   quit  I gave up this round (I'm watching now): don't wait for my finish.
 *   atk   I punched, standing here, facing this way. The one it might hit decides (fight.js).
 *   use   I used Ink, Slick (at my floor) or Grapple (on `target`, from where I stand).
 *   swap  The answer to a Grapple aimed at me: ok, and where I was (the grappler goes there).
 *   bomb  I threw a bomb: every machine flies it the same way and knocks its own player.
 *   out   The mist got me (last standing).
 *   crown My total time on the crown so far (king of the hill), once a second while I'm on it.
 *
 * The Tower plugin (2026-10-21): every `p` also carries my own claims — `fn` my finish, `ot` when the mist got me,
 * `cr` my crown time — so one lost `fin` or `out` can't leave two copies ranking the round differently. The node
 * settles a round only when the players' reports agree (Dissent spec 2026-10-20-tower-plugin-design §3).
 *
 * 🔴 Mixed versions play together (the web updates at once, the desktop when it next updates): the fields piece 3
 * added to `p` are optional, a piece 2 client ignores kinds it doesn't know, and the ledges never changed.
 */

const int = (v, lo, hi) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const LIMIT = 10_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bit = (v) => v === 0 || v === 1;
const opt = (v, ok) => v === undefined || ok(v);
const pos = (m) => int(m.x, -LIMIT, LIMIT) && int(m.y, -LIMIT, LIMIT);

/** Checks a received message. Returns null for anything that isn't exactly a Tower message. */
export function parseMsg(data) {
  if (!data || typeof data !== "object") return null;
  const m = data;
  if (!int(m.t, 0, 3_600_000)) return null;
  if (m.k === "fin") return { k: "fin", t: m.t };
  if (m.k === "quit") return { k: "quit", t: m.t };
  if (m.k === "out") return { k: "out", t: m.t };
  if (m.k === "crown") return int(m.held, 0, 3_600_000) ? { k: "crown", t: m.t, held: m.held } : null;
  if (m.k === "atk") {
    return pos(m) && (m.f === 1 || m.f === -1) && bit(m.run) ? { k: "atk", t: m.t, x: m.x, y: m.y, f: m.f, run: m.run } : null;
  }
  if (m.k === "use") {
    if (!pos(m) || !int(m.floor, 0, 100_000) || !["ink", "slick", "grapple"].includes(m.item)) return null;
    if (m.item === "grapple" && !(typeof m.target === "string" && UUID.test(m.target))) return null;
    const u = { k: "use", t: m.t, item: m.item, floor: m.floor, x: m.x, y: m.y };
    if (m.item === "grapple") u.target = m.target;
    return u;
  }
  if (m.k === "swap") {
    return pos(m) && typeof m.to === "string" && UUID.test(m.to) && bit(m.ok)
      ? { k: "swap", t: m.t, to: m.to, ok: m.ok, x: m.x, y: m.y } : null;
  }
  if (m.k === "bomb") {
    return pos(m) && typeof m.id === "string" && /^[a-z0-9-]{1,24}$/i.test(m.id) && int(m.vx, -5000, 5000) && int(m.vy, -5000, 5000)
      ? { k: "bomb", t: m.t, id: m.id, x: m.x, y: m.y, vx: m.vx, vy: m.vy } : null;
  }
  if (m.k !== "p") return null;
  if (!int(m.x, -LIMIT, LIMIT) || !int(m.y, -LIMIT, LIMIT) || !int(m.vx, -LIMIT, LIMIT) || !int(m.vy, -LIMIT, LIMIT)) return null;
  if ((m.g !== 0 && m.g !== 1) || (m.f !== 1 && m.f !== -1) || (m.bl !== 0 && m.bl !== 1)) return null;
  if (!int(m.ph, 0, LIMIT) || !int(m.sq, -100, 100) || !int(m.b, 0, 100_000)) return null;
  if (!opt(m.st, bit) || !opt(m.sh, bit) || !opt(m.pu, bit) || !opt(m.it, (v) => int(v, 0, 6))) return null;
  const ms = (v) => int(v, 0, 3_600_000);
  if (!opt(m.fn, ms) || !opt(m.ot, ms) || !opt(m.cr, ms)) return null;
  const p = { k: "p", t: m.t, x: m.x, y: m.y, vx: m.vx, vy: m.vy, g: m.g, f: m.f, ph: m.ph, sq: m.sq, bl: m.bl, b: m.b };
  if (m.st !== undefined) p.st = m.st;
  if (m.it !== undefined) p.it = m.it;
  if (m.sh !== undefined) p.sh = m.sh;
  if (m.pu !== undefined) p.pu = m.pu;
  if (m.fn !== undefined) p.fn = m.fn;
  if (m.ot !== undefined) p.ot = m.ot;
  if (m.cr !== undefined) p.cr = m.cr;
  return p;
}

/** A position message for my climber at t ms since my GO; `extra` adds piece 3's fields. */
export function posMsg(
  t,
  c,
  extra = {},
) {
  return {
    ...extra,
    k: "p", t: Math.round(t), x: Math.round(c.x), y: Math.round(c.y), vx: Math.round(c.vx), vy: Math.round(c.vy),
    g: c.onGround ? 1 : 0, f: c.facing, ph: Math.round((c.phase % 1000) * 100), sq: Math.round(Math.max(-1, Math.min(1, c.squash)) * 100),
    bl: c.blink > 0 ? 1 : 0, b: c.best,
  };
}
