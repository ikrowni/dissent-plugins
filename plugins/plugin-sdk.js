// plugin-sdk.js — Dissent Plugin SDK boilerplate (shared by all plugins)
// Usage: import { request, storageGet, storageSet, realtimePublish, getIdentity, esc, genId } from './plugin-sdk.js';

const _pending = {};
let _msgId = 0;
let _identity = null;

export function request(action, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++_msgId;
    _pending[id] = { resolve, reject };
    parent.postMessage({ type: 'dissent:request', id, action, params }, '*');
    setTimeout(() => { if (_pending[id]) { delete _pending[id]; reject(new Error('timeout')); } }, 10000);
  });
}

// Like request() but transfers ArrayBuffers (zero-copy for large uploads).
export function requestWithTransfer(action, params, transfers, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const id = ++_msgId;
    _pending[id] = { resolve, reject };
    parent.postMessage({ type: 'dissent:request', id, action, params }, '*', transfers || []);
    setTimeout(() => { if (_pending[id]) { delete _pending[id]; reject(new Error('upload timeout')); } }, timeoutMs);
  });
}

// Call once in the bootstrap. onInit receives the full dissent:init message;
// onEvent receives dissent:event messages.
export function handleSDKMessage(e, onInit, onEvent) {
  if (e.data?.type === 'dissent:init') {
    if (e.data.user?.id) _identity = e.data.user; // pre-cache identity
    if (onInit) onInit(e.data);
    return;
  }
  if (e.data?.type === 'dissent:response') {
    const p = _pending[e.data.id];
    if (p) { delete _pending[e.data.id]; e.data.ok ? p.resolve(e.data.data) : p.reject(new Error(e.data.error)); }
    return;
  }
  if (e.data?.type === 'dissent:event' && onEvent) onEvent(e.data);
}

export async function storageGet(key, scope = 'server') {
  try { const r = await request('storage:get', { key, scope }); return r?.value ?? null; } catch { return null; }
}
export async function storageSet(key, value, scope = 'server') {
  try { return await request('storage:set', { key, value, scope }); } catch { return null; }
}
export async function storageGetUser(key) { return storageGet(key, 'user'); }
export async function storageSetUser(key, value) { return storageSet(key, value, 'user'); }

// Debounced write — coalesces rapid successive writes to the same key into one.
// Use for high-frequency writes (token moves, drag updates) to stay under rate limits.
const _debounceTimers = {};
export function debounceStorageSet(key, value, scope = 'server', delayMs = 350) {
  if (_debounceTimers[key]) clearTimeout(_debounceTimers[key]);
  _debounceTimers[key] = setTimeout(() => {
    delete _debounceTimers[key];
    request('storage:set', { key, value, scope }).catch(() => {});
  }, delayMs);
}

// Two-argument form: realtimePublish(eventName, dataObject)
export async function realtimePublish(eventName, data) {
  try { return await request('realtime:publish', { event: eventName, data }); } catch { return null; }
}

export async function getIdentity() {
  if (_identity) return _identity;
  try { const r = await request('identity:get', {}); _identity = r; return r; } catch { return null; }
}

export function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
export function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString() : 'never'; }
export function genId() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
}

export async function realtimePublishCompanion(registryId, eventName, data) {
  try { return await request('realtime:publish-companion', { registryId, event: eventName, data }); } catch { return null; }
}

// Relay an event to a sibling plugin in the same channel via the parent React frame,
// bypassing the server. Instant delivery with no rate-limit exposure.
export async function localPublish(registryId, eventName, data) {
  try { return await request('localRelay:publish', { registryId, event: eventName, data }); } catch { return null; }
}

/**
 * Opens an embedded media player overlay in the host frame, bypassing sandbox
 * restrictions. The overlay renders above the plugin with a visible source URL
 * header and a dismiss button.
 *
 * params.src          — full https:// URL to embed (any embeddable content)
 * params.twitchChannel — Twitch channel name (host constructs the correct embed URL)
 * params.title        — optional label shown in the overlay header
 *
 * Only https:// URLs are accepted. The source domain is always visible to the
 * user so they can see what they are viewing.
 */
export async function openMediaOverlay(params) {
  try { return await request('ui:media-overlay', params); } catch { return null; }
}

export async function storageGetCompanion(registryId, key, scope = 'server') {
  try { const r = await request('storage:get-companion', { registryId, key, scope }); return r?.value ?? null; } catch { return null; }
}
export async function storageSetCompanion(registryId, key, scope, value) {
  try { return await request('storage:set-companion', { registryId, key, scope: scope || 'server', value }); } catch { return null; }
}

/**
 * Connect the user's MetaMask wallet to Polymarket.
 * Returns { address, usdcBalance } or throws on error / user rejection.
 * Requires 'polymarket' permission.
 */
export async function polymarketConnect() {
  return request('polymarket:connect', {});
}

/**
 * Returns current wallet connection status without triggering a connect flow.
 * Returns { connected: bool, address: string|null, usdcBalance: string|null }.
 * Requires 'polymarket' permission.
 */
export async function polymarketStatus() {
  return request('polymarket:status', {});
}

/**
 * Opens the Polymarket bet modal for the given search query.
 * Searches for matching markets, lets the user pick + confirm, then places the order.
 * Returns { ok: true, orderId } or { ok: false, error }.
 * Requires 'polymarket' permission.
 *
 * @param {string} query - search string (e.g. "Pereira vs Ankalaev UFC 313")
 * @param {number} [suggestedAmount] - pre-fills the USDC amount input
 */
export async function polymarketBet(query, suggestedAmount) {
  return request('polymarket:bet', { query, suggestedAmount });
}
