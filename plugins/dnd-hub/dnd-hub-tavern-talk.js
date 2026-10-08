// dnd-hub-tavern-talk.js — talking to an NPC: their greeting, what the game is, the stakes, and sitting down.
//
// A dialogue box at the foot of the tavern, with the host's portrait, words that type themselves out, and
// numbered choices (keys 1–4, Esc to walk away). The DM can talk to a host too, to see what the players see,
// but only heroes sit down. My purse and numbers come from my own sheet (`tavern:hero`, dnd-player-tavern.js).
import { MAP, serverData } from './dnd-hub-state.js?v=20261015t';
import { localPublish } from '../plugin-sdk.js';
import { gameType, PLAYABLE, stakeProblem, CAUGHT } from './lk-tavern.js';
import { medal, TAVERN } from './dnd-hub-tavern.js?v=20261015t';
import { sit } from './dnd-hub-tavern-seat.js?v=20261015t';

let _hero = null;          // { gold, name, mods: {str…}, skills: {…} } from my sheet
let _typer = 0, _keys = null;

export function setHero(p) { _hero = { gold: p.gold ?? 0, name: p.name || '', mods: p.mods || {}, skills: p.skills || {} }; }
export const myHero = () => _hero;

export function closeTalk() {
  clearInterval(_typer);
  if (_keys) { document.removeEventListener('keydown', _keys); _keys = null; }
  document.getElementById('lk-tavern-talk')?.remove();
}

const itemName = id => (id ? serverData?.campaigns?.[MAP.campaignId]?.items?.[id]?.name || 'a prize' : null);

/** The stakes in a host's words. */
export function stakesLine(s) {
  const parts = [];
  parts.push(s.minBet === s.maxBet ? `The bet is ${s.minBet} gold.` : `Bets run from ${s.minBet} to ${s.maxBet} gold.`);
  if (s.entryFee) parts.push(`${s.entryFee} gold to sit, win or lose.`);
  if (s.type === 'beetle-derby') parts.push('Every beetle pays its own odds — the long shots pay best.');
  else parts.push(s.payout === 2 ? 'Win, and I double your money.' : `Win, and you walk away with ${s.payout} times your bet.`);
  const prize = itemName(s.prizeItemId);
  if (prize) parts.push(`And the winner takes ${prize}.`);
  if (s.playsPerVisit) parts.push(`${s.playsPerVisit === 1 ? 'One game' : s.playsPerVisit + ' games'} a visit, no more.`);
  if (s.cheating) parts.push(`And friend… I have sharp eyes. ${CAUGHT[s.caught].replace('Loses', 'A cheat loses')}.`);
  return parts.join(' ');
}

