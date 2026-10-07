// dnd-master-games.js — the Games tab: the tavern games, and the DM's setups of them (stakes, prizes, cheating).
//
// A setup is one game with the DM's settings; an NPC runs one setup (Actors tab, dnd-master-actors.js). The
// settings are cleaned by lk-tavern.js cleanSetup on every change, and the DM's Hub cleans them again before it pays.
import { esc, genId } from '../plugin-sdk.js';
import { saveHubDmCompanion } from './dnd-hub-shared-storage.js';
import { persistDmCatalog } from './dnd-master-shops.js?v=20261015a';
import { publishNpcTalk } from './dnd-master-actor-talk.js?v=20261015a';
import { GAME_TYPES, PLAYABLE, NPC_SKILLS, CAUGHT, gameType, cleanSetup } from './lk-tavern.js';

let _state = null;
const _saveTimers = {};

export function setGamesState(s) { _state = s; }

/** The game setups as this tab holds them (read only, for the playtests). */
export const currentGameSetups = () => Object.values(_state?.dmCampaign?.gameSetups || {});

const modeBadge = g => g.mode === 'table'
  ? '<span class="lk-badge gold" title="Every hero at the table plays at once, with the house">Whole table</span>'
  : '<span class="lk-badge" title="One hero against the host">vs the host</span>';

const STAT = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

export function renderGamesTab() {
  const el = document.getElementById('tab-games');
  if (!el || !_state?.dmCampaign) return;
  const setups = currentGameSetups();
  const items = Object.values(_state.dmCampaign.items || {});
  el.innerHTML =
    '<div class="lk-sec">YOUR GAME SETUPS</div>' +
    (setups.length ? setups.map(s => setupCard(cleanSetup(s), items)).join('')
      : '<div class="lk-empty">Set up a game below, then give it to an NPC in the Actors tab.</div>') +
    '<div class="lk-sec" style="margin-top:12px">TAVERN GAMES</div>' +
    GAME_TYPES.map(g => {
      const ready = PLAYABLE.has(g.id);
      return '<div class="game-type' + (ready ? '' : ' soon') + '">' +
        '<h4><span style="flex:1">' + esc(g.name) + '</span>' + modeBadge(g) +
          (ready ? '<button class="btn btn-gold" style="font-size:10px;padding:2px 8px" data-act="new" data-type="' + g.id + '">+ Set up</button>'
            : '<span class="lk-badge">Coming soon</span>') + '</h4>' +
        '<p>' + esc(g.pitch) + ' <i>' + STAT[g.stat] + ' helps.</i></p></div>';
    }).join('');
  el.onclick = onClick;
  el.onchange = onChange;
}

function setupCard(s, items) {
  const g = gameType(s.type);
  const num = (k, label, title, step = 1) => '<div class="lk-row"><span class="lk-lbl" title="' + title + '">' + label + '</span>' +
    '<input type="number" min="0" step="' + step + '" value="' + s[k] + '" data-k="' + k + '" data-id="' + s.id + '" title="' + title + '"></div>';
  const sel = (k, label, opts) => '<div class="lk-row"><span class="lk-lbl">' + label + '</span><select data-k="' + k + '" data-id="' + s.id + '">' +
    opts.map(([v, t]) => '<option value="' + esc(v) + '"' + (String(s[k] ?? '') === v ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select></div>';
  const check = (k, label, title) => '<label class="lk-row" style="font-size:11px;cursor:pointer" title="' + title + '">' +
    '<input type="checkbox" data-k="' + k + '" data-id="' + s.id + '"' + (s[k] ? ' checked' : '') + '> ' + label + '</label>';
  return '<div class="setup-card" data-setup="' + s.id + '">' +
    '<div class="lk-row"><input type="text" value="' + esc(s.name) + '" data-k="name" data-id="' + s.id + '" style="font-weight:700">' +
      '<span class="lk-badge">' + esc(g?.name || s.type) + '</span>' +
      '<button class="icon-x" data-act="del" data-id="' + s.id + '" title="Delete this setup">&#x1F5D1;</button></div>' +
    num('entryFee', 'Entry fee', 'Gold to sit down, kept by the house win or lose') +
    '<div class="lk-row"><span class="lk-lbl">Bets (gp)</span>' +
      '<input type="number" min="0" value="' + s.minBet + '" data-k="minBet" data-id="' + s.id + '" title="Least bet"> to ' +
      '<input type="number" min="0" value="' + s.maxBet + '" data-k="maxBet" data-id="' + s.id + '" title="Biggest bet"></div>' +
    (s.type === 'beetle-derby' ? '<div class="lk-row" style="font-size:10px;color:var(--muted)">Each beetle pays its own odds (2× to 9×).</div>'
      : num('payout', 'Win pays ×', 'A win hands back the bet times this: 2 doubles their money', 0.25)) +
    sel('prizeItemId', 'Prize', [['', 'No item'], ...items.map(i => [i.id, i.name])]) +
    sel('npcSkill', 'Host is a', Object.entries(NPC_SKILLS).map(([k, v]) => [k, v.label])) +
    check('statsHelp', 'The hero\'s ' + (STAT[g?.stat] || 'stats') + ' helps', 'Better stats make the game easier') +
    check('cheating', 'Heroes may try to cheat (Sleight of Hand vs the host\'s Perception)', 'A caught cheat loses the bet') +
    (s.cheating ? sel('caught', 'Caught cheat', Object.entries(CAUGHT)) : '') +
    num('playsPerVisit', 'Plays a visit', 'How many games a hero may play each time the tavern opens; 0 = no limit') +
  '</div>';
}

async function save() {
  _state.serverData.campaigns[_state.dmCampaignId].gameSetups = _state.dmCampaign.gameSetups;
  await saveHubDmCompanion(_state.serverData);
  await persistDmCatalog();
  await publishNpcTalk(); // the Hubs pay from the setup they were sent
}

async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const setups = (_state.dmCampaign.gameSetups ||= {});
  if (b.dataset.act === 'new') {
    const s = cleanSetup({ id: genId(), type: b.dataset.type });
    setups[s.id] = s;
  } else if (b.dataset.act === 'del') {
    const used = Object.values(_state.dmCampaign.customActors || {}).filter(a => a.setupId === b.dataset.id);
    if (!confirm(used.length ? `${used.map(a => a.name).join(', ')} run${used.length === 1 ? 's' : ''} this game. Delete it anyway? They will just talk.` : 'Delete this game setup?')) return;
    used.forEach(a => { a.setupId = ''; });
    delete setups[b.dataset.id];
  } else return;
  renderGamesTab(); // drawn first, saved after (see dnd-master-taverns.js)
  if (b.dataset.act === 'del') _state.serverData.campaigns[_state.dmCampaignId].customActors = _state.dmCampaign.customActors;
  await save();
}

function onChange(e) {
  const { k, id } = e.target.dataset;
  const s = _state.dmCampaign.gameSetups?.[id];
  if (!k || !s) return;
  const v = e.target.type === 'checkbox' ? e.target.checked
    : e.target.type === 'number' ? Number(e.target.value) : e.target.value || null;
  _state.dmCampaign.gameSetups[id] = cleanSetup({ ...s, [k]: v });
  clearTimeout(_saveTimers[id]);
  _saveTimers[id] = setTimeout(save, 300);
  if (k === 'cheating' || k === 'minBet') renderGamesTab(); // the caught-cheat choice comes and goes; bets re-clamp
}
