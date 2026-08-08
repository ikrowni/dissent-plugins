// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderFantasy, renderOnboarding, renderTabs } from './fantasy.js';

const parse = (html) => {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
};

describe('renderOnboarding', () => {
  it('asks for a username first', () => {
    const d = parse(renderOnboarding({ step: 'username', leagues: [], error: null }));
    expect(d.querySelector('input[data-act="sleeper-username"]')).toBeTruthy();
    expect(d.querySelector('[data-act="sleeper-lookup"]')).toBeTruthy();
  });

  it('shows the error from a failed lookup instead of a dead form', () => {
    const d = parse(renderOnboarding({ step: 'username', leagues: [], error: 'No NFL leagues found for that username.' }));
    expect(d.textContent).toContain('No NFL leagues found');
  });

  it('also accepts a league ID directly, for someone who already knows it', () => {
    const d = parse(renderOnboarding({ step: 'username', leagues: [], error: null }));
    expect(d.querySelector('input[data-act="sleeper-leagueid"]')).toBeTruthy();
    expect(d.querySelector('[data-act="sleeper-use-league"]')).toBeTruthy();
  });

  it('lists leagues as pickable buttons carrying their id', () => {
    const d = parse(renderOnboarding({
      step: 'league', error: null,
      leagues: [{ id: '1', name: 'Sunday Funday', teams: 12, scoringType: 'PPR' },
        { id: '2', name: 'Average Joes', teams: 10, scoringType: 'Standard' }],
    }));
    const btns = [...d.querySelectorAll('[data-act="pick-league"]')];
    expect(btns).toHaveLength(2);
    expect(btns[0].dataset.league).toBe('1');
    expect(d.textContent).toContain('Sunday Funday');
  });

  it('marks the auto-suggested roster so a wrong guess is visible before it is accepted', () => {
    const d = parse(renderOnboarding({
      step: 'roster', error: null, leagues: [],
      rosterChoices: [
        { rosterId: 1, teamName: 'Leeks', displayName: 'MyLeekNeighbor', suggested: true },
        { rosterId: 2, teamName: 'Cabs', displayName: 'joelcab26', suggested: false },
      ],
    }));
    const btns = [...d.querySelectorAll('[data-act="pick-roster"]')];
    expect(btns).toHaveLength(2);
    expect(btns[0].getAttribute('aria-pressed')).toBe('true');
    expect(btns[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('escapes a hostile team name', () => {
    const d = parse(renderOnboarding({
      step: 'roster', error: null, leagues: [],
      rosterChoices: [{ rosterId: 1, teamName: '<img src=x onerror=alert(1)>', displayName: 'x', suggested: false }],
    }));
    expect(d.querySelector('img')).toBe(null);
  });
});

describe('renderTabs', () => {
  it('marks the active tab', () => {
    const d = parse(renderTabs('roster'));
    const active = [...d.querySelectorAll('[data-act="fantasy-tab"]')]
      .filter((b) => b.getAttribute('aria-current') === 'true');
    expect(active).toHaveLength(1);
    expect(active[0].dataset.tab).toBe('roster');
  });
});

describe('renderFantasy', () => {
  it('shows onboarding when not ready, and never the tabs', () => {
    const d = parse(renderFantasy({ session: { step: 'username', leagues: [], error: null }, loading: false }));
    expect(d.querySelector('input[data-act="sleeper-username"]')).toBeTruthy();
    expect(d.querySelector('[data-act="fantasy-tab"]')).toBe(null);
  });

  it('threads roster choices through to the onboarding picker', () => {
    const d = parse(renderFantasy({
      session: { step: 'roster', leagues: [], error: null }, loading: false,
      rosterChoices: [{ rosterId: 3, teamName: 'Mine', displayName: 'me', suggested: true }],
    }));
    expect(d.querySelector('[data-act="pick-roster"]')).toBeTruthy();
  });

  it('shows a spinner while loading rather than an empty pane', () => {
    const d = parse(renderFantasy({ session: { step: 'ready' }, loading: true }));
    expect(d.querySelector('.spinner')).toBeTruthy();
  });

  it('shows tabs and the active sub-view body once ready', () => {
    const d = parse(renderFantasy({
      session: { step: 'ready' }, loading: false, tab: 'matchup', body: '<p id="x">hi</p>',
    }));
    expect(d.querySelector('[data-act="fantasy-tab"]')).toBeTruthy();
    expect(d.querySelector('#x')).toBeTruthy();
  });

  it('offers a way out of a wrong league instead of trapping the user', () => {
    const d = parse(renderFantasy({ session: { step: 'ready' }, loading: false, tab: 'matchup', body: '' }));
    expect(d.querySelector('[data-act="fantasy-reset"]')).toBeTruthy();
  });
});
