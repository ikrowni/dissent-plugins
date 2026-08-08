// views/game.js — Game Center: the broadcast centerpiece.
//
// Composes the Stadium hero over the control-room modules. In replay mode it reads
// state from core/replay.js instead of the network, which is how this was developed
// out of season.
import { stateMsg, esc } from '../core/ui.js';
import { cache, TTL } from '../core/cache.js';
import {
  urls, fetchSummary, fetchPlays, fetchDrives, fetchProbabilities, fetchScoreboard,
} from '../core/espn-client.js';
import {
  parseScoreboard, parsePlays, parseDrives, parseProbabilities,
} from '../core/espn-game.js';
import { renderHero } from './game-scorebug.js';
import { renderDriveChart, renderPlayByPlay } from './game-drive.js';
import { renderWinProb } from './game-winprob.js';
import { parseTeamStats, renderComparison, renderBoxScore } from './game-box.js';

const state = {
  loading: true, error: null, game: null, siblings: null,
  plays: [], drives: [], winProb: [], summary: {},
  selectedDrive: null, replay: null, replayPlaying: false,
};

export function renderReplayBar(rs, isPlaying) {
  const total = rs?.totalPlays ?? 0;
  const pct = Math.round((rs?.progress ?? 0) * 100);
  return '<div class="replay-bar">'
    + `<button data-act="replay-play">${isPlaying ? 'Pause' : 'Play'}</button>`
    + '<button data-act="replay-step">Step</button>'
    + '<button data-act="replay-reset">Reset</button>'
    + `<input type="range" data-act="replay-seek" min="0" max="${esc(total)}"`
      + ` value="${Math.round((rs?.progress ?? 0) * total)}" aria-label="Scrub replay">`
    + `<span class="kicker num">${pct}%</span>`
    + '</div>';
}

export function renderGame(s = state) {
  if (s.loading) return stateMsg('Loading game…', { spinner: true });
  if (s.error) return stateMsg('Could not load this game.', { retry: true });
  if (!s.game) {
    return stateMsg('Choose a game from Around the League to open Game Center.');
  }

  const teams = { home: s.game.home, away: s.game.away };
  const scoringSeqs = (s.plays ?? []).filter((p) => p.scoring).map((p) => p.seq);

  return '<div class="game-center">'
    + '<div style="padding:10px 20px 0">'
      + '<button class="badge" data-act="nav" data-view="league">← Around the League</button>'
    + '</div>'
    + (s.replay ? renderReplayBar(s.replay, s.replayPlaying) : '')
    + renderHero(s.game, { winProb: s.winProb, siblings: s.siblings })
    + '<div class="panel"><div class="panel-body" style="display:grid;gap:12px">'
      + renderDriveChart(s.drives, { selectedId: s.selectedDrive })
      + renderWinProb(s.winProb, teams, { scoringSeqs })
      + renderPlayByPlay(s.plays)
      + renderComparison(parseTeamStats(s.summary), teams)
      + renderBoxScore(s.summary)
    + '</div></div>'
    + '</div>';
}

export function render() { return renderGame(state); }

async function loadLive(gameId) {
  const sbRaw = await cache.get(urls.scoreboard({}), () => fetchScoreboard({}),
    TTL.SCOREBOARD_LIVE, { staleOnError: true });
  const board = parseScoreboard(sbRaw);
  const game = board.games.find((g) => g.id === String(gameId)) ?? board.games[0] ?? null;
  state.game = game;
  state.siblings = board.games;
  if (!game) return;

  const ttl = game.state === 'post' ? TTL.GAME_FINAL : TTL.GAME_LIVE;

  // Each fetch degrades independently: one dead endpoint costs one panel, not the
  // screen. ESPN retires these without notice, so this is not hypothetical.
  const [summary, plays, drives, wp] = await Promise.all([
    cache.get(urls.summary(game.id), () => fetchSummary(game.id), ttl, { staleOnError: true })
      .catch(() => ({})),
    cache.get(urls.plays(game.id), () => fetchPlays(game.id), ttl, { staleOnError: true })
      .catch(() => ({ items: [] })),
    cache.get(urls.drives(game.id), () => fetchDrives(game.id), ttl, { staleOnError: true })
      .catch(() => ({ items: [] })),
    cache.get(urls.probabilities(game.id), () => fetchProbabilities(game.id), ttl,
      { staleOnError: true }).catch(() => ({ items: [] })),
  ]);

  state.summary = summary ?? {};
  state.plays = parsePlays(plays);
  state.drives = parseDrives(drives);
  state.winProb = parseProbabilities(wp);
}

/** Project the replay's running state into the same shape the live path produces. */
function loadFromReplay(replay) {
  const rs = replay.state();
  state.replay = rs;
  state.replayPlaying = replay.isPlaying;
  state.plays = rs.plays;
  state.drives = rs.drives;
  state.winProb = rs.winProb;
  state.siblings = null;
  state.game = {
    id: 'replay', state: rs.done ? 'post' : 'in',
    period: rs.period, clock: rs.clock,
    timeslot: 'Replay · DAL @ PHI 2025 wk1', broadcast: null, venue: null,
    home: { abbr: 'PHI', fullName: 'Philadelphia Eagles', score: rs.homeScore,
      logo: 'nfl-hub/assets/logos/phi.png', primary: '#06424d', record: null },
    away: { abbr: 'DAL', fullName: 'Dallas Cowboys', score: rs.awayScore,
      logo: 'nfl-hub/assets/logos/dal.png', primary: '#002a5c', record: null },
    down: null, distance: null, possessionAbbr: null, redZone: false,
  };
}

let unregister = null;
let unsubscribe = null;

export async function enter() {
  const { app, applyScoreFlip } = await import('../core/app.js');
  let prevScore = null;

  const repaint = () => {
    const next = state.game
      ? { home: state.game.home?.score, away: state.game.away?.score }
      : null;
    app.router.refresh();
    applyScoreFlip(document.getElementById('main'), next, prevScore);
    prevScore = next;
  };

  app.onAction = (act, el) => {
    if (act === 'drive') {
      state.selectedDrive = state.selectedDrive === el.dataset.drive ? null : el.dataset.drive;
      app.router.refresh();
      return;
    }
    if (!app.replay) return;
    if (act === 'replay-play') {
      if (app.replay.isPlaying) app.replay.pause(); else app.replay.play();
    }
    if (act === 'replay-step') app.replay.step();
    if (act === 'replay-reset') app.replay.reset();
    if (act === 'replay-seek') app.replay.seek(el.value);
    loadFromReplay(app.replay);
    repaint();
  };

  if (app.replay) {
    unsubscribe = app.replay.subscribe(() => { loadFromReplay(app.replay); repaint(); });
    loadFromReplay(app.replay);
    state.loading = false;
    repaint();
    return;
  }

  unregister = app.scheduler.add(() => { loadLive(app.gameId).then(repaint); });
  try {
    await loadLive(app.gameId);
    state.error = null;
  } catch (err) {
    state.error = err?.message ?? 'failed';
  } finally {
    state.loading = false;
  }
  repaint();
}

export function leave() {
  unregister?.();
  unsubscribe?.();
  unregister = null;
  unsubscribe = null;
}
