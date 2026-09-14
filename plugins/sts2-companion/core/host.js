// core/host.js — everything that talks to Dissent. Views never call the SDK directly.

import { handleSDKMessage, request, storageGetUser, storageSetUser, storageDelete, storageLocalGet, storageLocalSet, storageLocalDelete, netFetch } from '../../plugin-sdk.js';

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
  del: (key) => storageDelete(key, 'user'),
};

/** Device-local, never leaves this computer (storage:local). Used for caches, not for anything to keep. */
export const local = {
  get: (key) => storageLocalGet(key),
  set: (key, value) => storageLocalSet(key, value),
  del: (key) => storageLocalDelete(key),
};

/** net:direct — HTTPS from this computer to the stats service only (the one domain the manifest declares).
 *  Desktop only; rejects when not granted, on the web, or offline. */
export const net = (url, opts) => netFetch(url, opts);

/** overlay.context — { game, surface, width, height, panelOpen }, or null outside the overlay or if refused. */
export async function overlayContext() {
  try {
    return await request('overlay.context', {});
  } catch {
    return null;
  }
}

/** Every answer is data with a `status` (spec §5.3 of the platform spec). Never throws. */
export async function saves(action, params = {}) {
  try {
    return await request(`game.saves.${action}`, { game: 'slay-the-spire-2', ...params });
  } catch (e) {
    return { status: 'error', error: String(e?.message ?? e) };
  }
}
