// tower-main.js — the Tower as a Dissent games-room plugin (Dissent spec 2026-10-20-tower-plugin-design §7). Boot, the
// table, the loop, keys, passing messages, the report, sound. It plays the round exactly as the built-in Tower did
// (towerRound.js and friends are the same modules); only the edges changed:
//   - the table comes from game.lobby() and its events, never the app;
//   - messages go through games.send and arrive as `game.message` events;
//   - the round is reported as places the node settles by agreement (roundEnd.js), and pays through game_win;
//   - 🔴 GO is timed by the node's clock (`elapsed_ms`), never this PC's — a fast PC clock used to skip the countdown;
//   - Leave, Play again and the sound level are SDK calls (games.leave / games.start / games.sound).
// Only `request` and `handleSDKMessage` come from the SDK by name: a node that mirrors plugins serves its own embedded
// copy, which may be older, and a named import it lacks would stop the whole game loading (check-named-imports.mjs).
import { handleSDKMessage, request } from "../plugin-sdk.js";
import { Keys, StepClock } from "./input.js";
import { NO_INTENT } from "./climb.js";
import { ITEM_INFO } from "./items.js";
import { floorOf } from "./towerGen.js";
import { parseMsg } from "./towerProtocol.js";
import { Round, SEAT_COLORS } from "./towerRound.js";
import { drawRound, newViewState } from "./towerView.js";
import { mistLevel } from "./mist.js";
import { fmtTime, MODE_NAMES, prizeLine, resultCard, rowRight } from "./hudParts.js";
import { COUNT_MS, LEAD_MS, MAX_STEPS, MODES, STEP } from "./tuning.js";
import { lateMs } from "./roundClock.js";
import { readPrefs, TowerAudio, writePrefs } from "./sound/towerAudio.js";
import { soundFor } from "./sound/eventSounds.js";
import { Hud } from "./tower-hud.js";

const canvas = document.getElementById("view");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const standalone = window.parent === window;

let lobby = null, receivedAt = 0, selfId = null, round = null, closed = false, menuOpen = false;
let view = newViewState();
let bestBefore = null; // my best on this board before the round (for "New best!")
const keys = new Keys();
let prefs = readPrefs();
let appSound = { volume: 1, deafened: false };
const audio = new TowerAudio(appSound.volume, appSound.deafened, prefs);

const names = new Map();
const nameOf = (id) => names.get(id) ?? "Someone";
const colorOf = (id) => round?.seats.find((s) => s.id === id)?.color ?? "#c99a4b";

const hud = new Hud(document.getElementById("hud"), {
  leave, resume, giveUp,
  playAgain: () => { request("games.start", {}).catch(() => hud.note("Couldn't start the next round")); },
  prefs: (p) => { prefs = p; writePrefs(p); audio.setPrefs(p); hud.setPrefs(p); },
});
hud.setPrefs(prefs);

const send = (m) => { if (!standalone) request("games.send", { data: m }).catch(() => {}); };

function leave() {
  audio.close();
  if (standalone) return;
  request("games.leave", {}).catch(() => {}); // the app takes the player back to the games room
}
function resume() { menuOpen = false; hud.setCard({ kind: "none" }); canvas.focus(); }
function giveUp() {
  if (round) { round.gaveUp = true; round.gaveUpMs = Math.max(0, Math.round(round.raceMs)); }
  resume();
}

/** The seats: players by seat, each with their seat's colour. */
function seatsOf(l) {
  return l.members.filter((m) => m.role === "player").sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0))
    .map((m) => ({ id: m.user_id, name: m.name, color: SEAT_COLORS[(m.seat ?? 0) % SEAT_COLORS.length] }));
}

