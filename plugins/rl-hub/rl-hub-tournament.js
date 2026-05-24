// rl-hub-tournament.js — single elimination bracket
import { storageGet, storageSet, realtimePublish, genId, esc } from '../plugin-sdk.js';
import { SK, MODES, getMembers, getStatsCache, getMyUserId, isFresh } from './rl-hub-main.js';

const EV_TOURN_UPDATE = 'rl:tournament:update';

let _tournament = null;

// ── Bracket math ─────────────────────────────────────────────────────────────

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function buildBracket(participants) {
  // Standard single-elim seeding: 1 vs N, 2 vs N-1, …
  const size = nextPow2(participants.length);
  const seeds = [...participants];
  // Pad with byes
  while (seeds.length < size) seeds.push(null);

  // Build round 1 matchups
  const matches = [];
  for (let i = 0; i < size / 2; i++) {
    matches.push({
      player1: seeds[i],
      player2: seeds[size - 1 - i],
      score1: null,
      score2: null,
      winnerId: null,
    });
  }

  // Handle byes: if one slot is null, the other auto-advances
  matches.forEach(m => {
    if (m.player1 && !m.player2) m.winnerId = m.player1.dissentUserId;
    if (!m.player1 && m.player2) m.winnerId = m.player2.dissentUserId;
  });

  // Build subsequent rounds (empty until results entered)
  const rounds = [{ name: roundName(matches.length * 2), matches }];
  let prevMatches = matches;
  while (prevMatches.length > 1) {
    const nextCount = prevMatches.length / 2;
    const nextMatches = Array.from({ length: nextCount }, () => ({
      player1: null, player2: null, score1: null, score2: null, winnerId: null,
    }));
    rounds.push({ name: roundName(nextMatches.length * 2), matches: nextMatches });
    prevMatches = nextMatches;
  }

  return rounds;
}

function roundName(totalPlayers) {
  if (totalPlayers <= 2)  return 'Final';
  if (totalPlayers <= 4)  return 'Semifinals';
  if (totalPlayers <= 8)  return 'Quarterfinals';
  return `Round of ${totalPlayers}`;
}

function propagateWinners(rounds) {
  for (let r = 0; r < rounds.length - 1; r++) {
    const cur  = rounds[r].matches;
    const next = rounds[r + 1].matches;
    for (let i = 0; i < next.length; i++) {
      const a = cur[i * 2];
      const b = cur[i * 2 + 1];
      next[i].player1 = a.winnerId ? findParticipant(a.winnerId) : null;
      next[i].player2 = b.winnerId ? findParticipant(b.winnerId) : null;
      // Auto-advance byes
      if (next[i].player1 && !next[i].player2) next[i].winnerId = next[i].player1.dissentUserId;
      if (!next[i].player1 && next[i].player2) next[i].winnerId = next[i].player2.dissentUserId;
    }
  }
}

function findParticipant(userId) {
  return _tournament?.participants?.find(p => p.dissentUserId === userId) ?? null;
}

function getChampion() {
  if (!_tournament) return null;
  const finalRound = _tournament.rounds[_tournament.rounds.length - 1];
  const finalMatch = finalRound?.matches[0];
  return finalMatch?.winnerId ? findParticipant(finalMatch.winnerId) : null;
}

// ── MMR seeding ───────────────────────────────────────────────────────────────

function buildParticipants(gameMode) {
  const cache  = getStatsCache();
  const members = getMembers();
  const playlistId = MODES.find(m => m.short === gameMode)?.id
                  ?? MODES.find(m => m.name === gameMode)?.id
                  ?? 13; // default 3v3

  const participants = members.map(m => {
    const key          = `rl:stats:${m.platform}:${String(m.rlUsername).toLowerCase().replace(/\s+/g, '_')}`;
    const entry        = cache[key];
    const currentSeason = entry?.data?.currentSeason;
    const mmr          = entry?.data?.seasons?.[currentSeason]?.playlists?.[playlistId]?.mmr ?? 0;
    return { ...m, mmr };
  });

  // Sort by MMR descending (seed 1 = highest MMR)
  return participants.sort((a, b) => b.mmr - a.mmr);
}

// ── Persist + broadcast ───────────────────────────────────────────────────────

async function saveTournament() {
  await storageSet(SK.TOURNAMENT, _tournament);
  await realtimePublish(EV_TOURN_UPDATE, _tournament);
  renderTournamentContent(document.getElementById('tab-content'));
}

// ── Render ────────────────────────────────────────────────────────────────────

export function renderTournamentTab(content) {
  if (!content) return;
  if (!_tournament || _tournament.status === 'setup') {
    renderSetupOrEmpty(content);
  } else {
    renderTournamentContent(content);
  }
}

function renderSetupOrEmpty(content) {
  const myId = getMyUserId();
  const canManage = !_tournament || _tournament.createdBy === myId;

  if (!_tournament) {
    content.innerHTML = `
      <div class="tourn-header">
        <span class="tourn-title">Tournament</span>
        ${canManage ? '<button class="btn-sm" onclick="startTournamentSetup()">New Tournament</button>' : ''}
      </div>
      <div class="tourn-empty">No active tournament.<br>${canManage ? 'Start one above.' : 'Ask a member to start one.'}</div>
    `;
    return;
  }
}

