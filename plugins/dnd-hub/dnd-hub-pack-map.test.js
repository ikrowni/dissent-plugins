// plugins/dnd-hub/dnd-hub-pack-map.test.js
import { describe, it, expect } from 'vitest';
import { packFileId, parsePackFileId } from './dnd-hub-pack-map.js';

describe('pack map ids', () => {
  it('name a drawn pack map without storage, and only that', () => {
    expect(packFileId('lanternkeep-sample', 'lighthouse')).toBe('pack:lanternkeep-sample/lighthouse');
    expect(parsePackFileId('pack:lanternkeep-sample/lighthouse')).toEqual({ pack: 'lanternkeep-sample', map: 'lighthouse' });
    expect(parsePackFileId('3f2a9c1e-0000-4000-8000-000000000000')).toBe(null);
    expect(parsePackFileId('personal:abc')).toBe(null);
    expect(parsePackFileId('pack:../etc/x')).toBe(null);
    expect(parsePackFileId(null)).toBe(null);
  });
});
