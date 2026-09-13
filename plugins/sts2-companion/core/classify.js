// core/classify.js — what kind of build a finished deck is. One module, so the plugin and (later)
// the stats service label decks identically (community stats spec §6.2).
//
// 🔴 Themes are the game's own terms. Cards carry no tags, so a theme is a set of [gold] terms and
// keywords from card text, chosen from counts measured on the bundled data (plan 2026-09-13).
// Terms every character shares — Block, Hand, the piles — say nothing about a build and are left out.

import { saveIdToDataId } from './data.js';

export const THEMES = {
  ironclad: { Strength: ['Strength'], Vulnerable: ['Vulnerable'], Exhaust: ['Exhaust', 'Exhausted', 'Exhaust Pile'] },
  silent: { Poison: ['Poison'], Shivs: ['Shiv', 'Shivs'], Weak: ['Weak'] },
  defect: { Orbs: ['Channel', 'Channeled', 'Evoke', 'Lightning', 'Frost', 'Dark', 'Plasma', 'Glass'], Focus: ['Focus'] },
  necrobinder: { Osty: ['Osty', "Osty's", 'Summon'], Doom: ['Doom'], Souls: ['Soul', 'Souls'] },
  regent: { Forge: ['Forge', 'Forges', 'Sovereign Blade'], Strength: ['Strength'] },
};

/** A theme needs this many cards AND this share of the counted cards. */
export const MIN_THEME_CARDS = 3;
export const MIN_THEME_SHARE = 0.25;

const GOLD = /\[gold\]([^[]+)\[\/gold\]/g;

export function cardTerms(card) {
  const gold = [...String(card?.description ?? '').matchAll(GOLD)].map((m) => m[1].trim());
  return new Set([...gold, ...(card?.keywords ?? [])]);
}

export const colorOf = (character) => saveIdToDataId(String(character ?? '')).id.toLowerCase();

/**
 * `{ counted, counts, tags }` for a deck of `{ id: 'CARD.X' }`. Counted cards are the character's own
 * non-Basic cards: starters say nothing about a build, and colourless or event cards belong to anyone.
 * Up to two tags, strongest share first, ties by name. No tag means Mixed.
 */
export async function classifyDeck(deck, character, data) {
  const color = colorOf(character);
  const themes = THEMES[color] ?? {};
  const counted = [];
  for (const entry of deck ?? []) {
    const { kind, id } = saveIdToDataId(String(entry?.id ?? ''));
    if (kind !== 'card') continue;
    const card = await data.get('card', id);
    if (card.unknown || card.rarity === 'Basic' || card.color !== color) continue;
    counted.push(card);
  }
  const counts = {};
  for (const card of counted) {
    const terms = cardTerms(card);
    for (const [tag, words] of Object.entries(themes)) {
      if (words.some((w) => terms.has(w))) counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  const tags = Object.entries(counts)
    .map(([tag, n]) => ({ tag, n, share: n / counted.length }))
    .filter((t) => t.n >= MIN_THEME_CARDS && t.share >= MIN_THEME_SHARE)
    .sort((a, b) => b.share - a.share || a.tag.localeCompare(b.tag))
    .slice(0, 2)
    .map((t) => t.tag);
  return { counted: counted.length, counts, tags };
}

export const buildTypeLabel = (tags) => (tags?.length ? tags.join(' + ') : 'Mixed');
