// ul-cards.js — the card over the game (start, paused, died, cleared, table closed). Text only, never HTML.
import { clock } from './ul-hud.js';

/** card: the container element. spec: { title, lines: [string], buttons: [{ label, primary, onClick }] }. */
export function showCard(card, spec) {
  card.replaceChildren();
  const box = document.createElement('div'); box.className = 'box';
  const h = document.createElement('h3'); h.textContent = spec.title; box.append(h);
  for (const line of spec.lines ?? []) { const p = document.createElement('p'); p.textContent = line; box.append(p); }
  const row = document.createElement('div'); row.className = 'row';
  for (const b of spec.buttons ?? []) {
    const el = document.createElement('button'); el.textContent = b.label; if (b.primary) el.className = 'pri';
    el.onclick = b.onClick; row.append(el);
  }
  box.append(row); card.append(box); card.classList.add('show');
  const pri = row.querySelector('.pri'); if (pri) pri.focus();
}
export function hideCard(card) { card.classList.remove('show'); card.replaceChildren(); }

/** The words on each card (pure, tested). */
export const CARDS = {
  title: () => ({ title: 'Under the lantern town', lines: [
    'One room of the Cellars. Your lantern is your light and your skills’ fuel. It drains as you go; at zero, the Dark comes for you.',
    'White glow: block it, or tap K as it lands to parry. Red glow: roll out of it. Violet glow: it puts out your lantern; roll.',
    'Shades fear the light and come when it fails. Moths chase the brightest light: throw your lantern (E) to lure them. Snuffers breathe out lanterns.',
  ] }),
  paused: () => ({ title: 'Paused', lines: ['The Dark waits for you, this once.'] }),
  dead: (S) => ({ title: 'Your light went out', lines: [
    `Killed by ${S.player.cause} after ${clock(S.t)}, with ${S.enemies.filter((e) => !e.dead).length} still in the room.`,
    `Parries ${S.stats.parries} · dodges ${S.stats.dodges} · hits landed ${S.stats.hits}`,
  ] }),
  cleared: (S) => ({ title: 'The room is quiet', lines: [
    `Cleared in ${clock(S.t)} with ${Math.round(S.player.hp)} body and ${Math.round(S.player.oil)} oil left.`,
    `Parries ${S.stats.parries} · dodges ${S.stats.dodges} · hits landed ${S.stats.hits} · sconces lit ${S.sconces.filter((s) => s.lit).length} of ${S.sconces.length}`,
  ] }),
  closed: () => ({ title: 'The table closed', lines: ['Open a new table in the games room to play again.'] }),
  watching: () => ({ title: 'Watching', lines: ['Watching a descent comes with co-op, in a later version.'] }),
};
