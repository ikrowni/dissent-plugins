// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderGameText } from './markup.js';

const text = (node) => node.textContent;

describe('renderGameText', () => {
  it('turns [gold]Name[/gold] into a link for the name', () => {
    const el = renderGameText('Apply 2 [gold]Vulnerable[/gold].');
    expect(text(el)).toBe('Apply 2 Vulnerable.');
    const link = el.querySelector('[data-term]');
    expect(link.dataset.term).toBe('Vulnerable');
    expect(link.textContent).toBe('Vulnerable');
  });

  it('styles [blue]/[red]/[green] without linking, and keeps newlines as breaks', () => {
    const el = renderGameText('Gain [blue]8[/blue].\nLose [red]2[/red] HP.');
    expect(el.querySelectorAll('[data-term]')).toHaveLength(0);
    expect(el.querySelectorAll('br')).toHaveLength(1);
    expect(el.querySelector('.t-blue').textContent).toBe('8');
  });

  // Found in the real browser 2026-09-13: power text reads "for [Amount] turns". Powers scale
  // with a stack count, so Spire Codex leaves a capitalised placeholder in place of the number.
  it('renders an unresolved [Placeholder] as X', () => {
    expect(text(renderGameText('Receive [blue]50%[/blue] more damage for [blue][Amount][/blue] turns.')))
      .toBe('Receive 50% more damage for X turns.');
  });

  it('drops tags it does not know, keeping their text', () => {
    expect(text(renderGameText('[sine]wobbly[/sine] words'))).toBe('wobbly words');
  });

  // 🔴 The data came from outside Dissent. Nothing in it may execute or become markup.
  it('🔴 renders HTML in game text as visible text, never as elements', () => {
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>[gold]<b>x</b>[/gold]';
    const el = renderGameText(evil);
    document.body.appendChild(el);
    expect(el.querySelector('img, script, b')).toBeNull();
    expect(text(el)).toContain('<img src=x');
    expect(window.__pwned).toBeUndefined();
  });
});

// 🔴 The rule, enforced across the whole plugin rather than trusted.
describe('no HTML-string APIs anywhere in the plugin', () => {
  // process.cwd(), not import.meta.url: under jsdom the module URL is not a file: URL.
  const root = join(process.cwd(), 'plugins/sts2-companion');
  const files = (d) => readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    if (statSync(p).isDirectory()) return ['data', 'art'].includes(n) ? [] : files(p);
    return p.endsWith('.js') && !p.endsWith('.test.js') ? [p] : [];
  });
  it('🔴 no innerHTML, outerHTML or insertAdjacentHTML', () => {
    const offenders = files(root).filter((f) => /\.(innerHTML|outerHTML)\b|insertAdjacentHTML\s*\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  // Charts draw once. The overlay's frame budget (spec §3) is met by never animating.
  it('🔴 no requestAnimationFrame', () => {
    const offenders = files(root).filter((f) => /requestAnimationFrame/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
