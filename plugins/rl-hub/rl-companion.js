#!/usr/bin/env node
// rl-companion.js — bridges local RL Stats API socket to Dissent's plugin push endpoint
// Manual: node rl-companion.js --server <url> --token <jwt> --server-id <uuid> --channel-id <id>
// Daemon: node rl-companion.js --config <path/to/config.json> --daemon --quiet
'use strict';

const COMPANION_VERSION = '1.5.0'; // bumped on every installer-breaking change

const net   = require('net');
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const { URL } = require('url');

// ── Config (CLI args + optional config file) ──────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    // Treat as boolean flag if no next arg, or next arg is itself a flag
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++; // consume the value
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const DAEMON      = args['daemon'] === true || args['daemon'] === 'true';
const QUIET       = args['quiet']  === true || args['quiet']  === 'true';
// Derive log path early — before config is parsed — so startup errors are captured
const LOG_PATH    = DAEMON && args['config']
  ? String(args['config']).replace(/[^/\\]*$/, 'companion.log')
  : null;

function ts() { return new Date().toISOString(); }

function writeLine(line) {
  if (LOG_PATH) { try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch {} }
}

function clearLog() {
  if (LOG_PATH) { try { fs.writeFileSync(LOG_PATH, ''); } catch {} }
  const sep = '─'.repeat(60);
  const banner = `${sep}\n  NEW MATCH  ${ts()}\n${sep}`;
  if (!QUIET) console.log(banner);
  writeLine(banner);
}

function log(...a) {
  const line = `[${ts()}] ${a.join(' ')}`;
  if (!QUIET) console.log(line);
  writeLine(line);
}

function warn(...a) {
  const line = `[${ts()}] WARN ${a.join(' ')}`;
  console.warn(line);
  writeLine(line);
}

function fatal(...a) {
  const line = `[${ts()}] FATAL ${a.join(' ')}`;
  console.error(line);
  writeLine(line);
  process.exit(1);
}

let cfg = {};
if (args['config']) {
  try {
    const raw = fs.readFileSync(String(args['config']), 'utf8')
      .replace(/^﻿/, ''); // strip UTF-8 BOM if present (PowerShell 5 writes it)
    cfg = JSON.parse(raw);
  } catch (e) {
    fatal('Failed to read config file:', e.message);
  }
}

const SERVER_URL  = String(args['server']     ?? cfg.server     ?? '');
const TOKEN       = String(args['token']      ?? cfg.token      ?? '');
const SERVER_ID   = String(args['server-id']  ?? cfg.serverId   ?? '');
const CHANNEL_ID  = String(args['channel-id'] ?? cfg.channelId  ?? '');

if (!SERVER_URL || !TOKEN || !SERVER_ID || !CHANNEL_ID) {
  fatal('server, token, server-id, and channel-id are all required');
}

// ── Push helper ───────────────────────────────────────────────────────────────

function push(event, data) {
  const body = JSON.stringify({ server_id: SERVER_ID, channel_id: CHANNEL_ID, event, data });
  const parsed = new URL(`${SERVER_URL}/api/v1/plugins/rl-hub/push`);
  const lib = parsed.protocol === 'https:' ? https : http;
  const req = lib.request({
    hostname: parsed.hostname,
    port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path:     parsed.pathname,
    method:   'POST',
    headers: {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Authorization':  `Bearer ${TOKEN}`,
    },
  }, res => {
    let raw = '';
    res.on('data', c => raw += c);
    res.on('end', () => {
      if (res.statusCode === 204) {
        log(`[rl-companion] push OK 204 — event: ${event}`);
      } else if (res.statusCode === 401) {
        warn(`[rl-companion] token expired — click "Install on Windows" in the RL Hub plugin to refresh it`);
      } else {
        warn(`[rl-companion] push failed ${res.statusCode} — event: ${event} — ${raw.slice(0, 200)}`);
      }
    });
  });
  req.on('error', err => warn('[rl-companion] push error:', err.message));
  req.write(body);
  req.end();
}

