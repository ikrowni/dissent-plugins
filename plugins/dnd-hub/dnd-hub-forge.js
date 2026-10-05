// dnd-hub-forge.js — the Hero Forge, drawn in #screen-char-creator (spec 2026-10-03 hero forge). Replaces the plain
// Quick character page; the builder behind it (dnd-hub-quick.js) and the save path (finishWithDraft) are unchanged.
import { SRD } from './dnd-hub-state.js?v=20261014d';
import { storageSetUser } from '../plugin-sdk.js';
import { quickBuild, previewStats, READY_HEROES, CLASS_PRIORITY, STARTING_KITS } from './dnd-hub-quick.js';
import { startCharacterCreator, finishWithDraft } from './dnd-hub-char.js?v=20261014d';
import { raceView, classView } from './lk-hero-data.js';
import { initForge, forgeStep } from './dnd-hub-forge-state.js';
import { createForgeFx, FORGE_SHELL, setAura } from './dnd-hub-forge-fx.js';
import { createForgeSound } from './dnd-hub-forge-sound.js';
import { topBar, quickStrip, stage, emblemRow, reveal, countUp } from './dnd-hub-forge-view.js';
import { firstLevelPicks, applyFirstPicks } from './lk-levelling.js';
import { skillProficiencies } from './lk-rules5e.js';
import { openFirstPicks, openLevelUp, levelCtx } from './dnd-hub-levelup.js';
import { serverData, CC } from './dnd-hub-state.js?v=20261014d';
import { shapeSteps, swapScore, rollScores, toggleLimited, skillStep, spellStep, kitNames } from './dnd-hub-forge-shape.js';
import { shapeHeader, shapeBody, shapeFooter } from './dnd-hub-forge-shape-view.js';
import { validateDraft, draftScores } from './dnd-hub-draft-rules.js';
import { useCampaignSpells } from './book/book-spells-in-play.js';
import { getStartingGold } from './dnd-hub-char-steps.js?v=20261014d';
import { setGearTarget, gearChooserHtml, gearShopHtml } from './dnd-hub-gear-view.js';
import { applyGear } from './dnd-hub-starting-gear.js';

const ALL_SKILLS = ['Acrobatics', 'Animal Handling', 'Arcana', 'Athletics', 'Deception', 'History', 'Insight', 'Intimidation',
  'Investigation', 'Medicine', 'Nature', 'Perception', 'Performance', 'Persuasion', 'Religion', 'Sleight of Hand', 'Stealth', 'Survival'];
// Which validateDraft step each guided step answers for (its numbers are the old creator's steps).
const RULE_STEP = { heritage: 0, skills: 1, abilities: 2, spells: 5, details: 6 };
let _showQuick = false, _shapeError = '';

let _campaignId = null, _s = null, _draft = null, _fx = null, _dir = 1, _picksPlan = null;
const _sound = createForgeSound();
const races = () => (SRD.races || []).map(raceView);
const classes = () => (SRD.classes || []).map(classView);
const root = () => document.getElementById('screen-char-creator');
// The draft as a hero, enough for level-1 picks: its class and skills (expertise chooses among them).
function draftHero(d) {
  const bg = (SRD.backgrounds || []).find(b => b.id === d.background);
  return { class: d.class, race: d.race, name: d.name,
    skills: skillProficiencies({ race: d.race, classSkills: d.proficiencyChoices || [], extraSkills: d.extraSkills || [] }, bg), features: [] };
}
const open = () => !root()?.classList.contains('hidden') && !!root()?.querySelector('.forge');

