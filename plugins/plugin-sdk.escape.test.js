// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

describe('Esc inside a plugin frame (shim)', () => {
  // A cross-origin frame swallows the key, so the overlay around it never hears it. Forwarding
  // is a courtesy: the overlay's global hotkey and host close button do not depend on it.
  it('is forwarded to the host', async () => {
    const post = vi.spyOn(window.parent, 'postMessage');
    await import('./plugin-sdk.js');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(post).toHaveBeenCalledWith({ type: 'dissent:escape' }, '*');
  });
});
