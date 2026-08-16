// rl-hub-main.js — init, storage, cache orchestration, fetch queue
import { handleSDKMessage, storageGet, storageSet, storageGetUser, storageSetUser, realtimePublishCompanion } from '../plugin-sdk.js';
import { scrapeRLStats } from './rl-scraper.js';
import { showRegisterScreen, initRegisterForm } from './rl-hub-register.js';
import {
  initVersus, showVersus, refreshVersus, addFeedEvent,
  addBallHit, setOnHideCallback, resetMatchState, setTwitchStreamer, setClientOnline,
} from './rl-hub-versus.js?v=15';
import {
  addGoalEvent, showCrossbarAlert, setPaused, resetOverlayState,
} from './rl-hub-versus-overlay.js';

// ── Shared constants ────────────────────────────────────────────────────────

export const MODES = [
  { id: 11, name: 'Ranked Duel',     short: '1v1',   slots: 1    },
  { id: 12, name: 'Ranked Doubles',  short: '2v2',   slots: 2    },
  { id: 13, name: 'Ranked Standard', short: '3v3',   slots: 3    },
  { id: 34, name: 'Tournaments',     short: 'Tourn', slots: null }, // dynamic — uses actual player count
  { id: 27, name: 'Hoops',           short: 'Hoops', slots: 2    },
  { id: 28, name: 'Rumble',          short: 'Rumble',slots: 3    },
  { id: 29, name: 'Dropshot',        short: 'Drop',  slots: 3    },
  { id: 30, name: 'Snow Day',        short: 'Snow',  slots: 3    },
];

export const PLATFORMS = {
  epic: 'Epic', steam: 'Steam', psn: 'PlayStation', xbl: 'Xbox', switch: 'Switch',
};

export const SK = {
  MEMBERS:    'rl:members',
  MY_ACCOUNT: 'rl:my-account',
  TOURNAMENT: 'rl:tournament',
  stats: (platform, username) =>
    `rl:stats:${platform}:${String(username).toLowerCase().replace(/\s+/g, '_')}`,
};

const CACHE_TTL_MS  = 60 * 60 * 1000; // 1 hour — ranked stats change infrequently
const FETCH_DELAY_MS = 500;

// ── Module state ─────────────────────────────────────────────────────────────

let _config = {};
let _members = [];         // Array<{ dissentUserId, displayName, platform, rlUsername, epicFriendName }>
let _statsCache = {};      // { [cacheKey]: { fetchedAt, data } }
let _myUserId  = null;
let _myTwitchUsername = '';
let _channelId = null;
let _serverId  = null;
let _displayName = 'Unknown';

export function getConfig()     { return _config; }
export function getMembers()    { return _members; }
export function getStatsCache() { return _statsCache; }
export function getMyUserId()   { return _myUserId; }
export function getChannelId()  { return _channelId; }
let _liveGames = {};  // { [dissentUserId]: { gameState, receivedAt } }
export function getLiveGames() { return _liveGames; }

const LIVE_STALENESS_MS = 15_000;
const LIVE_WARN_MS      = 8_000;

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const uid of Object.keys(_liveGames)) {
    if (now - _liveGames[uid].receivedAt > LIVE_STALENESS_MS) {
      delete _liveGames[uid];
      changed = true;
      // Notify sidebar so it removes the live badge without needing a refresh
      realtimePublishCompanion('rl-sidebar', 'rl:live:end', { sender_id: uid });
    }
  }
  if (changed) _refreshVersus();
}, 5_000);

