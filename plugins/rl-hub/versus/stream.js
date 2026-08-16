// versus/stream.js — the Twitch card and the click-through to a real embed.

import { esc, mediaEmbed, getInitContext } from '../../plugin-sdk.js';

let _twitchUsername = '';

export function setTwitchStreamer(username) {
  _twitchUsername = username ?? '';
}

export function twitchCard() {
  if (!_twitchUsername) {
    return `<div class="vsb-twitch-card vsb-twitch-idle">
      <span class="vsb-twitch-ico">📺</span>
      <span class="vsb-twitch-hint">Add your Twitch username in ⚙️ settings to enable the stream viewer</span>
    </div>`;
  }
  const safeUser = esc(_twitchUsername);
  return `<div class="vsb-heatmap-card vsb-twitch-outer" onclick="watchTwitch('${safeUser}')" role="button" title="Watch ${safeUser} on Twitch">
    <div class="vsb-twitch-screen">
      <div class="vsb-twitch-screen-center">
        <div class="vsb-twitch-playbtn">&#9654;</div>
      </div>
      <div class="vsb-twitch-bar">
        <span class="vsb-twitch-bar-icon">&#9654;</span>
        <span class="vsb-twitch-bar-icon">&#128266;</span>
        <div class="vsb-twitch-scrubber">
          <div class="vsb-twitch-track"></div>
          <div class="vsb-twitch-dot"></div>
        </div>
        <span class="vsb-twitch-bar-icon">&#x26F6;</span>
      </div>
    </div>
  </div>`;
}

// MUST stay a global: the card above calls it from an inline onclick attribute, which
// resolves against window and cannot see module scope.
window.watchTwitch = (username) => {
  // parent= must be the raw hostname of the embedding app (Twitch requirement).
  const parent = getInitContext()?.hostHostname || 'app.dissent.chat';
  mediaEmbed(
    `https://player.twitch.tv/?channel=${encodeURIComponent(username)}&parent=${parent}&muted=false&autoplay=true`,
    `${username} on Twitch`,
  );
};
