// ul-main.js — boot: the canvas, keys and controller, the clock, the cards, and the table it was opened at.
// In Dissent it runs in a games frame (contextType 'games'); opened on its own it plays standalone, for testing.
import { handleSDKMessage, gameLobby, onGameLobby } from '../plugin-sdk.js';
import { newGame, advance } from './ul-game.js';
import { Input, padKeys, applyPad } from './ul-input.js';
import { Renderer } from './ul-render.js';
import { takeFx } from './ul-fx.js';
import { playFx, unlockAudio, setMuted, isMuted } from './ul-sound.js';
import { drawHud } from './ul-hud.js';
import { showCard, hideCard, CARDS } from './ul-cards.js';
import { CELLARS_01 } from './rooms/cellars-01.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view'), card = $('card');
const hud = { hp: $('hpFill'), oil: $('oilFill'), flask: $('flask'), status: $('status'), corner: $('corner') };
const renderer = new Renderer(canvas), input = new Input();
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
renderer.reduced = reduceMQ.matches;
reduceMQ.addEventListener?.('change', (e) => { renderer.reduced = e.matches; });

/** phase: 'card' (a card is up, nothing steps), 'play', 'paused', 'over' (the room's end card), 'closed'. */
let S = null, phase = 'card', acc = 0, last = 0, padPrev = new Set(), started = false;

function start() {
  unlockAudio();
  S = newGame(CELLARS_01, { seed: (Date.now() & 0x7fffffff) || 1 });
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
  showCard(card, { ...(S.over === 'dead' ? CARDS.dead(S) : CARDS.cleared(S)), buttons: [{ label: S.over === 'dead' ? 'Try again (Enter)' : 'Again (Enter)', primary: true, onClick: start }] });
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
  drawHud(hud, S);
  if (phase === 'play' && S.over) endCard();
}
requestAnimationFrame(frame);

// In Dissent: wait for the host's init. On its own (no parent frame): play standalone.
addEventListener('message', (e) => handleSDKMessage(e, async (msg) => {
  const ctx = msg.context ?? {};
  if (ctx.contextType !== 'games') { titleCard(); return; }
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
if (window.parent === window) titleCard();
else setTimeout(titleCard, 3000); // a host that never sends init: still let the game be played
