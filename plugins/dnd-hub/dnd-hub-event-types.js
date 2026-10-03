// ⚠️ GENERATED FILE — DO NOT EDIT.
//
// Vendored from plugins/dnd-hub-event-types.js by scripts/vendor-shared.mjs.
// Edit that file and re-run the script; `--check` fails the deploy if this copy drifts.
//
// It is a copy because a mirror may only serve files from under this plugin's own
// directory, so importing '../dnd-hub-event-types.js' directly would make the plugin unmirrorable.

// dnd-hub-event-types.js — all realtime event name constants
// Import EV everywhere. Never use bare strings for event types.

export const EV = {
  // Hub → its own sidebars (localPublish): the campaign the Hub is now showing.
  CAMPAIGN_ACTIVE:    'campaign:active',

  // Map
  MAP_SET:            'map:set',
  MAP_GRID:           'map:grid',
  MAP_GRID_SETTINGS:  'map:grid-settings',
  MAP_PING:           'map:ping',           // Phase 1

  // Tokens
  TOKEN_MOVE:         'token:move',
  TOKENS_SPAWN:       'tokens:spawn',
  TOKEN_TURN_START:   'token:turn-start',   // Phase 1
  TOKEN_CONDITIONS:   'token:conditions',   // Phase 2
  TOKEN_DEATH_SAVE:   'token:death-save',   // Phase 2

  // Fog
  FOG_REVEAL:         'fog:reveal',
  FOG_RESET:          'fog:reset',

  // Walls / doors
  WALLS_UPDATE:       'walls:update',
  DOOR_STATE:         'door:state',

  // HP & combat
  HP_CHANGE:          'hp:change',
  COMBAT_SETTINGS:    'combat:settings',    // Phase 2
  INITIATIVE_ROLL:    'initiative:roll',    // a player's own initiative roll → DM tracker (Table rules)
  DAMAGE_REQUEST:     'combat:damage',      // a player's Hub asks the DM's Hub to apply auto damage
  PARTY_UPDATE:       'party:update',       // a hero's summary changed → Hub, other sheets, DM sidebar (via the DM's Hub)
  SESSION_START:      'session:start',      // DM starts the evening → Hub (scene, music, recap card) + player sheets
  VIEW_SET:           'map:view',           // the DM's Hub → players' Hubs: centre (world px) and zoom

  // Initiative
  INITIATIVE_UPDATE:  'initiative:update',

  // Character
  CHARACTER_CREATED:  'character:created',

  // Dice
  DICE_ROLL:          'dice:roll',
  DICE_PHYSICS_ROLL:  'dice:physics-roll',

  // Scene (Phase 5)
  SCENE_LOAD:         'scene:load',
  HANDOUT_PUSH:       'handout:push',
  AUDIO_PLAY:         'audio:play',    // Phase 5 — sounds tab broadcast
  PINS_UPDATE:        'pins:update',   // Phase 5 — map pin sync

  // Lights (Phase 6)
  LIGHTS_UPDATE:      'lights:update',

  // Audio / Triggers (Phase 7)
  AUDIO_ZONE_UPDATE:  'audio:zone-update',
  TRIGGER_FIRED:      'trigger:fired',
  TRIGGER_PENDING:    'trigger:pending',

  // Templates (Phase 9)
  TEMPLATE_UPDATE:    'template:update',

  // Rest
  REST:               'rest',

  // Campaign / lobby
  JOIN_APPROVED:      'join:approved',
  JOIN_REQUEST:       'join:request',
  CAMPAIGN_CREATED:   'campaign:created',

  // Phase 2 — Movement / range
  MOVEMENT_OVERAGE:   'movement:overage',

  // Phase 3 — Loot & Shop
  LOOT_INTEREST:  'loot:interest',
  LOOT_RESOLVED:  'loot:resolved',

  // Shop open / volume (DM-privileged)
  SHOP_OPEN:   'shop:open',
  SHOP_VOLUME: 'shop:volume',

  // Contest dice rolling (DM-privileged — hub rolls, master receives result)
  CONTEST_ROLL:   'contest:roll',
  CONTEST_RESULT: 'contest:result',

  // Combat actions
  WEAPON_ATTACK: 'weapon:attack',
};