// ── Game state normaliser ─────────────────────────────────────────────────────

function normalise(data) {
  const game = data.Game ?? data.game ?? {};
  const rawPlayers = Array.isArray(data.Players) ? data.Players
                   : Array.isArray(data.players) ? data.players
                   : [];

  const playerEntries = rawPlayers.map(p => ({
    name:         p.Name        ?? p.name        ?? 'Unknown',
    team:         ((p.TeamNum   ?? p.team) === 0) ? 'blue' : 'orange',
    score:        p.Score       ?? p.score       ?? 0,
    goals:        p.Goals       ?? p.goals       ?? 0,
    assists:      p.Assists     ?? p.assists      ?? 0,
    saves:        p.Saves       ?? p.saves       ?? 0,
    shots:        p.Shots       ?? p.shots       ?? 0,
    boost:        p.Boost       ?? p.boost       ?? 0,
    speed:        p.Speed       ?? p.speed       ?? 0,
    demos:        p.Demos       ?? p.demos       ?? 0,
    touches:      p.Touches     ?? p.touches     ?? 0,
    demolished:   p.bDemolished ?? false,
    supersonic:   p.bSupersonic ?? false,
    boosting:     p.bBoosting   ?? false,
    on_wall:      p.bOnWall     ?? false,
    powersliding: p.bPowersliding ?? false,
    is_bot:       false,
    location: {
      x: p.Location?.X ?? p.location?.X ?? p.location?.x ?? 0,
      y: p.Location?.Y ?? p.location?.Y ?? p.location?.y ?? 0,
    },
  }));

  const perTeam = Math.max(
    playerEntries.filter(p => p.team === 'blue').length,
    playerEntries.filter(p => p.team === 'orange').length,
  );
  const modeMap = { 1: '1v1 Duel', 2: '2v2 Doubles', 3: '3v3 Standard' };
  const mode = modeMap[perTeam] ?? 'Unranked';

  const rawTeams   = Array.isArray(game.Teams) ? game.Teams
                   : Array.isArray(game.teams) ? game.teams
                   : [];
  const blueTeam   = rawTeams.find(t => (t.TeamNum ?? t.teamNum) === 0) ?? {};
  const orangeTeam = rawTeams.find(t => (t.TeamNum ?? t.teamNum) === 1) ?? {};

  const rawBall = game.Ball ?? game.ball ?? {};

  return {
    arena:       game.Arena       ?? game.arena       ?? 'Unknown',
    mode,
    time:        Math.floor(game.TimeSeconds ?? game.timeSeconds ?? game.time ?? 0),
    is_overtime: game.bOvertime   ?? game.isOT        ?? false,
    is_replay:   game.bReplay     ?? false,
    has_winner:  game.bHasWinner  ?? false,
    winner:      game.Winner      ?? game.winner      ?? null,
    ball: {
      speed:    rawBall.Speed    ?? rawBall.speed    ?? 0,
      team_num: rawBall.TeamNum  ?? rawBall.teamNum  ?? 255,
    },
    teams: {
      blue: {
        score:           blueTeam.Score          ?? blueTeam.score          ?? 0,
        color_primary:   blueTeam.ColorPrimary   ?? blueTeam.colorPrimary   ?? '1a6fdb',
        color_secondary: blueTeam.ColorSecondary ?? blueTeam.colorSecondary ?? '60a5fa',
      },
      orange: {
        score:           orangeTeam.Score          ?? orangeTeam.score          ?? 0,
        color_primary:   orangeTeam.ColorPrimary   ?? orangeTeam.colorPrimary   ?? 'f97316',
        color_secondary: orangeTeam.ColorSecondary ?? orangeTeam.colorSecondary ?? 'fb923c',
      },
    },
    players: playerEntries,
  };
}

// ── Throttled push ────────────────────────────────────────────────────────────

const THROTTLE_MS = 1_000;
let _pending    = null;
let _throttleId = null;

