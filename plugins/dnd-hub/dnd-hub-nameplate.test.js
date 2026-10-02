import { it, expect } from 'vitest';
import { plateText, plateFontSize } from './dnd-hub-nameplate.js';

it('keeps whole names up to the limit', () => {
  expect(plateText('charlie_qa hero')).toBe('charlie_qa hero');
  expect(plateText('Thorin')).toBe('Thorin');
});
it('ends long names with an ellipsis instead of chopping mid-word', () => {
  expect(plateText('Bartholomew the Unwashed Wanderer')).toBe('Bartholomew the…');
  expect(plateText('Bartholomew the Unwashed Wanderer').length).toBeLessThanOrEqual(16);
});
it('handles empty names', () => {
  expect(plateText('')).toBe('?');
  expect(plateText(null)).toBe('?');
});
it('sizes text to the grid so it reads at any map size', () => {
  expect(plateFontSize(40)).toBe(10);
  expect(plateFontSize(100)).toBe(25);
  expect(plateFontSize(10)).toBe(9);
});
