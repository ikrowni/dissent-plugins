// lk-guides.js — guides for new players (and DMs): one short tip the first time something happens.
// ⚠️ SOURCE; vendored into dnd-hub and dnd-player (scripts/vendor-shared.mjs). Pure; lk-guide-ui.js draws them.
//
// Owner, 2026-10-04: "Guides helping new players that can be toggled on/off." Per person, not per table (the DM's
// Table rules are for the whole table): stored in the user's own dnd-hub data, key 'guides' = { on, seen: [ids] }.
// Each tip shows once; turning guides back on starts them over.

export const GUIDES_KEY = 'guides';

// surface: where the tip appears (the Hub's map, or the player's sheet). anchor: what it points at (a selector),
// or none. Words: plain, short, no rules jargon a newcomer would not know.
export const TIPS = {
  'player:table': { surface: 'hub', anchor: null, title: 'Welcome to the table',
    text: 'This map is shared by everyone. Your token has your colour ring: drag it, or use the arrow keys, to move. Your character sheet is in the panel on the right.' },
  'player:fight': { surface: 'hub', anchor: '#initiative-hud', title: 'A fight has started',
    text: 'Everyone takes turns, in the order along the top. Wait for yours: then you can move up to your speed and do one thing, like attack or cast a spell.' },
  'player:turn': { surface: 'hub', anchor: null, title: 'Your turn',
    text: 'Move first if you like: the path shows how far you can go. Then attack or cast from the Combat tab of your sheet. When you are done, the DM moves on.' },
  'player:handout': { surface: 'hub', anchor: null, title: 'The DM shared a page',
    text: 'You can read it again any time: it is in the Party journal on your sheet.' },
  'sheet:open': { surface: 'sheet', anchor: '.hp-bar-wrap', title: 'Your character sheet',
    text: 'Hit points are at the top: when they reach 0 you fall. Click an ability or a skill to roll for it. Spells and gear have their own tabs.' },
  'sheet:spells': { surface: 'sheet', anchor: null, title: 'Your spells',
    text: 'Cantrips can be cast as often as you like. Other spells use a spell slot of their level; slots come back after a long rest.' },
  'sheet:down': { surface: 'sheet', anchor: '#death-saves-section', title: 'You have fallen',
    text: 'At 0 hit points you are unconscious. Each turn, press Roll death save: three successes and you are stable, three failures and you die. Any healing gets you back up.' },
  'sheet:levelup': { surface: 'sheet', anchor: null, title: 'You can level up',
    text: 'Your DM says you have grown stronger. Press Level up: it walks you through each new choice.' },
  'dm:table': { surface: 'hub', anchor: '#map-toolbar', title: 'You are the DM',
    text: 'Set the scene from this toolbar: a map, walls and doors, then fog. Your tools for monsters, loot and sound are in the DM panel on the right.' },
  'dm:book': { surface: 'hub', anchor: '#book-panel', title: 'Your book',
    text: 'Read ahead here. Share a section and your players get it in their journal; monsters go straight into your encounter.' },
};

export const guidesDefault = () => ({ on: true, seen: [] });
const norm = g => ({ on: g?.on !== false, seen: Array.isArray(g?.seen) ? g.seen : [] });

/** The tip to show for `trigger` now, or null (guides off, already seen, unknown). */
export function tipFor(trigger, guides) {
  const g = norm(guides);
  const t = TIPS[trigger];
  if (!t || !g.on || g.seen.includes(trigger)) return null;
  return { id: trigger, ...t };
}

export function markSeen(guides, id) {
  const g = norm(guides);
  return g.seen.includes(id) ? g : { on: g.on, seen: [...g.seen, id] };
}
