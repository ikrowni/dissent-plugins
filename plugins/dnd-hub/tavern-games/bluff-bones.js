// bluff-bones.js — Bluff Bones at a tavern table: cups, dice, bids and lies, the whole table at once (DM's Hub).
//
// On your turn raise the bid (how many of a face under ALL the cups) or call "Liar!". Insight reads the tells.
// Cheating: peek under the next cup (Sleight of Hand vs the host's eye, judged by the DM's Hub).
// Rules: bluff-bones-rules.js. Note: every screen receives the table's state; the view shows only your own dice.
import * as R from './bluff-bones-rules.js?v=20261015n';
import { useKit, loadCss, el, btn, banner, coins, sleep, pick, chips, tableClient, dieHtml, esc } from './kit.js?v=20261015n';
import { rattle, clack, chime, buzz, thump } from './tavern-sfx.js?v=20261015n';

const WORD = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const FACE = ['', 'ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
const say = b => `${WORD[b.count] || b.count} ${b.count === 1 ? FACE[b.face].replace(/s$/, '').replace(/xe$/, 'x') : FACE[b.face]}`;
const BARKS = { start: ['Cups down. Lie well.', 'Everyone lies at this table. Some lie better.'], caught: ['Hands off my cup, thief!'] };

export async function play(root, ctx) {
  useKit();
  loadCss('bb-css', './bluff-bones.css?v=20261015n', import.meta.url);
  const wrap = el('div', 'tk-felt bb');
  wrap.innerHTML = `<div class="bb-top"></div><div class="bb-cups"></div><div class="bb-bid" aria-live="polite"></div>
    <div class="bb-mine"><div class="bb-dice"></div><div class="bb-hint"></div><div class="bb-controls"></div><div class="tk-note bb-status" aria-live="polite"></div></div>`;
  root.appendChild(wrap);
  const $ = s => wrap.querySelector(s);
  let S = null, pickCount = 1, pickFace = 2, cheatUsed = false;
  const me = () => S?.players.find(p => p.id === ctx.me);
  const nameOf = id => (id === ctx.me ? 'You' : S.players.find(p => p.id === id)?.name || '?');

  const draw = () => {
    const showAll = S.phase === 'reveal' || S.phase === 'done';
    $('.bb-top').innerHTML = chips(S.players, { me: ctx.me, active: R.toAct(S), out: p => p.out, line: p => `${p.dice.length} dice` });
    $('.bb-cups').innerHTML = S.players.filter(p => p.id !== ctx.me).map(p => {
      const seen = showAll || me()?.peek === p.id;
      const dice = showAll && S.reveal ? S.reveal.dice[p.id] || [] : p.dice;
      return `<div class="bb-seat${p.out ? ' out' : ''}${S.turn === p.id && S.phase === 'bid' ? ' turn' : ''}"><b>${esc(p.name)}</b>` +
        (seen ? `<div class="bb-row">${dice.map(d => dieHtml(d, S.reveal && d === S.reveal.bid.face ? 'match' : '')).join('')}</div>`
          : `<div class="bb-cup" aria-label="${p.dice.length} dice hidden"><span>${p.dice.length}</span></div>`) +
        (me()?.peek === p.id && !showAll ? '<span class="tk-note">you peeked</span>' : '') + '</div>';
    }).join('');
    const b = S.bid;
    $('.bb-bid').innerHTML = S.phase === 'reveal' && S.reveal
      ? `<div class="bb-call">${esc(nameOf(S.reveal.caller))} called <b>Liar!</b> on ${esc(nameOf(S.reveal.bid.by))}'s ${say(S.reveal.bid)}.<br>There ${S.reveal.total === 1 ? 'was' : 'were'} <b>${S.reveal.total}</b>. ` +
        `${S.reveal.total >= S.reveal.bid.count ? 'The bid stands' : 'A lie'}: <b>${esc(nameOf(S.reveal.loser))}</b> ${S.reveal.loser === ctx.me ? 'lose' : 'loses'} a die.</div>`
      : b ? `<div class="bb-standing"><span>${esc(nameOf(b.by))} ${b.by === ctx.me ? 'bid' : 'bids'}</span><b>${say(b)}</b><div class="bb-row">${Array.from({ length: Math.min(b.count, 12) }, () => dieHtml(b.face)).join('')}</div></div>`
        : `<div class="bb-standing"><span>Round ${S.round}</span><b>${S.turn === ctx.me ? 'You open the bidding' : `${esc(nameOf(S.turn))} opens`}</b></div>`;
    const m = me();
    const myDice = S.phase === 'reveal' && S.reveal ? S.reveal.dice[ctx.me] || [] : m?.dice || [];
    $('.bb-dice').innerHTML = m?.out ? '<span class="tk-note">No dice left. Watch the rest.</span>'
      : myDice.map(d => dieHtml(d, S.reveal && d === S.reveal.bid.face ? 'match' : '')).join('');
    $('.bb-hint').textContent = S.phase === 'bid' ? S.hints?.[ctx.me]?.text || '' : '';
    drawControls();
  };

  const drawControls = () => {
    const c = $('.bb-controls'); c.innerHTML = '';
    if (!(S.phase === 'bid' && S.turn === ctx.me)) { $('.bb-status').textContent = S.phase === 'bid' ? `${nameOf(S.turn)} is thinking…` : ''; return; }
    const b = S.bid, total = R.totalDice(S);
    if (!R.beats({ count: pickCount, face: pickFace }, b)) { pickCount = b ? (b.face < 6 ? b.count : b.count + 1) : 1; pickFace = b ? (b.face < 6 ? b.face + 1 : 1) : 2; if (b && pickFace === 1) pickFace = 2; }
    const row = el('div', 'bb-pick');
    row.innerHTML = `<div class="bb-step"><button class="tv-btn" data-d="-1" aria-label="Fewer">−</button><b>${pickCount}</b><button class="tv-btn" data-d="1" aria-label="More">+</button></div>` +
      `<div class="bb-faces">${[1, 2, 3, 4, 5, 6].map(f => `<button class="bb-face${f === pickFace ? ' on' : ''}" data-f="${f}" aria-label="${FACE[f]}">${dieHtml(f)}</button>`).join('')}</div>`;
    row.onclick = e => {
      const d = e.target.closest('[data-d]'), f = e.target.closest('[data-f]');
      if (d) pickCount = Math.max(1, Math.min(total, pickCount + Number(d.dataset.d)));
      if (f) pickFace = Number(f.dataset.f);
      clack(0.3); drawControls();
    };
    c.appendChild(row);
    const ok = R.beats({ count: pickCount, face: pickFace }, b);
    const bidBtn = btn(`Bid ${say({ count: pickCount, face: pickFace })}`, () => { thump(0.3); client.act({ type: 'bid', count: pickCount, face: pickFace }); }, { primary: true });
    bidBtn.disabled = !ok;
    const btns = el('div', 'tk-row');
    btns.appendChild(bidBtn);
    if (b && b.by !== ctx.me) btns.appendChild(btn('Liar!', () => { buzz(); client.act({ type: 'call' }); }, { title: `Call ${nameOf(b.by)}'s bid a lie` }));
    if (ctx.setup.cheating && !cheatUsed) btns.appendChild(btn('🤫 Peek under a cup', () => { cheatUsed = true; client.cheat(); drawControls(); }, { title: 'Sleight of Hand against the host\'s eye: see the next player\'s dice this round' }));
    c.appendChild(btns);
    $('.bb-status').textContent = ok ? 'Your bid. Raise it, or call the last one a lie.' : 'Raise it: more dice, or as many of a higher face.';
  };

  ctx.say(pick(BARKS.start));
  const client = tableClient(wrap, ctx, R, {
    lobbyText: 'Bluff Bones — cups down',
    onState: (s, prev) => {
      S = s;
      if (s.phase === 'bid' && (!prev || prev.round !== s.round)) { rattle(); banner(wrap, `Round ${s.round}`, 'Cups down', 800); }
      if (s.phase === 'reveal' && prev?.phase !== 'reveal') clack(1);
      draw();
    },
    onCheated: d => {
      if (d.seatId !== ctx.me) return;
      $('.bb-status').textContent = d.caught ? `Sleight of Hand ${d.total} against the host's eye (${d.perception}). Caught!` : `Sleight of Hand ${d.total} — you saw under the cup.`;
      if (d.caught) ctx.say(pick(BARKS.caught));
    },
    onRefused: reason => { $('.bb-status').textContent = reason; },
  });
  const out = await client.done;
  if (out.caught) { await sleep(1400); return out; }
  if (S) {
    await sleep(500);
    if (out.won === true) { chime(); const r = wrap.getBoundingClientRect(); coins(wrap, r.width / 2, r.height / 2, 26); }
    const live = S.players.filter(p => !p.out);
    await banner(wrap, out.won === true ? 'Last cup standing' : `${live[0] ? nameOf(live[0].id) : 'Nobody'} wins`, '', 1600);
  }
  return out;
}
