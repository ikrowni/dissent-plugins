// ul-main.js — boot: the canvas, keys and controller, the clock, the cards, saving, settings, and the table it was
// opened at. In Dissent it runs in a games frame (contextType 'games'); opened on its own it plays standalone, for
// testing (nothing saves then, and it says so).
// Only helpers every SDK copy has: a node that mirrors plugins serves its own embedded copy, which may be older, and a
// named import it lacks would stop the whole game loading. The sound level is asked for and listened to by hand.
import { handleSDKMessage, request, gameLobby, onGameLobby } from '../plugin-sdk.js';
import { advance } from './ul-game.js';
import { newRun, openStep, closeStep, stepLabel, hashSeed, STEPS } from './ul-run.js';
import { CELLARS, LAMP_POST } from './biomes/cellars.js';
import { RAT_KING_ARENA } from './biomes/cellars-arena.js';
import { CAMP } from './biomes/camp.js';
import { Input, padKeys, applyPad } from './ul-input.js';
import { Renderer } from './ul-render.js';
import { takeFx } from './ul-fx.js';
import { playFx, unlockAudio, setMuted, isMuted, setVolume, setAppSound } from './ul-sound.js';
import { drawHud } from './ul-hud.js';
import { showCard, hideCard, CARDS } from './ul-cards.js';
import { Store } from './ul-store.js';
import { SAVE_KEY, saveOf, readSave, runFrom } from './ul-save.js';
import { SETTINGS_KEY, DEFAULT_SETTINGS, readSettings, bindingsFor } from './ul-settings.js';
import { showSettings, keysHint } from './ul-settings-card.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view'), card = $('card');
const hud = { hp: $('hpFill'), oil: $('oilFill'), flask: $('flask'), status: $('status'), corner: $('corner'), boss: $('boss'), bossName: $('bossName'), bossFill: $('bossFill') };
const renderer = new Renderer(canvas), input = new Input();
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
renderer.reduced = reduceMQ.matches;
reduceMQ.addEventListener?.('change', (e) => { renderer.reduced = e.matches; });

/** phase: 'card' (a card is up, nothing steps), 'play', 'paused', 'over' (died: R starts again), 'down' (between
 *  steps), 'settings', 'closed'. */
let S = null, run = null, where = '', phase = 'card', acc = 0, last = 0, padPrev = new Set(), booted = false;
/** At a table the levels come from its id (the node made it) and how many runs it has started; alone, the clock. */
let tableId = null, runs = 0;
/** Your saved run (at a camp) or null; your settings; a short note over the status line ("Rested · saved"). */
let save = null, settings = DEFAULT_SETTINGS, note = null, noteUntil = 0;
// Opened on its own, the local check may hand in a pretend host for storage (window.__ulTestStore). Never in Dissent.
const standalone = window.parent === window;
const store = new Store(standalone ? (window.__ulTestStore ?? null) : (action, params) => request(action, params));

function applySettings(s) {
  settings = s;
  input.setBindings(bindingsFor(s)); setVolume(s.volume);
  $('keys').textContent = keysHint(s);
}
function say(text, tone = 'plain', seconds = 4) { note = { text, tone }; noteUntil = performance.now() + seconds * 1000; }

function start() {
  unlockAudio();
  runs++;
  run = newRun(tableId ? hashSeed(`${tableId}#${runs}`) : (Date.now() & 0x7fffffff) || 1);
  openCurrent();
}
function continueRun() { unlockAudio(); run = runFrom(save); openCurrent(); }
function openCurrent() {
  S = openStep(run, CELLARS, LAMP_POST, RAT_KING_ARENA, CAMP);
  where = stepLabel(run, CELLARS);
  renderer.setRoom(S);
  acc = 0; input.clear(); phase = 'play'; hideCard(card); canvas.focus();
}
function titleCard() {
  phase = 'card';
  const extra = save ? [CARDS.continued(save)] : [];
  const lines = [...extra, CARDS.saving(store.state)];
  const settingsBtn = { label: 'Settings', onClick: () => openSettings(titleCard) };
  const buttons = save
    ? [{ label: 'Continue from the camp (Enter)', primary: true, onClick: continueRun }, { label: 'Start a new descent', onClick: confirmNew }, settingsBtn]
    : [{ label: 'Go down (Enter)', primary: true, onClick: start }, settingsBtn];
  showCard(card, { ...CARDS.title(lines), buttons });
}
function confirmNew() {
  showCard(card, { ...CARDS.confirmNew(), buttons: [
    { label: 'Keep my run (Enter)', primary: true, onClick: titleCard },
    { label: 'End it and start new', onClick: async () => { await store.del(SAVE_KEY); save = null; start(); } },
  ] });
}
function openSettings(back) {
  phase = 'settings';
  showSettings(card, settings, {
    onChange: (s) => { applySettings(s); store.set(SETTINGS_KEY, s); },
    onDone: back,
  });
}
function pauseCard() {
  const buttons = [{ label: 'Resume (Enter)', primary: true, onClick: togglePause }, { label: 'Settings', onClick: () => openSettings(pauseCard) }];
  if (STEPS[run.step] === 'camp' && save) buttons.push({ label: 'Leave for now (saved)', onClick: leave });
  phase = 'paused';
  showCard(card, { ...CARDS.paused(), buttons });
}
function togglePause() {
  if (phase === 'play') pauseCard();
  else if (phase === 'paused') { phase = 'play'; input.clear(); hideCard(card); canvas.focus(); }
}
/** Back to the title, the run kept in its save. */
function leave() { S = null; titleCard(); }

