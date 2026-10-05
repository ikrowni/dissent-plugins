// dnd-hub-publish.js — every live event the Hub sends goes through here.
//
// 🔴 A realtimePublish reaches every screen of this plugin, players' included. lk-secrets.js decides what an event
// may carry: a hidden token travels as `{ id, visible: false }`, a hidden token's moves not at all, DM-only pins
// never, a pending trap without its name or square. Import realtimePublish from here, never from the SDK, or a
// new publish path reopens the leak (spec: docs/superpowers/specs/2026-10-03-lanternkeep-dm-secrets-design.md).
import { realtimePublish as sdkPublish } from '../plugin-sdk.js';
import { publicPayload } from './lk-secrets.js';
import { MAP } from './dnd-hub-state.js?v=20261014e';

/** Same contract as the SDK's: resolves undefined when sent (or deliberately not sent), null when refused. */
export function realtimePublish(event, payload) {
  const out = publicPayload(event, payload, { isHidden: id => MAP.mapData?.tokens?.[id]?.visible === false });
  if (out === null) return Promise.resolve(undefined);
  return sdkPublish(event, out);
}
