// dnd-hub-main.js — entry point, wiring only. Zero logic.
import { levelupPick, levelupRoll, levelupRollDie, levelupAbility, levelupBack, levelupNext, levelupContinue } from './dnd-hub-levelup.js';
import { toggleWeatherPanel, setWeather } from './dnd-hub-weather.js';
import { showLibrary, bookPickFile, bookCancel, bookTab, bookFilter, bookKeep, bookKeepAll, bookPeek, bookTitle, bookPlace, bookSave, bookAttach, bookDelete, bookExport, bookPicKind, bookEdit, bookPickFiles, bookDrop } from './book/book-screens.js';
import { toggleBookPanel, bookPanelTab, bookPanelBook, bookPanelSection, bookPanelFilter, bookPanelOpen, bookShareSection, bookAddMonster, bookAddItem, bookUseHere, bookUseMap, bookShowPicture } from './book/book-reader.js';
import { handleSDKMessage } from '../plugin-sdk.js';
import { CC, MAP, showScreen, serverData } from './dnd-hub-state.js?v=20261009a';
import { setOnRemoteMerged } from './dnd-hub-storage.js?v=20261013n';
import { showCredits } from './dnd-hub-credits.js';
import { onInit, onEvent } from './dnd-hub-events.js?v=20261013n';
import { quickPickHero, quickStepByStep, quickPlay, quickChange, forgeSelect, forgeChoose, forgeBack, forgeToggleMute, shapePick, shapeScore, shapeScores, shapeHalfElf, shapeSkill, shapeExtraSkill, shapeCantrip, shapeSpell, shapeText, shapeNewName, shapeNext, shapeBack, shapeFinish, forgeShowQuick } from './dnd-hub-forge.js';
import { startSampleAdventure } from './dnd-hub-sample.js';
import { gearOpt, gearPick, gearBuy, gearShopTab, gearMode } from './dnd-hub-gear-view.js';
import { setUndoAppliers, undoMap, redoMap, rebaseUndo, refreshUndoButtons } from './dnd-hub-undo.js';
import { UNDO_APPLIERS } from './dnd-hub-undo-apply.js';
import { toggleDicePanel, diceLookPreset, diceLookColor, diceLookFinish, diceLookTry } from './dnd-hub-dice-panel.js';
import { loadMyLook } from './dnd-hub-dice-look.js';
import { onFinishRegister, ccBack, ccNext } from './dnd-hub-char.js?v=20261013n';
import { confirmDeleteCampaign, cancelDeleteCampaign, deleteCampaign, toggleGuides } from './dnd-hub-screens.js?v=20261013n';
import { setZoom } from './dnd-hub-canvas.js?v=20261013n';
import {
  enterCampaignAsPlayer, enterCampaignAsDM,
  showDMPortal, showJoinScreen, showCampaignWizard, createCampaign, requestJoin,
  renderLobbyScreen,
} from './dnd-hub-screens.js?v=20261013n';
import { setTool, toggleEditMode, toggleDMFog, renderWalls } from './dnd-hub-walls.js?v=20261013n';
import {
  triggerMapUpload, handleMapUpload, setGridSettings,
  toggleGridPanel, toggleVTTPanel, onVTTFileSelected, onVTTVideoSelected, runVTTImport,
} from './dnd-hub-map-bg.js?v=20261013n';
import { resetFog, renderFog } from './dnd-hub-fog.js?v=20261013n';
import { renderLights, startFlicker, stopFlicker, saveLightsAndBroadcast } from './dnd-hub-lights.js?v=20261013n';
import { updateAndBroadcastFog } from './dnd-hub-los.js?v=20261013n';
import {
  selectRace, selectSubrace, renderRaceDetails, selectClass, renderSubclassOptions, toggleClassSkill, toggleExtraSkill, setHalfElfBonus,
  selectAbilityMethod, renderAbilityMethodUI, adjustPB, rollAllAbilities,
  selectBackground, renderCCEquipment, toggleSpell,
  triggerPortraitUpload, handlePortraitUpload,
} from './dnd-hub-char-steps.js?v=20261013b';
import { startRuler, clearRuler } from './dnd-hub-ruler.js?v=20261013n';
import { destroyContextMenu, renderTokens, placePartyTokens } from './dnd-hub-tokens.js?v=20261013n';
import { renderPins, showPinDialog } from './dnd-hub-pins.js?v=20261013n';
import { renderAudioZones, saveZonesAndBroadcast } from './dnd-hub-audio-zones.js?v=20261013n';
import { renderTriggers, saveTriggersAndBroadcast } from './dnd-hub-triggers.js?v=20261013n';
import { updateSpatialAudio } from './dnd-hub-spatial.js?v=20261009a';
import { showTemplatePicker, destroyTemplatePicker, selectTemplateShape, selectTemplateColor,
         clearAllTemplates, clearMyTemplates, renderTemplates } from './dnd-hub-templates.js?v=20261011b';

