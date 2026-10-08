// dnd-master-main.js — bootstrap: init, tab switching, event dispatch
import { handleSDKMessage, getIdentity, storageGetCompanion, storageGet, storageSet, localPublish, genId } from '../plugin-sdk.js';
import { EV } from './dnd-hub-event-types.js?v=20261015w';
import { monsterFilterSet, monsterFilterClear } from './dnd-master-monster-filter.js';
import { loadSRDMonsters, getSRDMonsters, setBookMonsters, bookMonstersCampaign, shownRolls, renderMonsterSearch, filterMonsterSearch, refreshMonsterSearch, setMonstersState,
  expandMonster, addInstance, adjHP, setInstanceHP, deleteInstance, quickRoll, quickRollExpr } from './dnd-master-monsters.js';
import { renderEncounterBuilder, setEncounterState, loadEncounterDraft, filterMonsters, refreshEncounterMonsters, addMonsterToEncounter, loadPreparedEncounter,
  changeCount, removeCreature, clearEncounter, launchEncounter, setEncounterTargetDifficulty,
  toggleLootPanel, setLootItem } from './dnd-master-encounter.js?v=20261015w';
import { renderInitiativeTracker, setInitiativeState, setInitiativeSharedState,
  getInitiativeState, moveInitiative, rerollInitiative, endEncounter, updateHP,
  toggleInitRow, applyMassHP, spawnTokensOnMap, acceptInitiativeRoll, rollMissingInitiative, syncRowHp } from './dnd-master-initiative.js';
import { renderSettings, setSettingsState, toggleSetting, setSpatialRange, exportCampaign, pickPreset, setRulesEdition } from './dnd-master-settings.js?v=20261015w';
import { renderMapsTab,   setMapsState,   activateMapFromList, uploadNewMap, deleteMap, renameMapInline } from './dnd-master-maps.js';
import { renderActorsTab, setActorsState, saveNewActor, deleteActor, addPendingAttack, removePendingAttack,
  editActor, cancelEditActor, placeActorOnMap, renderActorsTabKeep, getCustomActors } from './dnd-master-actors.js';
import { setActorTalkState } from './dnd-master-actor-talk.js?v=20261015w';
import { renderItemsTab,  setItemsState,  saveNewItem, deleteItem,
  onItemImgSelected, handleLootInterest, resolveContest,
  addForgeEffect, removeForgeEffect, handleContestResult, restockDeclined, dismissContestPanel, lootContests, currentItems, addBookItem, itemLibGroup, itemLibSearch } from './dnd-master-items.js?v=20261015w';
import { campaignItemFromBook } from './lk-book.js';
import { rulesEdition } from './lk-table-rules.js';
import { srdItem, toggleSrdItems, srdItemSearch } from './dnd-master-srd-items.js';
import { renderNotesTab,  setNotesState  } from './dnd-master-notes.js';
import { renderHomebrewTab, setHomebrewState, addHomebrewSubclass, addHomebrewFeat, deleteHomebrew } from './dnd-master-homebrew.js';
import { renderLogsTab,   setLogsState,   appendLogEntry, clearLog, exportLog } from './dnd-master-logs.js';
import { renderScenesTab,  setScenesState,  saveNewScene, deleteScene, loadScene, onSceneVideoSelected, onSceneAudioSelected } from './dnd-master-scenes.js?v=20261015w';
import { renderJournalsTab, setJournalsState, newJournal, editJournal, closeJournalEditor, saveJournal, deleteJournal, pushHandout, setJournalVisibility } from './dnd-master-journals.js';
import { renderSoundsTab,  setSoundsState,  uploadNewSound, testSound, stopLocalSound, broadcastSound, deleteSoundEntry, updateSoundVolume } from './dnd-master-sounds.js';
import { renderTriggersTab, setTriggersState } from './dnd-master-triggers.js';
import { renderTavernsTab, setTavernsState, currentTaverns } from './dnd-master-taverns.js?v=20261015w';
import { renderGamesTab, setGamesState, currentGameSetups } from './dnd-master-games.js?v=20261015w';
import { renderShopsTab, setShopsState, currentShops, saveNewShop, deleteShop, addItemToShop, removeShopItem, loadShop, onShopVolumeChange, onShopSoundSelected, onShopMediaSelected, persistDmCatalog } from './dnd-master-shops.js?v=20261015w';
import { migrateTaverns } from './lk-tavern.js';
import { setLaunchCallback } from './dnd-master-encounter.js?v=20261015w';
import { setEndCallback    } from './dnd-master-initiative.js';
import { renderPlayersTab, playersLoaded, setPlayersState, dmBackToList, dmOpenPlayer,
  dmEditHP, dmToggleCondition, dmEditAbility, dmToggleSpellSlot,
  dmEditExhaustion, dmEditNotes } from './dnd-master-players.js';
