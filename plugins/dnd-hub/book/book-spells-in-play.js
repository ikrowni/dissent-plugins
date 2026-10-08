// book-spells-in-play.js — the Hub's spell list (SRD.spells: Hero Forge, level-up) plus the open campaign's books.
// Always rebuilt from the SRD's own list, so one campaign's books never leak into another's.
import { request } from '../../plugin-sdk.js';
import { SRD } from '../dnd-hub-state.js?v=20261015p';
import { mergeContent, loadPlayerParts } from '../lk-book.js';

export async function useCampaignSpells(camp) {
  if (!SRD._baseSpells) SRD._baseSpells = SRD.spells || [];
  SRD.spells = SRD._baseSpells;
  if (!camp?.books?.length) return;
  const parts = await loadPlayerParts(camp, request);
  SRD.spells = mergeContent(SRD._baseSpells, parts, 'spells');
}
