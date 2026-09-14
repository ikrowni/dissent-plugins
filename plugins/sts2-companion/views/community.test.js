// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createData } from '../core/data.js';

const userMem = new Map();
const localMem = new Map();
const kv = (m) => ({
  get: vi.fn(async (k) => (m.has(k) ? structuredClone(m.get(k)) : null)),
  set: vi.fn(async (k, v) => { m.set(k, structuredClone(v)); }),
  del: vi.fn(async (k) => { m.delete(k); }),
});
const store = kv(userMem);
const local = kv(localMem);
const saves = vi.fn();
const net = vi.fn();
vi.mock('../core/host.js', () => ({ store, local, saves, net }));
const { mountCommunity } = await import('./community.js');
const { buildContribution } = await import('../core/contribution.js');
const { SETTINGS_KEY } = await import('../core/sharing.js');
const { aggregate } = await import('../../../services/sts2-stats/src/aggregate.mjs');

const ROOT = process.cwd();
const load = async (n) => JSON.parse(readFileSync(`${ROOT}/plugins/sts2-companion/data/${n}.json`));
const fixture = (n) => JSON.parse(readFileSync(`${ROOT}/scripts/sts2/fixtures/saves/${n}.json`));
const RUNS = fixture('runs');
const RUN = fixture('run-1773796874');
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 10)); };
const ctx = () => ({ data: createData({ load }), onSavesChanged: () => () => {} });
const posts = () => net.mock.calls.filter(([, o]) => o?.method === 'POST');

let statsBody;
beforeEach(async () => {
  userMem.clear(); localMem.clear();
  document.body.replaceChildren();
  saves.mockReset(); net.mockReset();
  saves.mockImplementation(async (action) => (action === 'runs' ? RUNS : action === 'run' ? RUN : { status: 'error' }));
  statsBody = { schema: 1, generatedAt: '2026-09-14', minRuns: 50, minOffers: 30, builds: {}, available: [] };
  net.mockImplementation(async (url, opts) => {
    if (opts?.method === 'POST' && url.endsWith('/v1/runs')) return { status: 200, body: JSON.stringify({ ok: true, accepted: JSON.parse(opts.body).runs.length, duplicates: 0, refused: [] }) };
    if (opts?.method === 'POST') return { status: 200, body: JSON.stringify({ ok: true, deleted: 1 }) };
    return { status: 200, body: JSON.stringify(statsBody), etag: '"e"' };
  });
  globalThis.fetch = vi.fn(async () => ({ ok: false }));
});

async function mount() {
  // Attached: jsdom fires a checkbox's change event on click only for a connected element.
  const root = document.body.appendChild(document.createElement('div'));
  await mountCommunity(root, ctx());
  await flush();
  return root;
}

describe('Community — sharing', () => {
  // 🔴 Off by default: opening the section sends nothing.
  it('🔴 is off by default and sends nothing', async () => {
    const root = await mount();
    expect(root.querySelector('[data-act="share"]').checked).toBe(false);
    expect(root.querySelector('[data-act="backfill"]').disabled).toBe(true);
    expect(posts()).toEqual([]);
    expect(root.querySelector('[data-act="delete"]')).toBeNull();
  });

  it('turning on past runs sends the real run and reports it', async () => {
    const root = await mount();
    root.querySelector('[data-act="share"]').click();
    await flush();
    expect(posts()).toEqual([]); // future runs only: the fixture run finished before opting in
    root.querySelector('[data-act="backfill"]').click();
    await flush();
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0][1].body).runs).toEqual([buildContribution(RUN)]);
    expect(root.querySelector('[data-part="sync"]').textContent).toContain('1 runs shared from this computer');
  });

  it('the preview is the exact contribution', async () => {
    const root = await mount();
    const details = root.querySelector('[data-part="preview"]');
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await flush();
    expect(JSON.parse(root.querySelector('[data-part="preview"] pre').textContent)).toEqual(buildContribution(RUN));
  });

  it('deletes only after a confirming second click, then forgets the identity', async () => {
    const root = await mount();
    root.querySelector('[data-act="share"]').click();
    await flush();
    expect(userMem.get(SETTINGS_KEY).contributorId).toBeTruthy();
    root.querySelector('[data-act="delete"]').click();
    await flush();
    expect(posts()).toEqual([]);
    expect(root.querySelector('[data-act="delete"]').textContent).toBe('Really delete everything I shared?');
    root.querySelector('[data-act="delete"]').click();
    await flush();
    expect(posts().map(([u]) => u)).toEqual(['https://sts2-stats.plugins.dissent.chat/v1/contributors/delete']);
    expect(userMem.get(SETTINGS_KEY)).toEqual({ enabled: false, backfill: false });
    expect(root.querySelector('[data-part="deleted"]').textContent).toContain('Deleted 1 shared runs');
  });
});

describe('Community — stats', () => {
  it('says there is not enough data yet, when the published file has no cell for the group', async () => {
    const root = await mount();
    expect(root.querySelector('[data-part="source"]').dataset.source).toBe('network');
    expect(root.querySelector('[data-part="no-cell"]').textContent).toContain('50 runs');
  });

  it('shows the group of the user\'s newest run from REAL aggregated stats', async () => {
    statsBody = await aggregate(Array.from({ length: 60 }, () => buildContribution(RUN)), createData({ load }));
    const root = await mount();
    expect(root.querySelector('[data-character="CHARACTER.IRONCLAD"]').getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('[data-mode="coop"]').getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('[data-part="cell"]').textContent).toContain('60 shared runs');
    expect(root.querySelector('[data-encounter="ENCOUNTER.SOUL_NEXUS_ELITE"]').textContent).toContain('n=60');
    expect(root.querySelector('[data-build="Vulnerable"]')).not.toBeNull();
  });

  it('web or declined net:direct: the bundled snapshot, labelled', async () => {
    net.mockImplementation(async () => { throw new Error('net:direct: desktop only'); });
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => statsBody }));
    const root = await mount();
    expect(root.querySelector('[data-part="source"]').dataset.source).toBe('snapshot');
  });
});
