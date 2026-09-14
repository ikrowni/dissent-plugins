import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { openDb } from '../../../services/sts2-stats/src/db.mjs';
import { createLimits } from '../../../services/sts2-stats/src/limits.mjs';
import { createHandler } from '../../../services/sts2-stats/src/app.mjs';
import { pluginData } from '../../../services/sts2-stats/src/data.mjs';
import { createParty } from '../../../services/sts2-stats/src/party.mjs';
import { startParty, joinParty, leaveParty, readParty, pushParty, pullParty, sharedCurrent, importedRuns, makePartySaves, guessYou } from './party.js';

const ROOT = process.cwd();
const snap = (n) => JSON.parse(readFileSync(`${ROOT}/scripts/sts2/fixtures/saves/${n}.json`));
const CURRENT = snap('current-run-coop'); // the host is player 2 in this real sample
const RUNS = snap('runs');
const RUN = snap('run-1773796874'); // a finished co-op run; the host was player 2

const memory = () => {
  const m = new Map();
  return { m, get: async (k) => structuredClone(m.get(k) ?? null), set: async (k, v) => { m.set(k, structuredClone(v)); }, del: async (k) => { m.delete(k); } };
};

/** The host's game: the co-op run in progress and the finished run in history. */
const hostSaves = async (action, params) => {
  if (action === 'currentRun') return CURRENT;
  if (action === 'runs') return RUNS;
  if (action === 'run') return params.id === RUN.summary.id ? RUN : { status: 'not_found' };
  return { status: 'error' };
};
/** The guest's game keeps nothing of a co-op run (confirmed 2026-09-14: no current_run_mp.save). */
const guestSaves = async (action) => {
  if (action === 'currentRun') return { status: 'no_current_run' };
  if (action === 'runs') return { status: 'ok', game: 'slay-the-spire-2', runs: [], skipped: 0, next_before: null };
  if (action === 'run') return { status: 'not_found' };
  return { status: 'error' };
};

