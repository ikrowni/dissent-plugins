import { describe, it, expect, vi } from 'vitest';
import { layoutFor, onPanelShown, SURFACE_SECTIONS } from './placement.js';

// Shaped exactly as dissent-client/src/overlay/pluginSurfaces.ts builds it.
const overlayInit = (surface) => ({
  serverId: '', serverName: '', pluginConfig: {},
  contextType: 'personal', placement: 'overlay',
  surface, game: 'slay-the-spire-2', installId: 'i1', coreUrl: 'https://node.dissent.chat',
});
// As PluginRuntime.tsx builds it for a personal install on its page.
const pageInit = { serverId: '', serverName: '', channelId: '', channelName: '', pluginConfig: {}, installId: 'i1', hostHostname: 'app.dissent.chat', coreUrl: 'https://node.dissent.chat', contextType: 'personal', placement: 'page' };

describe('layoutFor', () => {
  it('the app page is the full layout, Wiki first', () => {
    expect(layoutFor(pageInit)).toEqual({ compact: false, section: 'wiki' });
    expect(layoutFor(undefined)).toEqual({ compact: false, section: 'wiki' });
  });
  it('an overlay panel is compact and shows its surface’s section', () => {
    expect(layoutFor(overlayInit('wiki'))).toEqual({ compact: true, section: 'wiki' });
    expect(layoutFor(overlayInit('deck'))).toEqual({ compact: true, section: 'deck' });
  });
  it('an overlay surface this build does not know falls back to the Wiki', () => {
    expect(layoutFor(overlayInit('mystery'))).toEqual({ compact: true, section: 'wiki' });
  });
  it('only sections the app can mount', () => {
    expect(Object.values(SURFACE_SECTIONS).every((s) => ['wiki', 'deck'].includes(s))).toBe(true);
  });
});

describe('onPanelShown', () => {
  it('focuses and refreshes when the panel layer is open', () => {
    const view = { focusSearch: vi.fn(), refresh: vi.fn() };
    expect(onPanelShown(view, { game: 'slay-the-spire-2', surface: 'wiki', width: 440, height: 760, panelOpen: true })).toBe(true);
    expect(view.focusSearch).toHaveBeenCalled();
    expect(view.refresh).toHaveBeenCalled();
  });
  it('does nothing when the layer closed, the call was refused, or the view has no such hooks', () => {
    const view = { focusSearch: vi.fn(), refresh: vi.fn() };
    expect(onPanelShown(view, { panelOpen: false })).toBe(false);
    expect(onPanelShown(view, null)).toBe(false);
    expect(view.focusSearch).not.toHaveBeenCalled();
    expect(onPanelShown({}, { panelOpen: true })).toBe(true);
    expect(onPanelShown(null, { panelOpen: true })).toBe(true);
  });
});
