import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { openDb } from '../../../services/sts2-stats/src/db.mjs';
import { createLimits } from '../../../services/sts2-stats/src/limits.mjs';
import { createHandler } from '../../../services/sts2-stats/src/app.mjs';
import { pluginData } from '../../../services/sts2-stats/src/data.mjs';
import { createParty } from '../../../services/sts2-stats/src/party.mjs';
import { channelsFrom, refreshLinks, inviteToParty, pushParty, pullParty, sharedCurrent, sharingNow, importedRuns, makePartySaves, guessYou } from './party.js';

const ROOT = process.cwd();
const snap = (n) => JSON.parse(readFileSync(`${ROOT}/scripts/sts2/fixtures/saves/${n}.json`));
const CURRENT = snap('current-run-coop'); // the host is player 2; the friend is player 1
const RUNS = snap('runs');
const RUN = snap('run-1773796874'); // finished co-op run; the friend is player 1 in it too

const memory = () => {
  const m = new Map();
  return { m, get: async (k) => structuredClone(m.get(k) ?? null), set: async (k, v) => { m.set(k, structuredClone(v)); }, del: async (k) => { m.delete(k); } };
};

const hostSaves = async (action, params) => {
  if (action === 'currentRun') return CURRENT;
  if (action === 'runs') return RUNS;
  if (action === 'run') return params.id === RUN.summary.id ? RUN : { status: 'not_found' };
  return { status: 'error' };
};
/** A co-op guest's game keeps nothing of the run (confirmed 2026-09-14: no current_run_mp.save). */
const guestSaves = async (action) => {
  if (action === 'currentRun') return { status: 'no_current_run' };
  if (action === 'runs') return { status: 'ok', game: 'slay-the-spire-2', runs: [], skipped: 0, next_before: null };
  return { status: 'not_found' };
};

/**
 * friends:link as dissent-core plugin_links.go answers it. `inRun(run)` says whether the friend's verified Steam
 * account is among that run's players (the Dissent app and the node decide that; the plugin only sees matches).
 * Automatic matches link at once; invites wait for accept; stopped links are never matched again.
 */
function fakeNode({ inRun = () => true } = {}) {
  const links = [];
  let n = 0;
  const secret = () => `${(++n).toString(16).padStart(8, '0')}${'ab'.repeat(28)}`;
  const view = (me, l) => {
    const sent = l.from === me;
    return { id: l.id, status: l.status, auto: l.auto, direction: sent ? 'sent' : 'received', created_at: new Date(BEFORE_RUN).toISOString(),
      peer: { handle: `h-${sent ? l.to : l.from}`, name: sent ? 'jj' : 'KROWN' },
      ...(sent || l.status === 'accepted' ? { payload: l.payload } : {}), ...(l.status === 'accepted' ? { secret: l.secret } : {}) };
  };
  const api = (me) => ({
    list: async () => ({ friends: [{ handle: `h-${me === 'host' ? 'guest' : 'host'}`, name: me === 'host' ? 'jj' : 'KROWN' }], me: `h-${me}`, auto: true }),
    links: async () => ({ links: links.filter((l) => (l.from === me || l.to === me) && l.status !== 'stopped').map((l) => view(me, l)) }),
    invite: async (handle, payload) => {
      const l = { id: `l${n + 1}`, from: me, to: handle.slice(2), payload, status: 'pending', auto: false, secret: secret() };
      links.push(l);
      return { id: l.id, status: 'pending' };
    },
    respond: async (id, accept) => { const i = links.findIndex((l) => l.id === id && l.to === me); if (accept) links[i].status = 'accepted'; else links.splice(i, 1); },
    remove: async (id) => { const l = links.find((x) => x.id === id); l.status = 'stopped'; },
    match: async (run) => {
      if (me !== 'host' || !inRun(run)) return { status: 'ok', matches: [] };
      let l = links.find((x) => [x.from, x.to].includes('guest'));
      if (!l) { l = { id: `l${n + 1}`, from: 'host', to: 'guest', payload: {}, status: 'accepted', auto: true, secret: secret() }; links.push(l); }
      if (l.status === 'stopped') return { status: 'ok', matches: [] };
      if (l.status === 'pending') l.status = 'accepted';
      return { status: 'ok', matches: [{ handle: 'h-guest', name: 'jj', player: 1, link_id: l.id, status: 'accepted', secret: l.secret }] };
    },
  });
  return { links, host: api('host'), guest: api('guest') };
}

