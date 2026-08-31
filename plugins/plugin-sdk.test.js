// plugin-sdk.test.js — the transport contract of invokeModule.
//
// 🔴 THE FILE UNDER TEST IS A COPY. The SDK that actually runs is embedded in
// the Go binary (dissent-core/internal/api/handlers/pluginsdk/plugin-sdk.js) and
// served by ServePluginSDKShim at GET /plugins/plugin-sdk.js. This repo's copy is
// a byte copy of it; `scripts/audit/embedded-sdk.mjs` is what keeps the pair in
// step. Fixing one without the other ships nothing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { invokeModule, handleSDKMessage } from './plugin-sdk.js';

// Drive the REAL postMessage transport rather than stubbing `request`, so these
// assertions cover the same code path a plugin frame runs.
//
// The value handed to `respond()` is the MODULE'S OWN ENVELOPE, which is exactly
// what reaches `invokeModule`. Traced 2026-08-31 rather than guessed:
//   node  → {"ok":true,"data":resp.Output,"outcome":…}   (plugin_invoke.go)
//   http.ts sees the {ok,data} envelope → {ok:true, data: resp.Output}
//   providers/module.ts → ok(res.data)  → posts data: resp.Output
//   handleSDKMessage resolves request() with resp.Output
// so res === resp.Output === the module's {ok, data|error} envelope.
let posted;
const origParent = globalThis.parent;

beforeEach(() => {
  posted = [];
  globalThis.parent = { postMessage: (msg) => posted.push(msg) };
});
afterEach(() => { globalThis.parent = origParent; });

/** Call invokeModule and let the host answer with `moduleEnvelope`. */
const invokeReturning = (moduleEnvelope) => {
  const p = invokeModule({ op: 'league:get' });
  const req = posted[posted.length - 1];
  handleSDKMessage({ data: { type: 'dissent:response', id: req.id, ok: true, data: moduleEnvelope } });
  return p;
};

describe('invokeModule envelope unwrapping', () => {
  it('sends the payload as a module:invoke request', async () => {
    const p = invokeReturning({ ok: true, data: 1 });
    expect(posted[0].action).toBe('module:invoke');
    expect(posted[0].params).toEqual({ payload: { op: 'league:get' } });
    await p;
  });

  // 🔴 THE REGRESSION. `??` read a null `data` as "absent" and fell back to the
  // envelope, so "there is nothing here" arrived as a TRUTHY object. nfl-hub's
  // getPlayoffs returns null for a league with no bracket; league-matchup.js
  // branched on truthiness and rendered an empty postseason pane over the
  // regular season, hiding the "Generate schedule" button a fresh league needs.
  it('returns null when the op answers with a null data', async () => {
    await expect(invokeReturning({ ok: true, data: null })).resolves.toBeNull();
  });

  // Unchanged from before the fix: no `data` key at all still yields the object
  // itself, which is what ops returning a bare record have always relied on.
  it('returns the envelope itself when there is no data key', async () => {
    await expect(invokeReturning({ ok: true })).resolves.toEqual({ ok: true });
  });

  it('unwraps a present data', async () => {
    await expect(invokeReturning({ ok: true, data: { leagues: ['a'] } }))
      .resolves.toEqual({ leagues: ['a'] });
  });

  it('unwraps falsy-but-present data without falling back', async () => {
    await expect(invokeReturning({ ok: true, data: 0 })).resolves.toBe(0);
    await expect(invokeReturning({ ok: true, data: '' })).resolves.toBe('');
    await expect(invokeReturning({ ok: true, data: false })).resolves.toBe(false);
  });

  it('preserves an empty array and an empty object as themselves', async () => {
    await expect(invokeReturning({ ok: true, data: [] })).resolves.toEqual([]);
    await expect(invokeReturning({ ok: true, data: {} })).resolves.toEqual({});
  });

  // Pins the RETURN-side unwrap specifically. The envelope-side unwrap is
  // provably redundant once the refusal check is hoisted (differential-tested
  // over 25 shapes, 0 differences), so only this one is load-bearing: reverting
  // it to `??` regresses exactly here, where the inner envelope's null data
  // would once again fall back to the envelope object.
  it('returns null through a doubly-wrapped null data', async () => {
    await expect(invokeReturning({ ok: true, data: { ok: true, data: null } }))
      .resolves.toBeNull();
  });

  describe('the ok:false refusal path', () => {
    it('throws with the module error message', async () => {
      await expect(invokeReturning({ ok: false, error: 'not the commissioner' }))
        .rejects.toThrow('not the commissioner');
    });

    // 🔴 THE REGRESSION THE NULL FIX NEARLY INTRODUCED. A module that always
    // emits a data key refuses as {ok:false, error, data:null}. The old `??`
    // never unwrapped a null so the refusal survived; `'data' in` does unwrap
    // it, and a check placed only after the unwrap sees null, finds it falsy,
    // and returns a successful-looking null with the error gone. Verified by
    // hand 2026-08-31: the literal two-line fix swallowed this.
    it('still throws when the refusal also carries a null data', async () => {
      await expect(invokeReturning({ ok: false, error: 'not the commissioner', data: null }))
        .rejects.toThrow('not the commissioner');
    });

    it('throws a default message when the refusal carries no error', async () => {
      await expect(invokeReturning({ ok: false }))
        .rejects.toThrow('module refused the request');
    });
  });

  // ⚠️ A payload may legitimately CONTAIN an `ok` field of its own. It must be
  // returned intact — neither mistaken for a refusal nor unwrapped further.
  it('passes through data that merely contains an ok field', async () => {
    const data = { ok: true, name: 'week 1 sync', count: 3 };
    await expect(invokeReturning({ ok: true, data })).resolves.toEqual(data);
  });

  // ⚠️ KNOWN LIMITATION, PRE-EXISTING AND DELIBERATELY LEFT ALONE by the
  // 2026-08-31 null fix, which was scoped to null-vs-absent and told to preserve
  // the refusal path. Once the envelope's `data` is unwrapped, a refusal and a
  // payload carrying its own ok:false are the same object, so this throws.
  // Curing it means moving the refusal check up to the envelope, which changes
  // refusal semantics for every plugin — a separate decision, not a side effect.
  // An op whose data has an `ok` key must not use false for it.
  it('MIS-throws when data carries its own ok:false (documented limitation)', async () => {
    const data = { ok: false, reason: 'the SYNC failed, the CALL did not' };
    await expect(invokeReturning({ ok: true, data })).rejects.toThrow(/refused|SYNC/);
  });
});