// Render static lobby screen HTML (all other screens render on navigate)
renderLobbyScreen();

// Wire finish callback
onFinishRegister(enterCampaignAsPlayer);

// A save merged in someone else's edits: re-point the open map at the merged object
// and redraw what it shows.
setOnRemoteMerged(campaignId => {
  if (campaignId !== MAP.campaignId || !MAP.mapId) return;
  const fresh = serverData?.campaigns?.[campaignId]?.maps?.[MAP.mapId];
  if (fresh) MAP.mapData = fresh;
  rebaseUndo(); // another screen's changes are not this DM's to undo
  renderTokens(); renderWalls(); renderLights(); renderPins(); renderFog(); refreshUndoButtons();
});
// Ctrl+Z for the DM's map tools: how each part is put back on every screen.
setUndoAppliers(UNDO_APPLIERS);
window.undoMap = undoMap; window.redoMap = redoMap;
// Each player's dice skin (dnd-hub-dice-look.js): loaded once, sent with every roll.
window.toggleDicePanel = toggleDicePanel; window.diceLookPreset = diceLookPreset; window.diceLookColor = diceLookColor;
window.diceLookFinish = diceLookFinish; window.diceLookTry = diceLookTry;
loadMyLook();

// ── Window globals for inline onclick= handlers ──────────────────────────────
window.showScreen          = showScreen;
window.showDMPortal        = showDMPortal;
window.showJoinScreen      = showJoinScreen;
window.showCampaignWizard  = showCampaignWizard;
window.createCampaign      = createCampaign;
window.requestJoin         = requestJoin;
window.enterCampaignAsDM   = enterCampaignAsDM;
window.confirmDeleteCampaign = confirmDeleteCampaign;
window.cancelDeleteCampaign  = cancelDeleteCampaign;
window.deleteCampaign        = deleteCampaign;
window.enterCampaignAsPlayer = enterCampaignAsPlayer;
window.setTool             = setTool;
window.toggleEditMode      = toggleEditMode;
window.toggleDMFog         = toggleDMFog;
window.triggerMapUpload    = triggerMapUpload;
window.handleMapUpload     = handleMapUpload;
window.setGridSize         = v => setGridSettings({ gridSize: parseInt(v) || 40 });
window.setGridSettings     = setGridSettings;
window.toggleGridPanel     = toggleGridPanel;
window.toggleVTTPanel      = toggleVTTPanel;
window.onVTTFileSelected   = onVTTFileSelected;
window.onVTTVideoSelected  = onVTTVideoSelected;
window.runVTTImport        = runVTTImport;
window.adjustGrid          = (key, delta) => { if (!MAP.mapData) return; setGridSettings({ [key]: (MAP.mapData[key] || 0) + delta }); };
window.setZoom             = setZoom;
window.resetFog            = resetFog;
window.updateAndBroadcastFog = updateAndBroadcastFog;
window.selectRace          = selectRace;
window.selectSubrace       = selectSubrace;
window.renderRaceDetails   = renderRaceDetails;
window.selectClass         = selectClass;
window.renderSubclassOptions = renderSubclassOptions;
// Hero Forge (dnd-hub-forge.js)
window.levelupPick = levelupPick; window.levelupRoll = levelupRoll; window.levelupRollDie = levelupRollDie;
window.levelupAbility = levelupAbility; window.levelupBack = levelupBack; window.levelupNext = levelupNext; window.levelupContinue = levelupContinue;
window.quickPickHero = quickPickHero; window.quickStepByStep = quickStepByStep; window.quickPlay = quickPlay; window.quickChange = quickChange; window.forgeSelect = forgeSelect; window.forgeChoose = forgeChoose; window.forgeBack = forgeBack; window.forgeToggleMute = forgeToggleMute;
window.toggleGuides = toggleGuides;
window.toggleWeatherPanel = toggleWeatherPanel; window.setWeather = setWeather;
// Books (book/book-screens.js, book/book-reader.js).
window.showLibrary = showLibrary; window.bookPickFile = bookPickFile; window.bookCancel = bookCancel; window.bookTab = bookTab; window.bookFilter = bookFilter; window.bookKeep = bookKeep; window.bookKeepAll = bookKeepAll; window.bookPeek = bookPeek; window.bookTitle = bookTitle; window.bookPlace = bookPlace; window.bookSave = bookSave; window.bookAttach = bookAttach; window.bookDelete = bookDelete; window.bookExport = bookExport; window.bookPicKind = bookPicKind; window.bookEdit = bookEdit; window.bookPickFiles = bookPickFiles; window.bookDrop = bookDrop; window.toggleBookPanel = toggleBookPanel; window.bookPanelTab = bookPanelTab; window.bookPanelBook = bookPanelBook; window.bookPanelSection = bookPanelSection; window.bookPanelFilter = bookPanelFilter; window.bookPanelOpen = bookPanelOpen; window.bookShareSection = bookShareSection; window.bookAddMonster = bookAddMonster; window.bookAddItem = bookAddItem; window.bookUseHere = bookUseHere; window.bookUseMap = bookUseMap; window.bookShowPicture = bookShowPicture;
// The Hero Forge's guided steps (dnd-hub-forge-shape*.js).
window.shapePick = shapePick; window.shapeScore = shapeScore; window.shapeScores = shapeScores; window.shapeHalfElf = shapeHalfElf; window.shapeSkill = shapeSkill; window.shapeExtraSkill = shapeExtraSkill; window.shapeCantrip = shapeCantrip; window.shapeSpell = shapeSpell; window.shapeText = shapeText; window.shapeNewName = shapeNewName; window.shapeNext = shapeNext; window.shapeBack = shapeBack; window.shapeFinish = shapeFinish; window.forgeShowQuick = forgeShowQuick;
window.startSampleAdventure = startSampleAdventure;
window.toggleClassSkill = toggleClassSkill; window.toggleExtraSkill = toggleExtraSkill; window.setHalfElfBonus = setHalfElfBonus;
window.selectAbilityMethod = selectAbilityMethod;
window.renderAbilityMethodUI = renderAbilityMethodUI;
window.adjustPB            = adjustPB;
window.rollAllAbilities    = rollAllAbilities;
window.selectBackground    = selectBackground;
window.renderCCEquipment   = renderCCEquipment;
// Starting gear, in both creators (dnd-hub-gear-view.js).
window.gearOpt = gearOpt; window.gearPick = gearPick; window.gearBuy = gearBuy; window.gearShopTab = gearShopTab; window.gearMode = gearMode;
window.toggleSpell             = toggleSpell;
window.triggerPortraitUpload   = triggerPortraitUpload;
window.handlePortraitUpload    = handlePortraitUpload;
window.ccBack              = ccBack;
window.ccNext              = ccNext;
window.CC  = CC;
window.MAP = MAP;
window.startRuler         = startRuler;
window.clearRuler         = clearRuler;
window.destroyContextMenu = destroyContextMenu;
window.placePartyTokens   = placePartyTokens;
window.showCredits        = showCredits;
window.renderPins         = renderPins;
window.showPinDialog      = showPinDialog;
window.renderLights           = renderLights;
window.saveLightsAndBroadcast = saveLightsAndBroadcast;
window.renderAudioZones       = renderAudioZones;
window.saveZonesAndBroadcast  = saveZonesAndBroadcast;
window.saveTriggersAndBroadcast = saveTriggersAndBroadcast; // scripts/playtest/dnd-rules-test.mjs places traps through it
window.renderTokens = renderTokens;
window.renderTriggers         = renderTriggers;
window.updateSpatialAudio     = updateSpatialAudio;
window.showTemplatePicker     = showTemplatePicker;
window.destroyTemplatePicker  = destroyTemplatePicker;
window.selectTemplateShape    = selectTemplateShape;
window.selectTemplateColor    = selectTemplateColor;
window.clearAllTemplates      = clearAllTemplates;
window.clearMyTemplates       = clearMyTemplates;
window.renderTemplates        = renderTemplates;

