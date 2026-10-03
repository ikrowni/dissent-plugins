// dnd-master-main.js — bootstrap: init, tab switching, event dispatch
import { handleSDKMessage, getIdentity, storageGetCompanion, storageGet } from '../plugin-sdk.js';
import { EV } from './dnd-hub-event-types.js?v=20260502p4';
import { loadSRDMonsters, getSRDMonsters, renderMonsterSearch, setMonstersState,
  expandMonster, addInstance, adjHP, setInstanceHP, deleteInstance, quickRoll, quickRollExpr } from './dnd-master-monsters.js';
import { renderEncounterBuilder, setEncounterState, loadEncounterDraft, filterMonsters, addMonsterToEncounter, loadPreparedEncounter,
  changeCount, removeCreature, clearEncounter, launchEncounter, setEncounterTargetDifficulty,
  toggleLootPanel, setLootItem } from './dnd-master-encounter.js?v=20261003d';
import { renderInitiativeTracker, setInitiativeState, setInitiativeSharedState,
  getInitiativeState, moveInitiative, rerollInitiative, endEncounter, updateHP,
  toggleInitRow, applyMassHP, spawnTokensOnMap, acceptInitiativeRoll, rollMissingInitiative } from './dnd-master-initiative.js';
import { renderSettings, setSettingsState, toggleSetting, setSpatialRange, exportCampaign, pickPreset } from './dnd-master-settings.js?v=20261003d';
import { renderMapsTab,   setMapsState,   activateMapFromList, uploadNewMap, deleteMap, renameMapInline } from './dnd-master-maps.js';
import { renderActorsTab, setActorsState, saveNewActor, deleteActor, addPendingAttack, removePendingAttack } from './dnd-master-actors.js';
import { renderItemsTab,  setItemsState,  saveNewItem, deleteItem,
  onItemImgSelected, handleLootInterest, resolveContest,
  addForgeEffect, removeForgeEffect, handleContestResult, dismissContestPanel } from './dnd-master-items.js?v=20261004a';
import { renderNotesTab,  setNotesState  } from './dnd-master-notes.js';
import { renderHomebrewTab, setHomebrewState, addHomebrewSubclass, addHomebrewFeat, deleteHomebrew } from './dnd-master-homebrew.js';
import { renderLogsTab,   setLogsState,   appendLogEntry, clearLog, exportLog } from './dnd-master-logs.js';
import { renderScenesTab,  setScenesState,  saveNewScene, deleteScene, loadScene, onSceneVideoSelected, onSceneAudioSelected } from './dnd-master-scenes.js?v=20261004a';
import { renderJournalsTab, setJournalsState, newJournal, editJournal, closeJournalEditor, saveJournal, deleteJournal, pushHandout, setJournalVisibility } from './dnd-master-journals.js';
import { renderSoundsTab,  setSoundsState,  uploadNewSound, testSound, stopLocalSound, broadcastSound, deleteSoundEntry, updateSoundVolume } from './dnd-master-sounds.js';
import { renderTriggersTab, setTriggersState } from './dnd-master-triggers.js';
import { renderShopsTab, setShopsState, saveNewShop, deleteShop, addItemToShop, removeShopItem, loadShop, onShopVolumeChange, onShopVideoSelected } from './dnd-master-shops.js?v=20260503';
import { setLaunchCallback } from './dnd-master-encounter.js?v=20261003d';
import { setEndCallback    } from './dnd-master-initiative.js';
import { renderPlayersTab, playersLoaded, setPlayersState, dmBackToList, dmOpenPlayer,
  dmEditHP, dmToggleCondition, dmEditAbility, dmToggleSpellSlot,
  dmEditExhaustion, dmEditNotes } from './dnd-master-players.js';
