// dnd-hub-main.js — entry point, wiring only. Zero logic.
import { handleSDKMessage } from '../plugin-sdk.js';
import { CC, MAP, showScreen } from './dnd-hub-state.js?v=20260502p4';
import { onInit, onEvent } from './dnd-hub-events.js?v=20260502p4';
import { onFinishRegister, ccBack, ccNext } from './dnd-hub-char.js?v=20260502p4';
import { confirmDeleteCampaign, cancelDeleteCampaign, deleteCampaign } from './dnd-hub-screens.js?v=20260502p4';
import { setZoom } from './dnd-hub-canvas.js?v=20260502p4';
import {
  enterCampaignAsPlayer, enterCampaignAsDM,
  showDMPortal, showJoinScreen, showCampaignWizard, createCampaign, requestJoin,
  renderLobbyScreen,
} from './dnd-hub-screens.js?v=20260502p4';
import { setTool, toggleEditMode, toggleDMFog } from './dnd-hub-walls.js?v=20260502p4';
import {
  triggerMapUpload, handleMapUpload, setGridSettings,
  toggleGridPanel, toggleVTTPanel, onVTTFileSelected, onVTTVideoSelected, runVTTImport,
} from './dnd-hub-map-bg.js?v=20260502p4';
import { resetFog, renderFog } from './dnd-hub-fog.js?v=20260502p4';
import { renderLights, startFlicker, stopFlicker, saveLightsAndBroadcast } from './dnd-hub-lights.js?v=20260502p4';
import { updateAndBroadcastFog } from './dnd-hub-los.js?v=20260502p4';
import {
  selectRace, selectSubrace, renderRaceDetails, selectClass, renderSubclassOptions,
  selectAbilityMethod, renderAbilityMethodUI, adjustPB, rollAllAbilities,
  selectBackground, renderCCEquipment, toggleEquipItem, filterEquipment, toggleSpell,
  triggerPortraitUpload, handlePortraitUpload,
} from './dnd-hub-char-steps.js?v=20260502p4';
import { startRuler, clearRuler } from './dnd-hub-ruler.js?v=20260502p4';
import { destroyContextMenu } from './dnd-hub-tokens.js?v=20260502p4';
import { renderPins, showPinDialog } from './dnd-hub-pins.js?v=20260502p4';
import { renderAudioZones, saveZonesAndBroadcast } from './dnd-hub-audio-zones.js?v=20260502p4';
import { renderTriggers } from './dnd-hub-triggers.js?v=20260502p4';
import { updateSpatialAudio } from './dnd-hub-spatial.js?v=20260502p4';
import { showTemplatePicker, destroyTemplatePicker, selectTemplateShape, selectTemplateColor,
         clearAllTemplates, clearMyTemplates, renderTemplates } from './dnd-hub-templates.js?v=20260502p4';

// Render static lobby screen HTML (all other screens render on navigate)
renderLobbyScreen();

// Wire finish callback
onFinishRegister(enterCampaignAsPlayer);

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
window.selectAbilityMethod = selectAbilityMethod;
window.renderAbilityMethodUI = renderAbilityMethodUI;
window.adjustPB            = adjustPB;
window.rollAllAbilities    = rollAllAbilities;
window.selectBackground    = selectBackground;
window.renderCCEquipment   = renderCCEquipment;
window.toggleEquipItem     = toggleEquipItem;
window.filterEquipment     = filterEquipment;
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
window.renderPins         = renderPins;
window.showPinDialog      = showPinDialog;
window.renderLights           = renderLights;
window.saveLightsAndBroadcast = saveLightsAndBroadcast;
window.renderAudioZones       = renderAudioZones;
window.saveZonesAndBroadcast  = saveZonesAndBroadcast;
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
  banner.style.cssText = 'position:fixed;bottom:8px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.85);border:1px solid var(--dnd-border);border-radius:6px;padding:6px 14px;font-size:11px;color:var(--dnd-muted);pointer-events:none;z-index:9999';
  banner.textContent = '🔊 Audio paused — click anywhere to enable';
  document.body.appendChild(banner);
}, 2000);

// ── Start flicker ticker (8 Hz, synced across clients via Date.now() seed) ──
startFlicker(renderFog);

// ── Message bridge ────────────────────────────────────────────────────────────
window.addEventListener('message', e => handleSDKMessage(e, onInit, onEvent));
