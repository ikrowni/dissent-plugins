// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { confirmDialog, scoreDialog, closeDialog, isDialogOpen } from './dialog.js';

afterEach(() => closeDialog());

const modal = () => document.querySelector('.rlt-modal');
const click = (sel) => document.querySelector(sel).click();
const setScore = (side, v) => {
  const el = document.querySelector(`[data-side="${side}"]`);
  el.value = String(v);
  el.dispatchEvent(new Event('input'));
};
const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

describe('confirmDialog', () => {
  it('mounts on document.body, not inside the plugin panel', async () => {
    const panel = document.createElement('div');
    panel.id = 'tab-content';
    document.body.appendChild(panel);

    const p = confirmDialog({ title: 'Delete?', body: 'Gone forever.' });
    // A transformed ancestor would capture position:fixed and misplace or clip the modal.
    expect(document.body.contains(modal())).toBe(true);
    expect(panel.contains(modal())).toBe(false);

    click('[data-act="cancel"]');
    await p;
    panel.remove();
  });

  it('resolves true on confirm', async () => {
    const p = confirmDialog({ title: 'T', body: 'B' });
    click('[data-act="ok"]');
    expect(await p).toBe(true);
  });

  it('resolves false on cancel', async () => {
    const p = confirmDialog({ title: 'T', body: 'B' });
    click('[data-act="cancel"]');
    expect(await p).toBe(false);
  });

  it('resolves false on escape', async () => {
    const p = confirmDialog({ title: 'T', body: 'B' });
    esc();
    expect(await p).toBe(false);
  });

  it('resolves false on a backdrop click', async () => {
    const p = confirmDialog({ title: 'T', body: 'B' });
    click('.rlt-modal-backdrop');
    expect(await p).toBe(false);
  });

  it('removes itself from the DOM after resolving', async () => {
    const p = confirmDialog({ title: 'T', body: 'B' });
    click('[data-act="ok"]');
    await p;
    expect(modal()).toBeNull();
    expect(isDialogOpen()).toBe(false);
  });

  it('escapes its title and body', async () => {
    const p = confirmDialog({ title: '<img src=x>', body: '<script>x</script>' });
    expect(modal().innerHTML).not.toContain('<img src=x>');
    expect(modal().innerHTML).not.toContain('<script>');
    click('[data-act="cancel"]');
    await p;
  });

  it('stops listening for escape once closed', async () => {
    const p = confirmDialog({ title: 'T', body: 'B' });
    click('[data-act="ok"]');
    await p;
    // Would throw on a stale listener reaching a removed node.
    expect(() => esc()).not.toThrow();
  });
});

describe('scoreDialog', () => {
  const open = () => scoreDialog({ player1: 'alice', player2: 'bob', bestOf: 3 });

  it('starts with the save button disabled at 0-0', () => {
    const p = open();
    expect(document.querySelector('[data-act="ok"]').disabled).toBe(true);
    click('[data-act="cancel"]');
    return p;
  });

  it('says nothing at the untouched 0-0 rather than opening with an error', () => {
    const p = open();
    expect(document.querySelector('[data-role="error"]').textContent).toBe('');
    click('[data-act="cancel"]');
    return p;
  });

  it('enables save for a legal result', async () => {
    const p = open();
    setScore(1, 2); setScore(2, 1);
    expect(document.querySelector('[data-act="ok"]').disabled).toBe(false);
    click('[data-act="ok"]');
    expect(await p).toEqual({ s1: 2, s2: 1 });
  });

  it('refuses an impossible result and explains why', () => {
    const p = open();
    setScore(1, 2); setScore(2, 2);
    expect(document.querySelector('[data-act="ok"]').disabled).toBe(true);
    expect(document.querySelector('[data-role="error"]').textContent.length).toBeGreaterThan(5);
    click('[data-act="cancel"]');
    return p;
  });

  // The old prompt() path parsed free text and accepted these.
  it.each([[2, 2], [2, 3], [1, 0], [3, 0]])('cannot submit %i-%i in a best of 3', (a, b) => {
    const p = open();
    setScore(1, a); setScore(2, b);
    expect(document.querySelector('[data-act="ok"]').disabled).toBe(true);
    click('[data-act="cancel"]');
    return p;
  });

  it('resolves null on cancel', async () => {
    const p = open();
    click('[data-act="cancel"]');
    expect(await p).toBeNull();
  });

  it('resolves null on escape even while an input has focus', async () => {
    const p = open();
    document.querySelector('[data-side="1"]').focus();
    esc();
    expect(await p).toBeNull();
  });

  it('submits on Enter when the score is valid', async () => {
    const p = open();
    setScore(1, 2); setScore(2, 0);
    document.querySelector('[data-side="1"]')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(await p).toEqual({ s1: 2, s2: 0 });
  });

  it('ignores Enter when the score is invalid', () => {
    const p = open();
    setScore(1, 1); setScore(2, 1);
    document.querySelector('[data-side="1"]')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(isDialogOpen()).toBe(true);
    click('[data-act="cancel"]');
    return p;
  });

  it('escapes player names', () => {
    const p = scoreDialog({ player1: '<script>x</script>', player2: 'b', bestOf: 3 });
    expect(modal().innerHTML).not.toContain('<script>');
    click('[data-act="cancel"]');
    return p;
  });

  it('adapts the target to the series length', () => {
    const p = scoreDialog({ player1: 'a', player2: 'b', bestOf: 5 });
    expect(modal().textContent).toContain('First to 3');
    click('[data-act="cancel"]');
    return p;
  });
});

describe('one dialog at a time', () => {
  it('replaces an already-open dialog rather than stacking', async () => {
    const first = confirmDialog({ title: 'first', body: 'B' });
    const second = confirmDialog({ title: 'second', body: 'B' });
    expect(document.querySelectorAll('.rlt-modal')).toHaveLength(1);
    expect(modal().textContent).toContain('second');
    click('[data-act="ok"]');
    await second;
    // The abandoned first promise must not leave a listener or node behind.
    expect(isDialogOpen()).toBe(false);
    void first;
  });
});