import { pickCampaign } from './dnd-campaign-pick.js';
import { SECTIONS, TAB_LABELS, sectionOf, ALL_TABS } from './dnd-master-sections.js';
import { icon } from './lk-icons.js';
import { loadHubDmCompanion } from './dnd-hub-shared-storage.js';
import { isRepeat } from './lk-bus.js';
import { setPartyState, applyPartyUpdate, renderPartyPanel } from './dnd-master-party.js';
import * as Levels from './dnd-master-levels.js';
import { setSessionState, renderSessionBar, openStartSession, startSessionNow, onSessionSceneChange, closeSessionWindow,
  openEndSession, saveEndSession } from './dnd-master-session.js';

let serverData = null, userId = null, dmCampaignId = null, dmCampaign = null;

// The panel's navigation: five sections (dnd-master-sections.js) and the tools inside the open one.
const _lastTabOf = {}; // section id → last tool opened in it
let _activeTab = 'encounter';

function renderNav() {
  const sec = sectionOf(_activeTab);
  document.getElementById('section-bar').innerHTML = SECTIONS.map(s => `
    <button class="dm-section${s.id === sec ? ' active' : ''}" onclick="switchSection('${s.id}')">
      ${icon(s.icon, { size: 16 })}<span>${s.label}</span></button>`).join('');
  const tabs = sec ? SECTIONS.find(s => s.id === sec).tabs : [];
  document.getElementById('subtab-bar').innerHTML = tabs.map(t => `
    <button class="dm-subtab${t === _activeTab ? ' active' : ''}" onclick="switchDMTab('${t}')">${TAB_LABELS[t]}</button>`).join('');
  document.getElementById('subtab-bar').classList.toggle('hidden', tabs.length < 2);
  document.getElementById('party-panel')?.classList.toggle('hidden', sec !== 'run');
  document.getElementById('session-bar')?.classList.toggle('hidden', sec !== 'run');
  document.getElementById('dm-settings-btn')?.classList.toggle('active', _activeTab === 'settings');
}

function switchSection(id) {
  const s = SECTIONS.find(x => x.id === id);
  if (s) switchDMTab(_lastTabOf[id] || s.tabs[0]);
}

function switchDMTab(name) {
  _activeTab = name;
  const sec = sectionOf(name);
  if (sec) _lastTabOf[sec] = name;
  ALL_TABS.forEach(t => document.getElementById('tab-' + t).classList.toggle('hidden', t !== name));
  renderNav();
  if (name === 'monsters')   renderMonsterSearch();
  if (name === 'initiative') renderInitiativeTracker();
  if (name === 'settings')   renderSettings();
  if (name === 'maps')       renderMapsTab();
  if (name === 'actors')     renderActorsTab();
  if (name === 'items')      renderItemsTab();
  if (name === 'shops')      renderShopsTab();
  if (name === 'scenes')     renderScenesTab();
  if (name === 'journals')   renderJournalsTab();
  if (name === 'sounds')     renderSoundsTab();
  if (name === 'triggers')   renderTriggersTab();
  if (name === 'notes')      renderNotesTab();
  if (name === 'homebrew')   renderHomebrewTab();
  if (name === 'logs')       renderLogsTab();
  if (name === 'players')    renderPlayersTab();
}

// Set by the Hub's CAMPAIGN_ACTIVE announcement; see onEvent.
let _announcedCampaignId = null;

