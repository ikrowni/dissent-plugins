// ul-hud.js — the bars and words around the game. statusLine and clock are pure (tested); drawHud touches the DOM.
import { attackersNow } from './ul-enemy.js';

/** The one line at the top: what most needs your attention, or nothing. tone: warn | violet | plain. */
export function statusLine(S) {
  const p = S.player;
  if (p.dead) return null;
  if (p.oil <= 0) return { text: 'Your oil is gone. The Dark is on you.', tone: 'warn' };
  if (p.snuffT > 0) return { text: `Lantern snuffed · ${p.snuffT.toFixed(1)} s`, tone: 'violet' };
  if (S.lantern.state !== 'held') return { text: 'Your lantern is out of your hand: E calls it back', tone: 'plain' };
  return null;
}
export const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** els: { hp, oil, flask, status, corner, boss, bossName, bossFill }. where: the step's name ("Cellars · level 2 of 3"). */
export function drawHud(els, S, where) {
  const p = S.player;
  els.hp.style.width = `${Math.max(0, p.hp)}%`;
  els.oil.style.width = `${Math.max(0, p.oil)}%`;
  els.flask.textContent = p.drinkT > 0 ? 'drinking…' : p.flask ? 'flask ready (F)' : 'flask empty';
  const st = statusLine(S);
  els.status.textContent = st ? st.text : '';
  els.status.className = `status ${st ? st.tone : ''}`;
  els.corner.textContent = `${where} · ${clock(S.t)}`;
  if (els.boss) { // the boss's health, at the top while it lives
    const on = Boolean(S.boss && !S.boss.dead);
    els.boss.hidden = !on;
    if (on) { els.bossName.textContent = S.boss.name; els.bossFill.style.width = `${Math.max(0, S.boss.hp / S.boss.maxHp) * 100}%`; }
  }
  els.corner.title = `attacking you: ${attackersNow(S)} of ${S.T.tokens}`;
}
