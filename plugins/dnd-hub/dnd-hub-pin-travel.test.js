import { describe, it, expect } from 'vitest';
import { canTravel, travelFields, travelSummary, travelTooSoon, TRAVEL_COOLDOWN_MS } from './dnd-hub-pin-travel.js';

const DM = 'dm-1', BOB = 'bob', CAROL = 'carol';
const pin = (o = {}) => ({ id: 'p', sceneId: 's1', visible: 'all', travel: 'dm', travelers: [], ...o });

describe('canTravel', () => {
  it('the DM may always travel with a pin that has a scene', () => {
    expect(canTravel(pin({ visible: 'dm' }), DM, DM)).toBe(true);
    expect(canTravel(pin(), DM, DM)).toBe(true);
  });
  it('nobody travels with a pin that has no scene', () => {
    expect(canTravel(pin({ sceneId: null }), DM, DM)).toBe(false);
    expect(canTravel(pin({ sceneId: null, travel: 'all' }), BOB, DM)).toBe(false);
  });
  it('a player only when the DM allowed them', () => {
    expect(canTravel(pin(), BOB, DM)).toBe(false);
    expect(canTravel(pin({ travel: 'all' }), BOB, DM)).toBe(true);
    expect(canTravel(pin({ travel: 'some', travelers: [BOB] }), BOB, DM)).toBe(true);
    expect(canTravel(pin({ travel: 'some', travelers: [BOB] }), CAROL, DM)).toBe(false);
  });
  it('never with a DM-only pin, whatever its travel mode says', () => {
    expect(canTravel(pin({ visible: 'dm', travel: 'all' }), BOB, DM)).toBe(false);
  });
  it('an unknown sender or campaign DM grants nothing', () => {
    expect(canTravel(pin({ travel: 'some', travelers: [BOB] }), undefined, DM)).toBe(false);
    expect(canTravel(pin(), BOB, undefined)).toBe(false);
  });
});

describe('travelFields', () => {
  it('no scene clears the rest', () => {
    expect(travelFields({ sceneId: '', travel: 'all', travelers: [BOB] })).toEqual({ sceneId: null, travel: 'dm', travelers: [] });
  });
  it('keeps travellers only for chosen players, without repeats', () => {
    expect(travelFields({ sceneId: 's', travel: 'some', travelers: [BOB, BOB, '', 3] })).toEqual({ sceneId: 's', travel: 'some', travelers: [BOB] });
    expect(travelFields({ sceneId: 's', travel: 'all', travelers: [BOB] }).travelers).toEqual([]);
  });
  it('"chosen players" with nobody chosen is DM only; an unknown mode is DM only', () => {
    expect(travelFields({ sceneId: 's', travel: 'some', travelers: [] }).travel).toBe('dm');
    expect(travelFields({ sceneId: 's', travel: 'everyone!' }).travel).toBe('dm');
  });
});

describe('travelSummary', () => {
  it('says who may travel', () => {
    expect(travelSummary(pin())).toMatch(/Only you/);
    expect(travelSummary(pin({ travel: 'all' }))).toMatch(/Every player/);
    expect(travelSummary(pin({ travel: 'some', travelers: [BOB] }), id => id.toUpperCase())).toMatch(/BOB/);
    expect(travelSummary(pin({ visible: 'dm', travel: 'all' }))).toMatch(/Only you/);
    expect(travelSummary(pin({ sceneId: null }))).toBe('');
  });
});

describe('travelTooSoon', () => {
  it('drops a request right after the last travel', () => {
    expect(travelTooSoon(0, 1000)).toBe(false);
    expect(travelTooSoon(1000, 1000 + TRAVEL_COOLDOWN_MS - 1)).toBe(true);
    expect(travelTooSoon(1000, 1000 + TRAVEL_COOLDOWN_MS)).toBe(false);
  });
});