function _refreshVersus() {
  refreshVersus(_liveGames);
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

export function isFresh(entry) {
  if (!entry?.fetchedAt) return false;
  return Date.now() - new Date(entry.fetchedAt).getTime() < CACHE_TTL_MS;
}

export function getCached(platform, rlUsername) {
  return _statsCache[SK.stats(platform, rlUsername)] ?? null;
}

function setCached(platform, rlUsername, data) {
  const key = SK.stats(platform, rlUsername);
  _statsCache[key] = { fetchedAt: new Date().toISOString(), data };
}

// ── rlstats.net fetch queue ───────────────────────────────────────────────────

async function drainFetchQueue(staleMembers) {
  for (const member of staleMembers) {
    try {
      const profile    = await scrapeRLStats(member.platform, member.rlUsername);
      const cacheEntry = { fetchedAt: new Date().toISOString(), data: profile };
      setCached(member.platform, member.rlUsername, profile);
      await storageSet(SK.stats(member.platform, member.rlUsername), cacheEntry);
    } catch (err) {
      console.warn('[rl-hub] fetch failed for', member.rlUsername, err.message);
    }
    await new Promise(r => setTimeout(r, FETCH_DELAY_MS));
  }
}

// ── Member registration ───────────────────────────────────────────────────────

export async function registerMember({ platform, rlUsername, epicFriendName, twitchUsername = '' }) {
  await storageSetUser(SK.MY_ACCOUNT, { platform, rlUsername, epicFriendName, twitchUsername });
  _myTwitchUsername = twitchUsername;

  const members = (await storageGet(SK.MEMBERS)) ?? [];
  const idx     = members.findIndex(m => m.dissentUserId === _myUserId);
  const entry   = { dissentUserId: _myUserId, displayName: _displayName, platform, rlUsername, epicFriendName, twitchUsername };
  if (idx >= 0) members[idx] = entry; else members.push(entry);
  await storageSet(SK.MEMBERS, members);
  _members = members;
}

export function showEditAccount() {
  showRegisterScreen(true);
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function onInit(data) {
  _config = data.context?.pluginConfig ?? {};
  _myUserId  = data.user?.id ?? null;
  _channelId = data.context?.channelId ?? null;
  _serverId  = data.context?.serverId  ?? null;
  _displayName = data.user?.displayName ?? 'Unknown';

  initRegisterForm({ onSave: handleRegistrationSaved });

  const myAccount = await storageGetUser(SK.MY_ACCOUNT);
  if (!myAccount?.rlUsername) {
    showScreen('register');
    return;
  }
  await loadHubScreen();
}

async function loadHubScreen() {
  showScreen('hub');

  const myAccount = await storageGetUser(SK.MY_ACCOUNT);
  _myTwitchUsername = myAccount?.twitchUsername ?? '';
  setTwitchStreamer(_myTwitchUsername);

  const members = (await storageGet(SK.MEMBERS)) ?? [];
  _members = members;

  const stale = [];
  for (const m of members) {
    const key    = SK.stats(m.platform, m.rlUsername);
    const cached = await storageGet(key);
    if (cached) {
      _statsCache[key] = cached;
      if (!isFresh(cached)) stale.push(m);
    } else {
      stale.push(m);
    }
  }

  // Update season label from any cached profile
  const anyData = Object.values(_statsCache)[0]?.data;
  if (anyData?.currentSeason) {
    const el = document.getElementById('hub-season-label');
    const label = anyData.seasonLabels?.[anyData.currentSeason] ?? `Season ${anyData.currentSeason}`;
    if (el) el.textContent = label;
  }

  initVersus();
  setOnHideCallback(resetOverlayState);

  if (stale.length > 0) drainFetchQueue(stale);
}

async function handleRegistrationSaved() {
  await loadHubScreen();
}

function onEvent(ev) {
  if (ev.event === 'rl:companion:online') {
    console.log('[rl-hub] rl:companion:online received — companion is running');
    setClientOnline(true);
    _showLiveDebug('Companion connected — waiting for a match to start');
  }
  if (ev.event === 'rl:companion:match:created') {
    resetMatchState();
  }
  if (ev.event === 'rl:live:update') {
    const { sender_id: senderId, game_state: gameState } = ev.data ?? {};
    console.log('[rl-hub] rl:live:update received', { senderId, hasGameState: !!gameState });
    if (!senderId || !gameState) return;
    const wasEmpty = Object.keys(_liveGames).length === 0;
    if (wasEmpty) _showLiveDebug('Companion connected — live data flowing');
    _liveGames[senderId] = { gameState, receivedAt: Date.now() };
    const memberEntry = _members.find(m => m.dissentUserId === senderId) ?? {};
    const senderTwitch = memberEntry.twitchUsername
      || (senderId === _myUserId ? _myTwitchUsername : '');
    setTwitchStreamer(senderTwitch);
    _refreshVersus();
    realtimePublishCompanion('rl-sidebar', 'rl:live:update', { sender_id: senderId, game_state: gameState });
  }
  if (ev.event === 'rl:live:feed') {
    const { event_name, player_name, team_num, victim_name, victim_team } = ev.data ?? {};
    if (event_name && player_name) addFeedEvent({ event_name, player_name, team_num: team_num ?? 0, victim_name, victim_team });
  }
  if (ev.event === 'rl:live:end') {
    const senderId = ev.data?.sender_id;
    console.log('[rl-hub] rl:live:end received', { senderId });
    if (!senderId) return;
    delete _liveGames[senderId];
    resetMatchState();
    _refreshVersus();
    realtimePublishCompanion('rl-sidebar', 'rl:live:end', { sender_id: senderId });
  }
  if (ev.event === 'rl:live:goal') {
    addGoalEvent(ev.data ?? {});
  }
  if (ev.event === 'rl:live:ballhit') {
    addBallHit(ev.data ?? {});
  }
  if (ev.event === 'rl:live:crossbar') {
    showCrossbarAlert(ev.data ?? {});
  }
  if (ev.event === 'rl:live:paused') {
    setPaused(true);
  }
  if (ev.event === 'rl:live:unpaused') {
    setPaused(false);
  }
  if (ev.event === 'rl:sidebar:view-live') {
    const { senderId } = ev.data ?? {};
    if (senderId && _liveGames[senderId]) {
      showVersus(senderId, _liveGames[senderId].gameState);
    }
  }
}

function _showLiveDebug(msg) {
  const el = document.getElementById('live-debug');
  const txt = document.getElementById('live-debug-text');
  if (!el || !txt) return;
  txt.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 6000);
}

function dismissLiveDebug() {
  const el = document.getElementById('live-debug');
  if (el) el.classList.add('hidden');
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  const el = document.getElementById(`screen-${name}`);
  if (el) el.classList.remove('hidden');
  // Broadcast state is host-side (is this desktop? is the game up? is it bound?), so it
  // can change while the hub is closed — read it on every entry rather than once at load.
  if (name === 'register') window._rlHubRefreshBroadcast?.();
}

// ── Window globals ────────────────────────────────────────────────────────────

window.dismissLiveDebug = dismissLiveDebug;
window.showEditAccount = showEditAccount;
// Leaving the settings/edit screen without saving — the gear icon used to be a
// one-way trip.
window.cancelEditAccount = () => { loadHubScreen(); };
window.submitRegistration = () => {
  const fn = window._rlHubSubmitReg;
  if (fn) fn();
};

// ── Bootstrap ─────────────────────────────────────────────────────────────────

window.addEventListener('message', e => handleSDKMessage(e, onInit, onEvent));
