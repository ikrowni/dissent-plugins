// dnd-master-main.js — bootstrap: init, tab switching, event dispatch
import { handleSDKMessage, getIdentity, storageGetCompanion, storageGet } from '../plugin-sdk.js';
import { EV } from '../dnd-hub/dnd-hub-event-types.js?v=20260502p4';
import { loadSRDMonsters, getSRDMonsters, renderMonsterSearch, setMonstersState,
  expandMonster, addInstance, adjHP, setInstanceHP, deleteInstance, quickRoll, quickRollExpr } from './dnd-master-monsters.js';
import { renderEncounterBuilder, setEncounterState, loadEncounterDraft, filterMonsters, addMonsterToEncounter,
  changeCount, removeCreature, clearEncounter, launchEncounter, setEncounterTargetDifficulty,
  toggleLootPanel, setLootItem } from './dnd-master-encounter.js?v=20260502p4';
import { renderInitiativeTracker, setInitiativeState, setInitiativeSharedState,
  getInitiativeState, moveInitiative, rerollInitiative, endEncounter, updateHP,
  toggleInitRow, applyMassHP, spawnTokensOnMap } from './dnd-master-initiative.js';
import { renderSettings, setSettingsState, toggleSetting, setSpatialRange, exportCampaign } from './dnd-master-settings.js?v=20260417p10';
import { renderMapsTab,   setMapsState,   activateMapFromList, uploadNewMap, deleteMap, renameMapInline } from './dnd-master-maps.js';
import { renderActorsTab, setActorsState, saveNewActor, deleteActor, addPendingAttack, removePendingAttack } from './dnd-master-actors.js';
import { renderItemsTab,  setItemsState,  saveNewItem, deleteItem,
  onItemImgSelected, handleLootInterest, resolveContest,
  addForgeEffect, removeForgeEffect, handleContestResult, dismissContestPanel } from './dnd-master-items.js?v=20260502p4';
import { renderNotesTab,  setNotesState  } from './dnd-master-notes.js';
import { renderLogsTab,   setLogsState,   appendLogEntry, clearLog, exportLog } from './dnd-master-logs.js';
import { renderScenesTab,  setScenesState,  saveNewScene, deleteScene, loadScene, onSceneVideoSelected, onSceneAudioSelected } from './dnd-master-scenes.js?v=20260502p4';
import { renderJournalsTab, setJournalsState, newJournal, editJournal, closeJournalEditor, saveJournal, deleteJournal, pushHandout, setJournalVisibility } from './dnd-master-journals.js';
import { renderSoundsTab,  setSoundsState,  uploadNewSound, testSound, stopLocalSound, broadcastSound, deleteSoundEntry, updateSoundVolume } from './dnd-master-sounds.js';
import { renderTriggersTab, setTriggersState } from './dnd-master-triggers.js';
import { renderShopsTab, setShopsState, saveNewShop, deleteShop, addItemToShop, removeShopItem, loadShop, onShopVolumeChange, onShopVideoSelected } from './dnd-master-shops.js?v=20260503';
import { setLaunchCallback } from './dnd-master-encounter.js?v=20260502p4';
import { setEndCallback    } from './dnd-master-initiative.js';
import { renderPlayersTab, setPlayersState, dmBackToList, dmOpenPlayer,
  dmEditHP, dmToggleCondition, dmEditAbility, dmToggleSpellSlot,
  dmEditExhaustion, dmEditNotes } from './dnd-master-players.js';
import { loadHubDmCompanion } from './dnd-hub-shared-storage.js';

let serverData = null, userId = null, dmCampaignId = null, dmCampaign = null;

const ALL_TABS = ['encounter','initiative','monsters','maps','actors','items','shops','scenes','journals','sounds','triggers','notes','logs','settings','players'];

function switchDMTab(name) {
  ALL_TABS.forEach((t, i) => {
    document.getElementById('tab-' + t).classList.toggle('hidden', t !== name);
    document.querySelectorAll('.tab-btn')[i]?.classList.toggle('active', t === name);
  });
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
  if (name === 'logs')       renderLogsTab();
  if (name === 'players')    renderPlayersTab();
}

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

  const campaigns = Object.values(serverData.campaigns || {});
  const myCampaign = campaigns.find(c => c.dmUserId === userId);

  document.getElementById('loading').classList.add('hidden');
  if (!myCampaign) {
    parent.postMessage({ type: 'dissent:slot-action', action: 'hide' }, '*');
    return;
  }

  dmCampaignId = myCampaign.id;
  dmCampaign = myCampaign;

  document.getElementById('dm-app').classList.remove('hidden');
  document.getElementById('dm-campaign-name').textContent = myCampaign.name;

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
  setLogsState(sharedState);
  setScenesState(sharedState);
  setJournalsState(sharedState);
  setSoundsState(sharedState);
  setTriggersState(sharedState);
  setEncounterState({ dmCampaign, dmCampaignId, serverData, srdMonsters, switchDMTab, userId });
  await loadEncounterDraft();
  setPlayersState({ dmCampaign, dmCampaignId });
  setLaunchCallback(() => appendLogEntry({ type: 'combat-start', message: 'Encounter launched \u2014 Round 1' }));
  setEndCallback(()    => appendLogEntry({ type: 'combat-end',   message: 'Encounter ended' }));
  renderEncounterBuilder();
}

function onEvent(ev) {
  const p = ev.data;
  if (!p) return;
  if (p.type === 'initiative:update' && p.campaignId === dmCampaignId) {
    setInitiativeState(p.initiative);
    const el = document.getElementById('tab-initiative');
    if (el && !el.classList.contains('hidden')) renderInitiativeTracker();
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
    appendLogEntry({ type: 'death-save', message: (p.name || 'Token') + ' death save: ' + (p.success ? 'success' : 'failure') });
  }
  if (p.type === 'loot:interest' && p.campaignId === dmCampaignId) {
    handleLootInterest(p);
  }
  if (p.type === 'contest:result' && p.campaignId === dmCampaignId) {
    handleContestResult(p).catch(e => console.error('[dnd-master] contest result error:', e));
  }
}

window.switchDMTab         = switchDMTab;
window.filterMonsters               = filterMonsters;
window.addMonsterToEncounter        = addMonsterToEncounter;
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
