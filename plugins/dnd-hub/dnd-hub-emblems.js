// dnd-hub-emblems.js — the Hero Forge's 21 emblems: gold line art, one style (spec 2026-10-03 hero forge §3).
// Drawn in code, so there is nothing to license. currentColor: the caller sets the colour (gold, or a race tint).

const P = {
  'race-dwarf': '<path d="M14 44 L26 24 L32 32 L38 22 L50 44 Z"/><path d="M22 50 h20 M26 50 v-4 h12 v4 M24 46 h16"/>',
  'race-elf': '<path d="M40 14 a16 16 0 1 0 0 30 a12 12 0 1 1 0 -30 Z"/><path d="M22 50 C28 40 36 38 44 36 C40 44 32 48 22 50 Z M26 47 L40 38"/>',
  'race-halfling': '<path d="M32 18 c-8 0 -12 6 -12 12 c0 10 6 16 12 16 c6 0 12 -6 12 -16 c0 -6 -4 -12 -12 -12 Z"/><path d="M20 26 h24 M32 18 v-4 M26 52 h12"/>',
  'race-human': '<circle cx="32" cy="34" r="12"/><path d="M32 16 v36 M14 34 h36 M24 26 l16 16 M40 26 l-16 16"/><path d="M24 14 l4 4 l4 -6 l4 6 l4 -4 v4 h-16 Z"/>',
  'race-dragonborn': '<path d="M18 40 C18 24 30 16 42 18 L48 14 L46 22 C50 28 48 38 40 42 L30 46 L34 40 L26 42 Z"/><circle cx="38" cy="26" r="1.5"/><path d="M22 48 c4 -2 8 -2 12 0 c4 2 8 2 12 0"/>',
  'race-gnome': '<circle cx="32" cy="32" r="10"/><path d="M32 16 v6 M32 42 v6 M16 32 h6 M42 32 h6 M21 21 l4 4 M39 39 l4 4 M43 21 l-4 4 M25 39 l-4 4"/><path d="M32 27 l4 5 l-4 5 l-4 -5 Z"/>',
  'race-half-elf': '<path d="M20 46 L44 18 M42 16 l4 4 M18 44 l4 4 M24 40 l4 4"/><path d="M22 22 C30 22 38 30 40 44 C30 42 22 34 22 22 Z"/>',
  'race-half-orc': '<path d="M20 18 h24 v14 c0 10 -6 16 -12 20 c-6 -4 -12 -10 -12 -20 Z"/><path d="M26 30 l-2 -6 M38 30 l2 -6"/><path d="M14 48 h6 m4 0 h6 m4 0 h6 m4 0 h6"/>',
  'race-tiefling': '<path d="M22 30 C18 22 18 16 22 12 C24 18 26 22 30 24 M42 30 C46 22 46 16 42 12 C40 18 38 22 34 24"/><path d="M32 50 C24 46 24 38 30 32 C30 38 34 38 34 34 C40 40 40 46 32 50 Z"/>',
  'class-barbarian': '<path d="M32 14 V52 M32 18 C22 18 18 26 20 34 C26 30 30 28 32 28 M32 18 C42 18 46 26 44 34 C38 30 34 28 32 28"/><path d="M26 52 c2 -6 6 -8 6 -12 c0 4 4 6 6 12"/>',
  'class-bard': '<path d="M22 40 a8 8 0 1 0 12 6 L46 18 l4 -2 l-2 4 Z"/><path d="M28 44 l14 -20 M40 22 l4 4"/><circle cx="26" cy="44" r="2"/>',
  'class-cleric': '<circle cx="32" cy="32" r="8"/><path d="M32 14 v8 M32 42 v8 M14 32 h8 M42 32 h8 M19 19 l6 6 M39 39 l6 6 M45 19 l-6 6 M25 39 l-6 6"/>',
  'class-druid': '<path d="M32 52 V30 M32 36 l-8 -6 M32 32 l8 -6"/><path d="M20 30 C14 24 18 14 26 16 C26 22 22 26 20 30 Z M44 30 C50 24 46 14 38 16 C38 22 42 26 44 30 Z"/><path d="M24 52 h16"/>',
  'class-fighter': '<path d="M22 14 h20 v14 c0 10 -4 16 -10 20 c-6 -4 -10 -10 -10 -20 Z"/><path d="M44 46 L20 22 M18 24 l4 -4 M40 48 l6 -6"/>',
  'class-monk': '<path d="M44 20 a16 16 0 1 0 2 18"/><path d="M28 46 V30 c0 -2 4 -2 4 0 v-6 c0 -2 4 -2 4 0 v8 c2 -2 6 -1 4 3 l-6 11 Z"/>',
  'class-paladin': '<path d="M32 12 V48 M26 40 h12 M30 48 h4 v4 h-4 Z"/><path d="M30 22 C22 18 16 20 14 26 C20 26 24 28 30 30 M34 22 C42 18 48 20 50 26 C44 26 40 28 34 30"/>',
  'class-ranger': '<path d="M20 14 C34 22 34 42 20 50"/><path d="M20 14 V50 M16 32 h30 M42 28 l6 4 l-6 4"/><path d="M38 52 l4 -8 l4 8 Z M44 52 l3 -6 l3 6 Z"/>',
  'class-rogue': '<path d="M32 12 L36 36 L32 40 L28 36 Z M24 40 h16 M32 40 v10"/><path d="M14 26 C20 22 26 22 30 26 M34 26 C38 22 44 22 50 26 M18 26 c2 4 8 4 10 0 M36 26 c2 4 8 4 10 0"/>',
  'class-sorcerer': '<path d="M14 32 C22 20 42 20 50 32 C42 44 22 44 14 32 Z"/><path d="M32 24 V40 M28 32 l4 -8 l4 8 l-4 8 Z"/>',
  'class-warlock': '<path d="M32 12 L50 42 H14 Z"/><path d="M22 34 C26 28 38 28 42 34 C38 40 26 40 22 34 Z"/><circle cx="32" cy="34" r="2.5"/>',
  'class-wizard': '<path d="M16 44 L32 48 L48 44 V30 L32 34 L16 30 Z M32 34 V48"/><path d="M32 12 l2 6 l6 0 l-5 4 l2 6 l-5 -4 l-5 4 l2 -6 l-5 -4 l6 0 Z"/>',
};

export const EMBLEM_IDS = Object.keys(P);

/** Inline SVG for an emblem id ('race-dwarf', 'class-wizard'), or '' for an unknown id. */
export function emblem(id, size = 64) {
  const body = P[id];
  if (!body) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="32" cy="32" r="30" opacity=".35"/>${body}</svg>`;
}
