// dnd-master-sections.js — the DM panel's five sections. Was 15 tiny tabs in one row that ran off the
// edge of the sidebar; grouped by what a DM is doing: running the fight, preparing foes, the world, loot,
// sound. Table rules live behind the gear in the header.

export const ALL_TABS = ['encounter','initiative','monsters','maps','actors','items','shops','scenes','journals',
  'sounds','triggers','notes','logs','settings','players'];

export const SECTIONS = [
  { id: 'run',   label: 'Run',   icon: 'play',      tabs: ['initiative', 'players', 'logs'] },
  { id: 'foes',  label: 'Foes',  icon: 'skull',     tabs: ['encounter', 'monsters', 'actors', 'triggers'] },
  { id: 'world', label: 'World', icon: 'globe',     tabs: ['maps', 'scenes', 'journals', 'notes'] },
  { id: 'loot',  label: 'Loot',  icon: 'coins',     tabs: ['items', 'shops'] },
  { id: 'sound', label: 'Sound', icon: 'music',     tabs: ['sounds'] },
];

export const TAB_LABELS = {
  initiative: 'Initiative', players: 'Players', logs: 'Log',
  encounter: 'Encounter', monsters: 'Monsters', actors: 'NPCs', triggers: 'Traps',
  maps: 'Maps', scenes: 'Scenes', journals: 'Journals', notes: 'Notes',
  items: 'Items', shops: 'Shops', sounds: 'Sounds', settings: 'Table rules',
};

export function sectionOf(tab) {
  return SECTIONS.find(s => s.tabs.includes(tab))?.id ?? null;
}