/** A new lobby from the node: a new round when it turns playing, the result when it settles, the seats as they change. */
function setLobby(l) {
  if (!l) return;
  lobby = l;
  receivedAt = Date.now();
  selfId = l.you?.user_id ?? selfId;
  for (const m of l.members) names.set(m.user_id, m.name);
  const seats = seatsOf(l);
  if (l.status === "playing" && l.seed != null && (l.round ?? 0) > (round?.round ?? 0)) startRound(l, seats);
  else if (round) round.setSeats(seats);
  if (l.status === "open" && l.result && round && l.result.round === round.round) showResult(l);
}

function startRound(l, seats) {
  const set = l.settings ?? {};
  const floors = Number(set.floors) || 100;
  const mode = set.mode && set.mode in MODE_NAMES ? set.mode : "race";
  const watching = !seats.some((s) => s.id === selfId);
  const r = new Round(l.round ?? 1, l.seed, floors, selfId, seats, watching, mode);
  // 🔴 Every copy's GO is the node's start + LEAD_MS + the countdown, by the NODE's clock (roundClock.js).
  r.raceMs = lateMs(l, receivedAt, Date.now()) - LEAD_MS - COUNT_MS * 3;
  round = r;
  view = newViewState();
  view.y = 110 - 2000;
  menuOpen = false;
  hud.setCard({ kind: "none" });
  audio.resume();
  audio.music?.stop();
  audio.muffle(false);
  canvas.focus();
  bestBefore = null;
  if (!watching && !standalone) {
    request("games.leaderboard", { period: "all" })
      .then((b) => { bestBefore = b?.best?.find((x) => x.user_id === selfId)?.best ?? null; })
      .catch(() => {}); // leaderboards off, or an older app: no "New best!"
  }
}

function showResult(l) {
  const res = l.result;
  const r = round;
  if (r.myFinishMs === null) audio.music?.stop(); // a finisher's music already resolved
  const card = resultCard(res, r.mode, selfId, nameOf, colorOf);
  const sub = r.mode === "last" || r.mode === "koth" ? MODE_NAMES[r.mode] : `${MODE_NAMES[r.mode] ?? "First to the top"} · ${r.floors} floors`;
  const mine = res.places?.find((p) => p.user_id === selfId);
  // Only when you beat a best you already had on this board: a first round is not news.
  const best = mine && typeof mine.score === "number" && bestBefore !== null && mine.score > bestBefore && !res.disputed
    ? `New best on this board: ${mine.label}` : null;
  hud.setCard({ kind: "result", ...card, sub, best, host: l.host_id === selfId, hostName: nameOf(l.host_id),
    prizeLine: prizeLine(res, nameOf(res.places?.[0]?.user_id ?? "")) });
}

async function reread() {
  try { setLobby(await request("games.lobby", {})); } catch { /* the next event tries again */ }
}

// ── Messages from the host: the table, the others, the sound level ─────────────────────────────────────────────────
function onEvent(ev) {
  if (ev.event === "game.lobby") {
    if (ev.data?.closed) { closed = true; audio.music?.stop(); hud.setCard({ kind: "closed" }); return; }
    void reread();
  } else if (ev.event === "game.message") {
    const m = parseMsg(ev.data?.data);
    if (!m || !round) return;
    round.receive(ev.data.from, m);
    if (m.k === "fin") hud.note(`${nameOf(ev.data.from)} reached the top`);
    if (m.k === "quit") hud.note(`${nameOf(ev.data.from)} gave up this round`);
  } else if (ev.event === "game.rate_limited") {
    round?.limited();
  } else if (ev.event === "game.sound") {
    appSound = ev.data ?? appSound;
    audio.setVolume(appSound.volume, appSound.deafened);
  }
}
addEventListener("message", (e) => handleSDKMessage(e, onInit, onEvent));

async function onInit(msg) {
  if (msg.context?.contextType !== "games") return;
  try { appSound = await request("games.sound", {}); audio.setVolume(appSound.volume, appSound.deafened); } catch { /* an older app: full volume */ }
  await reread();
}

