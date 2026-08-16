// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { playerCard } from './playercard.js';
import { resetAll, bumpDemo } from './state.js';

const P = (over = {}) => ({
  name: 'alice', score: 240, goals: 1, assists: 0, saves: 2, shots: 3, touches: 14,
  boost: 47, speed: 1200, supersonic: false, demolished: false, boosting: false,
  on_wall: false, powersliding: false, is_member: false, ...over,
});

describe('playerCard', () => {
  beforeEach(() => resetAll());

  it('renders the name and score', () => {
    const html = playerCard(P(), 'blue', 0);
    expect(html).toContain('alice');
    expect(html).toContain('240');
  });

  it('renders an empty slot without inventing a player', () => {
    const html = playerCard(null, 'blue', 0);
    expect(html).toContain('vsb-pname empty');
    expect(html).toContain('PLAYER 1');
  });

  it('clamps boost into 0..100', () => {
    expect(playerCard(P({ boost: 300 }), 'blue', 0)).toContain('width:100%');
    expect(playerCard(P({ boost: -20 }), 'blue', 0)).toContain('width:0%');
  });

  it('zeroes boost for a demolished player and dims the card', () => {
    const html = playerCard(P({ demolished: true, boost: 80 }), 'blue', 0);
    expect(html).toContain('width:0%');
    expect(html).toContain('demo');
  });

  it('shows the supersonic badge only when supersonic', () => {
    expect(playerCard(P({ supersonic: true }), 'blue', 0)).toContain('Supersonic');
    expect(playerCard(P(), 'blue', 0)).not.toContain('Supersonic');
  });

  it('shows wall and slide badges from their flags', () => {
    const html = playerCard(P({ on_wall: true, powersliding: true }), 'blue', 0);
    expect(html).toContain('Wall');
    expect(html).toContain('Slide');
  });

  it('reads the demo count from shared state, not the player payload', () => {
    // p.demos exists in the payload but is not what the card shows — demolitions are
    // counted from rl:live:feed events, which is the only source that names the attacker.
    bumpDemo('alice');
    bumpDemo('alice');
    expect(playerCard(P(), 'blue', 0)).toContain('>2<');
  });

  it('escapes the player name', () => {
    expect(playerCard(P({ name: '<script>x</script>' }), 'blue', 0)).not.toContain('<script>');
  });

  // Design constraint from the spec: emoji render at different sizes and weights on every
  // platform and read as amateur against a broadcast layout.
  it('contains no emoji', () => {
    const html = playerCard(P({ on_wall: true, powersliding: true, supersonic: true }), 'blue', 0);
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u);
  });
});
