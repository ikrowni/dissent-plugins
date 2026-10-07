// hearthlane.js — Hearthlane at a tavern table: three lanes, five cards each, and a host who plays to win.
//
// Pick a card from your hand, then a lane (click, or keys 1–7 then 1–3). Intelligence brings a bigger hand.
// Cheating: mark the deck and see the host's hand (Sleight of Hand vs the host's eye). Rules: hearthlane-rules.js.
import { CARDS, PLAYS, LANE_CAP, handSize, newGame, lanePower, legalLanes, play as playCard, over, score, hostMove } from './hearthlane-rules.js?v=20261015d';
import { useKit, loadCss, el, btn, banner, coins, sleep, pick } from './kit.js?v=20261015d';
import { clack, chime, crack, tick } from './tavern-sfx.js?v=20261015d';
import { icon } from '../lk-icons.js';

const BARKS = {
  start: ['Three lanes. Take two.', 'My deck\'s older than you are.'],
  rogue: ['Sneaky.', 'You\'ll pay for that one.'], hostRogue: ['Oops. Your poor fellow.'], storm: ['Rain on the hearth!'],
  win: ['Two lanes to you. Fairly won.'], lose: ['The hearth is mine.'], caught: ['Marked cards? Out of my sight!'],
};

export async function play(root, ctx) {
  useKit();
  loadCss('hl-css', './hearthlane.css?v=20261015d', import.meta.url);
  const wrap = el('div', 'tk-felt hl');
  wrap.innerHTML = `<div class="hl-hosthand"></div><div class="hl-board"></div><div class="tk-note hl-status" aria-live="polite"></div>
    <div class="hl-hand"></div><div class="tk-row hl-tricks"></div>`;
  root.appendChild(wrap);
  const $ = s => wrap.querySelector(s);
  const status = t => { $('.hl-status').textContent = t; };
  let S = newGame(Math.random, handSize(ctx.edge));
  let peek = false, cheatUsed = false;

  const cardHtml = (id, cls = '') => {
    const c = CARDS[id];
    return `<div class="tk-card hl-card ${c.spell ? 'spell' : ''} ${cls}" data-card="${id}">` +
      (c.spell ? '' : `<span class="hl-pow">${c.power}</span>`) + `<span class="hl-art">${icon(c.icon, { size: 28 })}</span>` +
      `<b>${c.name}</b>${c.text ? `<small>${c.text}</small>` : ''}</div>`;
  };
  const draw = (sel = null) => {
    const { lanes } = score(S);
    $('.hl-board').innerHTML = [0, 1, 2].map(l => {
      const a = lanePower(S, 'hero', l), b = lanePower(S, 'host', l), lead = lanes[l];
      const storm = S.hero.storms[l] || S.host.storms[l];
      const slots = side => Array.from({ length: LANE_CAP }, (_, k) => S[side].lanes[l][k] ? cardHtml(S[side].lanes[l][k], 'small') : '<div class="hl-slot"></div>').join('');
      const can = sel != null && legalLanes(S, 'hero', sel).includes(l);
      return `<button class="hl-lane${can ? ' can' : ''}${storm ? ' storm' : ''}" data-lane="${l}" ${can ? '' : 'tabindex="-1"'} aria-label="Lane ${l + 1}: you ${a}, ${ctx.host.name} ${b}">` +
        `<div class="hl-units host">${slots('host')}</div>` +
        `<div class="hl-mid"><span class="${lead === 'host' ? 'lead' : ''}">${b}</span>${icon(lead ? 'crown' : 'flame', { size: 18 })}<span class="${lead === 'hero' ? 'lead' : ''}">${a}</span></div>` +
        `<div class="hl-units hero">${slots('hero')}</div>${storm ? `<i class="hl-rain">${icon('cloud-rain', { size: 16 })}</i>` : ''}</button>`;
    }).join('');
    $('.hl-hosthand').innerHTML = `<b>${ctx.host.name}</b> ` + S.host.hand.map(id => (peek ? cardHtml(id, 'tiny') : '<div class="tk-card back tiny"></div>')).join('') +
      `<span class="tk-note">${PLAYS - S.plays.host} to play</span>`;
    $('.hl-hand').innerHTML = S.hero.hand.map((id, i) => cardHtml(id, (S.turn === 'hero' && !over(S) ? 'play' : '') + (sel === i ? ' sel' : ''))).join('');
    $('.hl-hand').querySelectorAll('.hl-card').forEach((c, i) => { c.dataset.i = i; c.tabIndex = 0; });
  };

  const heroTurn = () => new Promise(resolve => {
    let sel = null;
    const choose = i => { sel = i; draw(sel); status(`${CARDS[S.hero.hand[i]].name}: now pick a lane (1–3).`); };
    const go = lane => {
      if (sel == null || !legalLanes(S, 'hero', sel).includes(lane)) return;
      cleanup(); resolve({ i: sel, lane });
    };
    const onClick = e => {
      const card = e.target.closest('.hl-hand .hl-card'), lane = e.target.closest('.hl-lane');
      if (card) choose(Number(card.dataset.i)); else if (lane) go(Number(lane.dataset.lane));
    };
    const onKey = e => {
      if (e.target.closest?.('input,textarea')) return;
      const n = Number(e.key);
      if (!n) return;
      if (sel == null && n <= S.hero.hand.length) choose(n - 1);
      else if (sel != null && n <= 3) go(n - 1);
      else if (n <= S.hero.hand.length) choose(n - 1);
    };
    const onAbort = () => { cleanup(); resolve(null); };
    function cleanup() { wrap.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); ctx.signal.removeEventListener('abort', onAbort); $('.hl-tricks').innerHTML = ''; }
    wrap.addEventListener('click', onClick); document.addEventListener('keydown', onKey); ctx.signal.addEventListener('abort', onAbort);
    status(`Your play (${PLAYS - S.plays.hero} left): pick a card.`);
    if (ctx.setup.cheating && !cheatUsed) $('.hl-tricks').appendChild(btn('🤫 Mark the deck', async () => {
      cheatUsed = true; $('.hl-tricks').innerHTML = '';
      const res = await ctx.tryCheat();
      if (res?.caught) { cleanup(); resolve({ caught: res }); return; }
      if (res) { peek = true; status(`Sleight of Hand ${res.total} — you can read ${ctx.host.name}'s hand.`); draw(sel); }
    }, { title: 'Sleight of Hand against the host\'s eye. Get caught, and you lose your bet.' }));
    draw();
  });

  const placed = (side, id, before) => {
    if (CARDS[id].spell) { tick(0.3); ctx.say(pick(BARKS.storm)); return; }
    clack();
    const killed = before[side === 'hero' ? 'host' : 'hero'].lanes.flat().length > S[side === 'hero' ? 'host' : 'hero'].lanes.flat().length;
    if (killed) { crack(); ctx.say(pick(side === 'hero' ? BARKS.rogue : BARKS.hostRogue)); }
  };

  ctx.say(pick(BARKS.start));
  draw();
  while (!over(S)) {
    if (ctx.signal.aborted) return { won: false };
    if (S.turn === 'hero') {
      const m = await heroTurn();
      if (!m) return { won: false };
      if (m.caught) { ctx.say(pick(BARKS.caught)); status(`Sleight of Hand ${m.caught.total} against ${ctx.host.name}'s eye (${m.caught.perception}). Caught!`); await sleep(1400); return { won: false, caught: true }; }
      const before = S, id = S.hero.hand[m.i];
      S = playCard(S, 'hero', m.i, m.lane); draw(); placed('hero', id, before);
    } else {
      status(`${ctx.host.name} considers the hearth…`);
      await sleep(800 + Math.random() * 600);
      const m = hostMove(S, ctx.setup.npcSkill);
      if (!m) { S = { ...S, plays: { ...S.plays, host: PLAYS }, turn: 'hero' }; continue; }
      const before = S, id = S.host.hand[m.i];
      S = playCard(S, 'host', m.i, m.lane); draw(); placed('host', id, before);
      await sleep(350);
    }
  }
  const { lanes, winner } = score(S);
  status('');
  for (let l = 0; l < 3; l++) {
    const lane = wrap.querySelectorAll('.hl-lane')[l];
    lane?.classList.add(lanes[l] === 'hero' ? 'won' : lanes[l] === 'host' ? 'lost' : 'tied');
    tick(0.3); await sleep(450);
  }
  ctx.say(pick(winner === 'hero' ? BARKS.win : BARKS.lose));
  if (winner === 'hero') { chime(); const r = wrap.getBoundingClientRect(); coins(wrap, r.width / 2, r.height / 2, 24); }
  await banner(wrap, winner === 'hero' ? 'The hearth is yours' : winner === 'host' ? `${ctx.host.name} holds the hearth` : 'Even', `${lanes.filter(x => x === 'hero').length} lanes to ${lanes.filter(x => x === 'host').length}`, 1500);
  return { won: winner === 'hero' ? true : winner === 'draw' ? 'draw' : false };
}