// ── Keys: on the game's own frame ───────────────────────────────────────────────────────────────────────────────────
addEventListener("keydown", (e) => {
  audio.resume();
  if (e.key === "Escape") {
    e.preventDefault();
    if (hud.card.kind === "menu") { resume(); return; }
    if (hud.card.kind !== "none") return;
    menuOpen = true;
    hud.setCard({ kind: "menu", canGiveUp: !!round?.live && round.seats.length > 1 });
    return;
  }
  if (keys.down(e.key, e.repeat)) e.preventDefault();
});
addEventListener("keyup", (e) => keys.up(e.key));
addEventListener("blur", () => keys.clear());
canvas.addEventListener("pointerdown", () => { audio.resume(); canvas.focus(); });

// ── The loop ────────────────────────────────────────────────────────────────────────────────────────────────────────
const clock = new StepClock(STEP, MAX_STEPS);
const NO_STEP = { ...NO_INTENT, punch: false, use: false };
let last = 0, hudAt = 0, level = 0, counted = 99, waitingShown = -1, musicRound = -1, comboStep = 0, winRound = -1;

function sound(ev, r) {
  if (typeof ev === "object" && "comboEnded" in ev) comboStep = 0;
  if (typeof ev === "object" && "boom" in ev && r.me && Math.abs(ev.boom.y - r.me.y) > 900) return; // off my screen
  const s = soundFor(ev, comboStep);
  if (typeof ev === "object" && "combo" in ev) comboStep++;
  if (!s) return;
  audio.play(s.name, s.n);
  if (s.name === "out") audio.muffle(true);
}

function onRoundEvent(r, ev) {
  if (typeof ev === "string") {
    if (ev === "hurt") hud.note("Ow!");
    if (ev === "shield-pop") hud.note("Your shield broke");
    if (ev === "out") hud.say("The mist got you", "small");
    if (ev === "swapped") hud.note("Grapple: swapped places");
    return;
  }
  if ("combo" in ev) hud.say(`Combo ×${ev.combo}`, "combo");
  else if ("comboEnded" in ev) hud.note(`Combo: ${ev.comboEnded} floors`);
  else if ("crate" in ev) hud.note(`Crate: ${ITEM_INFO[ev.crate].name}${ev.strong ? " (last place gets the strong ones)" : ""}`);
  else if ("feed" in ev) hud.note(ev.feed);
  else if ("boom" in ev) view.blasts.push({ ...ev.boom, at: Math.max(0, r.raceMs) / 1000 });
}

// A failed report is tried again, at most every REPORT_RETRY_MS. 🔴 Never when the app or node said no for good: an
// older app that doesn't know games.report was asked 60 times a second (the round settles from the others' reports).
const REPORT_RETRY_MS = 2000;
let reportRetryAt = 0;
function report(r) {
  if (performance.now() < reportRetryAt) return;
  r.reported = true;
  request("games.report", r.report()).catch((err) => {
    const why = String(err?.message ?? err);
    if (/not_open|wrong_round|no_rounds|unknown action|not available/.test(why)) return;
    r.reported = false;
    reportRetryAt = performance.now() + REPORT_RETRY_MS;
  });
}

