// dnd-hub-levelup.js — the level-up scene (spec 2026-10-03 growing your hero §1), in the map area, built from the
// Hero Forge's pieces. Nothing is saved until the last step; several waiting levels run one after another.
import { SRD, serverData, userId } from './dnd-hub-state.js?v=20261014m';
import { loadHubDm } from './dnd-hub-storage.js?v=20261014m';
import { storageGetUser } from '../plugin-sdk.js';
import { rule } from './lk-table-rules.js';
import { levelPlan, checkChoice, choiceKey, applyLevel, allowedLevel } from './lk-levelling.js';
import { raceView, classView } from './lk-hero-data.js';
import { useCampaignSpells } from './book/book-spells-in-play.js';
import { createForgeFx, FORGE_SHELL, setAura } from './dnd-hub-forge-fx.js';
import { createForgeSound } from './dnd-hub-forge-sound.js';
import { reveal, countUp } from './dnd-hub-forge-view.js';
import { previewStatsOfHero } from './dnd-hub-quick.js';
import { saveHero } from './dnd-hub-char.js?v=20261014m';
import { header, body, footer } from './dnd-hub-levelup-view.js';

let S = null; // { campaignId, hero, plan, i, choices, error, onDone, fx, back }
const sound = createForgeSound();
const root = () => document.getElementById('screen-char-creator');

export function levelCtx(campaignId) {
  const camp = serverData?.campaigns?.[campaignId];
  return { srd: { classes: SRD.classes || [], feats: SRD.feats || [], spells: SRD.spells || [] },
    library: camp?.library || {}, featsAllowed: rule(camp?.settings, 'featsAllowed') };
}

/** Open the scene for my hero in `campaignId`, if a level is waiting. `onDone` runs when no level is left. */
export async function openLevelUp(campaignId, onDone = null) {
  // A fresh read: the DM may have added subclasses or feats, or granted levels, since this screen loaded.
  // Only the fields the level-up reads are copied in: replacing the campaign object would detach the open map.
  const fresh = (await loadHubDm().catch(() => null))?.campaigns?.[campaignId];
  const camp = serverData?.campaigns?.[campaignId];
  if (fresh && camp) for (const k of ['library', 'levels', 'xp', 'settings', 'startingLevel']) if (k in fresh) camp[k] = fresh[k];
  const hero = (await storageGetUser('characters') || {})[campaignId];
  if (!hero || !camp) return false;
  await useCampaignSpells(camp).catch(() => {}); // the campaign's books add spells to the choices
  if ((hero.level || 1) >= allowedLevel(camp, userId, hero, rule(camp.settings, 'levelByXp'))) { onDone?.(); return false; }
  const plan = levelPlan(hero, levelCtx(campaignId));
  if (!plan) { onDone?.(); return false; }
  S = { campaignId, hero, plan, i: 0, choices: {}, error: '', onDone, back: document.querySelector('[id^="screen-"]:not(.hidden)')?.id?.slice(7) || 'campaign' };
  window.showScreen('char-creator');
  root().innerHTML = FORGE_SHELL;
  S.fx = createForgeFx(document.getElementById('forge-fx'));
  { const [rv, cv] = views(); setAura([rv.aura[0], cv.aura[0]], S.fx); }
  S.fx.start();
  sound.chime();
  render();
  return true;
}

function views() {
  const r = (SRD.races || []).find(x => x.id === S.hero.race) || { id: S.hero.race, name: S.hero.race, speed: 30 };
  const c = (SRD.classes || []).find(x => x.id === S.hero.class) || { id: S.hero.class, name: S.hero.class, hit_die: 8 };
  return [raceView(r), classView(c)];
}

function render() {
  const ui = document.getElementById('forge-ui');
  if (!ui || !S) return;
  const [rv, cv] = views();
  const step = S.plan.steps[S.i];
  ui.innerHTML = header(S.hero, rv, cv, S.plan.level, S.i, S.plan.steps.length, step.kind)
    + `<div class="forge-slide">${body(step, S.choices[choiceKey(step.kind)], S.hero)}</div>`
    + footer(S.error, S.i === S.plan.steps.length - 1);
}

function current() { return S.plan.steps[S.i]; }
function set(v) { S.choices[choiceKey(current().kind)] = v; S.error = ''; render(); }

