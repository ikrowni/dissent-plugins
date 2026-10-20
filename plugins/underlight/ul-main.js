// ul-main.js — boot: the canvas, keys and controller, the clock, the cards, and the table it was opened at.
// In Dissent it runs in a games frame (contextType 'games'); opened on its own it plays standalone, for testing.
import { handleSDKMessage, gameLobby, onGameLobby } from '../plugin-sdk.js';
import { advance } from './ul-game.js';
import { newRun, openStep, closeStep, stepLabel, hashSeed } from './ul-run.js';
import { CELLARS, LAMP_POST } from './biomes/cellars.js';
import { RAT_KING_ARENA } from './biomes/cellars-arena.js';
import { Input, padKeys, applyPad } from './ul-input.js';
import { Renderer } from './ul-render.js';
import { takeFx } from './ul-fx.js';
import { playFx, unlockAudio, setMuted, isMuted } from './ul-sound.js';
import { drawHud } from './ul-hud.js';
import { showCard, hideCard, CARDS } from './ul-cards.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view'), card = $('card');
const hud = { hp: $('hpFill'), oil: $('oilFill'), flask: $('flask'), status: $('status'), corner: $('corner'), boss: $('boss'), bossName: $('bossName'), bossFill: $('bossFill') };
const renderer = new Renderer(canvas), input = new Input();
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
renderer.reduced = reduceMQ.matches;
reduceMQ.addEventListener?.('change', (e) => { renderer.reduced = e.matches; });

/** phase: 'card' (a card is up, nothing steps), 'play', 'paused', 'over' (died, or the act is done: R starts again),
 *  'down' (between steps), 'closed'. */
let S = null, run = null, where = '', phase = 'card', acc = 0, last = 0, padPrev = new Set(), started = false;
/** At a table the levels come from its id (the node made it) and how many runs it has started; alone, the clock. */
let tableId = null, runs = 0;

function start() {
  unlockAudio();
  runs++;
  run = newRun(tableId ? hashSeed(`${tableId}#${runs}`) : (Date.now() & 0x7fffffff) || 1);
  openCurrent();
}
function openCurrent() {
  S = openStep(run, CELLARS, LAMP_POST, RAT_KING_ARENA);
  where = stepLabel(run, CELLARS);
  renderer.setRoom(S);
  acc = 0; input.clear(); phase = 'play'; hideCard(card); canvas.focus();
}
function titleCard() {
  if (started) return;
  started = true;
  showCard(card, { ...CARDS.title(), buttons: [{ label: 'Go down (Enter)', primary: true, onClick: start }] });
}
function togglePause() {
  if (phase === 'play') { phase = 'paused'; showCard(card, { ...CARDS.paused(), buttons: [{ label: 'Resume (Enter)', primary: true, onClick: togglePause }] }); }
  else if (phase === 'paused') { phase = 'play'; input.clear(); hideCard(card); canvas.focus(); }
}
function endCard() {
  phase = 'over';
  if (S.over === 'dead') { showCard(card, { ...CARDS.dead(S, where), buttons: [{ label: 'Try again (Enter)', primary: true, onClick: start }] }); return; }
  const done = closeStep(run, S) === 'act-done';
  if (done) { showCard(card, { ...CARDS.actDone(S), buttons: [{ label: 'Go down again (Enter)', primary: true, onClick: start }] }); return; }
  phase = 'down'; // not 'over': R must not throw the run away here
  showCard(card, { ...CARDS.down(S, stepLabel(run, CELLARS)), buttons: [{ label: 'Continue (Enter)', primary: true, onClick: openCurrent }] });
}

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  if (k === 'm' && !e.repeat) { setMuted(!isMuted()); return; }
  if ((k === 'p' || k === 'escape') && !e.repeat && (phase === 'play' || phase === 'paused')) { togglePause(); return; }
  if (k === 'r' && !e.repeat && phase === 'over') { start(); return; }
  if (phase !== 'play') return; // Enter on a card presses its focused button by itself
  input.down(k);
});
addEventListener('keyup', (e) => input.up(e.key.toLowerCase()));
addEventListener('blur', () => { input.clear(); if (phase === 'play') togglePause(); });
canvas.addEventListener('pointerdown', () => { unlockAudio(); canvas.focus(); });
// Left button attacks, right button blocks (its press is the parry). No right-click menu over the game.
canvas.addEventListener('mousedown', (e) => {
  if (phase !== 'play' || (e.button !== 0 && e.button !== 2)) return;
  e.preventDefault(); input.down(`mouse${e.button}`);
});
addEventListener('mouseup', (e) => input.up(`mouse${e.button}`));
addEventListener('contextmenu', (e) => e.preventDefault());

function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (ts - (last || ts)) / 1000); last = ts;
  if (!S) return;
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const now = padKeys(pads[0]);
  if (now.has('pad:pause') && !padPrev.has('pad:pause')) togglePause();
  if (phase === 'play') padPrev = applyPad(input, padPrev, now); else padPrev = now;
  if (phase === 'play') acc = advance(S, input, acc + dt);
  const events = takeFx(S);
  playFx(events);
  renderer.frame(S, phase === 'play' ? dt : 0, events);
  drawHud(hud, S, where);
  if (phase === 'play' && S.over) endCard();
}
requestAnimationFrame(frame);

// In Dissent: wait for the host's init. On its own (no parent frame): play standalone.
addEventListener('message', (e) => handleSDKMessage(e, async (msg) => {
  const ctx = msg.context ?? {};
  if (ctx.contextType !== 'games') { titleCard(); return; }
  tableId = ctx.lobbyId ?? null;
  onGameLobby((info) => {
    if (!info?.closed) return;
    phase = 'closed'; showCard(card, { ...CARDS.closed(), buttons: [] });
  });
  try {
    const lobby = await gameLobby();
    if (lobby?.you?.role === 'watcher') { started = true; phase = 'closed'; showCard(card, { ...CARDS.watching(), buttons: [] }); return; }
  } catch { /* an old host without the lobby call: just play */ }
  titleCard();
}));
if (window.parent === window) {
  titleCard();
  // Opened on its own (never inside Dissent): let the local check see the game. Read-only by intent.
  window.__ul = { get S() { return S; }, get run() { return run; }, get phase() { return phase; } };
}
else setTimeout(titleCard, 3000); // a host that never sends init: still let the game be played
