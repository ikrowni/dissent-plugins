// dnd-hub-char.js — character creator wizard shell, SRD loader, finish callback
import { CC, CC_STEPS, SRD, setServerData } from './dnd-hub-state.js?v=20260502p4';
import { storageGetUser, storageSetUser, storageSet, storageGet, realtimePublish, getIdentity, genId } from '../plugin-sdk.js';
import { EV } from './dnd-hub-event-types.js?v=20260502p4';
import { renderCCRace, renderCCClass, renderCCAbilityScores, renderCCBackground, renderCCEquipment, renderCCSpells, renderCCDescription, renderCCReview, getStartingGold } from './dnd-hub-char-steps.js?v=20261003a';
import { saveHubDm, loadHubDm } from './dnd-hub-storage.js?v=20260502p4';
import { hitDieFor, profBonus, abilityMod, withSlotsForLevel, armorClass, skillProficiencies,
  characterSummary, isWeaponId } from './lk-rules5e.js';
import { draftScores } from './dnd-hub-char-steps.js?v=20261003a';
import { validateDraft } from './dnd-hub-draft-rules.js';

// Level-1 class features (SRD 5.1). The "features" list used to hold the first three class
// proficiencies ("All armor", "Shields", …) instead (audit A9).
const L1_FEATURES = {
  barbarian: ['Rage', 'Unarmored Defense'], bard: ['Spellcasting', 'Bardic Inspiration'],
  cleric: ['Spellcasting', 'Divine Domain'], druid: ['Druidic', 'Spellcasting'],
  fighter: ['Fighting Style', 'Second Wind'], monk: ['Unarmored Defense', 'Martial Arts'],
  paladin: ['Divine Sense', 'Lay on Hands'], ranger: ['Favored Enemy', 'Natural Explorer'],
  rogue: ['Expertise', 'Sneak Attack', "Thieves' Cant"], sorcerer: ['Spellcasting', 'Sorcerous Origin'],
  warlock: ['Otherworldly Patron', 'Pact Magic'], wizard: ['Spellcasting', 'Arcane Recovery'],
};
// XP to reach each level: a campaign that starts above level 1 hands the new hero this much XP, and the
// level-up wizard (one tested path) walks them through every level's choices (audit A4).
const XP_FOR_LEVEL = [0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000,
  140000, 165000, 195000, 225000, 265000, 305000, 355000];

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
  // The same rules Quick character is tested against (dnd-hub-draft-rules.js).
  const problem = validateDraft(CC.draft, SRD).find(p => p.step === CC.step);
  if (problem) { alert(problem.message); return false; }
  return true;
}