async function onInit(data) {
  const id = await getIdentity();
  userId = id?.id ?? null;
  serverData = await loadHubDmCompanion() || { campaigns: {} };

  // Restore items/shops from the dm-catalog backup in case dnd-hub overwrote hub-dm
  // with an older serverData (race: dnd-hub writes hub-dm frequently from its own copy).
  const catalog = await storageGet('dm-catalog');
  if (catalog?.campaigns) {
    for (const [cid, catCamp] of Object.entries(catalog.campaigns)) {
      const camp = serverData.campaigns?.[cid];
      if (!camp) continue;
      if (catCamp.items) camp.items = { ...camp.items, ...catCamp.items };
      if (catCamp.shops) camp.shops = { ...camp.shops, ...catCamp.shops };
    }
  }

  // Only campaigns this user runs; among those, the one the Hub announced (CAMPAIGN_ACTIVE)
  // wins. It used to take the FIRST campaign the user DMs, whatever the Hub showed.
  const runs = Object.fromEntries(Object.entries(serverData.campaigns || {})
    .filter(([, c]) => c.dmUserId === userId));
  const myCampaign = pickCampaign(runs, _announcedCampaignId, userId);

  if (!myCampaign) {
    // Not 'hide': PluginRuntime treats a hide as permanent until remount, so someone who
    // later starts running a campaign would never get this panel back.
    const el = document.getElementById('loading');
    el.classList.remove('hidden');
    el.innerHTML = '<div class="lk-note"><b class="lk-title">For the DM</b><span>This panel is for the campaign\'s Dungeon Master. Your character is in the LanternKeep Player panel.</span></div>';
    document.getElementById('dm-app').classList.add('hidden');
    return;
  }
  document.getElementById('loading').classList.add('hidden');

  dmCampaignId = myCampaign.id;
  dmCampaign = myCampaign;

  document.getElementById('dm-app').classList.remove('hidden');
  document.getElementById('dm-campaign-name').textContent = myCampaign.name;
  document.getElementById('dm-settings-btn').innerHTML = icon('settings', { size: 16 });
  renderNav();

  await loadSRDMonsters();
  const srdMonsters = getSRDMonsters();
  const sharedState = { dmCampaign, dmCampaignId, serverData, userId };
  setInitiativeSharedState(sharedState);
  setInitiativeState(dmCampaign.initiative || null);
  setMonstersState({ userId });
  setSettingsState(sharedState);
  setMapsState(sharedState);
  setActorsState(sharedState);
  setItemsState(sharedState);
  setShopsState(sharedState);
  setNotesState(sharedState);
  setHomebrewState(sharedState);
  setLogsState(sharedState);
  setScenesState(sharedState);
  setJournalsState(sharedState);
  setSoundsState(sharedState);
  setTriggersState(sharedState);
  setEncounterState({ dmCampaign, dmCampaignId, serverData, srdMonsters, switchDMTab, userId });
  await loadEncounterDraft();
  setPlayersState({ dmCampaign, dmCampaignId });
  Levels.setLevelsState({ dmCampaign, dmCampaignId, serverData, userId, onChange: () => { renderPartyPanel(); renderSessionBar(); } });
  setPartyState({ dmCampaign, dmCampaignId });
  setSessionState({ dmCampaign, dmCampaignId, serverData, userId });
  setLaunchCallback(() => appendLogEntry({ type: 'combat-start', message: 'Encounter launched \u2014 Round 1' }));
  setEndCallback(()    => appendLogEntry({ type: 'combat-end',   message: 'Encounter ended' }));
  renderEncounterBuilder();
}

