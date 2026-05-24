// dnd-hub-state.js — all shared mutable state for dnd-hub modules
// Mutate MAP/CC/SRD properties directly (object refs are stable).
// Use setServerData() / setUserId() to reassign the primitive-like vars.

// ── Map engine state ──────────────────────────────────────────────────────────
export const MAP = {
  app: null,            // PIXI.Application
  layers: {},           // { bg, grid, tokens, fog, walls, ui }
  campaignId: null,
  isDM: false,
  mapId: null,
  mapData: null,        // current map object from storage
  activeTool: 'select', // select | wall | door | brush-reveal | brush-hide | erase
  editMode: false,
  fogVisible: true,     // DM fog-visibility toggle
  tokenSprites: {},     // tokenId → PIXI.Container
  dragState: null,
  wallDrawing: null,
  fogThrottle: null,
  resizeObserver: null,
  localVisible: null,       // Set<string> of fog cell keys visible — DM persistence only
  localVisiblePoly: null,   // Array<{x,y}[]> — one polygon per player token, for smooth fog cutout
  _bgOffset: { x: 0, y: 0 }, // image top-left offset from fitSprite (grid/fog alignment)
  _bgBlobUrl: null,     // object URL for video backgrounds (revoke on map change)
  _bgTickerCb: null,   // PixiJS ticker callback for video texture updates (one at a time)
  _soundtrackAudio: null, // <Audio> element for active scene soundtrack
  _shopAudio: null,       // <Audio> element for active shop video audio
  _activeShopId: null,    // shopId of the currently loaded shop
  _shopFogHidden: false,  // when true, renderFog() clears the fog layer and returns
  _fogCanvas: null,     // reused Canvas2D element for fog rendering (avoids per-frame allocation)
  _fogTexture: null,    // PixiJS texture wrapping _fogCanvas — updated each render
  _fogSprite: null,     // PixiJS Sprite showing the fog canvas — repositioned on pan/zoom
  zoom: 1,              // stage scale factor (0.25–4)
  panX: 0,              // stage X translation in screen pixels
  panY: 0,              // stage Y translation in screen pixels
  selectedWall: null,   // id of selected wall (select tool + Delete key)
  selectedDoor: null,   // id of selected door (select tool + Delete key)
  selectedToken: null,  // id of selected token (WASD / arrow key movement)
  _wasdPendingMove: null,    // coalesced pending TOKEN_MOVE broadcast from WASD
  _wasdBroadcastTimer: null, // timer handle for debounced WASD broadcast
  eraseHover: null,     // id of wall/door under erase cursor
  // Phase 1 — Token UX
  selectedTokens: new Set(),    // DM shift-click multi-select: Set of tokenIds
  activeTurnTokenId: null,      // tokenId of the combatant whose turn it is
  activeTurnTokenSpeed: 30,     // movement speed in feet for active turn token
  turnMovedDistance: 0,         // feet moved by active turn token this turn
  rulerActive: false,           // whether the measurement ruler is being shown
  rulerStart: null,             // { x, y } world coords of ruler anchor point
  // Phase 6 — Dynamic lighting
  lightDragState: null,    // { mode: 'radius'|'move', lightId, originX?, originY? }
  activeLightId: null,     // id of currently selected light (select tool + Delete)
  // Phase 7 — Audio zones & triggers
  activeAudioZoneId: null,   // id of selected audio zone (DM select tool)
  audioZoneDragState: null,  // { mode: 'radius'|'move', zoneId, originX?, originY? }
  activeTriggerId: null,     // id of selected trigger tile
  // Phase 9 — AoE templates
  templates: [],            // ephemeral — cleared on map change, never persisted
  activeTemplateId: null,   // id of template selected for deletion (select tool)
  templateDrawState: null,  // { type, color, originX, originY } while drawing
  // Phase 2 — Range warnings & movement tracking
  selectedAttack: null,          // { name, toHit, damageDice, rangeFt } — set when DM picks an attack
  turnMovedDistances: new Map(), // tokenId → feet moved this turn (per-token, reset on turn-start)
  // Phase 3 — Loot contests (in-memory only; not persisted)
  lootContests: {},   // { [contestKey]: { tokenId, shopId, itemId, itemName, source, goldCost, interested: [] } }
};

