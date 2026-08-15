// views/game.js — Game Center: the broadcast centerpiece.
//
// Composes the Stadium hero over the control-room modules. In replay mode it reads
// state from core/replay.js instead of the network, which is how this was developed
// out of season.
import { stateMsg, esc, errorPane} from '../core/ui.js';
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
  /**
   * ⚠️ HAS THIS TAB ALREADY PAINTED ITS DATA ONCE?
   *
   * This is the only view in the plugin that BOTH carries entrance animations and
   * re-renders on the scheduler — every 20 s while a game is live. Every render
   * replaces the DOM wholesale, so an ungated entrance does not play once, it
   * plays every twenty seconds for three hours. `heroLogo` was exactly that bug
   * until this session, measured going `finished` -> `running` on every refresh.
   *
   * So the entrance classes are emitted only while this is false. repaint() sets
   * it after the first paint; leave() clears it, because coming back to the tab is
   * a genuine arrival again.
   */
  settled: false,
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
  if (s.error) return errorPane(s.error, 'Could not load this game.');
  if (!s.game) {
    return stateMsg('Choose a game from Around the League to open Game Center.');
  }

  const teams = { home: s.game.home, away: s.game.away };
  const scoringSeqs = (s.plays ?? []).filter((p) => p.scoring).map((p) => p.seq);
  const first = !s.settled;
  const drives = s.drives?.length ?? 0;

  // ⚠️ THE STORY, THEN THE DETAIL. These five modules used to sit in one flat
  // panel at identical weight, so the drive chart — which game-drive.js's own
  // header calls the single highest-value graphic here — carried exactly as much
  // as the box score. The drive chart and the win-probability graph answer the
  // same question from two directions (what happened, and what it was worth), so
  // they go together on a stage under the hero; everything you consult afterwards
  // reads like it. Same rule as the standings and leaders passes.
  return '<div class="game-center">'
    + '<div style="padding:10px 20px 0">'
      + '<button class="badge" data-act="nav" data-view="league">← Around the League</button>'
    + '</div>'
    + (s.replay ? renderReplayBar(s.replay, s.replayPlaying) : '')
    + renderHero(s.game, { winProb: s.winProb, siblings: s.siblings, entrance: first })
    + `<div class="stage bth-stage${first ? ' is-first' : ''}">`
      + '<div class="stage-head"><h3>How it happened</h3>'
        + `<span class="stage-sub">${drives} drive${drives === 1 ? '' : 's'}</span></div>`
      + '<div class="bth-story">'
        + renderDriveChart(s.drives, { selectedId: s.selectedDrive })
        + renderWinProb(s.winProb, teams, { scoringSeqs })
      + '</div>'
    + '</div>'
    + '<div class="kicker bth-more-h">The detail</div>'
    + '<div class="panel bth-detail"><div class="panel-body" style="display:grid;gap:12px">'
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
      logo: 'assets/logos/phi.png', primary: '#06424d', record: null },
    away: { abbr: 'DAL', fullName: 'Dallas Cowboys', score: rs.awayScore,
      logo: 'assets/logos/dal.png', primary: '#002a5c', record: null },
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
    // ⚠️ AFTER the paint, never before. The render that is happening on the line
    // above IS the entrance; every one after it is a poll landing on a surface
    // already on screen, and must arrive without animating.
    state.settled = true;
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
  // Coming back to this tab is a genuine arrival, so it gets its entrance again.
  state.settled = false;
}
