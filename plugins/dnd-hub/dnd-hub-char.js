// dnd-hub-char.js — character creator wizard shell, SRD loader, finish callback
import { CC, CC_STEPS, SRD, setServerData, HUB_DM_KEY } from './dnd-hub-state.js?v=20260502p4';
import { storageGetUser, storageSetUser, storageSet, storageGet, realtimePublish, getIdentity, genId } from '../plugin-sdk.js';
import { EV } from './dnd-hub-event-types.js?v=20260502p4';
import { renderCCRace, renderCCClass, renderCCAbilityScores, renderCCBackground, renderCCEquipment, renderCCSpells, renderCCDescription, renderCCReview, getStartingGold } from './dnd-hub-char-steps.js?v=20260502p4';

// Callback injected by bootstrap to avoid screens.js ↔ char.js circular import.
// Set via onFinishRegister(enterCampaignAsPlayer) before any user interaction.
let _onFinish = null;
export function onFinishRegister(cb) { _onFinish = cb; }

// ── SRD loader ────────────────────────────────────────────────────────────────
const SRD_FILES = ['races', 'classes', 'backgrounds', 'equipment', 'magic-items', 'feats', 'spells'];

export async function loadSRD() {
  const base = new URL('.', document.baseURI).href;
  await Promise.all(SRD_FILES.map(async f => {
    try {
      const r = await fetch(`${base}dnd-srd/${f}.json`);
      SRD[f] = await r.json();
    } catch { SRD[f] = []; }
  }));
}

// ── Wizard shell ──────────────────────────────────────────────────────────────
export function startCharacterCreator(campaignId) {
  renderCharacterCreator(campaignId);
  // showScreen is on window (set by bootstrap from dnd-hub-state.js)
  window.showScreen('char-creator');
}

