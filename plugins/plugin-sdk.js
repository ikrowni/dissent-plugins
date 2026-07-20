// plugin-sdk.js — Dissent Plugin SDK boilerplate (shared by all plugins)
// Usage: import { request, storageGet, storageSet, realtimePublish, getIdentity, esc, genId } from './plugin-sdk.js';

const _pending = {};
let _msgId = 0;
let _identity = null;
let _initContext = null;

// Init context from dissent:init (serverId, channelId, coreUrl, installId, hostHostname…).
export function getInitContext() { return _initContext; }

// Interactive capabilities (wallet signatures, native confirms) block on a human
// clicking a host modal — pass a generous timeoutMs (e.g. INTERACTIVE_TIMEOUT_MS).
export const INTERACTIVE_TIMEOUT_MS = 120000;

export function request(action, params = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const id = ++_msgId;
    _pending[id] = { resolve, reject };
    parent.postMessage({ type: 'dissent:request', id, action, params }, '*');
    setTimeout(() => { if (_pending[id]) { delete _pending[id]; reject(new Error('timeout')); } }, timeoutMs);
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
    if (e.data.context) _initContext = e.data.context;
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
 * restrictions. The overlay renders above the plugin with a visible source-domain
 * header and a dismiss button. Requires the 'media:embed' permission.
 *
 * url   — full https:// URL to embed (build it yourself; use getInitContext().hostHostname
 *         for embeds that need a parent= hostname, e.g. Twitch)
 * title — optional label shown in the overlay header (defaults to the URL's hostname)
 */
export async function mediaEmbed(url, title) {
  try { return await request('media.embed', { url, title }); } catch { return null; }
}

/** Adjust the local playback volume of a voice participant. Requires 'voice' permission. */
export async function voiceSetGain(userId, gain) {
  return request('voice.setGain', { userId, gain });
}

/** ⚠ T3: copy the user's login token to their clipboard (host confirms first). Requires 'identity:native'. */
export async function identityExportToken() {
  return request('identity.exportToken', {}, INTERACTIVE_TIMEOUT_MS);
}

/**
 * ⚠ T3: mint a companion token and show the user your install command with
 * {{API_BASE}} {{APP_ORIGIN}} {{TOKEN}} {{SERVER_ID}} {{CHANNEL_ID}} substituted.
 * Requires 'identity:native'.
 */
export async function companionInstall(template, channelId) {
  return request('companion.install', { template, channelId }, INTERACTIVE_TIMEOUT_MS);
}

/** Device-local KV (never leaves this browser). Requires 'storage:local' permission. */
export async function storageLocalGet(key) {
  try { const r = await request('storage:localGet', { key }); return r?.value ?? null; } catch { return null; }
}
export async function storageLocalSet(key, value) {
  return request('storage:localSet', { key, value });
}
export async function storageLocalDelete(key) {
  return request('storage:localDelete', { key });
}

export async function storageGetCompanion(registryId, key, scope = 'server') {
  try { const r = await request('storage:get-companion', { registryId, key, scope }); return r?.value ?? null; } catch { return null; }
}
export async function storageSetCompanion(registryId, key, scope, value) {
  try { return await request('storage:set-companion', { registryId, key, scope: scope || 'server', value }); } catch { return null; }
}


