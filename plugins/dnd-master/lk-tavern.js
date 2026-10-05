// ⚠️ GENERATED FILE — DO NOT EDIT.
//
// Vendored from plugins/lk-tavern.js by scripts/vendor-shared.mjs.
// Edit that file and re-run the script; `--check` fails the deploy if this copy drifts.
//
// It is a copy because a mirror may only serve files from under this plugin's own
// directory, so importing '../lk-tavern.js' directly would make the plugin unmirrorable.

// lk-tavern.js — taverns and their games: the game list, what a DM can set, and the money and cheating maths.
//
// ⚠️ SOURCE; vendored into dnd-hub and dnd-master (scripts/vendor-shared.mjs).
//
// A TAVERN is a place the DM opens for everyone, like a shop: a name, a sound, a picture/video, and HOSTS: an NPC
// at a table who runs one GAME SETUP. A game setup is one of the GAME_TYPES with the DM's settings (stakes, prizes,
// how good the NPC is, cheating). Every number a game pays out comes from `settle`, run on the DM's Hub, never from
// what a player's screen claims it won.

/** The games a tavern can run. `mode`: 'npc' = one hero against the host; 'table' = everyone at the table at once. */
export const GAME_TYPES = [
  { id: 'rune-dice', name: 'Rune Dice', mode: 'table', stat: 'wis',
    pitch: 'Six carved dice, three rolls, and the old gods watching.',
    howTo: 'Roll six dice and keep what you like: axes and arrows strike, helms and shields block, hands steal favour. ' +
      'Spend favour on a god\'s boon before the clash. Bring your rival to zero.' },
  { id: 'dagger-toss', name: 'Dagger Toss', mode: 'npc', stat: 'dex',
    pitch: 'Three daggers each. Closest to the heart of the board takes the pot.',
    howTo: 'Your hand sways: wait for it to settle, set your power, and let go. Dexterity steadies the sway.' },
  { id: 'bones-grid', name: 'Bones Grid', mode: 'npc', stat: 'int',
    pitch: 'Two boards of nine. Match your bones, and smash theirs.',
    howTo: 'Place each die you roll in one of your three columns. Matching dice in a column multiply. Placing a die ' +
      'knocks the same number out of your rival\'s facing column. When a board fills, the higher total wins.' },
  { id: 'bluff-bones', name: 'Bluff Bones', mode: 'table', stat: 'wis',
    pitch: 'Everyone hides five dice under a cup. Then everyone lies.',
    howTo: 'Bid how many of a face are under ALL the cups, or call the last bid a lie. A wrong call costs a die. ' +
      'Insight lets you read a liar\'s tells.' },
  { id: 'hearthlane', name: 'Hearthlane', mode: 'npc', stat: 'int',
    pitch: 'A pocket war of cards across three lanes of the hearth.',
    howTo: 'Play cards into three lanes; each lane goes to the stronger side. Win two lanes to win the round.' },
  { id: 'twenty', name: 'Twenty', mode: 'npc', stat: 'int',
    pitch: 'Get to twenty without going over. Your side deck is your edge.',
    howTo: 'Each turn a card is dealt to you. Stand, or play one card from your own small deck to push or pull ' +
      'your total. Closest to twenty without busting takes the set.' },
  { id: 'arm-wrestle', name: 'Arm Wrestle', mode: 'npc', stat: 'str',
    pitch: 'Elbows on the table. Don\'t blink.',
    howTo: 'Press when the marker crosses the bright band to push. Miss and you give ground. Strength widens the band.' },
  { id: 'fillet', name: 'Five-Finger Fillet', mode: 'npc', stat: 'dex',
    pitch: 'A knife, a table, and five fingers you would like to keep.',
    howTo: 'Hit each gap between your fingers as the rhythm speeds up. A miss can cost you more than gold.' },
  { id: 'beetle-derby', name: 'Beetle Derby', mode: 'table', stat: 'wis',
    pitch: 'Six beetles, one chalk track, and odds on every shell.',
    howTo: 'Study the beetles, back one, and cheer. Longer odds pay more. Insight reads which beetle is keen today.' },
  { id: 'last-standing', name: 'Last One Standing', mode: 'table', stat: 'con',
    pitch: 'Round after round of the house\'s strongest. The last one upright drinks free.',
    howTo: 'Each round, keep your tankard steady while the room sways, then make a Constitution save. ' +
      'Fall, and you wake up poisoned.' },
];

/** The games that are built and playable; the rest show in the DM's list as coming soon. */
export const PLAYABLE = new Set(['bones-grid']);

export const gameType = id => GAME_TYPES.find(g => g.id === id) || null;

export const NPC_SKILLS = { novice: { label: 'Novice', bonus: 0 }, regular: { label: 'Regular', bonus: 2 }, shark: { label: 'Card shark', bonus: 5 } };
export const CAUGHT = { forfeit: 'Loses the stake', 'thrown-out': 'Loses the stake and is thrown out', brawl: 'Loses the stake and a brawl starts (the DM is told)' };
export const MAX_PAYOUT = 20; // no game pays more than 20× the stake, whatever it asks for

