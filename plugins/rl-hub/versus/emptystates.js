// versus/emptystates.js — what the screen says when there is no live match.
//
// Every state explains itself in plain language. None of them renders a zero: a grid of
// 0s presented as data is what made the old idle screen read as broken software.
//
// ⚠️ THERE IS NO COMPANION APP. The Dissent desktop client reads Rocket League's Stats API
// directly (TCP 49123). Legacy naming survives — the event is still `rl:companion:online`,
// the CSS is still `companion-*` — but no companion exists and copy must never imply one.
//
// ⚠️ MOST VIEWERS ARE SPECTATORS, NOT BROADCASTERS. Web and Android report desktop:false
// and cannot broadcast, but they CAN watch anyone else's match. Copy that tells them to
// install the desktop app is telling them to fix something that is not broken for them.
// The question this panel answers is "is anyone broadcasting here", not "do you have the
// desktop app" — that is what the Live Broadcast card in settings is for.

import { STATES } from './screenstate.js';

const COPY = {
  [STATES.NO_BROADCAST]: {
    icon: '📡',
    title: 'No live match',
    body: 'Nobody is broadcasting to this channel right now. You can watch anyone’s match from any device — to share your own, open Live Broadcast in the hub settings.',
  },
  [STATES.GAME_CLOSED]: {
    icon: '🎮',
    title: 'Waiting for Rocket League',
    body: 'Broadcasting is on. Start a match and it will appear here. If nothing shows once you are in a game, check that PacketSendRate is above 0 in DefaultStatsAPI.ini and restart Rocket League — it only reads that file at launch.',
  },
  [STATES.PRE_MATCH]: {
    icon: '⏳',
    title: 'Match starting',
    body: 'Receiving match data. Waiting for players to load in.',
  },
  [STATES.STALE]: {
    icon: '⚠',
    title: 'Feed interrupted',
    body: 'No match data received for a while. The broadcaster may have closed Rocket League, stopped broadcasting, or lost connection.',
  },
};

export function emptyState(state) {
  const c = COPY[state];
  if (!c) return '';
  return `<div class="vsb-empty">
    <div class="vsb-empty-icon">${c.icon}</div>
    <div class="vsb-empty-title">${c.title}</div>
    <div class="vsb-empty-body">${c.body}</div>
  </div>`;
}

export function hasEmptyState(state) {
  return Object.prototype.hasOwnProperty.call(COPY, state);
}
