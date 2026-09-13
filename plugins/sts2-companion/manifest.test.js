// manifest.test.js — the overlay block, against the node's rules, before the node refuses it.
// Mirrors dissent-core/internal/api/handlers/plugin_overlay.go parseOverlay. A block the node
// refuses fails the re-add, and the plugin keeps its old manifest silently.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SURFACE_SECTIONS } from './core/placement.js';

const ROOT = process.cwd();
const manifest = JSON.parse(readFileSync(`${ROOT}/plugins/sts2-companion/manifest.json`, 'utf8'));
const catalog = JSON.parse(readFileSync('/home/ubuntu/projects/dissent-core/internal/gamecatalog/catalog.json', 'utf8'));
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ANCHORS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];

describe('manifest overlay block', () => {
  const o = manifest.overlay;

  it('declares exactly the permissions the plugin uses', () => {
    expect([...manifest.declared_permissions].sort()).toEqual(['game:saves', 'overlay:context', 'storage:local', 'storage:user']);
  });

  it('targets Slay the Spire 2 by its catalog id', () => {
    expect(o.games).toEqual(['slay-the-spire-2']);
    const ids = catalog.games.map((g) => g.id);
    for (const g of o.games) expect(ids).toContain(g);
  });

  it('🔴 every surface passes the node’s rules', () => {
    // overlay.api: optional at the node (absent = 1); this plugin declares the contract it targets.
    expect(Object.keys(o).sort()).toEqual(['api', 'games', 'surfaces']);
    expect(o.api).toBe(1);
    expect(o.surfaces.length).toBeGreaterThanOrEqual(1);
    expect(o.surfaces.length).toBeLessThanOrEqual(8);
    expect(new Set(o.surfaces.map((s) => s.id)).size).toBe(o.surfaces.length);
    for (const s of o.surfaces) {
      expect(Object.keys(s).sort(), s.id).toEqual(['anchor', 'id', 'layer', 'size', 'title']);
      expect(s.id).toMatch(SLUG);
      expect(s.title.trim().length).toBeGreaterThan(0);
      expect(s.title.length).toBeLessThanOrEqual(60);
      expect(s.layer).toBe('panel');
      expect(ANCHORS).toContain(s.anchor);
      expect(s.size[0]).toBeGreaterThanOrEqual(240); expect(s.size[0]).toBeLessThanOrEqual(1600);
      expect(s.size[1]).toBeGreaterThanOrEqual(160); expect(s.size[1]).toBeLessThanOrEqual(1200);
    }
  });

  it('every surface has a section to show, and the spec’s two panels exist', () => {
    for (const s of o.surfaces) expect(SURFACE_SECTIONS[s.id], s.id).toBeDefined();
    expect(o.surfaces.map((s) => s.id).sort()).toEqual(['deck', 'wiki']);
  });
});
