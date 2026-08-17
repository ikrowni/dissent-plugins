// rl-hub-tournament.js — single elimination bracket
import { logAppend, logReadAll, realtimePublish, genId, esc } from '../plugin-sdk.js';
import { MODES, getMembers, getStatsCache, getMyUserId, isFresh } from './rl-hub-main.js';
import { champion as bracketChampion, validateScore } from './tournament/bracket.js';
import { replay, canManage as replayCanManage, KIND } from './tournament/replay.js';
import { confirmDialog, scoreDialog, closeDialog } from './tournament/dialog.js';

const EV_TOURN_UPDATE = 'rl:tournament:update';

let _tournament = null;
let _rejected = [];
let _loadError = null;

/// Every log write goes through here. The capability layer rejects with a real reason —
/// "storage:log not granted", "plugin not assigned to this channel", "log is full" — and
/// showing it is the difference between a fixable problem and a button that does nothing.
async function writeToLog(entry, whatFailed) {
  try {
    await logAppend(entry);
    return true;
  } catch (err) {
    console.error('[rl-hub] tournament log append failed', err);
    await confirmDialog({
      title: whatFailed,
      body: `The server refused the write: ${err?.message ?? 'unknown error'}\n\n` +
            'Nothing was recorded. If this says the permission was not granted, reopen the ' +
            'hub settings and accept the tournament history permission.',
      confirmLabel: 'OK',
    });
    return false;
  }
}

// ── Bracket math ─────────────────────────────────────────────────────────────

function findParticipant(userId) {
  return _tournament?.participants?.find(p => p.dissentUserId === userId) ?? null;
}

