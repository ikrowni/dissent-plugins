import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseEventPage, renderFor } from './ufc-event-page.js';

const html = readFileSync(
  new URL('../tests/fixtures/ufc-event-20260808.html', import.meta.url), 'utf8');
const page = parseEventPage(html);

describe('parseEventPage', () => {
  it('finds the official event art at a size the proxy will carry', () => {
    expect(page.art).toMatch(/EVENT-ART[^"]*\.jpg/);
    expect(page.art).toContain('background_image_lg');
    // ⚠️ NOT the 2x, and never the raw CloudFront original: it is 4.7 MB against the
    // image proxy's 2 MB cap and comes back as 200 with an undecodable body.
    expect(page.art).not.toContain('_2x');
    expect(page.art).not.toContain('dmxg5wxfqgb4u');
  });

  it('finds a stance render for every fighter on the card', () => {
    expect(Object.keys(page.renders)).toHaveLength(24);
  });

  it('keys renders by a normalised name, so a caller can look one up', () => {
    expect(renderFor(page, 'Mateusz', 'Gamrot')).toMatch(/GAMROT_MATEUSZ_L_/);
    expect(renderFor(page, 'Quillan', 'Salkilld')).toMatch(/SALKILLD_QUILLAN_R_/);
  });

  it('does not confuse two fighters who share a last name', () => {
    // The card carries both Ty Miller and Juliana Miller.
    const ty = renderFor(page, 'Ty', 'Miller');
    const juliana = renderFor(page, 'Juliana', 'Miller');
    expect(ty).toBeTruthy();
    expect(juliana).toBeTruthy();
    expect(ty).not.toBe(juliana);
  });

  it('returns null for a fighter who is not on this card', () => {
    expect(renderFor(page, 'Conor', 'McGregor')).toBe(null);
  });

  it('returns an empty shape for a page it cannot read, and never throws', () => {
    const e = parseEventPage('<html></html>');
    expect(e.art).toBe(null);
    expect(e.renders).toEqual({});
    expect(() => parseEventPage(null)).not.toThrow();
  });
});
