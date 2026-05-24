// rl-hub-leaderboard.js — leaderboard rendering and player click handler
import { esc, realtimePublishCompanion } from '../plugin-sdk.js';
import { MODES, getMembers, getStatsCache, isFresh, getLiveGames } from './rl-hub-main.js';
import { showVersus } from './rl-hub-versus.js';

// ── rlstats.net data helpers ──────────────────────────────────────────────────

function getPlaylist(data, modeId) {
  const season = data?.currentSeason;
  return data?.seasons?.[season]?.playlists?.[modeId] ?? null;
}

function getMmr(data, modeId) {
  return getPlaylist(data, modeId)?.mmr ?? null;
}

function getRankName(data, modeId) {
  const p = getPlaylist(data, modeId);
  if (!p) return null;
  return [p.rankName, p.division].filter(Boolean).join(' ') || null;
}

function getRankIcon(data, modeId) {
  return getPlaylist(data, modeId)?.iconSrc ?? null;
}

// ── Render helpers ────────────────────────────────────────────────────────────

function posClass(pos) {
  if (pos === 1) return 'gold';
  if (pos === 2) return 'silver';
  if (pos === 3) return 'bronze';
  return '';
}

function renderSkeletons(count) {
  return Array.from({ length: count }, () => `
    <div class="lb-skeleton">
      <div class="skel skel-pos"></div>
      <div class="skel skel-icon"></div>
      <div class="skel-info">
        <div class="skel skel-name"></div>
        <div class="skel skel-rank"></div>
      </div>
      <div class="skel skel-mmr"></div>
    </div>
  `).join('');
}

function renderRow(member, pos, profileData, modeId, isLive) {
  const mmr      = getMmr(profileData, modeId);
  const rankName = getRankName(profileData, modeId);
  const iconUrl  = getRankIcon(profileData, modeId);
  const cls      = posClass(pos);
  const unranked = mmr === null;

  const iconHtml = iconUrl
    ? `<img class="lb-rank-icon" src="${esc(iconUrl)}" alt="${esc(rankName ?? 'Unranked')}" loading="lazy">`
    : `<div class="lb-rank-icon-placeholder"></div>`;

  const mmrHtml = unranked
    ? `<span class="lb-mmr-pill unranked">Unranked</span>`
    : `<span class="lb-mmr-pill">${mmr} MMR</span>`;

  const liveBadge = isLive ? `<span class="lb-live-badge">● LIVE</span>` : '';

  return `
    <div class="lb-row ${cls}"
         onclick="selectPlayer(${esc(JSON.stringify({ platform: member.platform, rlUsername: member.rlUsername, displayName: member.displayName, epicFriendName: member.epicFriendName ?? '', dissentUserId: member.dissentUserId ?? '' }))})"
         data-userid="${esc(member.dissentUserId)}">
      <span class="lb-pos ${cls}">${pos}</span>
      ${iconHtml}
      <div class="lb-info">
        <div class="lb-name">${esc(member.displayName)}</div>
        ${rankName ? `<div class="lb-rank-name">${esc(rankName)}</div>` : ''}
      </div>
      ${mmrHtml}
      ${liveBadge}
    </div>
  `;
}

// ── Main render ───────────────────────────────────────────────────────────────

export function renderLeaderboard(tabIdx) {
  const content = document.getElementById('tab-content');
  if (!content) return;

  const mode = MODES[tabIdx];
  if (!mode) return;

  const members   = getMembers();
  const cache     = getStatsCache();
  const liveGames = getLiveGames();

  if (members.length === 0) {
    content.innerHTML = '<div id="lb-list"><div class="lb-empty">No members have registered yet.<br>Open the hub and connect your account.</div></div>';
    return;
  }

  const ranked   = [];
  const unranked = [];

  for (const m of members) {
    const key   = `rl:stats:${m.platform}:${String(m.rlUsername).toLowerCase().replace(/\s+/g, '_')}`;
    const entry = cache[key];
    if (!entry || !isFresh(entry)) continue;
    const mmr = getMmr(entry.data, mode.id);
    if (mmr !== null) {
      ranked.push({ member: m, profileData: entry.data, mmr });
    } else {
      unranked.push({ member: m, profileData: entry.data });
    }
  }

  ranked.sort((a, b) => b.mmr - a.mmr);

  const isLive = m => !!liveGames[m.dissentUserId];
  const liveRanked   = ranked.filter(r => isLive(r.member));
  const normalRanked = ranked.filter(r => !isLive(r.member));
  const orderedRanked = [...liveRanked, ...normalRanked];

  const cached       = new Set(Object.keys(cache));
  const stillLoading = members.filter(m => {
    const key = `rl:stats:${m.platform}:${String(m.rlUsername).toLowerCase().replace(/\s+/g, '_')}`;
    return !cached.has(key);
  });

  let html = '';
  orderedRanked.forEach(({ member, profileData }, i) => {
    html += renderRow(member, i + 1, profileData, mode.id, isLive(member));
  });
  unranked.forEach(({ member, profileData }) => {
    html += renderRow(member, orderedRanked.length + 1, profileData, mode.id, isLive(member));
  });
  if (stillLoading.length > 0) html += renderSkeletons(stillLoading.length);
  if (!html) html = '<div class="lb-empty">Loading player stats…</div>';

  const lbList = document.getElementById('lb-list');
  if (lbList) {
    lbList.innerHTML = html;
  } else {
    content.innerHTML = `<div id="lb-list">${html}</div>`;
  }
}

// ── Player selection ──────────────────────────────────────────────────────────

async function selectPlayer(playerData) {
  const liveGames = getLiveGames();
  const live = liveGames[playerData.dissentUserId];
  if (live) {
    showVersus(playerData.dissentUserId, live.gameState);
  } else {
    await realtimePublishCompanion('rl-sidebar', 'player-selected', playerData);
  }
}

window.selectPlayer = selectPlayer;
