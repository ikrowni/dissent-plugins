// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRouter, liveCadence, applyScoreFlip , isFormControl } from './app.js';
import { POLL_LIVE_MS, POLL_IDLE_MS } from './config.js';

describe('liveCadence', () => {
  it('polls fast when any game is live', () => {
    expect(liveCadence([{ state: 'pre' }, { state: 'in' }])).toBe(POLL_LIVE_MS);
  });
  it('polls slowly when nothing is live', () => {
    expect(liveCadence([{ state: 'pre' }, { state: 'post' }])).toBe(POLL_IDLE_MS);
    expect(liveCadence([])).toBe(POLL_IDLE_MS);
    expect(liveCadence(null)).toBe(POLL_IDLE_MS);
  });
});

describe('createRouter', () => {
  let mount, views, router;
  beforeEach(() => {
    document.body.innerHTML = `<div id="m"></div>
      <nav><button data-act="nav" data-view="league" aria-current="true">a</button>
           <button data-act="nav" data-view="game">b</button></nav>`;
    mount = document.getElementById('m');
    views = {
      league: { render: vi.fn(() => '<p id="L">league</p>'), enter: vi.fn(), leave: vi.fn() },
      game: { render: vi.fn(() => '<p id="G">game</p>'), enter: vi.fn(), leave: vi.fn() },
    };
    router = createRouter({ mount, views, nav: document.querySelector('nav') });
  });

  it('renders the initial view', () => {
    router.go('league');
    expect(mount.querySelector('#L')).not.toBeNull();
    expect(views.league.enter).toHaveBeenCalledTimes(1);
  });

  it('calls leave on the outgoing view before entering the next', () => {
    router.go('league');
    router.go('game');
    expect(views.league.leave).toHaveBeenCalledTimes(1);
    expect(views.game.enter).toHaveBeenCalledTimes(1);
    expect(mount.querySelector('#G')).not.toBeNull();
    expect(mount.querySelector('#L')).toBeNull();
  });

  it('is a no-op when navigating to the current view', () => {
    router.go('league');
    router.go('league');
    expect(views.league.enter).toHaveBeenCalledTimes(1);
  });

  it('reflects the active view on the nav buttons', () => {
    router.go('game');
    const btns = document.querySelectorAll('[data-act="nav"]');
    expect(btns[0].getAttribute('aria-current')).toBe('false');
    expect(btns[1].getAttribute('aria-current')).toBe('true');
  });

  it('ignores an unknown view rather than blanking the pane', () => {
    router.go('league');
    router.go('nope');
    expect(mount.querySelector('#L')).not.toBeNull();
    expect(router.current).toBe('league');
  });

  it('renders an error state instead of throwing when a view render fails', () => {
    views.game.render = () => { throw new Error('boom'); };
    router.go('league');
    router.go('game');
    expect(mount.querySelector('.state')).not.toBeNull();
    expect(mount.textContent).toMatch(/could not be displayed/i);
  });

  it('still enters a view whose render threw, so it can recover on refresh', () => {
    views.game.render = vi.fn(() => { throw new Error('boom'); });
    router.go('game');
    expect(views.game.enter).toHaveBeenCalledTimes(1);
  });

  it('re-renders the current view on refresh without re-entering it', () => {
    router.go('league');
    router.refresh();
    expect(views.league.render).toHaveBeenCalledTimes(2);
    expect(views.league.enter).toHaveBeenCalledTimes(1);
  });

  it('refresh before any navigation is a no-op rather than a crash', () => {
    expect(() => router.refresh()).not.toThrow();
  });

  it('tolerates a view with no enter or leave hooks', () => {
    views.bare = { render: () => '<p id="B">b</p>' };
    router = createRouter({ mount, views, nav: document.querySelector('nav') });
    expect(() => { router.go('bare'); router.go('league'); }).not.toThrow();
  });

  it('exposes the current view name', () => {
    router.go('game');
    expect(router.current).toBe('game');
  });
});