/** Talk to a host. `setup` is their game (null: the table has no game any more). */
export async function openTalk(host, setup) {
  closeTalk();
  const wrap = document.getElementById('map-canvas-wrap');
  if (!wrap) return;
  const g = setup ? gameType(setup.type) : null;
  const box = document.createElement('div');
  box.id = 'lk-tavern-talk';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', `Talking to ${host.name}`);
  box.appendChild(await medal(host));
  const say = document.createElement('div');
  say.className = 'tv-say';
  say.innerHTML = '<h3></h3><div class="tv-line" aria-live="polite"></div><div class="tv-choices"></div>';
  say.querySelector('h3').textContent = host.name;
  const close = Object.assign(document.createElement('button'), { className: 'tv-close', textContent: '✕', title: 'Walk away (Esc)' });
  close.onclick = closeTalk;
  box.append(say, close);
  wrap.appendChild(box);

  const line = say.querySelector('.tv-line'), choicesEl = say.querySelector('.tv-choices');
  const speak = text => {
    clearInterval(_typer);
    let i = 0;
    line.textContent = '';
    _typer = setInterval(() => { i += 2; line.textContent = text.slice(0, i); if (i >= text.length) clearInterval(_typer); }, 16);
    line.onclick = () => { clearInterval(_typer); line.textContent = text; }; // click to see it all at once
  };
  const choices = list => {
    choicesEl.innerHTML = '';
    list.forEach(([label, fn, disabled], i) => {
      const b = Object.assign(document.createElement('button'), { className: 'tv-choice', textContent: label });
      b.dataset.n = i + 1;
      if (disabled) { b.disabled = true; b.title = disabled; }
      b.onclick = () => !b.disabled && fn();
      choicesEl.appendChild(b);
    });
  };
  _keys = e => {
    if (e.target.closest?.('input,textarea,select')) return;
    if (e.key === 'Escape') { closeTalk(); return; }
    const b = choicesEl.querySelectorAll('.tv-choice')[Number(e.key) - 1];
    if (b) { e.preventDefault(); b.click(); }
  };
  document.addEventListener('keydown', _keys);

  const playable = g && PLAYABLE.has(g.id);
  const canSit = !MAP.isDM && playable;
  const sitWhy = MAP.isDM ? 'Heroes sit down here. Ask who is playing.'
    : !playable ? 'This game is not ready to play yet.' : null;
  const menu = text => {
    speak(text);
    choices([
      ...(g ? [['What\'s the game?', () => menu(`${g.name}. ${g.howTo}`)],
               ['What are the stakes?', () => menu(stakesLine(setup))],
               ['Deal me in.', () => stakePicker(), !canSit && sitWhy]] : []),
      ...(MAP.isDM ? [['Who\'s at your table?', () => {
        const names = TAVERN.busy[host.id] || [];
        menu(names.length ? `Playing with me now: ${names.join(', ')}.` : 'Nobody, yet.');
      }]] : []),
      ['Another time.', closeTalk],
    ]);
  };
  const stakePicker = () => {
    if (!_hero) localPublish('dnd-player', 'tavern:hero?', { type: 'tavern:hero?', campaignId: MAP.campaignId });
    const gold = _hero?.gold ?? null;
    const most = gold == null ? setup.maxBet : Math.min(setup.maxBet, gold - setup.entryFee);
    if (most < setup.minBet) {
      menu(gold == null ? 'Open your character sheet first, friend — I need to see the colour of your coin.'
        : `Your purse is a little light for this table. You'd need ${setup.minBet + setup.entryFee} gold.`);
      return;
    }
    speak(`How much are you putting down?${setup.entryFee ? ` (${setup.entryFee} to sit, too.)` : ''}`);
    choicesEl.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'tv-stake';
    row.innerHTML = `<input type="range" min="${setup.minBet}" max="${most}" step="1" value="${setup.minBet}" aria-label="Your bet"><output>${setup.minBet} gp</output>`;
    const range = row.querySelector('input'), out = row.querySelector('output');
    range.oninput = () => { out.textContent = `${range.value} gp`; };
    const go = Object.assign(document.createElement('button'), { className: 'tv-btn primary', textContent: 'Bet' });
    go.onclick = async () => {
      const stake = Number(range.value);
      const problem = stakeProblem(setup, stake, gold);
      if (problem) { speak(problem); return; }
      go.disabled = true;
      speak('Sit, sit. Let\'s see what you\'re made of.');
      const res = await sit(host, setup, stake);
      if (res !== true) { menu(res); return; }
      closeTalk();
    };
    const back = Object.assign(document.createElement('button'), { className: 'tv-btn', textContent: 'Back' });
    back.onclick = () => menu(host.greeting || g.pitch);
    row.append(go, back);
    choicesEl.appendChild(row);
    if (gold != null) choicesEl.appendChild(Object.assign(document.createElement('div'), { className: 'tv-gold', textContent: `Your purse: ${gold} gp` }));
    range.focus();
  };
  menu(host.greeting || (g ? g.pitch : 'Nothing on my table tonight, friend. Just ale.'));
}