function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (ts - (last || ts)) / 1000);
  last = ts;
  const r = round;
  if (!r) return;
  const n = clock.steps(dt);
  for (let i = 0; i < n; i++) {
    // Hit-stop freezes the game for a moment; the presses wait for a step that runs (spec §8.2).
    if (r.hitStopMs > 0) { r.hitStopMs -= STEP * 1000; continue; }
    r.step(menuOpen ? NO_STEP : keys.take(), STEP);
  }
  for (const ev of r.events.splice(0)) { onRoundEvent(r, ev); sound(ev, r); }
  // The music starts with the countdown, once per round, calm; GO brings in the beat; each Hurry up builds it.
  const music = audio.music;
  if (music && musicRound !== r.round && r.raceMs >= -COUNT_MS * 3) { musicRound = r.round; level = 0; music.setIntensity(r.started ? 1 : 0); music.start(); }
  const left = Math.ceil(-r.raceMs / COUNT_MS);
  if (left !== counted && left >= 0 && left <= 3) {
    counted = left;
    hud.say(left === 0 ? "GO!" : String(left));
    if (left === 0) { audio.play("go"); music?.setIntensity(1); } else audio.play("count", 3 - left);
  }
  if (r.started && mistLevel(r.raceMs) > level) {
    level = mistLevel(r.raceMs);
    hud.say("Hurry up!", "small");
    audio.play("hurry");
    music?.setIntensity(1 + level);
  }
  if (r.myFinishMs !== null && winRound !== r.round) { winRound = r.round; audio.play("win"); music?.resolve(); }
  for (const m of r.outbox()) send(m);
  if (!standalone && r.reportDue()) report(r);
  if (r.me && (r.myFinishMs !== null || r.gaveUp || r.myOutMs !== null) && waitingShown !== r.round && hud.card.kind !== "result") {
    waitingShown = r.round;
    if (r.myFinishMs !== null) hud.note("You reached the top!");
    const title = r.myFinishMs !== null ? `You reached the top · ${fmtTime(r.myFinishMs)}`
      : r.myOutMs !== null ? `Out at ${fmtTime(r.myOutMs)} — watching` : "You gave up this round";
    hud.setCard({ kind: "waiting", title, rows: [] });
  }
  const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext("2d");
  if (ctx) drawRound(ctx, r, view, w, h, dpr, dt, reduced);
  if (ts - hudAt > 100) {
    hudAt = ts;
    const st = r.standings();
    const place = st.findIndex((s) => s.id === r.selfId) + 1;
    const alive = st.filter((p) => p.outMs === null && !p.quit).length;
    hud.setHud({
      floor: r.me ? Math.max(0, floorOf(r.me.y)) : Math.max(0, st[0]?.floor ?? 0),
      floors: r.mode === "last" ? 0 : r.floors,
      place: !r.me ? "watching" : st.length === 1 ? "solo" : `${place} of ${st.length}`,
      timeMs: r.myFinishMs ?? r.myOutMs ?? r.gaveUpMs ?? Math.max(0, r.raceMs),
      keysFaded: r.raceMs > 8000,
      item: r.item ? { glyph: ITEM_INFO[r.item].glyph, name: ITEM_INFO[r.item].name } : null,
      extra: r.mode === "koth" ? `Crown ${fmtTime(r.myCrownMs).slice(0, -2)} / ${fmtTime(MODES.crownWinMs).slice(0, -2)}`
        : r.mode === "last" && st.length > 1 ? `${alive} left` : null,
    });
    if (hud.card.kind === "waiting") {
      hud.setCard({ ...hud.card, rows: st.map((p) => ({ id: p.id, name: nameOf(p.id) + (p.id === r.selfId ? " (you)" : ""), color: colorOf(p.id), right: rowRight(r.mode, p) })) });
    }
  }
}
requestAnimationFrame(frame);

// Opened on its own (never inside Dissent): a solo round to try the game, and a handle for the local check.
if (standalone) {
  const id = "00000000-0000-4000-8000-000000000001";
  const mode = new URLSearchParams(location.search).get("mode") ?? "race";
  setLobby({ id: "solo", status: "playing", seed: (Date.now() & 0x7fffffff) || 1, round: 1, elapsed_ms: 0, host_id: id,
    settings: { mode, floors: 50 }, members: [{ user_id: id, name: "You", role: "player", seat: 0 }], you: { user_id: id, role: "player", seat: 0 } });
}
// A read-only handle on the game's own state, for the checks (verify-tower-plugin*.mjs). Only this page can read it.
window.__tower = { get round() { return round; }, get hud() { return hud.card; }, get lobby() { return lobby; }, get said() { return [...hud.said]; } };
