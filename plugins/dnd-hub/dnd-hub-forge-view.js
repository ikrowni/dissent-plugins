// dnd-hub-forge-view.js — the Hero Forge's markup. Strings only: no state, no DOM access (dnd-hub-forge.js owns those).
import { esc } from '../plugin-sdk.js';
import { icon } from './lk-icons.js';
import { emblem } from './dnd-hub-emblems.js';

const art = (v, size) => v.art
  ? `<img src="${esc(v.art)}" alt=""><div class="seal" style="color:${v.colour || 'var(--lk-gold)'}">${emblem(v.emblem, 44)}</div>`
  : `<div style="color:${v.colour || 'var(--lk-gold)'}">${emblem(v.emblem, size)}</div>`;

export function topBar(title, { muted, canBack }) {
  return `<div class="forge-top">
    ${canBack ? `<button class="screen-back" onclick="forgeBack()" aria-label="Back">${icon('arrow-left')}</button>`
      : `<button class="screen-back" onclick="showScreen('campaign')" aria-label="Back">${icon('arrow-left')}</button>`}
    <div class="forge-title">${esc(title)}</div>
    <button class="btn btn-ghost btn-sm forge-mute" onclick="forgeToggleMute()" aria-pressed="${muted}" aria-label="${muted ? 'Sound off' : 'Sound on'}">${icon(muted ? 'volume-x' : 'volume-2')}</button>
    <button class="btn btn-ghost btn-sm" onclick="quickStepByStep()">Step by step instead</button>
  </div>`;
}

export function quickStrip(heroes) {
  return `<div><div class="forge-title" style="font-size:11px;margin-bottom:6px">Quick pick — ready-made heroes</div>
    <div class="forge-quick">${heroes.map(h => `<button onclick="quickPickHero('${esc(h.id)}')"><b>${esc(h.label)}</b><span>${esc(h.blurb)}</span></button>`).join('')}</div></div>`;
}

/** Scene 1 or 2: the spotlight on one race (v from raceView) or class (from classView). */
export function stage(v, { kind, dir }) {
  const badges = kind === 'race' ? v.badges
    : [v.role, `${v.difficulty} to play`, `Main ability ${v.main}`, v.sturdy];
  return `<div class="forge-stage forge-slide ${dir < 0 ? 'back' : ''}" id="forge-stage">
    <div class="forge-art" id="forge-art">${art(v, 200)}</div>
    <div>
      <h2 class="forge-name">${esc(v.name)}</h2>
      <div class="forge-blurb">${esc(v.blurb)}</div>
      <div class="forge-lore">${esc(kind === 'race' ? v.lore : v.plays)}</div>
      <div class="forge-badges">${badges.map(b => `<span>${esc(b)}</span>`).join('')}</div>
      <button class="btn btn-gold forge-choose" id="forge-choose" onclick="forgeChoose()">Choose ${esc(v.name)}</button>
    </div>
  </div>`;
}

export function emblemRow(views, selected, label) {
  return `<div class="forge-row" role="group" aria-label="${esc(label)}">${views.map((v, i) =>
    `<button onclick="forgeSelect(${i})" aria-pressed="${i === selected}" aria-label="${esc(v.name)}" title="${esc(v.name)}">${emblem(v.emblem, 34)}</button>`).join('')}</div>`;
}

/** Scene 3: the hero card. `p` from previewStats; numbers start at 0 and count up (data-to). */
export function reveal(draft, race, cls, p) {
  const stat = (to, label) => `<div class="lk-stat"><b data-to="${to}">0</b><span>${esc(label)}</span></div>`;
  return `<div class="forge-card" id="forge-card">
    <svg class="frame" aria-hidden="true"><rect rx="12"/></svg>
    <div class="emblems"><span style="color:${race.colour}">${emblem(race.emblem, 72)}</span>${emblem(cls.emblem, 72)}</div>
    <div class="forge-title" style="text-align:center;margin-top:10px">Here's your hero</div>
    <input id="quick-name" value="${esc(draft.name)}" maxlength="60" aria-label="Name"
      style="display:block;width:100%;margin-top:10px;text-align:center;font-family:var(--lk-title);font-size:24px;background:transparent;border:0;border-bottom:1px solid var(--lk-line);color:#f3e3b5;padding:6px">
    <div style="text-align:center;color:var(--lk-muted);font-size:13px;margin-top:6px">${esc(race.name)} ${esc(cls.name)} · level 1 · ${esc(cls.role)}</div>
    <div class="forge-stats">${stat(p.hp, 'HP')}${stat(p.ac, 'AC')}
      ${p.attack ? `<div class="lk-stat" style="flex:2"><b>${esc(p.attack.name)} ${p.attack.toHit >= 0 ? '+' : ''}${p.attack.toHit}</b><span>${esc(p.attack.damage)} ${esc(p.attack.damageType)}</span></div>` : ''}</div>
    <button id="quick-play" class="btn btn-gold" style="width:100%;padding:12px" onclick="quickPlay()">Play</button>
    <button class="btn btn-ghost" style="width:100%;margin-top:6px" onclick="quickChange()">Change something</button>
  </div>`;
}