/** What every game setup has. Each game may add its own settings under `extra`. */
export const SETUP_DEFAULTS = {
  entryFee: 0,        // gp to sit down, kept by the house win or lose
  minBet: 1,          // gp
  maxBet: 25,         // gp
  payout: 2,          // a win returns the stake × this (2 = double your money)
  prizeItemId: null,  // an item from the Items tab, given with a win
  npcSkill: 'regular',
  statsHelp: true,    // the hero's ability (and skills) make the game easier
  cheating: true,     // a hero may try Sleight of Hand against the host
  caught: 'forfeit',
  playsPerVisit: 0,   // 0 = as many as they like, while the tavern is open
};

const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const str = (v, max) => String(v ?? '').trim().slice(0, max);

/** A game setup as it may be stored: known type, every setting in range. Unknown settings are dropped. */
export function cleanSetup(s = {}) {
  const d = SETUP_DEFAULTS;
  const minBet = int(s.minBet, 0, 100000, d.minBet);
  return {
    id: str(s.id, 40), type: gameType(s.type) ? s.type : GAME_TYPES[0].id,
    name: str(s.name, 60) || gameType(s.type)?.name || 'Game',
    entryFee: int(s.entryFee, 0, 100000, d.entryFee),
    minBet, maxBet: Math.max(minBet, int(s.maxBet, 0, 100000, d.maxBet)),
    payout: Math.min(MAX_PAYOUT, Math.max(1, Math.round((Number(s.payout) || d.payout) * 4) / 4)),
    prizeItemId: s.prizeItemId ? str(s.prizeItemId, 40) : null,
    npcSkill: NPC_SKILLS[s.npcSkill] ? s.npcSkill : d.npcSkill,
    statsHelp: s.statsHelp !== false, cheating: s.cheating !== false,
    caught: CAUGHT[s.caught] ? s.caught : d.caught,
    playsPerVisit: int(s.playsPerVisit, 0, 99, d.playsPerVisit),
    extra: s.extra && typeof s.extra === 'object' ? s.extra : {},
  };
}

/** A host: the NPC at a table. `actorId` points at one of the DM's NPCs (for stats and a picture) or is empty. */
export function cleanHost(h = {}) {
  return {
    id: str(h.id, 40), setupId: str(h.setupId, 40), actorId: h.actorId ? str(h.actorId, 40) : null,
    name: str(h.name, 40) || 'The dealer',
    greeting: str(h.greeting, 300),
    portraitFileId: h.portraitFileId ? str(h.portraitFileId, 80) : null,
  };
}

/** A tavern as it may be stored. Up to 8 hosts (tables). */
export function cleanTavern(t = {}) {
  return {
    id: str(t.id, 40), name: str(t.name, 60) || 'Tavern',
    soundFileId: t.soundFileId ? str(t.soundFileId, 80) : null,
    ambientVolume: Math.min(1, Math.max(0, Number(t.ambientVolume ?? 0.5) || 0)),
    videoFileId: t.videoFileId ? str(t.videoFileId, 80) : null, videoMime: str(t.videoMime, 60),
    hosts: (Array.isArray(t.hosts) ? t.hosts : []).slice(0, 8).map(cleanHost),
  };
}

/** Whether a stake may be played at this setup; null when it may, else why not (said to the player). */
export function stakeProblem(setup, stake, gold) {
  const s = cleanSetup(setup);
  if (!Number.isInteger(stake) || stake < s.minBet) return `The least you can bet here is ${s.minBet} gp.`;
  if (stake > s.maxBet) return `The house takes bets up to ${s.maxBet} gp.`;
  if (gold != null && gold < stake + s.entryFee) return `You need ${stake + s.entryFee} gp for that (you have ${gold}).`;
  return null;
}

/**
 * What a finished game pays a hero. `won`: true / false / 'draw'. `multiplier`: what the game asks for (a long-odds
 * beetle), else the setup's payout; never above MAX_PAYOUT. A caught cheat is paid nothing. The entry fee was spent
 * when they sat down. Returns { gold, itemId } — gold handed back (0 = lost the stake).
 */
export function settle(setup, { stake = 0, won = false, multiplier = null, caught = false } = {}) {
  const s = cleanSetup(setup);
  if (caught) return { gold: 0, itemId: null };
  if (won === 'draw') return { gold: stake, itemId: null };
  if (!won) return { gold: 0, itemId: null };
  const m = Math.min(MAX_PAYOUT, Math.max(1, Number(multiplier) || s.payout));
  return { gold: Math.floor(stake * m), itemId: s.prizeItemId };
}

/** The host's passive Perception: 10 + Wisdom modifier (from their NPC, if any) + their skill as a dealer. */
export function hostPerception(setup, actor) {
  const wis = Math.floor(((actor?.wis ?? 10) - 10) / 2);
  return 10 + wis + NPC_SKILLS[cleanSetup(setup).npcSkill].bonus;
}

/** A cheat attempt: d20 + Sleight of Hand against the host's passive Perception. Ties go to the host. */
export function cheatCheck(d20, sleight, perception) {
  const total = d20 + (sleight || 0);
  return { total, perception, caught: d20 !== 20 && (d20 === 1 || total <= perception) };
}

/** How much a hero's stat helps, as a number from -1 to 1 a game scales its own difficulty by (0 when stats are off). */
export function statEdge(setup, mod) {
  if (!cleanSetup(setup).statsHelp) return 0;
  return Math.max(-1, Math.min(1, (mod || 0) / 5));
}
