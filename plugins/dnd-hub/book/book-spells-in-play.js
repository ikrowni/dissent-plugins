// book-spells-in-play.js — the Hub's spell list (SRD.spells: Hero Forge, level-up): the SRD spells of the rules in play
// (2014 = SRD 5.1, 2024 = SRD 5.2.1; Table rules → Rules, or the hero's own rules when levelling) plus the open
// campaign's books. Always rebuilt from those two, so one campaign's books never leak into another's, and a change of
// rules keeps the books' spells.
import { request } from '../../plugin-sdk.js';
import { SRD } from '../dnd-hub-state.js?v=20261015w';
import { mergeContent, loadPlayerParts } from '../lk-book.js';

let _edition = '2014', _parts = [];
const apply = () => {
  if (!SRD._spells2014) SRD._spells2014 = SRD.spells || [];
  const base = _edition === '2024' ? (SRD['spells-2024'] || []) : SRD._spells2014;
  SRD.spells = _parts.length ? mergeContent(base, _parts, 'spells') : base;
};

/** The rules whose SRD spells are offered: '2014' or '2024'. */
export function useSpellEdition(edition) { _edition = edition === '2024' ? '2024' : '2014'; apply(); }

export async function useCampaignSpells(camp) {
  _parts = [];
  apply();
  if (!camp?.books?.length) return;
  _parts = await loadPlayerParts(camp, request);
  apply();
}