function scheduleUpdate(gameState) {
  _pending = gameState;
  if (_throttleId) return;
  _throttleId = setTimeout(() => {
    _throttleId = null;
    if (_pending) { push('rl:live:update', { game_state: _pending }); _pending = null; }
  }, THROTTLE_MS);
}

function flushEnd() {
  if (_throttleId) { clearTimeout(_throttleId); _throttleId = null; }
  _pending = null;
  push('rl:live:end', {});
}

// ── RL socket connection ──────────────────────────────────────────────────────

const RL_HOST = '127.0.0.1';
const RL_PORT = 49123;
// In daemon mode: retry forever, backing off to 30s after several quick failures.
// In normal mode: give up after 10 attempts so the terminal session isn't hung.
const MAX_RETRIES = DAEMON ? Infinity : 10;
let _retries = 0;
let _matchActive = false;
let _lastKnownTime = 0;

function retryDelay() {
  // Back off to 30s after 5 failed attempts so we don't spin when RL isn't running
  return _retries <= 5 ? 5_000 : 30_000;
}

// Extract all complete JSON objects from buf regardless of whether the sender
// uses newline delimiters. Scans brace depth while respecting string literals
// and escape sequences so inner { } inside Data strings don't confuse the parser.
function extractMessages(buf) {
  const messages = [];
  let i = 0;
  while (i < buf.length) {
    // Skip whitespace / newlines between messages
    while (i < buf.length && buf[i] <= ' ') i++;
    if (i >= buf.length) break;
    if (buf[i] !== '{') { i++; continue; }

    let depth = 0, inStr = false, esc = false, j = i;
    for (; j < buf.length; j++) {
      const ch = buf[j];
      if (esc)              { esc = false; continue; }
      if (ch === '\\' && inStr) { esc = true;  continue; }
      if (ch === '"')           { inStr = !inStr; continue; }
      if (!inStr) {
        if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) break;
      }
    }
    if (depth === 0) { messages.push(buf.slice(i, j + 1)); i = j + 1; }
    else             { break; } // incomplete — wait for more data
  }
  return { messages, remaining: buf.slice(i) };
}

function connect() {
  let buf = '';
  const sock = net.connect(RL_PORT, RL_HOST, () => {
    log('[rl-companion] Connected to RL Stats API');
    _retries = 0;
  });

  sock.setEncoding('utf8');

  let _rawChunks = 0;
  sock.on('data', chunk => {
    if (_rawChunks < 5) {
      log(`[rl-companion] raw data chunk #${++_rawChunks}: ${JSON.stringify(chunk.slice(0, 200))}`);
    } else {
      _rawChunks++;
    }
    buf += chunk;
    const { messages, remaining } = extractMessages(buf);
    buf = remaining;
    for (const msg of messages) {
      try { handleMessage(JSON.parse(msg)); } catch (e) {
        log(`[rl-companion] parse error: ${e.message} — raw: ${JSON.stringify(msg.slice(0, 100))}`);
      }
    }
  });

  sock.on('close', () => {
    log('[rl-companion] RL socket closed');
    if (_throttleId) {
      clearTimeout(_throttleId);
      _throttleId = null;
      // Push whatever state we buffered before the socket dropped
      if (_pending) {
        log('[rl-companion] socket closed with pending state — flushing update');
        push('rl:live:update', { game_state: _pending });
        _pending = null;
      }
    }
    // Don't send rl:live:end on socket close — the match may still be ongoing.
    // Only MatchEnded triggers that.
    retry();
  });

  sock.on('error', () => {
    // error fires before close; suppress — close handler does the retry
  });
}

let _loggedEvents = new Set();