export async function finishCharacterCreation() {
  const identity = await getIdentity();
  if (!identity?.id) { alert('Could not verify identity.'); return; }

  const race = (SRD.races || []).find(r => r.id === CC.draft.race);
  const cls = (SRD.classes || []).find(c => c.id === CC.draft.class);

  const finalScores = draftScores();

  const hitDie = cls?.hit_die || hitDieFor(CC.draft.class);
  // Hill dwarves: +1 HP per level (Dwarven Toughness).
  const maxHP = Math.max(1, hitDie + abilityMod(finalScores.con)) + (CC.draft.subrace === 'hill-dwarf' ? 1 : 0);
  const campaign = (await loadHubDm())?.campaigns?.[CC.campaignId];
  const startLevel = Math.min(20, Math.max(1, campaign?.startingLevel || 1));
  const background = (SRD.backgrounds || []).find(b => b.id === CC.draft.background);
  // Starting kit: armour and shield worn, weapons in hand; named, so the inventory can show them.
  const equipment = (CC.draft.equipment || []).map(id => {
    const it = (SRD.equipment || []).find(e => e.id === id);
    const kind = it?.category === 'Armor' ? 'armor' : it?.category === 'Weapon' || isWeaponId(id) ? 'weapon' : 'gear';
    return { id, name: it?.name || id, type: kind, description: it?.desc || '', qty: 1, attuned: false,
      equipped: kind !== 'gear' };
  });
  let armorWorn = false;
  equipment.forEach(e => { if (e.type === 'armor' && e.id !== 'shield') { e.equipped = !armorWorn; armorWorn = true; } });

  const character = {
    id: genId(),
    campaignId: CC.campaignId,
    userId: identity.id,
    name: CC.draft.name.trim(),
    race: CC.draft.race,
    subrace: CC.draft.subrace,
    class: CC.draft.class,
    subclass: CC.draft.subclass,
    level: 1,
    xp: XP_FOR_LEVEL[startLevel],
    background: CC.draft.background,
    alignment: CC.draft.alignment,
    deity: CC.draft.deity,
    ...finalScores,
    hp: maxHP, hpMax: maxHP, hpTemp: 0, hitDiceRemaining: 1,
    ac: armorClass({ class: CC.draft.class, ...finalScores }, equipment.filter(e => e.equipped)),
    initiative: abilityMod(finalScores.dex),
    speed: race?.speed || 30,
    proficiencyBonus: profBonus(1),
    spellcastingAbility: cls?.spellcasting_ability?.toLowerCase().slice(0, 3) || null,
    // One shape everywhere: index = slot level, [current, max]; only casters get slots (audit A2, A3).
    spellSlots: withSlotsForLevel(null, CC.draft.class, 1),
    spells: [...(CC.draft.spells || []), ...(CC.draft.cantrips || [])],
    savingThrows: cls?.saving_throws?.map(s => s.toLowerCase().slice(0, 3)) || [],
    skills: skillProficiencies({ race: CC.draft.race, classSkills: CC.draft.proficiencyChoices || [],
      extraSkills: CC.draft.extraSkills || [] }, background),
    deathSaves: { successes: 0, failures: 0 },
    conditions: [],
    exhaustion: 0,
    inspiration: false,
    equipment,
    gold: CC.draft.useStartingGold ? getStartingGold() : 0,
    silver: 0, copper: 0, platinum: 0, electrum: 0,
    features: [
      ...(race?.traits?.map(t => t.name) || []),
      ...(L1_FEATURES[CC.draft.class] || []),
      ...(background?.feature?.name ? [background.feature.name] : []),
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
  // The server mirror the DM reads — so the DM sees the sheet at once, not after the player's first save (audit E3).
  await storageSet(`player_sheet_${CC.campaignId}_${identity.id}`, character, 'server');
  await storageSetUser(`char-draft-${CC.campaignId}`, null);

  // Update campaign character summary in server storage
  const serverData = await loadHubDm();
  if (serverData?.campaigns?.[CC.campaignId]) {
    if (!serverData.campaigns[CC.campaignId].characterSummaries) {
      serverData.campaigns[CC.campaignId].characterSummaries = {};
    }
    // AC, DEX, passive Perception and live HP: what initiative, auto hit/miss and the party view need (audit F2).
    serverData.campaigns[CC.campaignId].characterSummaries[identity.id] = characterSummary(character);
    serverData.campaigns[CC.campaignId].updatedAt = new Date().toISOString();
    await saveHubDm( serverData);
    setServerData(serverData); // sync module-level state so renderTokens sees the new summary
  }

  await realtimePublish(EV.CHARACTER_CREATED, {
    type: EV.CHARACTER_CREATED, campaignId: CC.campaignId,
    userId: identity.id, name: character.name, class: character.class, race: character.race,
  });

  alert(`${character.name} is ready for adventure! 🎲`);
  if (_onFinish) await _onFinish(CC.campaignId);
}

/** Save a complete draft (Quick character) through the one creator save path. */
export async function finishWithDraft(campaignId, draft) {
  CC.campaignId = campaignId;
  CC.draft = { ...CC.draft, ...draft };
  await finishCharacterCreation();
}
