// plugins/dnd-hub/dnd-hub-weather-model.test.js
import { describe, it, expect } from 'vitest';
import { normWeather, spawn, step, countFor, KINDS, WEATHER } from './dnd-hub-weather-model.js';

describe('weather', () => {
  it('a stored value is made safe', () => {
    expect(normWeather(null)).toEqual({ kind: 'none', strength: 0.6 });
    expect(normWeather({ kind: 'lava', strength: 9 })).toEqual({ kind: 'none', strength: 1 });
    expect(normWeather({ kind: 'snow', strength: 0.05 })).toEqual({ kind: 'snow', strength: 0.2 });
  });
  it('more strength, more particles; clear has none', () => {
    expect(countFor('rain', 1)).toBeGreaterThan(countFor('rain', 0.3));
    expect(countFor('none', 1)).toBe(0);
  });
  it('rain falls and leaves at the bottom; embers rise and leave at the top', () => {
    const r = spawn('rain', 800, 600, () => 0.5);
    let out = false;
    for (let i = 0; i < 200 && !out; i++) out = step(r, 'rain', 1, 800, 600);
    expect(out).toBe(true);
    expect(r.y).toBeGreaterThan(600);
    const e = spawn('embers', 800, 600, () => 0.5);
    for (let i = 0; i < 2000 && !step(e, 'embers', 1, 800, 600); i++);
    expect(e.y).toBeLessThan(0);
  });
  it('a fresh particle starts outside the edge it flows in from', () => {
    expect(spawn('snow', 800, 600, () => 0.5, true).y).toBeLessThan(0);
    expect(spawn('embers', 800, 600, () => 0.5, true).y).toBeGreaterThan(600);
  });
  it('every kind has a label', () => { for (const k of KINDS) expect(WEATHER[k].label).toBeTruthy(); });
});