function onEvent(ev) {
  const p = ev.data;
  if (!p) return;

  // The Hub opened a campaign: follow it if this user runs it and it isn't shown yet.
  if (p.type === EV.CAMPAIGN_ACTIVE) {
    _announcedCampaignId = p.campaignId || null;
    // The DM opened a campaign: ask the host to show this panel (see dnd-player's twin).
    if (p.role === 'dm') parent.postMessage({ type: 'dissent:slot-action', action: 'focus' }, '*');
    if (p.role === 'dm' && p.campaignId !== dmCampaignId) onInit({});
    return;
  }
  if (p.type === 'initiative:update' && p.campaignId === dmCampaignId) {
    setInitiativeState(p.initiative);
    const el = document.getElementById('tab-initiative');
    if (el && !el.classList.contains('hidden')) renderInitiativeTracker();
  }
  if (p.type === EV.PARTY_UPDATE) { applyPartyUpdate(p); return; }
  if (p.type === EV.INITIATIVE_ROLL && p.campaignId === dmCampaignId) {
    if (isRepeat(p)) return;
    // The roller's own id: a player can roll only for themselves.
    if (p.fromUserId && p.fromUserId === p.userId) acceptInitiativeRoll(p.userId, p.roll).catch(e => console.error('[dnd-master] initiative roll', e));
    return;
  }
  if (p.type === 'combat:settings' && p.campaignId === dmCampaignId) {
    if (dmCampaign) dmCampaign.settings = p.settings;
    setSettingsState({ dmCampaign, dmCampaignId, serverData, userId });
    const el = document.getElementById('tab-settings');
    if (el && !el.classList.contains('hidden')) renderSettings();
  }
  if (p.type === 'dice:roll' && p.campaignId === dmCampaignId && p.result !== undefined) {
    appendLogEntry({ type: 'roll', message: (p.label || 'Roll') + ': ' + p.result + (p.breakdown ? ' (' + p.breakdown + ')' : '') });
  }
  if (p.type === EV.WEAPON_ATTACK && p.campaignId === dmCampaignId) {
    const toHitStr = `d20(${p.toHitRoll})${p.toHitMod >= 0 ? '+' : ''}${p.toHitMod}=${p.toHitTotal}`;
    let msg = `${p.weaponName} \u2014 hit ${p.toHitTotal} (${toHitStr})`;
    if (p.damageRoll !== undefined) {
      msg += ` / ${p.damageRoll} ${p.damageType || ''}`;
    }
    if (p.conditionTarget) {
      msg += ` \u00b7 may apply ${p.conditionTarget.condition}`;
      if (p.conditionTarget.saveDC) msg += ` (DC ${p.conditionTarget.saveDC} ${p.conditionTarget.saveAbility || ''} save)`;
    }
    appendLogEntry({ type: 'weapon-attack', message: msg });
    return;
  }
  if (p.type === 'hp:change' && p.campaignId === dmCampaignId) {
    let hpMsg = (p.name || 'Token') + ' HP \u2192 ' + p.hp + '/' + p.hpMax;
    if (p.source) hpMsg += ' (' + p.source + ')';
    appendLogEntry({ type: 'hp-change', message: hpMsg });
  }
  if (p.type === 'token:death-save' && p.campaignId === dmCampaignId) {
    // A player's sheet sends the tallies (and, for a roll, a message); it never sent `success`.
    const tally = p.successes !== undefined ? ' death saves: ' + p.successes + ' success, ' + (p.failures || 0) + ' failure' : ' death save';
    appendLogEntry({ type: 'death-save', message: p.message || ((p.name || 'Token') + tally) });
  }
  if (p.type === 'loot:interest' && p.campaignId === dmCampaignId) {
    handleLootInterest(p);
  }
  if (p.type === 'contest:result' && p.campaignId === dmCampaignId) {
    handleContestResult(p).catch(e => console.error('[dnd-master] contest result error:', e));
  }
}

