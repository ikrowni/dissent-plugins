// core/host.js — everything that talks to Dissent. Views never call the SDK directly.

import { handleSDKMessage, request, storageGetUser, storageSetUser } from '../../plugin-sdk.js';

const THEME = { '--background': '--bg', '--foreground': '--text', '--primary': '--accent' };

export function connect({ onInit, onEvent }) {
  window.addEventListener('message', (e) => handleSDKMessage(e, (msg) => {
    // The host sends HSL component triples for these (shadcn tokens), e.g. "240 10% 4%".
    for (const [from, to] of Object.entries(THEME)) {
      const v = msg.theme?.[from];
      if (v) document.documentElement.style.setProperty(to, /^\d/.test(v) ? `hsl(${v})` : v);
    }
    onInit?.(msg);
  }, onEvent));
}

export const store = {
  get: (key) => storageGetUser(key),
  set: (key, value) => storageSetUser(key, value),
};

/** Every answer is data with a `status` (spec §5.3 of the platform spec). Never throws. */
export async function saves(action, params = {}) {
  try {
    return await request(`game.saves.${action}`, { game: 'slay-the-spire-2', ...params });
  } catch (e) {
    return { status: 'error', error: String(e?.message ?? e) };
  }
}