// ── Audio context unlock gate (browser autoplay policy) ──────────────────────
let _audioCtx = null;
let _audioUnlocked = false;
const _audioQueue = [];

export function getAudioContext() { return _audioCtx; }
export function queueAudio(fn) {
  if (_audioUnlocked) { fn(_audioCtx); return; }
  _audioQueue.push(fn);
}

function _unlockAudio() {
  if (_audioUnlocked) return;
  _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  _audioCtx.resume().then(() => {
    _audioUnlocked = true;
    document.getElementById('audio-gate-banner')?.remove();
    _audioQueue.forEach(fn => fn(_audioCtx));
    _audioQueue.length = 0;
  });
}

document.addEventListener('click', _unlockAudio, { once: true });
document.addEventListener('keydown', _unlockAudio, { once: true });

setTimeout(() => {
  if (_audioUnlocked) return;
  const banner = document.createElement('div');
  banner.id = 'audio-gate-banner';
  banner.style.cssText = 'position:fixed;bottom:10px;left:10px;background:var(--lk-panel);border:1px solid var(--lk-line);border-radius:999px;padding:4px 12px;font-size:11px;color:var(--lk-muted);pointer-events:none;z-index:9999';
  banner.textContent = 'Sound is off · click anywhere to turn it on';
  document.body.appendChild(banner);
}, 2000);

// ── Start flicker ticker (8 Hz, synced across clients via Date.now() seed) ──
startFlicker(renderFog);

// ── Message bridge ────────────────────────────────────────────────────────────
window.addEventListener('message', e => handleSDKMessage(e, onInit, onEvent));