export function renderCharacterCreator(campaignId) {
  CC.campaignId = campaignId;
  CC.step = 0;

  storageGetUser(`char-draft-${campaignId}`).then(draft => {
    if (draft) CC.draft = { ...CC.draft, ...draft };
    renderCCStep();
  });

  const el = document.getElementById('screen-char-creator');
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%">
      <div style="padding:16px 20px 0;flex-shrink:0">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
          <button class="screen-back" onclick="showScreen('campaign')">←</button>
          <div style="font-size:16px;font-weight:800">⚔️ Create Your Character</div>
        </div>
        <div style="display:flex;gap:4px;margin-bottom:16px" id="cc-steps">
          ${CC_STEPS.map((_, i) => `<div style="flex:1;height:3px;border-radius:2px;background:${i===0?'var(--dnd-gold)':'rgba(255,255,255,.12)'}" id="cc-step-bar-${i}"></div>`).join('')}
        </div>
        <div id="cc-step-label" style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--dnd-gold);margin-bottom:4px">Step 1 of ${CC_STEPS.length} — ${CC_STEPS[0]}</div>
      </div>
      <div id="cc-content" style="flex:1;overflow-y:auto;padding:0 20px 16px"></div>
      <div style="padding:12px 20px;border-top:1px solid var(--dnd-border);display:flex;gap:10px;flex-shrink:0">
        <button class="btn btn-ghost" id="cc-back-btn" style="min-width:80px" onclick="ccBack()" disabled>Back</button>
        <button class="btn btn-gold" id="cc-next-btn" style="flex:1" onclick="ccNext()">Next →</button>
      </div>
    </div>
  `;
}

export function updateCCProgress() {
  CC_STEPS.forEach((_, i) => {
    const bar = document.getElementById(`cc-step-bar-${i}`);
    if (bar) bar.style.background = i <= CC.step ? 'var(--dnd-gold)' : 'rgba(255,255,255,.12)';
  });
  const label = document.getElementById('cc-step-label');
  if (label) label.textContent = `Step ${CC.step + 1} of ${CC_STEPS.length} — ${CC_STEPS[CC.step]}`;
  const backBtn = document.getElementById('cc-back-btn');
  if (backBtn) backBtn.disabled = CC.step === 0;
  const nextBtn = document.getElementById('cc-next-btn');
  if (nextBtn) nextBtn.textContent = CC.step === CC_STEPS.length - 1 ? 'Finish & Create Character ✨' : 'Next →';
}

export function renderCCStep() {
  updateCCProgress();
  const el = document.getElementById('cc-content');
  if (!el) return;
  switch (CC.step) {
    case 0: renderCCRace(el); break;
    case 1: renderCCClass(el); break;
    case 2: renderCCAbilityScores(el); break;
    case 3: renderCCBackground(el); break;
    case 4: renderCCEquipment(el); break;
    case 5: renderCCSpells(el); break;
    case 6: renderCCDescription(el); break;
    case 7: renderCCReview(el); break;
  }
}

export function ccBack() {
  if (CC.step === 0) return;
  CC.step--;
  renderCCStep();
}

export async function ccNext() {
  if (!ccValidateStep()) return;
  await storageSetUser(`char-draft-${CC.campaignId}`, CC.draft);
  if (CC.step === CC_STEPS.length - 1) {
    await finishCharacterCreation();
    return;
  }
  CC.step++;
  renderCCStep();
}

export function ccValidateStep() {
  switch (CC.step) {
    case 0: if (!CC.draft.race) { alert('Please select a race.'); return false; } break;
    case 1: if (!CC.draft.class) { alert('Please select a class.'); return false; } break;
    case 6: if (!CC.draft.name.trim()) { alert('Please enter a character name.'); return false; } break;
  }
  return true;
}

export async function finishCharacterCreation() {
  const identity = await getIdentity();
  if (!identity?.id) { alert('Could not verify identity.'); return; }

  const race = (SRD.races || []).find(r => r.id === CC.draft.race);
  const cls = (SRD.classes || []).find(c => c.id === CC.draft.class);

  const finalScores = { ...CC.draft.baseScores };
  if (race) {
    race.ability_bonuses.forEach(b => {
      const key = b.ability?.toLowerCase().slice(0, 3);
      if (key && finalScores[key] !== undefined) finalScores[key] += b.bonus;
    });
  }

  const hitDie = cls?.hit_die || 8;
  const conMod = Math.floor((( finalScores.con || 10) - 10) / 2);
  const maxHP = hitDie + conMod;

  const character = {
    id: genId(),
    campaignId: CC.campaignId,
    userId: identity.id,
    name: CC.draft.name.trim(),
    race: CC.draft.race,
    subrace: CC.draft.subrace,
    class: CC.draft.class,
    subclass: CC.draft.subclass,
    level: CC.draft.level || 1,
    background: CC.draft.background,
    alignment: CC.draft.alignment,
    deity: CC.draft.deity,
    ...finalScores,
    hp: maxHP, hpMax: maxHP, hpTemp: 0,
    ac: 10 + Math.floor(((finalScores.dex || 10) - 10) / 2),
    initiative: Math.floor(((finalScores.dex || 10) - 10) / 2),
    speed: race?.speed || 30,
    proficiencyBonus: Math.ceil(1 + (CC.draft.level || 1) / 4),
    spellcastingAbility: cls?.spellcasting_ability?.toLowerCase().slice(0, 3) || null,
    spellSlots: [[0,0],[2,2],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0]],
    spells: [...(CC.draft.spells || []), ...(CC.draft.cantrips || [])],
    savingThrows: cls?.saving_throws?.map(s => s.toLowerCase().slice(0, 3)) || [],
    skills: {},
    deathSaves: { successes: 0, failures: 0 },
    conditions: [],
    exhaustion: 0,
    inspiration: false,
    equipment: CC.draft.equipment.map(id => ({ id, qty: 1, equipped: false, attuned: false })),
    gold: CC.draft.useStartingGold ? getStartingGold() : 0,
    silver: 0, copper: 0, platinum: 0, electrum: 0,
    features: [
      ...(race?.traits?.map(t => t.name) || []),
      ...(cls?.proficiencies?.slice(0, 3) || []),
    ],
    personalityTraits: CC.draft.personalityTraits,
    ideals: CC.draft.ideals,
    bonds: CC.draft.bonds,
    flaws: CC.draft.flaws,
    backstory: CC.draft.backstory,
    portraitUrl:    CC.draft.portraitUrl    || '',
    portraitFileId: CC.draft.portraitFileId || '',
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const userData = await storageGetUser('characters') || {};
  userData[CC.campaignId] = character;
  await storageSetUser('characters', userData);
  await storageSetUser(`char-draft-${CC.campaignId}`, null);

  // Update campaign character summary in server storage
  const serverData = await storageGet(HUB_DM_KEY);
  if (serverData?.campaigns?.[CC.campaignId]) {
    if (!serverData.campaigns[CC.campaignId].characterSummaries) {
      serverData.campaigns[CC.campaignId].characterSummaries = {};
    }
    serverData.campaigns[CC.campaignId].characterSummaries[identity.id] = {
      name: character.name, race: character.race, class: character.class,
      level: character.level, hp: character.hp, hpMax: character.hpMax,
      portraitUrl: CC.draft.portraitUrl || '',
      portraitFileId: CC.draft.portraitFileId || '',
    };
    serverData.campaigns[CC.campaignId].updatedAt = new Date().toISOString();
    await storageSet(HUB_DM_KEY, serverData);
    setServerData(serverData); // sync module-level state so renderTokens sees the new summary
  }

  await realtimePublish(EV.CHARACTER_CREATED, {
    type: EV.CHARACTER_CREATED, campaignId: CC.campaignId,
    userId: identity.id, name: character.name, class: character.class, race: character.race,
  });

  alert(`${character.name} is ready for adventure! 🎲`);
  if (_onFinish) await _onFinish(CC.campaignId);
}
