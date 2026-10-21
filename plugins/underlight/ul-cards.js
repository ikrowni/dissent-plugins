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
  title: (extra = []) => ({ title: 'Under the lantern town', lines: [...extra,
    'The Cellars: three levels down, a lamp post between each. Find the stairs; you don\u2019t have to kill everything. Your lantern is your light and your skills\u2019 fuel. It drains as you go; at zero, the Dark comes for you.',
    'White glow: hold right click (or K) to block it, or click right as it lands to parry. Red glow: you can\u2019t block it, roll (Shift). Violet glow: it puts out your lantern; roll.',
    'Shades fear the light and come when it fails. Moths chase the brightest light: throw your lantern (E) to lure them. Snuffers breathe out lanterns.',
  ] }),
  paused: () => ({ title: 'Paused', lines: ['The Dark waits for you, this once.'] }),
  /** What saving can do here, in a line: store.state from ul-store.js. */
  saving: (state) => ({
    ok: 'Your run saves at the camp after the Rat King.', unknown: 'Your run saves at the camp after the Rat King.',
    refused: 'Saving is off: when Underlight first opened you chose \u201cView Without Joining\u201d. To let it save, click \u201cViewing only \u00b7 Change\u201d on the bar above the game.',
    standalone: 'Opened on its own, so nothing saves. Play it at a table in Dissent to save.',
    error: 'Saving isn\u2019t answering right now. You can still play.',
  })[state] ?? '',
  continued: (save) => `Saved at the camp: ${Math.round(save.carry.hp)} body, ${Math.round(save.carry.oil)} oil, ${save.carry.flask ? 'a full flask' : 'an empty flask'}.`,
  confirmNew: () => ({ title: 'Start a new descent?', lines: ['This ends your saved run at the camp. It can\u2019t be undone.'] }),
  dugOut: (state) => ({ title: 'The way down', lines: [
    'Below the camp the way goes on into the second act, but it is still being dug out.',
    state === 'ok' ? 'Your run is saved here. Leave now and you\u2019ll come back to this fire.' : CARDS.saving(state),
  ] }),
  dead: (S, where) => ({ title: 'Your light went out', lines: [
    `Killed by ${S.player.cause} on ${where}, ${clock(S.t)} in.`,
    `Parries ${S.stats.parries} · dodges ${S.stats.dodges} · hits landed ${S.stats.hits}`,
  ] }),
  cleared: (S) => ({ title: 'The room is quiet', lines: [
    `Cleared in ${clock(S.t)} with ${Math.round(S.player.hp)} body and ${Math.round(S.player.oil)} oil left.`,
    `Parries ${S.stats.parries} · dodges ${S.stats.dodges} · hits landed ${S.stats.hits} · sconces lit ${S.sconces.filter((s) => s.lit).length} of ${S.sconces.length}`,
  ] }),
  down: (S, next) => ({ title: 'Down the stairs', lines: [
    `Next: ${next}.`,
    `You carry ${Math.round(S.player.hp)} body, ${Math.round(S.player.oil)} oil and ${S.player.flask ? 'a full flask' : 'an empty flask'}.`,
  ] }),
  actDone: (S) => ({ title: 'Through the Cellars', lines: [
    `The Rat King is dead. You came through with ${Math.round(S.player.hp)} body and ${Math.round(S.player.oil)} oil.`,
    'Below the Cellars the way goes on, but it is still being dug out. A camp to rest and save at comes next.',
  ] }),
  closed: () => ({ title: 'The table closed', lines: ['Open a new table in the games room to play again.'] }),
  watching: () => ({ title: 'Watching', lines: ['Watching a descent comes with co-op, in a later version.'] }),
};
