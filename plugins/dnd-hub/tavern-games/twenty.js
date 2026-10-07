// twenty.js — Twenty at a tavern table: get closer to 20 than the host without going over, best of three sets.
//
// Intelligence brings more side cards; cheating marks the deck so you can see the next card (Sleight of Hand vs the
// host's eye). Rules: twenty-rules.js.
import { TARGET, MAX_CARDS, newDeck, sideDeck, sideCount, total, sideValue, setResult, hostPlay, gameResult } from './twenty-rules.js?v=20261015h';
import { useKit, loadCss, el, btn, banner, coins, sleep, pick } from './kit.js?v=20261015h';
import { tick, chime, buzz, clack } from './tavern-sfx.js?v=20261015h';

const BARKS = {
  start: ['Twenty, friend. Not twenty-one. Twenty.', 'Cards on the table. Keep your side deck close.'],
  hostStand: ['I\'ll stand.', 'That\'ll do me.', 'Your move.'], hostBust: ['Blast and bother.', 'Too greedy. Again.'],
  heroBust: ['Over! Ha!', 'The cards bite back.'], heroSet: ['Hmph. Your set.'], hostSet: ['Mine, I think.'],
  win: ['Well played. The coin is yours.'], lose: ['The house thanks you.'], caught: ['Is that ink on your thumb? Cheat!'],
};