import { pickCampaign } from './dnd-campaign-pick.js';
import { SECTIONS, TAB_LABELS, sectionOf, ALL_TABS } from './dnd-master-sections.js';
import { icon } from './lk-icons.js';
import { loadHubDmCompanion, saveHubDmCompanion, setSecretsUser, joinSecrets } from './dnd-hub-shared-storage.js';
import { sealedHtml } from './lk-sealed.js';
import { isRepeat } from './lk-bus.js';
import { setPartyState, applyPartyUpdate, renderPartyPanel } from './dnd-master-party.js';
import * as Levels from './dnd-master-levels.js';
import { setPrepState, renderPrepTab, currentPrep } from './dnd-master-prep.js?v=20261015w';
import { setScheduleState, openSchedule, closeScheduleWindow, askSchedule, pickSchedule, newScheduleQuestion, onScheduleVote,
  currentNextSession } from './dnd-master-schedule.js?v=20261015w';
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

/** The table's rules changed (2014 ↔ 2024): the monster lists show that edition's SRD (lk-srd-edition.js). */
async function useRulesMonsters() {
  if (!dmCampaign) return;
  await loadSRDMonsters(rulesEdition(dmCampaign.settings));
  setEncounterState({ dmCampaign, dmCampaignId, serverData, srdMonsters: getSRDMonsters(), switchDMTab, userId });
  if (document.getElementById('enc-monster-list')) refreshEncounterMonsters();
  if (document.getElementById('mon-list')) refreshMonsterSearch();
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
  if (name === 'taverns')    renderTavernsTab();
  if (name === 'prep')       renderPrepTab();
  if (name === 'games')      renderGamesTab();
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
// What the Hub said is open: 'unknown', 'none' (no campaign: stay sealed), 'open', or 'fallback' (no answer).
let _hubState = 'unknown', _hubAsked = false;
let _announcedRole = null, _loadRetries = 0, _loadRetryTimer = 0, _initGen = 0;

/** The DM tools are closed until the DM opens a campaign at the table (lk-sealed.js). */
function seal(title, text) {
  document.getElementById('dm-app').classList.add('hidden');
  const el = document.getElementById('loading');
  el.classList.remove('hidden');
  el.innerHTML = sealedHtml({ title, text });
}
const sealTable = () => seal('The DM\'s tools', 'Open or create a campaign at the LanternKeep table, and your tools for running it open here.');

async function onInit(data) {
  const id = await getIdentity();
  userId = id?.id ?? null;
  setSecretsUser(userId); // before the first load: the DM's sidebar joins its secret record
  if (!_hubAsked) {
    _hubAsked = true;
    localPublish('dnd-hub', EV.CAMPAIGN_QUERY, { type: EV.CAMPAIGN_QUERY });
    setTimeout(() => { if (_hubState === 'unknown') { _hubState = 'fallback'; onInit({}); } }, 6000);
  }
  if (_hubState === 'unknown') return; // the answer calls onInit again
  if (_hubState === 'none') { dmCampaignId = null; dmCampaign = null; sealTable(); return; }
  // Only the newest load counts: an older one finishing late would put back what storage held then (edits lost).
  const gen = ++_initGen;
  const loaded = await loadHubDmCompanion() || { campaigns: {} };
  if (gen !== _initGen) return;
  serverData = loaded;

  // Restore items/shops from the dm-catalog backup in case dnd-hub overwrote hub-dm
  // with an older serverData (race: dnd-hub writes hub-dm frequently from its own copy).
  const catalog = await storageGet('dm-catalog');
  if (gen !== _initGen) return;
  if (catalog?.campaigns) {
    for (const [cid, catCamp] of Object.entries(catalog.campaigns)) {
      const camp = serverData.campaigns?.[cid];
      if (!camp) continue;
      if (catCamp.items) camp.items = { ...camp.items, ...catCamp.items };
      if (catCamp.shops) camp.shops = { ...camp.shops, ...catCamp.shops };
      if (catCamp.taverns) camp.taverns = { ...camp.taverns, ...catCamp.taverns };
      if (catCamp.gameSetups) camp.gameSetups = { ...camp.gameSetups, ...catCamp.gameSetups };
    }
  }

  // Only campaigns this user runs; among those, the one the Hub announced (CAMPAIGN_ACTIVE)
  // wins. It used to take the FIRST campaign the user DMs, whatever the Hub showed.
  const runs = Object.fromEntries(Object.entries(serverData.campaigns || {})
    .filter(([, c]) => c.dmUserId === userId));
  // 🔴 The Hub's campaign did not load (a failed or rate-limited read reads as nothing): never open ANOTHER campaign
  // in its place. The sidebar used to fall back to the first campaign the DM runs, and its tabs then edited that
  // campaign's shops and taverns (tavern playtest, 2026-10-05, under HTTP 429). Wait, and read again.
  if (_announcedRole === 'dm' && _announcedCampaignId && !runs[_announcedCampaignId]) {
    seal('Opening your campaign…', 'The table is busy for a moment. Your tools open here as soon as it answers.');
    dmCampaignId = null; dmCampaign = null;
    clearTimeout(_loadRetryTimer);
    _loadRetryTimer = setTimeout(() => onInit({}), Math.min(30000, 3000 * 2 ** _loadRetries++));
    return;
  }
  // Loaded: a retry still waiting would reload from storage later and drop edits made since (tavern playtest).
  clearTimeout(_loadRetryTimer); _loadRetries = 0;
  const myCampaign = pickCampaign(runs, _announcedCampaignId, userId);

  if (!myCampaign) {
    // Not 'hide': PluginRuntime treats a hide as permanent until remount, so someone who
    // later starts running a campaign would never get this panel back.
    seal('For the DM', 'This panel is for the campaign\'s Dungeon Master. Your character is in the LanternKeep Player panel.');
    return;
  }
  await joinSecrets(serverData, myCampaign.id); // its DM-only part (encounters, notes, traps): this campaign only
  document.getElementById('loading').classList.add('hidden');

  dmCampaignId = myCampaign.id;
  dmCampaign = myCampaign;

  document.getElementById('dm-app').classList.remove('hidden');
  document.getElementById('dm-campaign-name').textContent = myCampaign.name;
  document.getElementById('dm-settings-btn').innerHTML = icon('settings', { size: 16 });
  document.getElementById('dm-rolls-btn').innerHTML = icon('dices', { size: 16 });
  renderNav();

  await loadSRDMonsters(rulesEdition(myCampaign.settings));
  if (bookMonstersCampaign() && bookMonstersCampaign() !== dmCampaignId) setBookMonsters([], null);
  const srdMonsters = getSRDMonsters();
  const sharedState = { dmCampaign, dmCampaignId, serverData, userId };
  setInitiativeSharedState(sharedState);
  setInitiativeState(dmCampaign.initiative || null);
  setMonstersState({ userId, campaignId: dmCampaignId, shownRolls: !!(await storageGet('rolls-shown', 'user').catch(() => false)) });
  syncRollsButton();
  setSettingsState(sharedState);
  setMapsState(sharedState);
  setActorsState(sharedState);
  setActorTalkState(sharedState);
  setItemsState(sharedState);
  setShopsState(sharedState);
  setTavernsState(sharedState);
  setGamesState(sharedState);
  // Taverns used to be tables with hosts; now NPCs run the games (owner, 2026-10-07). Moved over once: the dm-catalog
  // backup is rewritten too, or its old taverns would be merged back in on the next load.
  const moved = migrateTaverns(dmCampaign, genId);
  if (moved) {
    Object.assign(dmCampaign, moved);
    saveHubDmCompanion(serverData).then(() => persistDmCatalog()).catch(e => console.warn('[dnd-master] moving taverns over', e));
  }
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
  setScheduleState({ dmCampaign, dmCampaignId, serverData, userId });
  setPrepState(sharedState);
  setSessionState({ dmCampaign, dmCampaignId, serverData, userId });
  setLaunchCallback(() => appendLogEntry({ type: 'combat-start', message: 'Encounter launched \u2014 Round 1' }));
  setEndCallback(()    => appendLogEntry({ type: 'combat-end',   message: 'Encounter ended' }));
  renderEncounterBuilder();
}

function onEvent(ev) {
  const p = ev.data;
  if (!p) return;
  if (p.type === 'schedule:vote') { onScheduleVote(p); return; } // a player answered "when can you play?"

  // The Hub opened a campaign: follow it if this user runs it and it isn't shown yet.
  if (p.type === EV.CAMPAIGN_ACTIVE) {
    if (!p.campaignId) { _hubState = 'none'; _announcedCampaignId = null; _announcedRole = null; clearTimeout(_loadRetryTimer); dmCampaignId = null; dmCampaign = null; sealTable(); return; }
    const wasSealed = _hubState !== 'open' && _hubState !== 'fallback';
    _hubState = 'open';
    _announcedCampaignId = p.campaignId || null;
    _announcedRole = p.role || null;
    // The DM opened a campaign: ask the host to show this panel (see dnd-player's twin).
    if (p.role === 'dm') parent.postMessage({ type: 'dissent:slot-action', action: 'focus' }, '*');
    if ((p.role === 'dm' && p.campaignId !== dmCampaignId) || (wasSealed && !dmCampaignId)) onInit({});
    return;
  }
  // The open campaign's book monsters, from the DM's Hub (it holds the library).
  if (p.type === EV.BOOK_ADD_MONSTER && p.campaignId === dmCampaignId) {
    switchDMTab('encounter');
    addMonsterToEncounter(p.monsterId);
    return;
  }
  // A book's item the DM added from the Hub's Book panel: into this campaign's items (Loot → Items), shown at once.
  if (p.type === EV.BOOK_ADD_ITEM && p.campaignId === dmCampaignId) {
    addBookItem(campaignItemFromBook(p.item)).then(() => switchDMTab('items')).catch(e => console.warn('[dnd-master] book item', e));
    return;
  }
  // Kept even before this sidebar has picked its campaign (the Hub may answer first); onInit drops another campaign's.
  if (p.type === EV.BOOK_MONSTERS) {
    setBookMonsters(p.monsters, p.campaignId);
    if (p.campaignId !== dmCampaignId) return;
    setEncounterState({ dmCampaign, dmCampaignId, serverData, srdMonsters: getSRDMonsters(), switchDMTab, userId });
    // New book monsters can bring new types: the filter bars are drawn again (never the search boxes).
    if (document.getElementById('enc-monster-list')) refreshEncounterMonsters();
    if (document.getElementById('mon-list')) refreshMonsterSearch();
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
    useRulesMonsters().catch(e => console.warn('[dnd-master] rules monsters', e));
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
    syncRowHp(p.tokenId, p.hp, p.hpMax).catch(() => {});
    let hpMsg = (p.name || 'Token') + ' HP \u2192 ' + p.hp + '/' + p.hpMax;
    if (p.source) hpMsg += ' (' + p.source + ')';
    appendLogEntry({ type: 'hp-change', message: hpMsg });
  }
  if (p.type === 'token:death-save' && p.campaignId === dmCampaignId) {
    // A player's sheet sends the tallies (and, for a roll, a message); it never sent `success`.
    const tally = p.successes !== undefined ? ' death saves: ' + p.successes + ' success, ' + (p.failures || 0) + ' failure' : ' death save';
    appendLogEntry({ type: 'death-save', message: p.message || ((p.name || 'Token') + tally) });
  }
  // A tavern game was settled on the DM's Hub (dnd-hub-tavern-ref.js): what was bet, won or caught.
  if (p.type === 'tavern:log' && p.campaignId === dmCampaignId) {
    appendLogEntry({ type: 'loot', message: String(p.message || '').slice(0, 300) }).catch(() => {});
    return;
  }
  if (p.type === 'loot:declined' && p.campaignId === dmCampaignId) {
    const sale = p.saleId || p.eid;
    if (sale && isRepeat({ eid: 'declined:' + sale })) return; // logged and put back once per sale
    appendLogEntry({ type: 'loot', message: `${p.name || 'A player'} could not pay ${p.goldCost} gp for ${p.itemName}: not taken` }).catch(() => {});
    restockDeclined(p).catch(() => {}); // not sold: back on the shelf
    return;
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
// Read-only views for the playtests (scripts/playtest/dnd-rules-test.mjs).
window.__dmItems = () => currentItems(); // what the Items and Shops tabs hold, which is what the DM sees
window.__dmShops = () => currentShops();
window.__dmTaverns = () => currentTaverns();
window.setRulesEdition = v => setRulesEdition(v).then(useRulesMonsters);
window.__dmNextSession = () => currentNextSession();
window.__dmPrep = () => currentPrep();
window.openSchedule = openSchedule; window.closeScheduleWindow = closeScheduleWindow; window.askSchedule = askSchedule;
window.pickSchedule = pickSchedule; window.newScheduleQuestion = newScheduleQuestion;
window.__dmActors = () => getCustomActors();
window.__dmGameSetups = () => currentGameSetups();
window.__lootContests = () => lootContests();
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
window.filterMonsterSearch = filterMonsterSearch;
window.monsterFilterSet = monsterFilterSet;
window.monsterFilterClear = monsterFilterClear;
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
window.editActor            = editActor;
window.cancelEditActor      = cancelEditActor;
window.placeActorOnMap      = placeActorOnMap;
window.renderActorsTabKeep  = renderActorsTabKeep;
// Shops tab
window.saveNewShop          = saveNewShop;
window.deleteShop           = deleteShop;
window.addItemToShop        = addItemToShop;
window.removeShopItem       = removeShopItem;
window.loadShop             = loadShop;
window.onShopVolumeChange   = onShopVolumeChange;
window.onShopSoundSelected  = onShopSoundSelected;
window.onShopMediaSelected  = onShopMediaSelected;
// Items tab
window.saveNewItem          = saveNewItem;
window.deleteItem           = deleteItem;
window.itemLibGroup         = itemLibGroup;
window.itemLibSearch        = itemLibSearch;
window.toggleSrdItems       = () => { toggleSrdItems(); renderItemsTab(); };
window.srdItemSearch        = srdItemSearch;
// An SRD magic item into the campaign's items (dnd-master-srd-items.js), the way a book's item arrives.
window.addSrdItem           = id => addBookItem(campaignItemFromBook(srdItem(id))).then(() => renderItemsTab())
  .catch(e => console.warn('[dnd-master] SRD item', e));
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

// "Players see my rolls": off = secret (the table only hears the dice). Remembered per DM.
function syncRollsButton() {
  const b = document.getElementById('dm-rolls-btn');
  if (!b) return;
  const on = shownRolls();
  b.setAttribute('aria-pressed', String(on));
  b.classList.toggle('active', on);
  b.title = on ? 'Your rolls: everyone sees them' : 'Your rolls: secret (players only hear the dice)';
}
window.toggleShownRolls = async () => {
  setMonstersState({ userId, shownRolls: !shownRolls() });
  syncRollsButton();
  try { await storageSet('rolls-shown', shownRolls(), 'user'); } catch { /* remembered for this session */ }
};
