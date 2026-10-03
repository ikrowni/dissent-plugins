// dnd-hub-forge.js — the Hero Forge, drawn in #screen-char-creator (spec 2026-10-03 hero forge). Replaces the plain
// Quick character page; the builder behind it (dnd-hub-quick.js) and the save path (finishWithDraft) are unchanged.
import { SRD } from './dnd-hub-state.js?v=20260502p4';
import { storageSetUser } from '../plugin-sdk.js';
import { quickBuild, previewStats, READY_HEROES } from './dnd-hub-quick.js';
import { startCharacterCreator, finishWithDraft } from './dnd-hub-char.js?v=20261003p';
import { raceView, classView } from './lk-hero-data.js';
import { initForge, forgeStep } from './dnd-hub-forge-state.js';
import { createForgeFx } from './dnd-hub-forge-fx.js';
import { createForgeSound } from './dnd-hub-forge-sound.js';
import { topBar, quickStrip, stage, emblemRow, reveal } from './dnd-hub-forge-view.js';

let _campaignId = null, _s = null, _draft = null, _fx = null, _dir = 1;
const _sound = createForgeSound();
const races = () => (SRD.races || []).map(raceView);
const classes = () => (SRD.classes || []).map(classView);
const root = () => document.getElementById('screen-char-creator');
const open = () => !root()?.classList.contains('hidden') && !!root()?.querySelector('.forge');

export function showQuickCharacter(campaignId) {
  _campaignId = campaignId; _draft = null;
  _s = initForge((SRD.races || []).length, (SRD.classes || []).length);
  window.showScreen('char-creator');
  root().innerHTML = '<div class="forge"><canvas class="forge-fx" id="forge-fx"></canvas><div class="forge-ui" id="forge-ui"></div></div>';
  _fx?.stop();
  _fx = createForgeFx(document.getElementById('forge-fx'));
  _fx.start();
  window.__forgeFxRunning = () => !!_fx?.running; // the playtest's reduced-motion check
  render();
}

function render() {
  const ui = document.getElementById('forge-ui');
  if (!ui) return;
  const R = races(), C = classes();
  const race = R[_s.race], cls = C[_s.cls];
  _fx?.setTint(race?.colour);
  if (_s.scene === 'race') {
    ui.innerHTML = topBar('Choose your people', { muted: _sound.muted(), canBack: false }) + quickStrip(READY_HEROES)
      + stage(race, { kind: 'race', dir: _dir }) + emblemRow(R, _s.race, 'Races');
  } else if (_s.scene === 'class') {
    ui.innerHTML = topBar('Choose your calling', { muted: _sound.muted(), canBack: true })
      + stage(cls, { kind: 'class', dir: _dir }) + emblemRow(C, _s.cls, 'Classes');
  } else {
    if (!_draft) _draft = quickBuild(SRD, race.id, cls.id);
    ui.innerHTML = topBar('Your hero', { muted: _sound.muted(), canBack: true })
      + reveal(_draft, race, cls, previewStats(SRD, _draft));
    countUp(ui);
    _sound.swell();
  }
  document.getElementById('forge-choose')?.focus({ preventScroll: true });
}

function countUp(ui) {
  for (const b of ui.querySelectorAll('[data-to]')) {
    const to = Number(b.dataset.to), t0 = performance.now();
    const tick = t => { const k = Math.min(1, (t - t0) / 900); b.textContent = String(Math.round(to * k)); if (k < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
}

function step(action, dir = 1) {
  const before = _s;
  _s = forgeStep(_s, action);
  if (_s === before) return;
  _dir = dir;
  if (action.type === 'browse' || action.type === 'select') _sound.whoosh();
  render();
}

export function forgeSelect(i) { step({ type: 'select', index: i }, i < (_s.scene === 'class' ? _s.cls : _s.race) ? -1 : 1); }
export function forgeChoose() {
  if (_s.scene === 'reveal') return;
  _sound.chime();
  const stageEl = document.getElementById('forge-stage');
  document.getElementById('forge-art')?.classList.add('forge-flash');
  stageEl?.classList.add('forge-sweep');
  if (_s.scene === 'class') _draft = null;
  setTimeout(() => step({ type: 'choose' }), stageEl ? 450 : 0);
}
export function forgeBack() { step({ type: 'back' }, -1); }
export function forgeToggleMute() { _sound.setMuted(!_sound.muted()); render(); }

export function quickPickHero(id) {
  const h = READY_HEROES.find(x => x.id === id);
  if (!h) return;
  _draft = quickBuild(SRD, h.race, h.class, Math.random, h.name);
  _sound.chime();
  step({ type: 'quickPick', id, race: (SRD.races || []).findIndex(r => r.id === h.race), cls: (SRD.classes || []).findIndex(c => c.id === h.class) });
}
export function quickStepByStep() { _fx?.stop(); startCharacterCreator(_campaignId); }

function takeName() { const n = document.getElementById('quick-name')?.value?.trim(); if (n) _draft.name = n; }

export async function quickPlay() {
  takeName();
  const btn = document.getElementById('quick-play');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  _fx?.stop();
  await finishWithDraft(_campaignId, _draft);
}

/** Back to the class scene, keeping the race; a new class makes a new hero. */
export function quickChange() { takeName(); _draft = null; step({ type: 'change' }, -1); }

/** Full creator with this hero filled in (kept for anything that still calls it). */
export async function quickOpenFullCreator() {
  takeName();
  await storageSetUser(`char-draft-${_campaignId}`, _draft);
  _fx?.stop();
  startCharacterCreator(_campaignId);
}

// Keys: ←/→ browse, Enter chooses, Esc goes back. Only while the forge is on screen and not while typing a name.
window.addEventListener('keydown', e => {
  if (!open() || e.target?.closest?.('input, textarea')) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); step({ type: 'browse', by: e.key === 'ArrowRight' ? 1 : -1 }, e.key === 'ArrowRight' ? 1 : -1); }
  else if (e.key === 'Enter' && _s.scene !== 'reveal' && !e.target?.closest?.('button')) { e.preventDefault(); forgeChoose(); }
  else if (e.key === 'Escape' && _s.scene !== 'race') { e.preventDefault(); forgeBack(); }
}, true);
window.addEventListener('wheel', e => {
  if (!open() || _s.scene === 'reveal' || !e.target?.closest?.('#forge-stage, .forge-row')) return;
  if (Math.abs(e.deltaY) < 20) return;
  e.preventDefault();
  step({ type: 'browse', by: e.deltaY > 0 ? 1 : -1 }, e.deltaY > 0 ? 1 : -1);
}, { passive: false });