describe('applyScoreFlip', () => {
  it('adds the flip class only to scores that actually changed', () => {
    document.body.innerHTML =
      '<span data-score="home" class="hero-score">7</span>'
      + '<span data-score="away" class="hero-score">3</span>';
    applyScoreFlip(document.body, { home: 14, away: 3 }, { home: 7, away: 3 });
    expect(document.querySelector('[data-score="home"]').classList.contains('flip')).toBe(true);
    expect(document.querySelector('[data-score="away"]').classList.contains('flip')).toBe(false);
  });

  it('does nothing when there is no previous score to compare', () => {
    document.body.innerHTML = '<span data-score="home">7</span>';
    applyScoreFlip(document.body, { home: 7, away: 0 }, null);
    expect(document.querySelector('[data-score="home"]').classList.contains('flip')).toBe(false);
  });

  it('does nothing when the next score is missing', () => {
    document.body.innerHTML = '<span data-score="home">7</span>';
    expect(() => applyScoreFlip(document.body, null, { home: 3 })).not.toThrow();
  });

  it('is safe on a root with no score elements', () => {
    document.body.innerHTML = '<p>nothing</p>';
    expect(() => applyScoreFlip(document.body, { home: 1 }, { home: 0 })).not.toThrow();
  });
});

describe('drill-down views', () => {
  it('clears every nav button on a view with no nav entry', () => {
    document.body.innerHTML = `<div id="m"></div>
      <nav><button data-act="nav" data-view="league" aria-current="true">a</button></nav>`;
    const mount = document.getElementById('m');
    const views = {
      league: { render: () => '<p>l</p>' },
      team: { render: () => '<p>t</p>' },
    };
    const router = createRouter({ mount, views, nav: document.querySelector('nav') });
    router.go('league');
    router.go('team');
    // A drill-down has no nav button, so every button must read false rather than
    // leaving the previous one highlighted.
    for (const b of document.querySelectorAll('[data-act="nav"]')) {
      expect(b.getAttribute('aria-current')).toBe('false');
    }
    expect(router.current).toBe('team');
  });
});

describe('router — fantasy', () => {
  it('routes to the fantasy view', () => {
    const mount = document.createElement('div');
    const nav = document.createElement('nav');
    const views = {
      league: { render: () => '<p>l</p>' },
      fantasy: { render: () => '<p id="f">fantasy</p>' },
    };
    const router = createRouter({ mount, views, nav });
    router.go('fantasy');
    expect(router.current).toBe('fantasy');
    expect(mount.querySelector('#f')).toBeTruthy();
  });
});

describe('click delegation and form controls', () => {
  // 🔴 THE BUG THIS EXISTS FOR. `click` and `input` both route to `onAction`, and
  // almost every handler ends in `router.refresh()` — `mount.innerHTML = …`. So
  // clicking INTO a control destroyed and rebuilt it mid-interaction: an open
  // <select> snapped shut before a value could be picked, and a search box lost
  // the focus the click had just given it. Reported across several tabs.
  const el = (tag, type) => ({ tagName: tag, type });

  it('treats value-reporting controls as form controls', () => {
    expect(isFormControl(el('SELECT'))).toBe(true);
    expect(isFormControl(el('TEXTAREA'))).toBe(true);
    for (const t of ['text', 'search', 'number', 'range', 'checkbox', 'radio', 'file', 'color', 'date']) {
      expect(isFormControl(el('INPUT', t))).toBe(true);
    }
    // An <input> with no type attribute is a text field.
    expect(isFormControl(el('INPUT', ''))).toBe(true);
  });

  // ⚠️ An <input type=button|submit> is a BUTTON wearing an input's tag. Excluding
  // these would have swapped one dead interaction for another.
  it('leaves real buttons alone', () => {
    expect(isFormControl(el('BUTTON'))).toBe(false);
    expect(isFormControl(el('A'))).toBe(false);
    expect(isFormControl(el('DIV'))).toBe(false);
    for (const t of ['button', 'submit', 'image', 'reset']) {
      expect(isFormControl(el('INPUT', t))).toBe(false);
    }
  });

  it('survives a missing element', () => {
    expect(isFormControl(null)).toBe(false);
    expect(isFormControl(undefined)).toBe(false);
  });

});