function handleMessage(msg) {
  // RL Stats API uses PascalCase: { Event, Data } where Data is a double-encoded JSON string
  const event = msg.Event ?? msg.event ?? msg.type ?? '';
  let data = msg.Data ?? msg.data ?? msg;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch {}
  }

  // Log first occurrence of each event type so the log isn't flooded
  if (!_loggedEvents.has(event)) {
    _loggedEvents.add(event);
    log(`[rl-companion] RL event: ${event}`);
  }

  if (event === 'UpdateState' || event === 'game:updateState') {
    _matchActive = true;
    scheduleUpdate(normalise(data));
    const g = data.Game ?? data.game ?? {};
    _lastKnownTime = Math.floor(g.TimeSeconds ?? g.timeSeconds ?? g.time ?? 0);
  } else if (event === 'StatfeedEvent') {
    const main      = data.MainTarget      ?? {};
    const secondary = data.SecondaryTarget ?? {};
    push('rl:live:feed', {
      event_name:  data.Type ?? data.EventName ?? 'Unknown',
      player_name: main.Name       ?? 'Unknown',
      team_num:    main.TeamNum    ?? 0,
      victim_name: secondary.Name  ?? null,
      victim_team: secondary.TeamNum ?? null,
      ts:          Date.now(),
    });
  } else if (event === 'MatchEnded' || event === 'EndMatch' || event === 'game:matchEnded') {
    _matchActive = false;
    flushEnd();
  } else if (event === 'GoalScored') {
    push('rl:live:goal', {
      scorer:          data.Scorer?.Name    ?? 'Unknown',
      scorer_team:     data.Scorer?.TeamNum ?? 0,
      assister:        data.Assister?.Name  ?? null,
      goal_speed:      data.GoalSpeed       ?? 0,
      goal_time:       data.GoalTime        ?? 0,
      impact_location: data.ImpactLocation  ?? null,
      match_time:      _lastKnownTime,
      ts:              Date.now(),
    });
  } else if (event === 'BallHit') {
    const hitter = Array.isArray(data.Players) ? data.Players[0] : null;
    push('rl:live:ballhit', {
      player_name:    hitter?.Name    ?? 'Unknown',
      team_num:       hitter?.TeamNum ?? 0,
      pre_hit_speed:  data.Ball?.PreHitSpeed  ?? 0,
      post_hit_speed: data.Ball?.PostHitSpeed ?? 0,
      location:       data.Ball?.Location     ?? null,
      ts:             Date.now(),
    });
  } else if (event === 'CrossbarHit') {
    push('rl:live:crossbar', {
      ball_speed:        data.BallSpeed                    ?? 0,
      impact_force:      data.ImpactForce                  ?? 0,
      last_toucher:      data.BallLastTouch?.Player?.Name  ?? 'Unknown',
      last_toucher_team: data.BallLastTouch?.Player?.TeamNum ?? 0,
      ts:                Date.now(),
    });
  } else if (event === 'MatchPaused') {
    push('rl:live:paused', { ts: Date.now() });
  } else if (event === 'MatchUnpaused') {
    push('rl:live:unpaused', { ts: Date.now() });
  } else if (event === 'MatchCreated') {
    clearLog();
    _matchActive = true;
    _lastKnownTime = 0;
    _loggedEvents.clear();
    push('rl:companion:match:created', {});
  } else if (event === 'Initialized' || event === 'game:initialized') {
    _matchActive = true;
  }
}

function retry() {
  if (_retries >= MAX_RETRIES) {
    console.error('[rl-companion] Max retries reached. Is Rocket League running with the Stats API enabled?');
    process.exit(1);
  }
  _retries++;
  const delay = retryDelay();
  log(`[rl-companion] Waiting for Rocket League… (retry ${_retries}, next check in ${delay / 1000}s)`);
  setTimeout(connect, delay);
}

// ── Start ─────────────────────────────────────────────────────────────────────

log(`[rl-companion] v${COMPANION_VERSION} starting — server: ${SERVER_URL}`);
log('[rl-companion] Waiting for Rocket League Stats API…');

// Announce presence so the plugin can confirm the companion is running
// even before a match begins.
push('rl:companion:online', {});

connect();