// ── Character creator state ───────────────────────────────────────────────────
export const CC = {
  campaignId: null,
  step: 0,
  draft: {
    race: null, subrace: null,
    class: null, subclass: null, level: 1,
    background: null,
    abilityMethod: 'standard-array',
    baseScores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    equipment: [], startingGold: 0, useStartingGold: false,
    spells: [], cantrips: [],
    name: '', alignment: 'True Neutral', deity: '', portraitUrl: '', portraitFileId: '',
    personalityTraits: '', ideals: '', bonds: '', flaws: '', appearance: '', backstory: '',
    proficiencyChoices: [],
  },
};

// ── SRD data cache ────────────────────────────────────────────────────────────
export const SRD = {};

// ── Runtime globals (reassigned, use setters) ─────────────────────────────────
export let serverData = null;
export let userId = null;
export function setServerData(d) { serverData = d; }
export function setUserId(id) { userId = id; }

// ── Constants ─────────────────────────────────────────────────────────────────
export const CC_STEPS = ['Race', 'Class', 'Ability Scores', 'Background', 'Equipment', 'Spells', 'Description', 'Review'];
export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const ALIGNMENTS = ['Lawful Good', 'Neutral Good', 'Chaotic Good', 'Lawful Neutral', 'True Neutral', 'Chaotic Neutral', 'Lawful Evil', 'Neutral Evil', 'Chaotic Evil'];
export const TOKEN_COLORS = [0x3b82f6, 0x22c55e, 0xf59e0b, 0xa855f7, 0xef4444, 0x06b6d4, 0xf97316, 0xec4899];
export const SIZE_SCALE = { tiny: 0.4, small: 0.8, medium: 1.0, large: 1.9, huge: 2.8, gargantuan: 3.7 };
export const SIZE_CELLS = { tiny: 0.5, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };

// ── Storage keys ──────────────────────────────────────────────────────────────
export const HUB_DM_KEY    = 'hub-dm';   // DM-only: campaign state, maps, tokens, walls, settings
export const HUB_META_KEY  = 'hub-meta'; // DM-only: lightweight index (campaign list, active map)
export function hubPlayerKey(uid) { return `hub-player-${uid}`; }
export function hubFogKey(campaignId, mapId) { return `hub-fog-${campaignId}-${mapId}`; }

// ── Geometry / grid helpers ───────────────────────────────────────────────────

// Effective grid cell size in canvas pixels. Matches renderGrid's formula.
// Use this everywhere instead of mapData.gridSize || 40 to keep tokens/fog/grid aligned.
export function effectiveGs(mapData) {
  return (mapData?.mapCellW && MAP._bgImgW && MAP._bgScale != null)
    ? MAP._bgImgW * MAP._bgScale / mapData.mapCellW
    : (mapData?.gridSize || 40);
}

export function segmentsIntersect(p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y) {
  const d1x = p2x - p1x, d1y = p2y - p1y;
  const d2x = p4x - p3x, d2y = p4y - p3y;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return false;
  const t = ((p3x - p1x) * d2y - (p3y - p1y) * d2x) / cross;
  const u = ((p3x - p1x) * d1y - (p3y - p1y) * d1x) / cross;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// ── D&D math helpers ──────────────────────────────────────────────────────────
export function abilityMod(score) { return Math.floor((score - 10) / 2); }
export function fmtMod(mod) { return mod >= 0 ? `+${mod}` : `${mod}`; }

// ── Screen navigation (here to avoid cycle: events.js and screens.js both need it) ──
export function showScreen(name) {
  ['loading', 'lobby', 'dm-portal', 'join', 'cam-wizard', 'char-creator', 'campaign'].forEach(s => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.classList.add('hidden');
  });
  const target = document.getElementById(`screen-${name}`);
  if (target) { target.classList.remove('hidden'); target.classList.add('fade-in'); }
}
