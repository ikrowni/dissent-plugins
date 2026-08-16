// versus/emptystates.js — what the screen says when there is no live match.
//
// Every state explains itself in plain language. None of them renders a zero: a grid of
// 0s presented as data is what made the old idle screen read as broken software.

import { STATES } from './screenstate.js';

const COPY = {
  [STATES.NO_CLIENT]: {
    icon: '🖥',
    title: 'Desktop app required',
    body: 'Live match telemetry is captured by the Dissent desktop app. Open it on the machine running Rocket League and it will broadcast to this channel.',
  },
  [STATES.GAME_CLOSED]: {
    icon: '🎮',
    title: 'Waiting for Rocket League',
    body: 'The desktop app is connected. Start a match and it will appear here.',
  },
  [STATES.PRE_MATCH]: {
    icon: '⏳',
    title: 'Match starting',
    body: 'Connected and waiting for players to load in.',
  },
  [STATES.STALE]: {
    icon: '📡',
    title: 'Feed interrupted',
    body: 'No telemetry received for a while. The broadcaster may have closed the game or lost connection.',
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