export function showQuickCharacter(campaignId) {
  // The campaign's books add spells to the spell step (re-drawn if they arrive while it is open).
  useCampaignSpells(serverData?.campaigns?.[campaignId]).then(() => { if (_s?.scene === 'shape') render(); }).catch(() => {});
  _campaignId = campaignId; _draft = null; _showQuick = false; _shapeError = '';
  _s = initForge((SRD.races || []).length, (SRD.classes || []).length);
  window.showScreen('char-creator');
  root().innerHTML = FORGE_SHELL;
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
  // The background takes the race on the race scene, the class on the class scene, then both together.
  setAura(_s.scene === 'race' ? race?.aura : _s.scene === 'class' ? cls?.aura : [race?.aura?.[0], cls?.aura?.[0]], _fx);
  if (_s.scene === 'race') {
    // Ready-made heroes are tucked away (owner, 2026-10-03): the Forge is for making your own.
    ui.innerHTML = topBar('Choose your people', { muted: _sound.muted(), canBack: false })
      + stage(race, { kind: 'race', dir: _dir }) + emblemRow(R, _s.race, 'Races')
      + (_showQuick ? quickStrip(READY_HEROES)
        : '<button class="forge-hurry" id="forge-hurry" onclick="forgeShowQuick()">In a hurry? Take a ready-made hero</button>');
  } else if (_s.scene === 'class') {
    ui.innerHTML = topBar('Choose your calling', { muted: _sound.muted(), canBack: true })
      + stage(cls, { kind: 'class', dir: _dir }) + emblemRow(C, _s.cls, 'Classes');
  } else if (_s.scene === 'picks') {
    openFirstPicks({ campaignId: _campaignId, hero: draftHero(_draft), plan: _picksPlan,
      onPicks: choices => {
        const picked = applyFirstPicks(draftHero(_draft), _picksPlan, choices);
        _draft.subclass = picked.subclass || null;
        _draft.fightingStyle = picked.fightingStyle || null;
        _draft.expertise = Object.entries(picked.skills).filter(([, v]) => v === 'expertise').map(([k]) => k);
        step({ type: 'choose' });
      },
      onBack: () => step({ type: 'back' }, -1) });
    return;
  } else if (_s.scene === 'shape') {
    renderShape(ui, race, cls);
    return;
  } else {
    if (!_draft) _draft = quickBuild(SRD, race.id, cls.id);
    ui.innerHTML = topBar('Your hero', { muted: _sound.muted(), canBack: true })
      + reveal(_draft, race, cls, previewStats(SRD, _draft));
    countUp(ui);
    _sound.swell();
  }
  document.getElementById('forge-choose')?.focus({ preventScroll: true });
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
  if (_s.scene === 'class') {
    // Build the hero now, filled with suggestions: its level-1 picks (if the class has any), then the guided steps,
    // come before the reveal. Coming back to the same race and class keeps what was chosen.
    const raceId = races()[_s.race].id, classId = classes()[_s.cls].id;
    if (!_draft || _draft.race !== raceId || _draft.class !== classId) _draft = quickBuild(SRD, raceId, classId);
    _picksPlan = firstLevelPicks(draftHero(_draft), levelCtx(_campaignId));
    _s = { ..._s, picks: _picksPlan.steps.length > 0, nShape: shapeSteps(_draft, SRD).length };
  }
  setTimeout(() => step({ type: 'choose' }), stageEl ? 450 : 0);
}
export function forgeBack() { step({ type: 'back' }, -1); }
export function forgeToggleMute() { _sound.setMuted(!_sound.muted()); render(); }

export function quickPickHero(id) {
  const h = READY_HEROES.find(x => x.id === id);
  if (!h) return;
  _draft = quickBuild(SRD, h.race, h.class, Math.random, h.name, h.picks || {});
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
  // A campaign that starts above level 1: save the level-1 hero, then play its level-ups before entering.
  const start = serverData?.campaigns?.[_campaignId]?.startingLevel || 1;
  if (start <= 1) { await finishWithDraft(_campaignId, _draft); return; }
  const cid = _campaignId;
  await finishWithDraft(cid, _draft, { enter: false });
  await openLevelUp(cid, () => window.enterCampaignAsPlayer(cid));
}

/** Back to the class scene, keeping the race; a new class makes a new hero. */
export function quickChange() { takeName(); if (_s.quick || !_s.nShape) _draft = null; step({ type: 'change' }, -1); }

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
  else if (e.key === 'Enter' && (_s.scene === 'race' || _s.scene === 'class') && !e.target?.closest?.('button')) { e.preventDefault(); forgeChoose(); }
  else if (e.key === 'Escape' && _s.scene !== 'race') { e.preventDefault(); forgeBack(); }
}, true);
window.addEventListener('wheel', e => {
  if (!open() || (_s.scene !== 'race' && _s.scene !== 'class') || !e.target?.closest?.('#forge-stage, .forge-row')) return;
  if (Math.abs(e.deltaY) < 20) return;
  e.preventDefault();
  step({ type: 'browse', by: e.deltaY > 0 ? 1 : -1 }, e.deltaY > 0 ? 1 : -1);
}, { passive: false });

// ── The guided steps (dnd-hub-forge-shape.js) ─────────────────────────────────────────────────────────────────────

