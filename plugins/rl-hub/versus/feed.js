// versus/feed.js — match ticker and demolition feed rendering.

import { esc } from '../../plugin-sdk.js';
import { tickerEvents, demoFeed } from './state.js';

export function updateTicker() {
  const el = document.getElementById('vsb-ticker');
  if (!el) return;
  if (tickerEvents().length === 0) {
    el.innerHTML = '<div class="vsb-demo-empty">No events yet</div>';
    return;
  }
  el.innerHTML = tickerEvents().map(e => {
    const icon = _tickerIcon(e.event_name);
    return `<div class="vsb-tick-row ${e.team}">
      <span class="vsb-tick-ico">${icon}</span>
      <span class="vsb-tick-name">${esc(e.player_name)}</span>
      <span class="vsb-tick-evt">${esc(e.event_name)}</span>
    </div>`;
  }).join('');
}

export function updateDemoFeed() {
  const el = document.getElementById('vsb-demo-feed');
  if (!el) return;
  el.innerHTML = demoFeed().map(d =>
    `<div class="vsb-demo-row">
      <span class="vsb-demo-name ${d.attacker_team}">${esc(d.attacker)}</span>
      <span class="vsb-demo-arrow">💥</span>
      <span class="vsb-demo-name ${d.victim_team}">${esc(d.victim)}</span>
    </div>`
  ).join('') || `<div class="vsb-demo-empty">No demos yet</div>`;
}

function _tickerIcon(eventName) {
  const map = {
    'Goal': '⚽', 'Aerial Goal': '🚀', 'Bicycle Kick Goal': '🚲',
    'Save': '🛡', 'Epic Save': '🦅', 'Demolition': '💥', 'Demolish': '💥', 'Assist': '🤝',
  };
  return map[eventName] ?? '📊';
}
