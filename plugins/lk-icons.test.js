import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { icon, ICON_NAMES } from './lk-icons.js';

describe('icon', () => {
  it('renders a known icon as decorative inline SVG at the requested size', () => {
    const s = icon('swords', { size: 20, cls: 'x' });
    expect(s.startsWith('<svg')).toBe(true);
    expect(s).toContain('aria-hidden="true"');
    expect(s).toContain('width="20"');
    expect(s).toContain('class="lk-icon x"');
    expect(s).toContain('stroke="currentColor"');
  });
  it('has the hand-drawn lantern', () => {
    expect(icon('lantern')).toContain('<svg');
  });
  it('returns empty (and warns) for an unknown name instead of throwing mid-render', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(icon('no-such-icon')).toBe('');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it('every icon the LanternKeep plugins ask for exists', () => {
    const used = new Set();
    for (const dir of ['dnd-hub', 'dnd-master', 'dnd-player']) {
      for (const f of readdirSync(join(__dirname, dir))) {
        if (!/\.(js|html)$/.test(f) || f.startsWith('lk-icons')) continue;
        const src = readFileSync(join(__dirname, dir, f), 'utf8');
        for (const m of src.matchAll(/\bicon\(\s*['"]([a-z0-9-]+)['"]/g)) used.add(m[1]);
      }
    }
    const missing = [...used].filter(n => !ICON_NAMES.includes(n));
    expect(missing).toEqual([]);
  });
});
