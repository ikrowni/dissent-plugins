// dnd-hub-quick-screen.js — the Quick character page, drawn inside #screen-char-creator (spec 2026-10-03 §2).
import { SRD } from './dnd-hub-state.js?v=20260502p4';
import { esc, storageSetUser } from '../plugin-sdk.js';
import { icon } from './lk-icons.js';
import { quickBuild, previewStats, READY_HEROES, RACE_BLURBS, CLASS_BLURBS } from './dnd-hub-quick.js';
import { startCharacterCreator, finishWithDraft } from './dnd-hub-char.js?v=20261003a';

let _campaignId = null, _race = null, _class = null, _draft = null;

const el = () => document.getElementById('screen-char-creator');
const card = (on, html, click) =>
  `<div onclick="${click}" style="padding:10px 12px;border-radius:8px;cursor:pointer;background:${on ? 'rgba(212,175,55,.08)' : 'var(--dnd-surface)'};border:1px solid ${on ? 'var(--dnd-gold)' : 'var(--dnd-border)'}">${html}</div>`;

export function showQuickCharacter(campaignId) {
  _campaignId = campaignId; _race = null; _class = null; _draft = null;
  window.showScreen('char-creator');
  renderQuick();
}

function renderQuick() {
  const races = SRD.races || [], classes = SRD.classes || [];
  el().innerHTML = `
    <div style="padding:16px 20px;display:flex;flex-direction:column;gap:16px;height:100%;overflow-y:auto">
      <div style="display:flex;align-items:center;gap:10px">
        <button class="screen-back" onclick="showScreen('campaign')" aria-label="Back">${icon('arrow-left')}</button>
        <div style="font-size:16px;font-weight:800">Make your hero</div>
        <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="quickStepByStep()">Step by step instead</button>
      </div>
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--dnd-gold);margin-bottom:8px">READY-MADE HEROES</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px">
          ${READY_HEROES.map(h => card(false,
            `<div style="font-size:13px;font-weight:700">${esc(h.label)}</div><div style="font-size:11px;color:var(--dnd-muted);margin-top:2px">${esc(h.blurb)}</div>`,
            `quickPickHero('${h.id}')`)).join('')}
        </div>
      </div>
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--dnd-gold);margin-bottom:8px">OR BUILD YOUR OWN — RACE</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px">
          ${races.map(r => card(_race === r.id, `<div style="font-size:12px;font-weight:700">${esc(r.name)}</div><div style="font-size:10px;color:var(--dnd-muted)">${esc(RACE_BLURBS[r.id] || '')}</div>`, `quickPickRace('${r.id}')`)).join('')}
        </div>
        <div style="font-size:12px;font-weight:700;color:var(--dnd-gold);margin:12px 0 8px">CLASS</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px">
          ${classes.map(c => card(_class === c.id, `<div style="font-size:12px;font-weight:700">${esc(c.name)}</div><div style="font-size:10px;color:var(--dnd-muted)">${esc(CLASS_BLURBS[c.id] || '')}</div>`, `quickPickClass('${c.id}')`)).join('')}
        </div>
        <button class="btn btn-gold" style="margin-top:12px;width:100%" ${_race && _class ? '' : 'disabled'} onclick="quickBuildOwn()">Build</button>
      </div>
    </div>`;
}

function renderResult() {
  const p = previewStats(SRD, _draft);
  const race = (SRD.races || []).find(r => r.id === _draft.race)?.name || _draft.race;
  const cls = (SRD.classes || []).find(c => c.id === _draft.class)?.name || _draft.class;
  el().innerHTML = `
    <div style="padding:24px 20px;display:flex;flex-direction:column;gap:14px;max-width:480px;margin:0 auto">
      <div style="font-size:12px;font-weight:700;color:var(--dnd-gold)">HERE'S YOUR HERO</div>
      <input id="quick-name" value="${esc(_draft.name)}" maxlength="60" aria-label="Name"
        style="font-size:20px;font-weight:800;background:var(--dnd-surface);border:1px solid var(--dnd-border);border-radius:8px;padding:8px 10px;color:var(--dnd-text)">
      <div style="font-size:13px;color:var(--dnd-muted)">${esc(race)} ${esc(cls)} · level 1</div>
      <div style="display:flex;gap:10px">
        <div class="lk-stat"><b>${p.hp}</b><span>HP</span></div>
        <div class="lk-stat"><b>${p.ac}</b><span>AC</span></div>
        ${p.attack ? `<div class="lk-stat" style="flex:2"><b>${esc(p.attack.name)} ${p.attack.toHit >= 0 ? '+' : ''}${p.attack.toHit}</b><span>${esc(p.attack.damage)} ${esc(p.attack.damageType)}</span></div>` : ''}
      </div>
      <div style="font-size:11px;color:var(--dnd-muted)">Skills: ${esc([..._draft.proficiencyChoices, ..._draft.extraSkills, 'Insight', 'Religion'].join(', '))}</div>
      <button id="quick-play" class="btn btn-gold" style="padding:12px" onclick="quickPlay()">Play</button>
      <button class="btn btn-ghost" onclick="quickChange()">Change something</button>
      <button class="btn btn-ghost btn-sm" onclick="quickBack()">Back to the heroes</button>
    </div>`;
}

export function quickPickHero(id) {
  const h = READY_HEROES.find(x => x.id === id);
  if (!h) return;
  _draft = quickBuild(SRD, h.race, h.class, Math.random, h.name);
  renderResult();
}
export function quickPickRace(id) { _race = id; renderQuick(); }
export function quickPickClass(id) { _class = id; renderQuick(); }
export function quickBuildOwn() { if (_race && _class) { _draft = quickBuild(SRD, _race, _class); renderResult(); } }
export function quickBack() { renderQuick(); }
export function quickStepByStep() { startCharacterCreator(_campaignId); }

function takeName() { const n = document.getElementById('quick-name')?.value?.trim(); if (n) _draft.name = n; }

export async function quickPlay() {
  takeName();
  const btn = document.getElementById('quick-play');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  await finishWithDraft(_campaignId, _draft);
}

/** Open the full creator with this hero already filled in. */
export async function quickChange() {
  takeName();
  await storageSetUser(`char-draft-${_campaignId}`, _draft);
  startCharacterCreator(_campaignId);
}