let server; let relay; let net; let posts; let db;
beforeEach(async () => {
  db = openDb(':memory:');
  relay = createParty();
  server = http.createServer(createHandler({ db, data: pluginData(), limits: createLimits(), party: relay }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  posts = [];
  net = async (url, { method = 'GET', body, headers } = {}) => {
    if (method === 'POST') posts.push({ url, body: JSON.parse(body) });
    const r = await fetch(base + new URL(url).pathname, { method, body, headers });
    return { status: r.status, body: await r.text(), content_type: r.headers.get('content-type'), etag: null, truncated: false };
  };
});
afterEach(() => new Promise((r) => server.close(r)));

// Runs finished before the party started are not sent; the fixture run is old, so start the party before it.
const BEFORE_RUN = (Number(RUN.summary.id) - 10) * 1000;

async function party() {
  const host = { store: memory(), local: memory() };
  const guest = { store: memory(), local: memory() };
  const { code } = await startParty(host.store, { now: BEFORE_RUN });
  await joinParty(guest.store, code, { now: BEFORE_RUN });
  return { host, guest, code };
}

describe('joining', () => {
  it('start makes a code; join accepts it however typed; a bad code is refused; leave forgets it', async () => {
    const store = memory();
    const { code } = await startParty(store);
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const other = memory();
    expect(await joinParty(other, code.toLowerCase().replace(/-/g, ' '))).toMatchObject({ ok: true, code });
    expect(await joinParty(memory(), 'nope')).toEqual({ ok: false, error: 'not a party code' });
    await leaveParty(other);
    expect(await readParty(other)).toBeNull();
  });
});

describe('host → relay → guest, with the REAL co-op samples', () => {
  it('the guest sees the host\'s run in progress, with the guest marked as the other player', async () => {
    const { host, guest } = await party();
    expect(await pushParty({ saves: hostSaves, ...host, net })).toMatchObject({ current: 'sent' });
    await pullParty({ ...guest, net });
    const shared = await sharedCurrent(guest.local);
    expect(shared.run.players.map((p) => p.character)).toEqual(['CHARACTER.SILENT', 'CHARACTER.DEFECT']);

    const saves = makePartySaves({ saves: guestSaves, ...guest, net });
    const run = await saves('currentRun');
    expect(run).toMatchObject({ status: 'ok', you: 1, character: 'CHARACTER.SILENT' });
    expect(run.shared).toMatchObject({ by: 'party' });
  });

  // 🔴 What crosses the relay is sealed: no deck, no character, no id is readable there.
  it('🔴 the relay only ever sees sealed bytes', async () => {
    const { host } = await party();
    await pushParty({ saves: hostSaves, ...host, net });
    expect(posts.length).toBeGreaterThan(0);
    // Checked on the wire AND with every payload base64-decoded: base64 alone hides plain text from a scan.
    const decoded = posts.map((p) => Buffer.from(p.body.data, 'base64').toString('latin1')).join('');
    const wire = JSON.stringify(posts) + decoded;
    for (const plain of ['CHARACTER.SILENT', 'CARD.', 'RELIC.', RUN.summary.id, '"players"']) expect(wire).not.toContain(plain);
  });

  it('sends a run in progress only when it changed', async () => {
    const { host } = await party();
    await pushParty({ saves: hostSaves, ...host, net });
    const n = posts.filter((p) => p.url.endsWith('/current')).length;
    expect(await pushParty({ saves: hostSaves, ...host, net })).toMatchObject({ current: 'unchanged' });
    expect(posts.filter((p) => p.url.endsWith('/current'))).toHaveLength(n);
  });

  it('a finished co-op run reaches the guest\'s Run History once, as theirs', async () => {
    const { host, guest } = await party();
    expect(await pushParty({ saves: hostSaves, ...host, net })).toMatchObject({ finished: 1 });
    expect(await pushParty({ saves: hostSaves, ...host, net })).toMatchObject({ finished: 0 });
    await pullParty({ ...guest, net });
    await pullParty({ ...guest, net });
    expect((await importedRuns(guest.local)).map((r) => r.id)).toEqual([RUN.summary.id]);

    const saves = makePartySaves({ saves: guestSaves, ...guest, net });
    const list = await saves('runs', { limit: 100 });
    expect(list.runs).toHaveLength(1);
    expect(list.runs[0]).toMatchObject({ id: RUN.summary.id, you: 1, shared: 'party' });
    const run = await saves('run', { id: RUN.summary.id });
    expect(run.summary).toMatchObject({ you: 1, shared: 'party' });
    expect(run.floors).toHaveLength(RUN.floors.length);
  });

  it('runs finished before the party started are not sent', async () => {
    const host = { store: memory(), local: memory() };
    await startParty(host.store, { now: (Number(RUN.summary.id) + 99_999) * 1000 });
    expect(await pushParty({ saves: hostSaves, ...host, net })).toMatchObject({ finished: 0 });
  });

  it('a member never imports its own runs, and the host keeps reading its own files first', async () => {
    const { host } = await party();
    await pushParty({ saves: hostSaves, ...host, net });
    await pullParty({ ...host, net });
    expect(await importedRuns(host.local)).toEqual([]);
    const saves = makePartySaves({ saves: hostSaves, ...host, net });
    expect((await saves('currentRun')).shared).toBeUndefined();
  });

  it('a solo run is never sent', async () => {
    const { host } = await party();
    const solo = { ...CURRENT, you: 1, players: [CURRENT.players[0]] };
    const soloSaves = async (a, p) => (a === 'currentRun' ? solo : a === 'runs' ? { ...RUNS, runs: [] } : hostSaves(a, p));
    expect(await pushParty({ saves: soloSaves, ...host, net })).toMatchObject({ current: 'not_coop', finished: 0 });
    expect(posts).toEqual([]);
  });

  it('out of a party: saves are the local ones, untouched', async () => {
    const saves = makePartySaves({ saves: guestSaves, store: memory(), local: memory(), net });
    expect(await saves('currentRun')).toEqual({ status: 'no_current_run' });
  });
});

describe('guessYou', () => {
  it('in a two-player run the guest is the player the sender was not; with more players, unknown', () => {
    expect(guessYou(2, 2)).toBe(1);
    expect(guessYou(1, 2)).toBe(2);
    expect(guessYou(null, 2)).toBeNull();
    expect(guessYou(1, 3)).toBeNull();
  });
});
