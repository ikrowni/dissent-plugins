// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// friends:link as dissent-core plugin_links.go answers it, for two users sharing one fake node.
const links = [];
let n = 0;
let me = 'host';
let auto = true;
const names = { host: 'KROWN', guest: 'jj' };
const friends = {
  list: vi.fn(async () => ({ friends: [{ handle: `h-${me === 'host' ? 'guest' : 'host'}`, name: names[me === 'host' ? 'guest' : 'host'] }], me: `h-${me}`, auto })),
  setAuto: vi.fn(async (enabled) => { auto = enabled; }),
  links: vi.fn(async () => ({
    links: links.filter((l) => l.from === me || l.to === me).map((l) => {
      const sent = l.from === me;
      return { id: l.id, status: l.status, direction: sent ? 'sent' : 'received', created_at: '2026-09-14T00:00:00Z',
        peer: { handle: `h-${sent ? l.to : l.from}`, name: names[sent ? l.to : l.from] }, ...(sent || l.status === 'accepted' ? { payload: l.payload } : {}) };
    }),
  })),
  invite: vi.fn(async (handle, payload) => { links.push({ id: `l${++n}`, from: me, to: handle.slice(2), payload, status: 'pending' }); return { id: `l${n}` }; }),
  respond: vi.fn(async (id, accept) => { const i = links.findIndex((l) => l.id === id && l.to === me); if (accept) links[i].status = 'accepted'; else links.splice(i, 1); }),
  remove: vi.fn(async (id) => { links.splice(links.findIndex((l) => l.id === id), 1); }),
};
const kv = () => { const m = new Map(); return { get: vi.fn(async (k) => structuredClone(m.get(k) ?? null)), set: vi.fn(async (k, v) => { m.set(k, structuredClone(v)); }), del: vi.fn(async (k) => { m.delete(k); }) }; };
const stores = { host: { store: kv(), local: kv() }, guest: { store: kv(), local: kv() } };
vi.mock('../core/host.js', () => ({
  friends,
  get store() { return stores[me].store; },
  get local() { return stores[me].local; },
}));
const { mountCoop } = await import('./coop.js');

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5)); };
const ctx = { onSavesChanged: () => () => {} };
async function as(who, options) {
  me = who;
  const c = mountCoop(ctx, options);
  document.body.replaceChildren(c.el);
  await flush();
  return c.el;
}

beforeEach(() => { links.length = 0; auto = true; });

describe('co-op invites between two friends', () => {
  it('host invites → guest sees the invite and accepts → both show they are sharing', async () => {
    let host = await as('host', { showInvite: true });
    host.querySelector('[data-act="invite"]').click();
    await flush();
    host.querySelector('[data-act="invite-friend"]').click();
    await flush();
    expect(host.querySelector('[data-sent]').textContent).toBe('Invite sent to jj — waiting for them to accept.');
    expect(links[0]).toMatchObject({ from: 'host', to: 'guest', status: 'pending' });

    const guest = await as('guest', { showInvite: false, compact: true });
    const invite = guest.querySelector('[data-invite]');
    expect(invite.textContent).toContain('KROWN invites you to co-op sharing');
    invite.querySelector('[data-act="accept"]').click();
    await flush();
    expect(guest.querySelector('[data-part="linked"]').textContent).toBe('Co-op sharing with KROWN.');

    host = await as('host', { showInvite: true });
    expect(host.querySelector('[data-part="linked"]').textContent).toBe('Co-op sharing with jj.');
  });

  it('declining removes the invite; nothing is shared', async () => {
    await as('host', {});
    await friends.invite('h-guest', { party: 'K7Q4-M2XP-9D01' });
    const guest = await as('guest', {});
    guest.querySelector('[data-act="decline"]').click();
    await flush();
    expect(links).toEqual([]);
    expect(guest.querySelector('[data-invite]')).toBeNull();
  });

  it('with no friend who can be invited, says why', async () => {
    const host = await as('host', { showInvite: true });
    friends.list.mockResolvedValueOnce({ friends: [] });
    host.querySelector('[data-act="invite"]').click();
    await flush();
    expect(host.querySelector('[data-part="pick"]').textContent).toContain('None of your Dissent friends has STS2 Companion');
  });

  it('Community can stop sharing, after a confirming second click', async () => {
    await as('host', {});
    await friends.invite('h-guest', { party: 'K7Q4-M2XP-9D01' });
    links[0].status = 'accepted';
    const host = await as('host', { manage: true });
    host.querySelector('[data-act="remove"]').click();
    await flush();
    expect(links).toHaveLength(1);
    document.querySelector('[data-act="remove"]').click();
    await flush();
    expect(links).toEqual([]);
  });
});

describe('automatic sharing', () => {
  it('while this computer is sending its run to a matched friend, says so instead of offering invites', async () => {
    me = 'host';
    await stores.host.local.set('coop:sharingNow', { names: ['jj'], at: Date.now() });
    const host = await as('host', { showInvite: true });
    expect(host.querySelector('[data-part="sharing-now"]').textContent).toBe("Sharing this run with jj — you're playing together.");
    expect(host.querySelector('[data-act="invite"]')).toBeNull();
    await stores.host.local.del('coop:sharingNow');
  });

  it('Community turns automatic sharing off and on', async () => {
    const host = await as('host', { manage: true });
    const box = host.querySelector('[data-act="auto"]');
    expect(box.checked).toBe(true);
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await flush();
    expect(friends.setAuto).toHaveBeenCalledWith(false);
    expect(auto).toBe(false);
  });
});
