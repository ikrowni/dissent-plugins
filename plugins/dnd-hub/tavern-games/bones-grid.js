// bones-grid.js — Bones Grid at a tavern table: the hero against the host, bone dice on two carved boards.
//
// The rules are in bones-grid-rules.js. Here: drawing, the turn loop, and the hero's tricks. Intelligence (the
// game's stat) gives rerolls (a dim hero hands the HOST one instead); Sleight of Hand lets a hero palm a die once a
// game and set its face, if the DM allows cheating, against the host's eye (ctx.tryCheat). See dnd-hub-tavern-games.js.
import { emptyBoard, place, moveValue, hostMove, winner, rerolls, boardScore, columnScore, openColumns, ROWS } from './bones-grid-rules.js?v=20261015q';
import { clack, crack, rattle, chime } from './tavern-sfx.js?v=20261015q';

const BARKS = {
  start: ['Bones on the table. You first.', 'Three columns, friend. Choose well.', 'Let\'s see what your hands can do.'],
  hurt: ['Hah! Lucky throw.', 'Ooh, that stings.', 'You\'ll pay for that one.', 'My poor bones!'],
  smash: ['Crack! Sorry — not sorry.', 'Your bones are mine.', 'Mind your columns, friend.', 'Snap!'],
  triple: ['Three of a kind. Pay attention.', 'Now THAT is a column.'],
  reroll: ['Hmph. Again.', 'Let me try that once more.'],
  heroWin: ['Well played. Take your coin.', 'The bones liked you tonight.'],
  hostWin: ['The bones favour the house.', 'Better luck next time, friend.'],
  draw: ['Even. Neither of us is happy.'],
  palmed: ['…', 'Hm. Funny roll, that.'],
  caught: ['Is that a die up your sleeve? Off my table!', 'I SAW that. Cheat!'],
};
const pick = list => list[Math.floor(Math.random() * list.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const d6 = () => 1 + Math.floor(Math.random() * 6);

function loadCss() {
  if (document.getElementById('bg-css')) return;
  const l = Object.assign(document.createElement('link'), { id: 'bg-css', rel: 'stylesheet', href: new URL('./bones-grid.css?v=20261015q', import.meta.url).href });
  document.head.appendChild(l);
}

const dieHtml = (f, cls = '') => `<div class="bg-die ${cls}" data-f="${f}">${'<i></i>'.repeat(9)}</div>`;

export async function play(root, ctx) {
  loadCss();
  const extra = rerolls(ctx.edge);
  const S = { hero: emptyBoard(), host: emptyBoard(), heroRerolls: extra.hero, hostRerolls: extra.host, cheatUsed: false };
  root.innerHTML = `<div class="bg-wrap">
    <div class="bg-side host"><div class="bg-who"><b></b><div class="bg-total">0</div></div><div class="bg-board"></div><div class="bg-who"></div></div>
    <div class="bg-mid"><div class="bg-tray"></div><div class="bg-status" aria-live="polite"></div><div class="bg-tricks"></div></div>
    <div class="bg-side hero"><div class="bg-who"><b>You</b><div class="bg-total">0</div></div><div class="bg-board"></div><div class="bg-who"></div></div></div>`;
  const $ = s => root.querySelector(s);
  const wrap = $('.bg-wrap'), tray = $('.bg-tray'), status = $('.bg-status'), tricks = $('.bg-tricks');
  $('.host .bg-who b').textContent = ctx.host.name;
  const say = (t, small = '') => { status.innerHTML = ''; status.append(t); if (small) status.appendChild(Object.assign(document.createElement('small'), { textContent: small })); };

  const render = (side, fresh = -1) => {
    const board = S[side];
    const el = $(`.${side} .bg-board`);
    el.innerHTML = board.map((col, c) => {
      const n = {}; col.forEach(v => { n[v] = (n[v] || 0) + 1; });
      const slots = Array.from({ length: ROWS }, (_, r) => (r < col.length
        ? dieHtml(col[r], (n[col[r]] >= 3 ? 'm3' : n[col[r]] === 2 ? 'm2' : '') + (c === fresh && r === col.length - 1 ? ' land' : ''))
        : '<div class="bg-slot"></div>')).join('');
      return `<button class="bg-col" data-c="${c}" aria-label="Column ${c + 1}, ${columnScore(col)} points" tabindex="-1">${slots}` +
        `<span class="bg-cs">${columnScore(col) || ''}</span><span class="bg-gain"></span></button>`;
    }).join('');
    const tot = $(`.${side} .bg-total`);
    const v = boardScore(board);
    if (String(v) !== tot.textContent) { tot.textContent = v; tot.classList.add('bump'); setTimeout(() => tot.classList.remove('bump'), 220); }
  };
  render('hero'); render('host');

  const roll = async () => {
    rattle();
    tray.innerHTML = dieHtml(d6(), 'rolling');
    const die = tray.firstChild;
    for (let i = 0; i < 9; i++) { await sleep(65); die.dataset.f = d6(); }
    const f = d6();
    die.dataset.f = f; die.classList.remove('rolling'); die.classList.add('land'); clack();
    return f;
  };

  /** Fly the tray die into `side`'s column, smash the rival's matches, and score. */
  const placeDie = async (side, col, face) => {
    const otherSide = side === 'hero' ? 'host' : 'hero';
    const from = tray.firstChild?.getBoundingClientRect();
    const slot = $(`.${side} .bg-col[data-c="${col}"]`).querySelectorAll('.bg-slot, .bg-die')[S[side][col].length];
    const to = slot?.getBoundingClientRect(), base = wrap.getBoundingClientRect();
    if (from && to) {
      const fly = Object.assign(document.createElement('div'), { className: 'bg-fly', innerHTML: dieHtml(face) });
      Object.assign(fly.style, { left: `${from.left - base.left}px`, top: `${from.top - base.top}px` });
      wrap.appendChild(fly);
      tray.innerHTML = '';
      requestAnimationFrame(() => { fly.style.transform = `translate(${to.left - from.left}px,${to.top - from.top}px) scale(${to.width / from.width})`; });
      await sleep(330);
      fly.remove();
    }
    const r = place(S[side], S[otherSide], col, face);
    S[side] = r.mine;
    render(side, col);
    clack(1.2);
    if (r.smashed) {
      const victims = [...$(`.${otherSide} .bg-col[data-c="${col}"]`).querySelectorAll(`.bg-die[data-f="${face}"]`)];
      victims.forEach(v => { v.classList.add('smash'); shards(v); });
      crack();
      ctx.say(pick(side === 'hero' ? BARKS.hurt : BARKS.smash));
      await sleep(480);
      S[otherSide] = r.theirs;
      render(otherSide);
    } else if (side === 'host' && r.mine[col].filter(v => v === face).length === 3) ctx.say(pick(BARKS.triple));
  };

  const shards = el => {
    const a = el.getBoundingClientRect(), b = wrap.getBoundingClientRect();
    for (let i = 0; i < 8; i++) {
      const s = Object.assign(document.createElement('div'), { className: 'bg-shard' });
      const ang = Math.random() * Math.PI * 2, dist = 30 + Math.random() * 40;
      s.style.cssText = `left:${a.left - b.left + a.width / 2}px;top:${a.top - b.top + a.height / 2}px;--dx:${Math.cos(ang) * dist}px;--dy:${Math.sin(ang) * dist}px;--r:${Math.random() * 360}deg`;
      wrap.appendChild(s);
      setTimeout(() => s.remove(), 650);
    }
  };

  /** The hero's turn: pick a column (click or 1–3), maybe reroll, maybe palm the die. */
  const heroTurn = face => new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; document.removeEventListener('keydown', keys); ctx.signal.removeEventListener('abort', onAbort); tricks.innerHTML = ''; resolve(v); };
    const onAbort = () => finish({ abort: true });
    ctx.signal.addEventListener('abort', onAbort);
    const arm = () => {
      const open = openColumns(S.hero);
      $('.hero .bg-board').querySelectorAll('.bg-col').forEach(b => {
        const c = Number(b.dataset.c);
        const ok = open.includes(c);
        b.classList.toggle('open', ok);
        b.tabIndex = ok ? 0 : -1;
        if (ok) {
          b.querySelector('.bg-gain').textContent = `+${moveValue(S.hero, S.host, c, face)}`;
          b.onclick = () => finish({ col: c, face });
        } else b.onclick = null;
      });
      say(`Your ${face}. Where does it go?`, open.length > 1 ? 'Click a column, or press 1–3.' : '');
      tricks.innerHTML = '';
      if (S.heroRerolls > 0) {
        const b = Object.assign(document.createElement('button'), { className: 'tv-btn', textContent: `Reroll (${S.heroRerolls})`, title: 'Your Intelligence earns you rerolls' });
        b.onclick = async () => { S.heroRerolls--; tricks.innerHTML = ''; face = await roll(); arm(); };
        tricks.appendChild(b);
      }
      if (ctx.setup.cheating && !S.cheatUsed) {
        const b = Object.assign(document.createElement('button'), { className: 'tv-btn', textContent: '🤫 Palm a die', title: 'Sleight of Hand against the host\'s eye. Get caught, and you lose.' });
        b.onclick = async () => {
          S.cheatUsed = true; tricks.innerHTML = '';
          say('You let your sleeve drift over the die…');
          const res = await ctx.tryCheat();
          if (!res) return arm();
          if (res.caught) { finish({ caught: true, res }); return; }
          say(`Sleight of Hand ${res.total} — ${ctx.host.name} didn't see a thing.`, 'Choose the face you want.');
          ctx.say(pick(BARKS.palmed));
          const faces = Object.assign(document.createElement('div'), { className: 'bg-faces' });
          faces.innerHTML = [1, 2, 3, 4, 5, 6].map(f => dieHtml(f)).join('');
          faces.querySelectorAll('.bg-die').forEach(d => { d.onclick = () => { face = Number(d.dataset.f); tray.innerHTML = dieHtml(face, 'land'); clack(); arm(); }; });
          tricks.appendChild(faces);
        };
        tricks.appendChild(b);
      }
    };
    const keys = e => {
      if (!['1', '2', '3'].includes(e.key)) return;
      const c = Number(e.key) - 1;
      if (openColumns(S.hero).includes(c)) { e.preventDefault(); finish({ col: c, face }); }
    };
    document.addEventListener('keydown', keys);
    arm();
  });

  ctx.say(pick(BARKS.start));
  let turn = 'hero';
  while (!winner(S.hero, S.host)) {
    if (ctx.signal.aborted) return { won: false };
    let face = await roll();
    if (turn === 'hero') {
      const move = await heroTurn(face);
      if (move.abort) return { won: false };
      if (move.caught) {
        say(`Sleight of Hand ${move.res.total} against ${ctx.host.name}'s eye (${move.res.perception}).`, 'Caught!');
        ctx.say(pick(BARKS.caught));
        await sleep(1400);
        return { won: false, caught: true };
      }
      say('');
      await placeDie('hero', move.col, move.face);
    } else {
      say(`${ctx.host.name} is thinking…`);
      await sleep(550 + Math.random() * 500);
      if (S.hostRerolls > 0 && face <= 2) {
        S.hostRerolls--; ctx.say(pick(BARKS.reroll));
        face = await roll();
        await sleep(400);
      }
      await placeDie('host', hostMove(S.host, S.hero, face, ctx.setup.npcSkill), face);
    }
    turn = turn === 'hero' ? 'host' : 'hero';
    await sleep(250);
  }
  const w = winner(S.hero, S.host);
  ctx.say(pick(w === 'hero' ? BARKS.heroWin : w === 'host' ? BARKS.hostWin : BARKS.draw));
  if (w === 'hero') chime();
  say(`${boardScore(S.hero)} to ${boardScore(S.host)}.`);
  await sleep(1100);
  return { won: w === 'hero' ? true : w === 'draw' ? 'draw' : false };
}
