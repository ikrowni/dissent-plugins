// rune-dice.js — Rune Dice at a tavern table: everyone at once, run by the DM's Hub (rune-dice-rules.js).
//
// Click dice to keep them, roll the rest (up to three times), pick a god's boon if you have the favour, and be ready.
// Then the clash: everyone strikes the next player round the table. Cheating: a loaded die (two extra axes this
// round) — Sleight of Hand against the host's eye, judged by the DM's Hub.
import * as R from './rune-dice-rules.js?v=20261015p';
import { useKit, loadCss, el, btn, banner, coins, sleep, pick, chips, tableClient, esc } from './kit.js?v=20261015p';
import { rattle, clack, thump, chime, crack } from './tavern-sfx.js?v=20261015p';
import { icon } from '../lk-icons.js';

const ICON = { axe: 'sword', arrow: 'target', helm: 'crown', shield: 'shield', hand: 'hand' };
const BARKS = { start: ['Roll your runes. The gods are watching.', 'Six dice. Three throws. No mercy.'], caught: ['A weighted die? OUT!'] };

export async function play(root, ctx) {
  useKit();
  loadCss('rd-css', './rune-dice.css?v=20261015p', import.meta.url);
  const wrap = el('div', 'tk-felt rd');
  wrap.innerHTML = `<div class="rd-top"></div><div class="rd-ring"></div><div class="rd-clash" aria-live="polite"></div>
    <div class="rd-mine"><div class="rd-dice"></div><div class="rd-boons"></div><div class="tk-row rd-btns"></div><div class="tk-note rd-status" aria-live="polite"></div></div>`;
  root.appendChild(wrap);
  const $ = s => wrap.querySelector(s);
  let keep = Array(6).fill(false), boon = null, S = null, cheatUsed = false;

  const face = (d, cls = '') => {
    const F = R.FACES[d];
    return `<div class="rd-die ${F.gold ? 'gold' : ''} ${cls}" title="${F.f}${F.gold ? ' (gold: +1 favour)' : ''}">${icon(ICON[F.f], { size: 22 })}</div>`;
  };
  const me = () => S?.players.find(p => p.id === ctx.me);

  const drawTop = () => {
    $('.rd-top').innerHTML = chips(S.players, { me: ctx.me, active: R.toAct(S), out: p => p.out,
      line: p => `<span class="rd-stones">${'◆'.repeat(Math.max(0, Math.min(R.LIFE, p.life)))}</span> ${p.life} · ✦ ${p.favor}` });
  };
  const drawRing = () => {
    $('.rd-ring').innerHTML = S.players.filter(p => p.id !== ctx.me).map(p => {
      const t = R.targetOf(S, p.id);
      return `<div class="rd-seat${p.out ? ' out' : ''}${p.done ? ' ready' : ''}"><b>${esc(p.name)}</b>` +
        `<div class="rd-row">${p.dice.map((d, i) => face(d, (p.keep[i] ? 'kept ' : '') + 'small')).join('')}</div>` +
        `<span class="tk-note">${p.out ? 'out' : p.done ? `ready${p.boon && S.phase !== 'roll' ? '' : ''}` : `rolling (${p.rolls}/${R.maxRolls(p)})`}${t ? ` · strikes ${t.id === ctx.me ? 'you' : esc(t.name)}` : ''}</span></div>`;
    }).join('');
  };
  const drawMine = () => {
    const p = me();
    if (!p || p.out) { $('.rd-dice').innerHTML = ''; $('.rd-boons').innerHTML = ''; $('.rd-btns').innerHTML = ''; $('.rd-status').textContent = p?.out ? 'You are out of stones. Watch the rest.' : ''; return; }
    const t = R.targetOf(S, ctx.me);
    const myTurn = S.phase === 'roll' && !p.done;
    $('.rd-dice').innerHTML = p.dice.map((d, i) => `<button class="rd-pick" data-i="${i}" ${myTurn && p.rolls < R.maxRolls(p) ? '' : 'disabled'} aria-pressed="${keep[i]}">${face(d, keep[i] ? 'kept' : '')}</button>`).join('');
    const golds = p.dice.filter(d => R.FACES[d].gold).length;
    $('.rd-boons').innerHTML = myTurn ? Object.entries(R.BOONS).map(([k, b]) =>
      `<button class="rd-boon${boon === k ? ' on' : ''}" data-boon="${k}" ${p.favor + golds >= b.cost ? '' : 'disabled'} title="${b.text}"><b>${b.name}</b><span>${b.cost} ✦ · ${b.text}</span></button>`).join('') : '';
    const btns = $('.rd-btns'); btns.innerHTML = '';
    if (myTurn) {
      if (p.rolls < R.maxRolls(p)) btns.appendChild(btn(`Roll the rest (${R.maxRolls(p) - p.rolls} left)`, () => { rattle(); client.act({ type: 'roll', keep }); }));
      btns.appendChild(btn('Ready', () => { clack(); client.act({ type: 'done', keep, boon }); }, { primary: true }));
      if (ctx.setup.cheating && !cheatUsed) btns.appendChild(btn('🤫 Load a die', () => { cheatUsed = true; client.cheat(); drawMine(); }, { title: 'Sleight of Hand against the host\'s eye: two extra axes this round, if unseen' }));
    }
    $('.rd-status').textContent = S.phase === 'roll'
      ? (p.done ? 'Ready. Waiting for the others…' : `Keep what you like and roll the rest. You strike ${t ? (t.id === ctx.me ? 'nobody' : t.name) : 'nobody'}; gold faces earn favour (✦ ${p.favor} + ${golds}).`)
      : '';
  };
  wrap.addEventListener('click', e => {
    const d = e.target.closest('.rd-pick'); const b = e.target.closest('.rd-boon');
    if (d && !d.disabled) { keep[Number(d.dataset.i)] = !keep[Number(d.dataset.i)]; clack(0.4); drawMine(); }
    if (b && !b.disabled) { boon = boon === b.dataset.boon ? null : b.dataset.boon; drawMine(); }
  });

  const showClash = async s => {
    const name = id => (id === ctx.me ? 'You' : s.players.find(p => p.id === id)?.name || '?');
    $('.rd-clash').innerHTML = '<h3>The clash</h3>' + s.clash.map(e => {
      const bits = [];
      if (e.dmg) bits.push(`<b class="hit">${e.dmg} damage</b>`); else bits.push('<span class="tk-note">blocked</span>');
      if (e.stole) bits.push(`steals ${e.stole} ✦`); if (e.heal) bits.push(`heals ${e.heal}`);
      if (e.boon) bits.push(`<i>${R.BOONS[e.boon].name}</i>`);
      return `<div class="rd-line">${esc(name(e.from))} → ${esc(e.to ? name(e.to) : '—')}: ${bits.join(' · ')}</div>`;
    }).join('');
    $('.rd-clash').classList.add('on');
    for (const e of s.clash) { if (e.dmg) { (e.to === ctx.me ? crack : thump)(0.4); await sleep(240); } }
  };

  ctx.say(pick(BARKS.start));
  const client = tableClient(wrap, ctx, R, {
    lobbyText: 'Rune Dice — pull up a stool',
    onState: (s, prev) => {
      S = s;
      if (s.phase === 'roll' && (!prev || prev.round !== s.round || prev.phase !== 'roll')) {
        keep = Array(6).fill(false); boon = null; $('.rd-clash').classList.remove('on'); rattle();
        banner(wrap, `Round ${s.round}`, `${R.MAX_ROUNDS - s.round + 1} at most to go`, 900);
      }
      if (s.phase === 'clash' && prev?.phase !== 'clash') showClash(s);
      if (prev && me() && prev.players.find(p => p.id === ctx.me)?.rolls !== me().rolls) rattle();
      drawTop(); drawRing(); drawMine();
    },
    onCheated: d => {
      if (d.seatId !== ctx.me) { $('.rd-status').textContent = d.caught ? 'Someone was caught with a loaded die!' : $('.rd-status').textContent; return; }
      $('.rd-status').textContent = d.caught ? `Sleight of Hand ${d.total} against the host's eye (${d.perception}). Caught!` : `Sleight of Hand ${d.total} — the die is loaded. Two extra axes this round.`;
      if (d.caught) ctx.say(pick(BARKS.caught));
    },
    onRefused: reason => { $('.rd-status').textContent = reason; },
  });
  const out = await client.done;
  if (out.caught) { await sleep(1400); return out; }
  if (S) {
    const w = R.winners(S);
    await sleep(600);
    const names = w.map(id => (id === ctx.me ? 'You' : S.players.find(p => p.id === id)?.name)).join(' & ');
    if (out.won === true) { chime(); const r = wrap.getBoundingClientRect(); coins(wrap, r.width / 2, r.height / 2, 26); }
    await banner(wrap, out.won === true ? 'You stand alone' : `${names} ${w.length > 1 ? 'share' : 'takes'} the table`, '', 1600);
  }
  return out;
}