window.switchDMTab         = switchDMTab;
window.switchSection       = switchSection;
window.filterMonsters               = filterMonsters;
window.addMonsterToEncounter        = addMonsterToEncounter;
window.loadPreparedEncounter        = loadPreparedEncounter;
window.changeCount                  = changeCount;
window.removeCreature               = removeCreature;
window.clearEncounter               = clearEncounter;
window.launchEncounter              = launchEncounter;
window.setEncounterTargetDifficulty = setEncounterTargetDifficulty;
window.toggleLootPanel     = toggleLootPanel;
window.setLootItem         = setLootItem;
window.moveInitiative      = moveInitiative;
window.rerollInitiative    = rerollInitiative;
window.endEncounter        = endEncounter;
window.rollMissingInitiative = rollMissingInitiative;
// Start session / End session (spec 2026-10-03 §6).
Object.assign(window, { openStartSession, startSessionNow, onSessionSceneChange, closeSessionWindow, openEndSession, saveEndSession });
// Party at a glance: a row opens the existing player editor (its sheets load first).
window.openPartyMember = async uid => {
  switchDMTab('players');      // starts loading the sheets
  await playersLoaded();       // one load, so a late list render cannot cover the editor
  dmOpenPlayer(uid);
};
// Read-only, for the playtest (like window.MAP on the Hub).
window.__dmInitiative = () => getInitiativeState();
window.updateHP            = updateHP;
window.toggleInitRow       = toggleInitRow;
window.applyMassHP         = applyMassHP;
window.spawnTokensOnMap    = spawnTokensOnMap;
window.expandMonster       = expandMonster;
window.addInstance         = addInstance;
window.adjHP               = adjHP;
window.setInstanceHP       = setInstanceHP;
window.deleteInstance      = deleteInstance;
window.quickRoll           = quickRoll;
window.quickRollExpr       = quickRollExpr;
window.renderMonsterSearch = renderMonsterSearch;
window.toggleSetting       = toggleSetting;
window.pickPreset          = pickPreset;
window.setSpatialRange     = setSpatialRange;
window.exportCampaign      = exportCampaign;
// Maps tab
window.activateMapFromList  = activateMapFromList;
window.uploadNewMap         = uploadNewMap;
window.deleteMap            = deleteMap;
window.renameMapInline      = renameMapInline;
// Actors tab
window.saveNewActor         = saveNewActor;
window.deleteActor          = deleteActor;
window.addPendingAttack     = addPendingAttack;
window.removePendingAttack  = removePendingAttack;
// Shops tab
window.saveNewShop          = saveNewShop;
window.deleteShop           = deleteShop;
window.addItemToShop        = addItemToShop;
window.removeShopItem       = removeShopItem;
window.loadShop             = loadShop;
window.onShopVolumeChange   = onShopVolumeChange;
window.onShopVideoSelected  = onShopVideoSelected;
// Items tab
window.saveNewItem          = saveNewItem;
window.deleteItem           = deleteItem;
window.onItemImgSelected    = onItemImgSelected;
window.resolveContest       = resolveContest;
window.addForgeEffect       = addForgeEffect;
window.removeForgeEffect    = removeForgeEffect;
window._dismissContestPanel = () => dismissContestPanel();
// Logs tab
window.clearLog             = clearLog;
window.exportLog            = exportLog;
// Scenes tab
window.saveNewScene         = saveNewScene;
window.deleteScene          = deleteScene;
window.loadScene            = loadScene;
window.onSceneVideoSelected = onSceneVideoSelected;
window.onSceneAudioSelected = onSceneAudioSelected;
// Journals tab
window.newJournal           = newJournal;
window.editJournal          = editJournal;
window.closeJournalEditor   = closeJournalEditor;
window.saveJournal          = saveJournal;
window.deleteJournal        = deleteJournal;
window.pushHandout          = pushHandout;
window.setJournalVisibility = setJournalVisibility;
// Sounds tab
window.uploadNewSound       = uploadNewSound;
window.testSound            = testSound;
window.stopLocalSound       = stopLocalSound;
window.updateSoundVolume    = updateSoundVolume;
window.broadcastSound       = broadcastSound;
window.deleteSoundEntry     = deleteSoundEntry;

window.dmBackToList        = dmBackToList;
window.dmOpenPlayer        = dmOpenPlayer;
window.dmEditHP            = dmEditHP;
window.dmToggleCondition   = dmToggleCondition;
window.dmEditAbility       = dmEditAbility;
window.dmToggleSpellSlot   = dmToggleSpellSlot;
window.dmEditExhaustion    = dmEditExhaustion;
window.dmEditNotes         = dmEditNotes;

window.addEventListener('message', e => handleSDKMessage(e, onInit, onEvent));

// Growing your hero (dnd-master-levels.js): the DM levels heroes up (milestone) or gives XP (experience).
window.levelUpParty = () => Levels.levelUpParty();
window.levelUpHero = uid => Levels.levelUpHeroes([uid]);
window.giveXpParty = () => { const n = prompt('Experience for every hero:', '100'); if (n !== null) Levels.giveXp(Object.keys(dmCampaign?.characterSummaries || {}), n); };
window.giveXpHero = uid => { const n = prompt('Experience for this hero:', '100'); if (n !== null) Levels.giveXp([uid], n); };
window.addHomebrewSubclass = addHomebrewSubclass; window.addHomebrewFeat = addHomebrewFeat; window.deleteHomebrew = deleteHomebrew;