let server; let net; let posts;
beforeEach(async () => {
  server = http.createServer(createHandler({ db: openDb(':memory:'), data: pluginData(), limits: createLimits(), party: createParty() }));
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

// Links made "before" the fixture run, so its finished run counts as after.
const BEFORE_RUN = (Number(RUN.summary.id) - 10) * 1000;

function people(node) {
  return {
    host: { store: memory(), local: memory(), friends: node.host },
    guest: { store: memory(), local: memory(), friends: node.guest },
  };
}
async function sync(p, saves) {
  const channels = channelsFrom(await refreshLinks(p));
  return pushParty({ saves, ...p, net, channels });
}
async function receive(p) {
  const channels = channelsFrom(await refreshLinks(p));
  return pullParty({ ...p, net, channels });
}

describe('automatic: friends playing the same run', () => {
  it('🔴 the host plays with a friend → the friend\'s Companion shows the run, as the player the host\'s app matched', async () => {
    const node = fakeNode();
    const { host, guest } = people(node);
    expect(await sync(host, hostSaves)).toMatchObject({ current: 'sent', sharingWith: ['jj'] });
    expect(node.links).toHaveLength(1);
    expect(node.links[0]).toMatchObject({ auto: true, status: 'accepted' });
    expect(await sharingNow(host.local)).toEqual(['jj']);

    await receive(guest);
    const saves = makePartySaves({ saves: guestSaves, ...guest, net });
    const run = await saves('currentRun');
    expect(run).toMatchObject({ status: 'ok', you: 1, character: 'CHARACTER.SILENT' });
    expect(run.shared).toMatchObject({ by: 'party', peer: 'KROWN' });
  });

  it('🔴 the relay only ever sees sealed bytes', async () => {
    const { host } = people(fakeNode());
    await sync(host, hostSaves);
    expect(posts.length).toBeGreaterThan(0);
    const decoded = posts.map((p) => Buffer.from(p.body.data, 'base64').toString('latin1')).join('');
    const wire = JSON.stringify(posts) + decoded;
    for (const plain of ['CHARACTER.SILENT', 'CARD.', 'RELIC.', RUN.summary.id, '"players"', 'h-guest']) expect(wire).not.toContain(plain);
  });

  it('sends a run in progress only when it changed, and asks who is in it only then', async () => {
    const node = fakeNode();
    let asked = 0;
    const match = node.host.match;
    node.host.match = async (run) => { asked += 1; return match(run); };
    const { host } = people(node);
    const noHistory = async (a, p) => (a === 'runs' ? { ...RUNS, runs: [] } : hostSaves(a, p));
    await sync(host, noHistory);
    const before = { posts: posts.length, asked };
    expect(await sync(host, noHistory)).toMatchObject({ current: 'unchanged' });
    expect(posts.length - before.posts).toBe(0);
    expect(asked).toBe(before.asked + 0);
  });

  it('a finished run reaches the friend who played it, once, marked as theirs', async () => {
    const node = fakeNode();
    const { host, guest } = people(node);
    await sync(host, hostSaves); // the run in progress makes the link
    expect((await sync(host, hostSaves)).finished).toBe(1); // then the finished run goes to it
    expect((await sync(host, hostSaves)).finished).toBe(0); // once
    await receive(guest);
    await receive(guest);
    expect((await importedRuns(guest.local)).map((r) => r.id)).toEqual([RUN.summary.id]);
    const saves = makePartySaves({ saves: guestSaves, ...guest, net });
    expect((await saves('runs', { limit: 100 })).runs[0]).toMatchObject({ id: RUN.summary.id, you: 1, shared: 'party' });
    expect((await saves('run', { id: RUN.summary.id })).floors).toHaveLength(RUN.floors.length);
  });

  // 🔴 A friend linked automatically receives only runs they were in.
  it('🔴 a friend who was not in a finished run never receives it', async () => {
    const node = fakeNode({ inRun: (run) => run === undefined }); // in the current run, not in the finished one
    const { host, guest } = people(node);
    expect(await sync(host, hostSaves)).toMatchObject({ current: 'sent', finished: 0 });
    expect(await sync(host, hostSaves)).toMatchObject({ finished: 0 });
    expect(posts.filter((p) => p.url.endsWith('/finished'))).toEqual([]);
    await receive(guest);
    expect(await importedRuns(guest.local)).toEqual([]);
  });

  it('a stopped link is not matched again: nothing more is sent', async () => {
    const node = fakeNode();
    const { host, guest } = people(node);
    await sync(host, hostSaves);
    await node.guest.remove(node.links[0].id);
    posts = [];
    const changed = async (a, p) => (a === 'currentRun' ? { ...CURRENT, saved_at: CURRENT.saved_at + 60 } : hostSaves(a, p));
    expect(await sync(host, changed)).toMatchObject({ sharingWith: [] });
    expect(posts).toEqual([]);
    expect(channelsFrom(await refreshLinks(guest))).toEqual([]);
  });

  it('a solo run is never sent, and no friend is asked about', async () => {
    const node = fakeNode();
    const { host } = people(node);
    const solo = { ...CURRENT, you: 1, players: [CURRENT.players[0]] };
    const soloSaves = async (a, p) => (a === 'currentRun' ? solo : a === 'runs' ? { ...RUNS, runs: [] } : hostSaves(a, p));
    expect(await sync(host, soloSaves)).toMatchObject({ current: 'not_coop', finished: 0 });
    expect(posts).toEqual([]);
    expect(node.links).toEqual([]);
  });

  it('the host never imports its own runs, and keeps reading its own files first', async () => {
    const { host } = people(fakeNode());
    await sync(host, hostSaves);
    await receive(host);
    expect(await importedRuns(host.local)).toEqual([]);
    expect((await makePartySaves({ saves: hostSaves, ...host, net })('currentRun')).shared).toBeUndefined();
  });
});

describe('invites: the fallback for a friend matching cannot find', () => {
  it('🔴 nothing is shared until the friend accepts; then they receive the host\'s co-op runs', async () => {
    const node = fakeNode({ inRun: () => false }); // e.g. no Steam connected
    const { host, guest } = people(node);
    await inviteToParty({ ...host, handle: 'h-guest' });
    const received = (await refreshLinks(guest))[0];
    expect(received).toMatchObject({ status: 'pending', direction: 'received' });
    expect(received.secret).toBeUndefined();
    expect(await sync(host, hostSaves)).toMatchObject({ sharingWith: [] });
    expect(posts).toEqual([]);

    await node.guest.respond(received.id, true);
    const changed = async (a, p) => (a === 'currentRun' ? { ...CURRENT, saved_at: CURRENT.saved_at + 60 } : hostSaves(a, p));
    expect(await sync(host, changed)).toMatchObject({ current: 'sent', sharingWith: ['jj'] });
    await receive(guest);
    // Not matched, so the position is inferred: two players, the host was 2.
    expect((await makePartySaves({ saves: guestSaves, ...guest, net })('currentRun')).you).toBe(1);
  });
});

describe('with no accepted link', () => {
  it('saves are the local ones, untouched', async () => {
    const saves = makePartySaves({ saves: guestSaves, store: memory(), local: memory(), net });
    expect(await saves('currentRun')).toEqual({ status: 'no_current_run' });
  });
});

describe('guessYou', () => {
  it('in a two-player run the receiver is the player the sender was not; with more players, unknown', () => {
    expect(guessYou(2, 2)).toBe(1);
    expect(guessYou(1, 2)).toBe(2);
    expect(guessYou(null, 2)).toBeNull();
    expect(guessYou(1, 3)).toBeNull();
  });
});