function renderShape(ui, race, cls) {
  // The creator's helpers (portrait upload) work on CC.draft: make it this hero.
  CC.campaignId = _campaignId; CC.draft = _draft;
  const kinds = shapeSteps(_draft, SRD);
  if (_s.nShape !== kinds.length) _s = { ..._s, nShape: kinds.length, shape: Math.min(_s.shape, kinds.length - 1) };
  const kind = kinds[_s.shape];
  const srdRace = (SRD.races || []).find(r => r.id === _draft.race);
  const ctx = { srd: SRD, race: srdRace, cls, main: (CLASS_PRIORITY[_draft.class] || []).slice(0, 2),
    finals: draftScores(_draft, SRD.races), skills: skillStep(_draft, SRD), spells: spellStep(_draft, SRD),
    kit: kitNames({ equipment: STARTING_KITS[_draft.class] || _draft.equipment }, SRD), gold: getStartingGold(), allSkills: ALL_SKILLS };
  if (kind === 'gear') {
    // The class's choices, or the shop for starting gold (dnd-hub-gear-view.js); every pick redraws this step.
    setGearTarget({ draft: () => _draft, srd: SRD, budgetGp: () => getStartingGold(_draft.class), redraw: render });
    if (!_draft.useStartingGold) applyGear(_draft, SRD);
    ctx.gearHtml = _draft.useStartingGold ? gearShopHtml(_draft, SRD, ctx.gold) : gearChooserHtml(_draft, SRD);
  }
  ui.innerHTML = shapeHeader(_draft, race, cls, _s.shape, kinds.length, kind, _sound.muted())
    + `<div class="forge-slide ${_dir < 0 ? 'back' : ''}">${shapeBody(kind, _draft, ctx)}</div>`
    + shapeFooter(_shapeError, _s.shape === kinds.length - 1);
  // Keyboard players: Enter goes on; Tab reaches the choices. Not while an error asks for a fix.
  if (!_shapeError) document.getElementById('shape-next')?.focus({ preventScroll: true });
}
const shapeKind = () => shapeSteps(_draft, SRD)[_s.shape];
const reshape = () => { _shapeError = ''; render(); };

export function shapePick(kv) {
  const [k, v] = String(kv).split(':');
  if (k === 'subrace') _draft.subrace = v;
  else if (k === 'background') _draft.background = v;
  else if (k === 'gear') {
    _draft.useStartingGold = v === 'gold';
    applyGear(_draft, SRD);
  }
  _sound.whoosh(); reshape();
}
export function shapeScore(ability, value) { _draft.baseScores = swapScore(_draft.baseScores, ability, Number(value)); reshape(); }
export function shapeScores(mode) {
  const prio = CLASS_PRIORITY[_draft.class] || [];
  if (mode === 'roll') { _draft.baseScores = rollScores(prio); _draft.abilityMethod = 'manual-roll'; _sound.chime(); }
  else { _draft.baseScores = Object.fromEntries(prio.map((a, i) => [a, [15, 14, 13, 12, 10, 8][i]])); _draft.abilityMethod = 'standard-array'; }
  reshape();
}
export function shapeHalfElf(i, ability) { const b = [...(_draft.halfElfBonus || [])]; b[i] = ability; _draft.halfElfBonus = b; reshape(); }
export function shapeSkill(n) {
  _draft.proficiencyChoices = toggleLimited(_draft.proficiencyChoices, n, skillStep(_draft, SRD).choose);
  _draft.extraSkills = (_draft.extraSkills || []).filter(x => !_draft.proficiencyChoices.includes(x));
  reshape();
}
export function shapeExtraSkill(n) { _draft.extraSkills = toggleLimited(_draft.extraSkills, n, 2); reshape(); }
export function shapeCantrip(id) { _draft.cantrips = toggleLimited(_draft.cantrips, id, spellStep(_draft, SRD).cantrips); reshape(); }
export function shapeSpell(id) { _draft.spells = toggleLimited(_draft.spells, id, spellStep(_draft, SRD).spells); reshape(); }
/** Typing: no re-render, or the field loses focus. */
export function shapeText(field, value) { _draft[field] = value; }
export function shapeNewName() {
  _draft.name = quickBuild(SRD, _draft.race, _draft.class).name;
  const el = document.getElementById('shape-name');
  if (el) el.value = _draft.name;
}

/** The first rule this step (or, with `all`, any step) leaves unmet. */
function shapeProblem(all = false) {
  // A prepared caster's spell count follows WIS: trim picks the new scores no longer allow.
  const sp = spellStep(_draft, SRD);
  if ((_draft.spells || []).length > sp.spells) _draft.spells = _draft.spells.slice(0, sp.spells);
  const want = RULE_STEP[shapeKind()];
  return validateDraft(_draft, SRD).find(p => all || p.step === want) || null;
}
export function shapeNext() {
  const p = shapeProblem();
  if (p) { _shapeError = p.message; render(); return; }
  _shapeError = '';
  if (_s.shape === _s.nShape - 1) _sound.chime(); else _sound.whoosh();
  step({ type: 'choose' });
}
export function shapeBack() { _shapeError = ''; step({ type: 'back' }, -1); }
export function shapeFinish() {
  const p = shapeProblem(true);
  if (p) { _shapeError = p.message; render(); return; }
  _shapeError = ''; _sound.chime();
  step({ type: 'finish' });
}
export function forgeShowQuick() { _showQuick = true; render(); document.querySelector('.forge-quick button')?.focus(); }