function renderSetupForm(content) {
  content.innerHTML = `
    <div class="tourn-header">
      <span class="tourn-title">New Tournament</span>
      <button class="btn-sm danger" onclick="cancelTournamentSetup()">Cancel</button>
    </div>
    <div class="tourn-setup">
      <label class="field-label">Tournament Name</label>
      <input id="tourn-name" class="field-input" type="text" placeholder="e.g. Spring Cup" value="Server Tournament"/>
      <label class="field-label">Game Mode</label>
      <select id="tourn-mode" class="field-input">
        <option value="1v1">Ranked Duel (1v1)</option>
        <option value="2v2">Ranked Doubles (2v2)</option>
        <option value="3v3" selected>Ranked Standard (3v3)</option>
      </select>
      <label class="field-label">Series Format</label>
      <select id="tourn-bestof" class="field-input">
        <option value="1">Best of 1</option>
        <option value="3" selected>Best of 3</option>
        <option value="5">Best of 5</option>
      </select>
      <button class="btn-primary" onclick="createTournament()">Start Bracket (auto-seed by MMR)</button>
    </div>
  `;
}

function renderTournamentContent(content) {
  if (!_tournament) return;
  const myId   = getMyUserId();
  const champ  = getChampion();
  const canManage = _tournament.createdBy === myId;

  let html = `
    <div class="tourn-header">
      <div>
        <div class="tourn-title">${esc(_tournament.name)}</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${esc(_tournament.gameMode)} · Bo${esc(String(_tournament.bestOf))}</div>
      </div>
      ${canManage ? '<button class="btn-sm danger" onclick="deleteTournament()">Delete</button>' : ''}
    </div>
  `;

  if (champ) {
    html += `
      <div class="champion-card">
        <div class="champion-crown">🏆</div>
        <div class="champion-name">${esc(champ.displayName)}</div>
        <div class="champion-label">Champion</div>
      </div>
    `;
  }

  html += '<div class="bracket-wrap"><div class="bracket">';

  _tournament.rounds.forEach(round => {
    html += `<div class="bracket-round"><div class="round-label">${esc(round.name)}</div>`;
    round.matches.forEach((match, matchIdx) => {
      const isClickable = canManage && match.player1 && match.player2 && !match.winnerId;
      html += `
        <div class="match-cell ${isClickable ? 'clickable' : ''}"
             ${isClickable ? `onclick="enterResult(${_tournament.rounds.indexOf(round)}, ${matchIdx})"` : ''}>
          ${renderMatchPlayer(match, 1)}
          ${renderMatchPlayer(match, 2)}
        </div>
      `;
    });
    html += '</div>';
  });

  html += '</div></div>';
  content.innerHTML = html;
}

function renderMatchPlayer(match, slot) {
  const player = slot === 1 ? match.player1 : match.player2;
  const score  = slot === 1 ? match.score1  : match.score2;
  const isWinner = player && match.winnerId === player.dissentUserId;

  if (!player) return `<div class="match-player bye">BYE</div>`;
  return `
    <div class="match-player ${isWinner ? 'winner' : ''}">
      <span>${esc(player.displayName)}</span>
      ${score !== null ? `<span class="match-score">${esc(String(score))}</span>` : ''}
    </div>
  `;
}

// ── Actions ────────────────────────────────────────────────────────────────────

function startTournamentSetup() {
  const content = document.getElementById('tab-content');
  if (content) renderSetupForm(content);
}

function cancelTournamentSetup() {
  renderTournamentTab(document.getElementById('tab-content'));
}

async function createTournament() {
  const name    = document.getElementById('tourn-name')?.value?.trim() || 'Tournament';
  const gameMode = document.getElementById('tourn-mode')?.value ?? '3v3';
  const bestOf  = parseInt(document.getElementById('tourn-bestof')?.value ?? '3', 10);

  const participants = buildParticipants(gameMode);
  const rounds = buildBracket(participants);

  _tournament = {
    id: genId(),
    name,
    gameMode,
    bestOf,
    status: 'active',
    participants,
    rounds,
    createdBy: getMyUserId(),
  };

  await saveTournament();
}

async function deleteTournament() {
  if (!confirm('Delete this tournament? This cannot be undone.')) return;
  _tournament = null;
  await storageSet(SK.TOURNAMENT, null);
  await realtimePublish(EV_TOURN_UPDATE, null);
  renderTournamentTab(document.getElementById('tab-content'));
}

function enterResult(roundIdx, matchIdx) {
  const match = _tournament.rounds[roundIdx].matches[matchIdx];
  const bo    = _tournament.bestOf;
  const target = Math.ceil(bo / 2);

  const input = prompt(`Enter score for ${match.player1.displayName} vs ${match.player2.displayName}\nFormat: "2-1" (first number = ${match.player1.displayName})`);
  if (!input) return;

  const parts = input.split(/[-:]/);
  const s1 = parseInt(parts[0], 10);
  const s2 = parseInt(parts[1], 10);

  if (isNaN(s1) || isNaN(s2) || (s1 !== target && s2 !== target)) {
    alert(`Invalid score. In a Best of ${bo}, winner must reach ${target} wins.`);
    return;
  }

  match.score1  = s1;
  match.score2  = s2;
  match.winnerId = s1 > s2 ? match.player1.dissentUserId : match.player2.dissentUserId;

  propagateWinners(_tournament.rounds);
  saveTournament();
}

// ── Realtime handler (called from main) ───────────────────────────────────────

export function handleTournamentEvent(data) {
  _tournament = data;
  renderTournamentTab(document.getElementById('tab-content'));
}

// ── Load on init ──────────────────────────────────────────────────────────────

export async function loadTournament() {
  _tournament = await storageGet(SK.TOURNAMENT);
}

// ── Window globals ────────────────────────────────────────────────────────────

window.startTournamentSetup  = startTournamentSetup;
window.cancelTournamentSetup = cancelTournamentSetup;
window.createTournament      = createTournament;
window.deleteTournament      = deleteTournament;
window.enterResult           = enterResult;