export async function play(root, ctx) {
  useKit();
  loadCss('tw-css', './twenty.css?v=20261015h', import.meta.url);
  const wrap = el('div', 'tk-felt tw');
  wrap.innerHTML = `
    <div class="tw-side host"><div class="tw-who"><b></b><div class="tw-sets"></div></div><div class="tw-total">0</div><div class="tw-table"></div></div>
    <div class="tw-mid"><div class="tw-hostside"></div><div class="tk-note tw-status" aria-live="polite"></div><div class="tw-deck"><div class="tk-card back"></div><div class="tw-peek"></div></div></div>
    <div class="tw-side hero"><div class="tw-who"><b>You</b><div class="tw-sets"></div></div><div class="tw-total">0</div><div class="tw-table"></div></div>
    <div class="tw-hand"><div class="tk-row tw-cards"></div><div class="tk-row tw-btns"></div></div>`;
  root.appendChild(wrap);
  const $ = s => wrap.querySelector(s);
  $('.host .tw-who b').textContent = ctx.host.name;
  const status = t => { $('.tw-status').textContent = t; };

  const heroHand = sideDeck(sideCount(ctx.edge)), hostHand = sideDeck(4);
  const sets = { hero: 0, host: 0 };
  let played = 0, peek = false, cheatUsed = false, armed = false;

  const cardHtml = v => `<div class="tk-card"><span class="tk-pip">◆</span>${v}</div>`;
  const sideHtml = (c, cls = '') => {
    const kind = c.flip ? 'flip' : c.v > 0 ? 'plus' : 'minus';
    return `<div class="tk-card ${kind} ${cls}">${c.flip ? '±' + c.flip : (c.v > 0 ? '+' : '−') + Math.abs(c.v)}<small>${c.flip ? 'your choice' : c.v > 0 ? 'add' : 'take away'}</small></div>`;
  };
  const draw = (S) => {
    for (const who of ['hero', 'host']) {
      const side = S[who];
      $(`.${who} .tw-table`).innerHTML = Array.from({ length: MAX_CARDS }, (_, i) => side.table[i] != null
        ? `<div class="tw-slot">${side.played[i] != null ? sideHtml(side.played[i], 'small') : cardHtml(side.table[i])}</div>` : '<div class="tw-slot"></div>').join('');
      const t = total(side.table);
      const tot = $(`.${who} .tw-total`);
      tot.textContent = t; tot.className = 'tw-total' + (t > TARGET ? ' over' : t === TARGET ? ' twenty' : '') + (side.stood ? ' stood' : '');
      $(`.${who} .tw-sets`).innerHTML = [0, 1].map(i => `<i class="${sets[who] > i ? 'on' : ''}"></i>`).join('') + (side.stood ? '<span>stands</span>' : '');
    }
    $('.tw-hostside').innerHTML = hostHand.map(() => '<div class="tk-card back mini"></div>').join('') + `<span class="tk-note">${ctx.host.name}'s side deck</span>`;
    if (!armed) $('.tw-cards').innerHTML = heroHand.map(c => sideHtml(c)).join('') || '<span class="tk-note">No side cards left</span>';
    $('.tw-peek').innerHTML = peek && S.deck.length ? `<div class="tk-card peek">${S.deck[S.deck.length - 1]}<small>next</small></div>` : '';
  };

  const deal = async (S, who) => {
    const v = S.deck.pop();
    S[who].table.push(v); S[who].played.push(null);
    tick(0.18); draw(S);
    $(`.${who} .tw-table`).children[S[who].table.length - 1]?.firstElementChild?.classList.add('tw-in');
    await sleep(420);
  };

  /** The hero's turn after the deal: maybe one side card, then End turn or Stand. */
  const heroTurn = S => new Promise(resolve => {
    let usedSide = false;
    armed = true;
    const arm = () => {
      const cards = $('.tw-cards'); cards.innerHTML = '';
      heroHand.forEach((c, i) => {
        const d = el('div'); d.innerHTML = sideHtml(c, usedSide ? '' : 'play');
        const card = d.firstElementChild; card.tabIndex = usedSide ? -1 : 0;
        if (!usedSide) card.onclick = () => {
          if (c.flip) {
            const pickSign = el('div', 'tw-sign');
            pickSign.append(btn(`+${c.flip}`, () => useSide(i, 1)), btn(`−${c.flip}`, () => useSide(i, -1)));
            card.after(pickSign);
          } else useSide(i, 1);
        };
        cards.appendChild(card);
      });
      const t = total(S.hero.table);
      const b = $('.tw-btns'); b.innerHTML = '';
      b.append(btn('End turn', () => finish(false), { title: 'Keep playing: you will be dealt another card next turn' }),
        btn('Stand', () => finish(true), { primary: true, title: `Stay on ${t}` }));
      if (ctx.setup.cheating && !cheatUsed) b.append(btn('🤫 Mark the deck', cheat, { title: 'Sleight of Hand against the host\'s eye: see the next card for the rest of the game' }));
      status(t > TARGET ? `${t}: over! Play a minus card, or bust.` : t === TARGET ? 'Twenty! Stand on it.' : `You have ${t}. Play a side card, end your turn, or stand.`);
    };
    const useSide = (i, sign) => {
      const c = heroHand.splice(i, 1)[0];
      S.hero.table.push(sideValue(c, sign)); S.hero.played.push(c);
      usedSide = true; clack(0.8); draw(S); arm();
    };
    const cheat = async () => {
      cheatUsed = true; $('.tw-btns').innerHTML = '';
      status('You run a thumbnail along the deck\'s edge…');
      const res = await ctx.tryCheat();
      if (res?.caught) { armed = false; return resolve({ caught: res }); }
      if (res) { peek = true; status(`Sleight of Hand ${res.total} — the deck is yours to read.`); draw(S); }
      arm();
    };
    const finish = stand => { armed = false; $('.tw-cards').innerHTML = ''; $('.tw-btns').innerHTML = ''; resolve({ stand }); };
    ctx.signal.addEventListener('abort', () => resolve({ abort: true }), { once: true });
    arm();
  });

  const hostTurn = async S => {
    status(`${ctx.host.name} studies the cards…`);
    await sleep(700 + Math.random() * 500);
    const p = hostPlay(S.host, S.hero, hostHand, ctx.setup.npcSkill);
    if (p.side != null) {
      const c = hostHand.splice(p.side, 1)[0];
      S.host.table.push(sideValue(c, p.sign)); S.host.played.push(c);
      clack(0.8); draw(S); await sleep(500);
    }
    if (total(S.host.table) > TARGET) { S.host.bust = true; ctx.say(pick(BARKS.hostBust)); }
    else if (p.stand) { S.host.stood = true; ctx.say(pick(BARKS.hostStand)); }
    draw(S);
  };

  ctx.say(pick(BARKS.start));
  while (!gameResult(sets, played)) {
    played++;
    status('');
    await banner(wrap, `Set ${played}`, `${sets.hero} – ${sets.host}`, 900);
    const S = { deck: newDeck(), hero: { table: [], played: [], stood: false, bust: false }, host: { table: [], played: [], stood: false, bust: false } };
    let turn = played % 2 ? 'hero' : 'host', result = null;
    draw(S);
    while (!(result = setResult(S.hero, S.host))) {
      if (ctx.signal.aborted) return { won: false };
      if (!S[turn].stood) {
        await deal(S, turn);
        if (turn === 'hero') {
          if (S.hero.table.length >= MAX_CARDS) { draw(S); continue; }
          const m = await heroTurn(S);
          if (m.abort) return { won: false };
          if (m.caught) { ctx.say(pick(BARKS.caught)); status(`Sleight of Hand ${m.caught.total} against ${ctx.host.name}'s eye (${m.caught.perception}). Caught!`); await sleep(1400); return { won: false, caught: true }; }
          if (total(S.hero.table) > TARGET) { S.hero.bust = true; buzz(); ctx.say(pick(BARKS.heroBust)); }
          else if (m.stand) S.hero.stood = true;
          draw(S);
        } else await hostTurn(S);
      }
      turn = turn === 'hero' ? 'host' : 'hero';
    }
    if (result !== 'draw') sets[result]++;
    draw(S);
    ctx.say(pick(result === 'hero' ? BARKS.heroSet : result === 'host' ? BARKS.hostSet : ['Even. Again.']));
    status('');
    await banner(wrap, result === 'hero' ? 'Your set' : result === 'host' ? `${ctx.host.name}'s set` : 'A tied set', `${total(S.hero.table)} to ${total(S.host.table)}`, 1500);
  }
  const w = gameResult(sets, played);
  ctx.say(pick(w === 'hero' ? BARKS.win : BARKS.lose));
  if (w === 'hero') { chime(); const r = wrap.getBoundingClientRect(); coins(wrap, r.width / 2, r.height / 2, 24); }
  await sleep(1100);
  return { won: w === 'hero' ? true : w === 'draw' ? 'draw' : false };
}