/** You rested at a camp's fire: save the run there (spec §3.1: saves only at camps). */
async function onRest() {
  const p = S.player;
  run.carry = { hp: p.hp, oil: p.oil, flask: p.flask };
  const next = saveOf(run, Date.now());
  if (await store.set(SAVE_KEY, next)) { save = readSave(next); say('Rested · saved'); }
  else say(`Rested · not saved. ${CARDS.saving(store.state)}`, 'warn', 8);
}
async function endCard() {
  if (S.over === 'dead') {
    phase = 'over';
    if (save && save.base === run.base) { await store.del(SAVE_KEY); save = null; } // a lost run's save goes with it
    showCard(card, { ...CARDS.dead(S, where), buttons: [{ label: 'Try again (Enter)', primary: true, onClick: start }] });
    return;
  }
  if (STEPS[run.step] === 'camp') { // the stairs below the camp: act 2 is still being dug out
    phase = 'down';
    showCard(card, { ...CARDS.dugOut(save ? 'ok' : store.state), buttons: [
      { label: 'Stay at the camp (Enter)', primary: true, onClick: () => { S.over = null; S.player.x -= 72; phase = 'play'; hideCard(card); canvas.focus(); } },
      { label: 'Leave for now', onClick: leave },
    ] });
    return;
  }
  const done = closeStep(run, S) === 'act-done';
  phase = 'down'; // not 'over': R must not throw the run away here
  if (done) { showCard(card, { ...CARDS.actDone(S), buttons: [{ label: 'Go down again (Enter)', primary: true, onClick: start }] }); return; }
  showCard(card, { ...CARDS.down(S, stepLabel(run, CELLARS)), buttons: [{ label: 'Continue (Enter)', primary: true, onClick: openCurrent }] });
}

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  if (phase === 'settings') return; // the settings card takes its own keys
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
  if (events.some((e) => e.k === 'rest')) onRest();
  renderer.frame(S, phase === 'play' ? dt : 0, events);
  if (note && performance.now() > noteUntil) note = null;
  drawHud(hud, S, where, note);
  if (phase === 'play' && S.over) endCard();
}
requestAnimationFrame(frame);

/** Once: your settings and any saved run, then the title. */
async function boot() {
  if (booted) return;
  booted = true;
  const [st, sv] = [await store.get(SETTINGS_KEY), await store.get(SAVE_KEY)];
  applySettings(readSettings(st));
  save = readSave(sv);
  titleCard();
}

// In Dissent: wait for the host's init. On its own (no parent frame): play standalone.
addEventListener('message', (e) => handleSDKMessage(e, onInit, (ev) => { if (ev.event === 'game.sound') setAppSound(ev.data); }));
async function onInit(msg) {
  const ctx = msg.context ?? {};
  if (ctx.contextType !== 'games') { boot(); return; }
  tableId = ctx.lobbyId ?? null;
  onGameLobby((info) => {
    if (!info?.closed) return;
    phase = 'closed'; showCard(card, { ...CARDS.closed(), buttons: [] });
  });
  try { setAppSound(await request('games.sound', {})); } catch { /* an older app: our own volume only */ }
  try {
    const lobby = await gameLobby();
    if (lobby?.you?.role === 'watcher') { booted = true; phase = 'closed'; showCard(card, { ...CARDS.watching(), buttons: [] }); return; }
  } catch { /* an old host without the lobby call: just play */ }
  boot();
}
if (standalone) {
  boot();
  // Opened on its own (never inside Dissent): let the local check see the game.
  window.__ul = { get S() { return S; }, get run() { return run; }, get phase() { return phase; }, get save() { return save; }, get settings() { return settings; } };
}
else setTimeout(boot, 3000); // a host that never sends init: still let the game be played