export function levelupPick(group, id, multi) {
  const step = current();
  if (group === 'hp') return set({ mode: 'average' });
  if (group === 'feat') return set({ kind: 'feat', id });
  if (group === 'cantrip' || group === 'spell') {
    const c = { cantrips: [], spells: [], ...(S.choices.spells || {}) };
    const key = group === 'cantrip' ? 'cantrips' : 'spells', max = group === 'cantrip' ? step.cantrips : step.spells;
    const list = c[key].includes(id) ? c[key].filter(x => x !== id) : [...c[key], id].slice(-max);
    return set({ ...c, [key]: list });
  }
  if (!multi) return set(id);
  const cur = S.choices[choiceKey(step.kind)] || [];
  set(cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id].slice(-step.count));
}
export function levelupRoll(v) { S.choices.hp = { mode: 'roll', roll: parseInt(v, 10) }; S.error = ''; }
export function levelupRollDie(die) { set({ mode: 'roll', roll: 1 + Math.floor(Math.random() * die) }); }
export function levelupAbility(k, d) {
  const prev = S.choices.asi?.kind === 'asi' ? { ...S.choices.asi.plus } : {};
  const total = Object.values(prev).reduce((a, b) => a + b, 0);
  const v = (prev[k] || 0) + d;
  if (v < 0 || v > 2 || (d > 0 && total >= 2) || (S.hero[k] ?? 10) + v > 20) return;
  if (v === 0) delete prev[k]; else prev[k] = v;
  set({ kind: 'asi', plus: prev });
}
export function levelupBack() {
  if (S.i === 0 && S.mode === 'picks') { const { onBack } = S; S = null; onBack(); return; }
  if (S.i === 0) { close(); return; }
  S.i--; S.error = ''; render();
}
export async function levelupNext() {
  const step = current();
  const key = choiceKey(step.kind);
  const why = key ? checkChoice(step, S.choices[key]) : null;
  if (why) { S.error = why; render(); return; }
  if (S.i < S.plan.steps.length - 1) { S.i++; sound.whoosh(); render(); return; }
  if (S.mode === 'picks') { const { onPicks, choices } = S; S = null; onPicks(choices); return; }
  const levelled = applyLevel(S.hero, S.plan, S.choices);
  document.getElementById('lvl-next')?.setAttribute('disabled', '');
  await saveHero(S.campaignId, levelled);
  showReveal(levelled);
}

function showReveal(h) {
  const [rv, cv] = views();
  const ui = document.getElementById('forge-ui');
  ui.innerHTML = `<div class="forge-top"><div class="forge-title">Level ${h.level}</div></div>`
    + reveal(h, rv, cv, previewStatsOfHero(h), h.level).replace('Here’s your hero', 'Stronger now').replace('Here\'s your hero', 'Stronger now')
      .replace(/<button id="quick-play"[^>]*>Play<\/button>/, '<button id="lvl-continue" class="btn btn-gold" style="width:100%;padding:12px" onclick="levelupContinue()">Continue</button>')
      .replace(/<button class="btn btn-ghost"[^>]*onclick="quickChange\(\)"[^>]*>Change something<\/button>/, '');
  countUp(ui);
  sound.swell();
}

export async function levelupContinue() {
  const { campaignId, onDone } = S;
  S.fx?.stop();
  S = null;
  // Another level waiting (several granted at once, or the starting level): play it too.
  if (!(await openLevelUp(campaignId, onDone))) { if (!onDone) window.showScreen('campaign'); }
}

function close() { const back = S?.back; S?.fx?.stop(); S = null; window.showScreen(back === 'char-creator' ? 'campaign' : back || 'campaign'); }

/**
 * The Forge's level-1 picks (subclass, fighting style, expertise) on the same screens, inside the Forge's own stage
 * (#forge-ui, its fx already running). `onPicks(choices)` on the last Next; `onBack()` on Back from the first step.
 */
export function openFirstPicks({ campaignId, hero, plan, onPicks, onBack }) {
  S = { mode: 'picks', campaignId, hero: { ...hero, level: 1 }, plan: { ...plan, level: 1 }, i: 0, choices: {}, error: '', onPicks, onBack };
  render();
}

/** A short gold moment over the map: "Level 4!" */
export function levelBurst(text) {
  const el = document.createElement('div');
  el.className = 'lvl-burst'; el.textContent = text;
  document.body.appendChild(el);
  sound.chime();
  setTimeout(() => el.remove(), 2300);
}
