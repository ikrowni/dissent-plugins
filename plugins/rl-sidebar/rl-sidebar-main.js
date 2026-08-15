// rl-sidebar-main.js — init, own-profile load, player-selected event handling
import { handleSDKMessage, storageGetUser, storageGetCompanion, request, realtimePublishCompanion, esc } from '../plugin-sdk.js';
import { getSeasonNums, getPlaylistData } from './rl-scraper.js';
import { renderProfile, renderMemberCardContent, fetchAndRenderMemberCard } from './rl-sidebar-profile.js';

const MODES = [
  { id: 11, short: '1v1'    },
  { id: 12, short: '2v2'    },
  { id: 13, short: '3v3'    },
  { id: 34, short: 'Tourn'  },
  { id: 27, short: 'Hoops'  },
  { id: 28, short: 'Rumble' },
  { id: 29, short: 'Drop'   },
  { id: 30, short: 'Snow'   },
];
export { MODES };

const SK_MY_ACCOUNT = 'rl:my-account';
const statsKey = (platform, username) =>
  `rl:stats:${platform}:${String(username).toLowerCase().replace(/\s+/g, '_')}`;

let _config      = {};
let _activeTab   = 'overview';
let _currentProfile = null; // { platform, rlUsername, displayName, epicFriendName }
let _ownProfile  = null;
let _profileData = null;

let _liveGames = {};   // { [dissentUserId]: { gameState, receivedAt } }
let _members = [];     // RL Hub registered members

const SIDEBAR_LIVE_STALENESS_MS = 20_000;
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const uid of Object.keys(_liveGames)) {
    if (now - _liveGames[uid].receivedAt > SIDEBAR_LIVE_STALENESS_MS) {
      delete _liveGames[uid];
      changed = true;
    }
  }
  if (changed) renderMembersPanel();
}, 5_000);
let _avatarMap = {};   // { [dissentUserId]: avatarUrl }
let _displayNameMap = {};  // { [dissentUserId]: Dissent display_name }
let _memberStatsMap = {};  // { [dissentUserId]: rl stats data | null }

const LIVE_MODE_MAP = {
  '1v1 Duel':     { id: 11, short: '1v1' },
  '2v2 Doubles':  { id: 12, short: '2v2' },
  '3v3 Standard': { id: 13, short: '3v3' },
};

export function getMemberRankInfo(data, liveGameState) {
  const season = getSeasonNums(data)[0] ?? null;
  if (!season) return null;

  if (liveGameState) {
    const entry = LIVE_MODE_MAP[liveGameState.mode];
    if (!entry) return null;
    const pl = getPlaylistData(data, entry.id, season);
    if (pl?.mmr == null) return null;
    return { label: entry.short, sub: pl.rankName + (pl.division ? ' ' + pl.division : '') };
  }

  let best = null;
  for (const mode of MODES) {
    const pl = getPlaylistData(data, mode.id, season);
    if (pl?.mmr != null && (!best || pl.mmr > best.mmr)) {
      best = { mmr: pl.mmr, label: 'Peak', sub: pl.rankName + (pl.division ? ' ' + pl.division : '') };
    }
  }
  return best ? { label: best.label, sub: best.sub } : null;
}

export function getConfig()      { return _config; }
export function getProfileData() { return _profileData; }

// ── Tab switching ──────────────────────────────────────────────────────────────