function getChampion() {
  if (!_tournament) return null;
  return bracketChampion(_tournament.rounds, _tournament.participants ?? []);
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

/// Re-derive everything from the attested log. The log is the truth; nothing else is.
///
/// Realtime is only an invalidation ping — we deliberately do NOT trust the payload it
/// carries, because a realtime publish has no attested sender and any member can send one.
async function reloadFromLog() {
  let entries;
  try {
    entries = await logReadAll();
  } catch (err) {
    // An unreadable log is not an empty one. Saying "no tournament" here would be a
    // confident lie over a failure.
    console.error('[rl-hub] tournament log read failed', err);
    _loadError = err?.message ?? 'unknown error';
    _tournament = null;
    renderTournamentTab(document.getElementById('tab-content'));
    return;
  }
  _loadError = null;
  const { tournament, rejected } = replay(entries);
  _tournament = tournament;
  _rejected = rejected;
  if (rejected.length) {
    console.warn('[rl-hub] tournament: %d log entr%s rejected on replay',
      rejected.length, rejected.length === 1 ? 'y' : 'ies', rejected);
  }
  renderTournamentTab(document.getElementById('tab-content'));
}

/// Tell other clients something changed so they re-read. The payload is deliberately empty:
/// anything in it would be unattested and therefore not worth reading.
async function announceChange() {
  try { await realtimePublish(EV_TOURN_UPDATE, { changed: true }); } catch { /* best effort */ }
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
  const registered = getMembers().length;

  if (_loadError) {
    content.innerHTML = `
      <div class="tourn-header"><span class="tourn-title">Tournament</span></div>
      <div class="tourn-empty">
        Could not read the tournament history.<br>
        <span class="tourn-error">${esc(_loadError)}</span><br><br>
        This is not an empty tournament — it means the history could not be loaded, so
        nothing is being shown rather than something wrong.
      </div>`;
    return;
  }

  if (!_tournament) {
    // Anyone may start a bracket; the log records who did, and only they can record results.
    const enough = registered >= 2;
    content.innerHTML = `
      <div class="tourn-header">
        <span class="tourn-title">Tournament</span>
        ${enough ? '<button class="btn-sm" onclick="startTournamentSetup()">New Tournament</button>' : ''}
      </div>
      <div class="tourn-empty">
        No active tournament.<br>
        ${enough
          ? 'Start one above. Everyone who has connected a Rocket League account is entered automatically.'
          : `A bracket needs at least two players with a connected Rocket League account — ${registered} ${registered === 1 ? 'has' : 'have'} connected so far.<br>Ask others to open this hub and connect their account.`}
      </div>`;
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
  // Attested: the log says who created the bracket. The old check read a createdBy
  // field the creator wrote themselves, which anyone could have set.
  const canManage = replayCanManage(_tournament, myId);

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
  console.log('[rl-hub] createTournament: %d registered member(s) → %d participant(s)',
    getMembers().length, participants.length);
  if (participants.length < 2) {
    await confirmDialog({
      title: 'Not enough players',
      body: 'A bracket needs at least two registered members. Ask people to connect their Rocket League account first.',
      confirmLabel: 'OK',
    });
    return;
  }

  // The organiser is whoever the NODE says appended this entry — never a field we set.
  // That is what makes the bracket's authority checkable by every other client.
  const ok2 = await writeToLog({
    kind: KIND.CREATE,
    id: genId(),
    name, gameMode, bestOf, participants,
  }, 'Could not create the tournament');
  if (!ok2) return;

  await reloadFromLog();
  announceChange();
}

async function deleteTournament() {
  const ok = await confirmDialog({
    title: 'Delete this tournament?',
    body: 'The bracket stops being shown to everyone. The log of what happened is kept — entries cannot be removed, which is what makes past results verifiable.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;

  const removed = await writeToLog({ kind: KIND.DELETE, tournamentId: _tournament.id },
    'Could not delete the tournament');
  if (!removed) return;

  await reloadFromLog();
  announceChange();
}

async function enterResult(roundIdx, matchIdx) {
  const match = _tournament.rounds[roundIdx].matches[matchIdx];
  const bo = _tournament.bestOf;

  const result = await scoreDialog({
    player1: match.player1.displayName,
    player2: match.player2.displayName,
    bestOf: bo,
  });
  if (!result) return;

  // The dialog cannot return an invalid score — the button stays disabled — but the
  // bracket is the thing that must never hold a nonsense result, so it validates too.
  const v = validateScore(result.s1, result.s2, bo);
  if (!v.ok) return;

  // Re-read the match: an incoming update may have replaced the bracket while the dialog
  // was open, in which case this roundIdx/matchIdx could now point somewhere else.
  const live = _tournament.rounds[roundIdx]?.matches?.[matchIdx];
  if (!live || live.player1?.dissentUserId !== match.player1.dissentUserId
            || live.player2?.dissentUserId !== match.player2.dissentUserId) {
    await confirmDialog({
      title: 'Bracket changed',
      body: 'This match was updated while the result dialog was open, so the score was not saved. Check the bracket and try again.',
      confirmLabel: 'OK',
    });
    return;
  }

  const saved = await writeToLog({
    kind: KIND.RESULT,
    tournamentId: _tournament.id,
    roundIdx, matchIdx,
    s1: result.s1, s2: result.s2,
  }, 'Could not save the result');
  if (!saved) return;

  await reloadFromLog();
  announceChange();
}

// ── Realtime handler (called from main) ───────────────────────────────────────

export function handleTournamentEvent() {
  // ⚠️ The argument is ignored ON PURPOSE. A realtime publish carries no attested sender,
  // so anything inside it could have been written by anyone. The event means only
  // "something changed"; the log says what.
  reloadFromLog();
}

// ── Load on init ──────────────────────────────────────────────────────────────

export async function loadTournament() {
  await reloadFromLog();
}

// ── Window globals ────────────────────────────────────────────────────────────

window.startTournamentSetup  = startTournamentSetup;
window.cancelTournamentSetup = cancelTournamentSetup;
window.createTournament      = createTournament;
window.deleteTournament      = deleteTournament;
window.enterResult           = enterResult;
