import { describe, it, expect, beforeEach } from 'vitest';
import {
  render, reset, roleOf, ownedTeam, coOwnedTeam, pendingTeam, pickTeam, _state,
} from './league-coowners.js';

const team = (id, over = {}) => ({
  id, name: `Team ${id.toUpperCase()}`, ownerId: `u_${id}`, coOwners: [], coOwnerRequests: [], ...over,
});

const league = (teams, me, over = {}) => ({
  me,
  settings: { name: 'Our League' },
  teams: Object.fromEntries(teams.map((t) => [t.id, t])),
  myTeams: [],
  ...over,
});

beforeEach(reset);

describe('roleOf', () => {
  const lg = (me) => league([team('t1', { coOwners: ['u_helper'] })], me);

  it('names the owner', () => expect(roleOf(lg('u_t1'), 't1')).toBe('owner'));
  it('names a co-owner', () => expect(roleOf(lg('u_helper'), 't1')).toBe('co-owner'));
  it('gives a stranger no role', () => expect(roleOf(lg('u_nobody'), 't1')).toBe(null));

  // ⚠️ Against a pre-0.9.0 module there is no `me`, and guessing would answer
  // "owner" for whoever happened to sort first.
  it('gives no role at all when the module did not send `me`', () => {
    expect(roleOf(league([team('t1')], undefined), 't1')).toBe(null);
  });
});

describe('team lookups', () => {
  const teams = [team('t1'), team('t2', { coOwners: ['u_helper'] })];

  it('finds the team I own outright', () => {
    expect(ownedTeam(league(teams, 'u_t1')).id).toBe('t1');
  });

  it('finds the team I co-own', () => {
    expect(coOwnedTeam(league(teams, 'u_helper')).id).toBe('t2');
  });

  // ⚠️ `myTeams` cannot tell these apart — it returns both — which is why the
  // module sends `me` at all.
  it('does not confuse co-owning with owning', () => {
    expect(ownedTeam(league(teams, 'u_helper'))).toBe(null);
    expect(coOwnedTeam(league(teams, 'u_t1'))).toBe(null);
  });

  it('finds a standing request of mine', () => {
    const withAsk = [team('t1', { coOwnerRequests: [{ userId: 'u_x', label: 'Ex' }] })];
    expect(pendingTeam(league(withAsk, 'u_x')).id).toBe('t1');
    expect(pendingTeam(league(withAsk, 'u_y'))).toBe(null);
  });
});

describe('render', () => {
  // ⚠️ An older module sends no `me`, so every role check answers "nobody" and
  // no button in this panel could be right. It hides rather than misleads.
  it('renders nothing at all without `me`', () => {
    expect(render(league([team('t1')], undefined))).toBe('');
  });

  describe('as the owner', () => {
    const lg = (over = {}) => league([team('t1', over)], 'u_t1');

    it('says nobody co-manages the team yet', () => {
      const html = render(lg());
      expect(html).toContain('Nobody co-manages this team yet');
      expect(html).toContain('No pending requests');
    });

    it('lists co-managers with a way to remove them', () => {
      const html = render(lg({ coOwners: ['u_helper'], coOwnerLabels: { u_helper: 'Helper' } }));
      expect(html).toContain('Helper');
      expect(html).toContain('co-remove');
      expect(html).toContain('data-user="u_helper"');
    });

    it('offers approve and decline on a pending request', () => {
      const html = render(lg({ coOwnerRequests: [{ userId: 'u_x', label: 'Ex' }] }));
      expect(html).toContain('co-approve');
      expect(html).toContain('co-decline');
    });

    // ⚠️ THE POINT OF THE HANDSHAKE. An owner naming a user id is exactly what
    // the module cannot verify, so no control may offer it.
    it('never offers a way to add somebody by id', () => {
      const html = render(lg());
      expect(html).not.toContain('co-ask');
      expect(html).not.toMatch(/<input[^>]+name="userId"/);
    });
  });

  describe('as a co-manager', () => {
    const lg = league([team('t1', { coOwners: ['u_helper'] })], 'u_helper');

    it('says which team I help run, and offers a way out', () => {
      const html = render(lg);
      expect(html).toContain('You co-manage');
      expect(html).toContain('co-leave');
    });

    // ⚠️ A co-owner who could approve co-owners could add an accomplice and keep
    // control after being removed. The module refuses it; the UI must not offer it.
    it('offers no approve, decline or remove control', () => {
      const html = render(lg);
      expect(html).not.toContain('co-approve');
      expect(html).not.toContain('co-remove');
    });
  });

  describe('with no team', () => {
    const teams = [team('t1'), team('t2')];

    it('offers a team picker and an ask button', () => {
      const html = render(league(teams, 'u_new'));
      expect(html).toContain('co-pick-team');
      expect(html).toContain('co-ask');
      expect(html).toContain('Team T1');
    });

    it('keeps the ask button disabled until a team is chosen', () => {
      expect(render(league(teams, 'u_new'))).toMatch(/data-act="co-ask"[^>]*disabled/);
      pickTeam(null, 't2');
      expect(render(league(teams, 'u_new'))).not.toMatch(/data-act="co-ask"[^>]*disabled/);
    });

    it('shows a standing request instead of the picker', () => {
      const asked = [team('t1', { coOwnerRequests: [{ userId: 'u_new', label: 'New' }] }), team('t2')];
      const html = render(league(asked, 'u_new'));
      expect(html).toContain('You have asked to co-manage');
      expect(html).toContain('co-withdraw');
      expect(html).not.toContain('co-pick-team');
    });

    it('says so when there are no teams to ask about', () => {
      expect(render(league([], 'u_new'))).toContain('no teams to co-manage');
    });
  });

  describe('labels are never identity', () => {
    // ⚠️ The label is whatever the requester's own client sent. Rendering it
    // alone would let anyone pick how they appear in an approval prompt, so the
    // verified id is always shown beside it.
    it('shows the user id alongside a self-declared name', () => {
      const html = render(league([team('t1', {
        coOwnerRequests: [{ userId: 'u_9911', label: 'Commissioner' }],
      })], 'u_t1'));
      expect(html).toContain('Commissioner');
      expect(html).toContain('u_9911');
    });

    it('escapes a label rather than injecting it', () => {
      const html = render(league([team('t1', {
        coOwnerRequests: [{ userId: 'u_9911', label: '<img src=x onerror=alert(1)>' }],
      })], 'u_t1'));
      expect(html).not.toContain('<img src=x');
      expect(html).toContain('&lt;img');
    });

    it('escapes team names too', () => {
      const html = render(league([team('t1', { name: '<script>x</script>' })], 'u_t1'));
      expect(html).not.toContain('<script>x');
    });

    it('falls back to the bare id when no label was given', () => {
      const html = render(league([team('t1', {
        coOwnerRequests: [{ userId: 'u_9911', label: '' }],
      })], 'u_t1'));
      expect(html).toContain('u_9911');
    });
  });

  it('surfaces an error and a notice when the state carries them', () => {
    _state.error = 'you already manage team t2 in this league';
    expect(render(league([team('t1')], 'u_t1'))).toContain('already manage team t2');
    _state.error = null;
    _state.notice = 'Co-manager removed.';
    expect(render(league([team('t1')], 'u_t1'))).toContain('Co-manager removed.');
  });
});