export function switchSidebarTab(tab) {
  _activeTab = tab;
  document.querySelectorAll('.s-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(el => el.classList.toggle('active', el.id === `panel-${tab}`));
}

// ── Shell HTML ────────────────────────────────────────────────────────────────

function buildProfileShell(meta, showBack) {
  const overviewActive = _activeTab !== 'members';
  return `
    <div class="profile-header">
      ${showBack ? '<button class="back-btn" onclick="backToOwn()">← My Stats</button>' : ''}
      <div class="profile-identity">
        <div class="profile-avatar">🏎️</div>
        <div>
          <div class="profile-name">${esc(meta.displayName)}</div>
          <span class="profile-platform-badge">${esc(meta.platform)}</span>
        </div>
      </div>
      <div class="sidebar-tabs">
        <button class="s-tab ${overviewActive ? 'active' : ''}" data-tab="overview" onclick="switchSidebarTab('overview')">Overview</button>
        <button class="s-tab ${!overviewActive ? 'active' : ''}" data-tab="members" onclick="switchSidebarTab('members')">Members</button>
      </div>
    </div>
    <div class="tab-panel ${overviewActive ? 'active' : ''}" id="panel-overview"></div>
    <div class="tab-panel ${!overviewActive ? 'active' : ''}" id="panel-members"></div>
  `;
}

function setRoot(html) {
  const root = document.getElementById('root');
  if (root) root.innerHTML = html;
}

async function backToOwn() {
  if (_ownProfile) {
    await loadProfile({
      platform: _ownProfile.platform,
      rlUsername: _ownProfile.rlUsername,
      epicFriendName: _ownProfile.epicFriendName ?? '',
      displayName: 'My Stats',
    });
  } else {
    await loadOwnProfile();
  }
}

// ── Members helpers ────────────────────────────────────────────────────────────

async function loadMembers() {
  const stored = await storageGetCompanion('rl-hub', 'rl:members');
  _members = Array.isArray(stored) ? stored : [];
  try {
    const result = await request('members:list', {});
    const serverMembers = result?.members ?? [];
    _avatarMap = {};
    _displayNameMap = {};
    for (const sm of serverMembers) {
      if (sm.id) {
        _avatarMap[sm.id]      = sm.avatar_url   ?? null;
        _displayNameMap[sm.id] = sm.display_name ?? sm.username ?? null;
      }
    }
  } catch {
    _avatarMap      = {};
    _displayNameMap = {};
  }
  _memberStatsMap = {};
  await Promise.all(_members.map(async m => {
    const cacheKey = `rl:stats:${m.platform}:${String(m.rlUsername).toLowerCase().replace(/\s+/g, '_')}`;
    const cached = await storageGetCompanion('rl-hub', cacheKey);
    _memberStatsMap[m.dissentUserId] = cached?.data ?? null;
  }));
}

function renderMembersPanel() {
  const panel = document.getElementById('panel-members');
  if (!panel) return;

  if (_members.length === 0) {
    panel.innerHTML = '<div class="empty-state">No members registered in the RL Hub yet.<br>Open the hub in a channel to set up your account.</div>';
    return;
  }

  const rows = _members.map(m => {
    const id          = esc(m.dissentUserId);
    const isLive      = !!_liveGames[m.dissentUserId];
    const avatarUrl   = _avatarMap[m.dissentUserId];
    const displayName = _displayNameMap[m.dissentUserId] ?? m.displayName;
    const statsData   = _memberStatsMap[m.dissentUserId] ?? null;
    const liveState   = _liveGames[m.dissentUserId]?.gameState ?? null;
    const rankInfo    = getMemberRankInfo(statsData, liveState);

    const initial     = (displayName || '?').charAt(0).toUpperCase();
    const avatarInner = avatarUrl
      ? `<img src="${esc(avatarUrl)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
      : `<span class="mem-av-initial">${esc(initial)}</span>`;

    const rankRow = rankInfo
      ? `<div class="mem-rank-row">
           <span class="mem-mode">${esc(rankInfo.label)}</span>
           <span class="mem-sep">·</span>
           <span class="mem-rank">${esc(rankInfo.sub)}</span>
         </div>`
      : '';

    return `
      <div class="mem-card${isLive ? ' live' : ''}" id="memrow-${id}">
        <button class="mem-btn" onclick="toggleMember('${id}')">
          <div class="mem-av-wrap">
            <div class="mem-av">${avatarInner}</div>
            <div class="${isLive ? 'mem-ring' : 'mem-ring-off'}"></div>
          </div>
          <div class="mem-info">
            <div class="mem-name">${esc(displayName)}</div>
            ${rankRow}
          </div>
          <div class="mem-right">
            ${isLive ? '<div class="mem-live-badge">● LIVE</div>' : ''}
            <span class="mem-chevron">▾</span>
          </div>
        </button>
        <div class="mem-body hidden" id="memexp-${id}"></div>
      </div>
    `;
  }).join('');

  panel.innerHTML = `<div class="mem-list">${rows}</div>`;
}

// ── Profile loading ───────────────────────────────────────────────────────────

async function loadProfile(profileMeta) {
  _currentProfile = profileMeta;
  const cacheKey = statsKey(profileMeta.platform, profileMeta.rlUsername);
  const cached = await storageGetCompanion('rl-hub', cacheKey);
  setRoot(buildProfileShell(profileMeta, !!_ownProfile && profileMeta.rlUsername !== _ownProfile.rlUsername));
  renderMembersPanel();  // populate members tab after shell is rebuilt
  if (cached?.data) {
    _profileData = cached.data;
    renderProfile(profileMeta, cached.data, _config);
  } else {
    renderProfile(profileMeta, null, _config);
  }
}

async function loadOwnProfile() {
  const account = await storageGetCompanion('rl-hub', SK_MY_ACCOUNT, 'user');
  if (!account?.rlUsername) {
    setRoot(`<div class="empty-state">Open the <strong>Rocket League Hub</strong> in a channel to set up your account and appear on the leaderboard.</div>`);
    return;
  }
  _ownProfile = account;
  await loadMembers();
  await loadProfile({
    platform: account.platform,
    rlUsername: account.rlUsername,
    epicFriendName: account.epicFriendName ?? '',
    displayName: 'My Stats',
  });
}

// ── SDK handlers ──────────────────────────────────────────────────────────────

async function onInit(data) {
  _config = data.context?.pluginConfig ?? {};
  await loadOwnProfile();
}

function onEvent(ev) {
  if (ev.event === 'player-selected' && ev.data) {
    loadProfile(ev.data);
  }
  if (ev.event === 'rl:live:update') {
    const { sender_id: senderId, game_state: gameState } = ev.data ?? {};
    if (senderId && gameState) {
      _liveGames[senderId] = { gameState, receivedAt: Date.now() };
      renderMembersPanel();
    }
  }
  if (ev.event === 'rl:live:end') {
    const senderId = ev.data?.sender_id;
    if (senderId) {
      delete _liveGames[senderId];
      renderMembersPanel();
    }
  }
}

// ── Window globals ─────────────────────────────────────────────────────────────

window.switchSidebarTab = switchSidebarTab;
window.backToOwn        = backToOwn;

window.toggleMember = async (dissentUserId) => {
  const body = document.getElementById(`memexp-${dissentUserId}`);
  const row  = document.getElementById(`memrow-${dissentUserId}`);
  if (!body || !row) return;

  const isOpen = !body.classList.contains('hidden');

  // Close all open cards
  document.querySelectorAll('.mem-body').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.mem-card').forEach(el => el.classList.remove('open'));

  if (isOpen) return; // was open — just close it

  body.classList.remove('hidden');
  row.classList.add('open');

  if (body.dataset.loaded) return; // already fetched

  const member = _members.find(m => m.dissentUserId === dissentUserId);
  if (!member) return;

  const isLive = !!_liveGames[dissentUserId];
  const cacheKey = `rl:stats:${member.platform}:${String(member.rlUsername).toLowerCase().replace(/\s+/g, '_')}`;

  body.innerHTML = '<div class="sidebar-loading"><div class="spinner"></div><span>Loading…</span></div>';

  const cached = await storageGetCompanion('rl-hub', cacheKey);
  if (cached?.data) {
    const data = cached.data;
    const seasonNums = getSeasonNums(data);
    const currentSeason = seasonNums[0] ?? null;
    const meta = { platform: member.platform, rlUsername: member.rlUsername, displayName: member.displayName, epicFriendName: member.epicFriendName ?? '' };
    if (!window._memberCardStates) window._memberCardStates = {};
    window._memberCardStates[dissentUserId] = { meta, data, season: currentSeason, isLive };
    renderMemberCardContent(body, meta, data, currentSeason, dissentUserId, isLive);
    body.dataset.loaded = '1';
  } else {
    await fetchAndRenderMemberCard(body, member, isLive);
    body.dataset.loaded = '1';
  }
};

window.viewLiveMatch = async (dissentUserId) => {
  await realtimePublishCompanion('rl-hub', 'rl:sidebar:view-live', { senderId: dissentUserId });
};

// ── Bootstrap ─────────────────────────────────────────────────────────────────

window.addEventListener('message', e => handleSDKMessage(e, onInit, onEvent));
