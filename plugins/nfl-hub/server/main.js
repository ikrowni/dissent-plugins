// nfl-hub server module — the entry point the node executes.
//
// ⚠️ THIS IS THE FIRST server_module ANY DISSENT PLUGIN HAS SHIPPED. Until the
// publish path is proven end to end (bundle → sign → manifest → install →
// invoke → rehash), keep the logic here trivial. A failure during that shakeout
// should be unambiguously a *toolchain* failure, not a logic bug.
//
// ⚠️ MUST BE BUNDLED BEFORE COMPILING. extism-js does not resolve imports — see
// build.sh. Client-side plugin code needs no such step, which is a real
// difference between the two halves of this plugin.
import { log, storage, input, output } from "./sdk/server-sdk.js";

const MODULE_VERSION = "0.1.0";

// Every op is a named function taking the request payload. A flat table rather
// than a switch so the op list is greppable and each op stays independently
// testable once the rules engine lands.
const OPS = {
  /** Liveness. Proves the module compiles, runs and can talk to the host. */
  ping(payload) {
    return { pong: true, module_version: MODULE_VERSION, echo: payload ?? null };
  },

  /**
   * Proves storage round-trips under this install's scope.
   * Deliberately uses a key nothing else will ever touch.
   */
  "diag:storage"() {
    const key = "diag:roundtrip";
    const wrote = { at: MODULE_VERSION, n: (storage.get(key)?.n ?? 0) + 1 };
    storage.set(key, wrote);
    return { wrote, read: storage.get(key) };
  },

  /**
   * Proves compare-and-swap works on the live node.
   *
   * This is the primitive the whole league design rests on (all roster
   * ownership lives in one CAS-guarded key), so it gets a diagnostic that can
   * be run against production before any league state exists.
   */
  "diag:swap"() {
    const before = storage.getVersioned("diag:counter");
    const after = storage.swap("diag:counter", (c) => ({ n: (c?.n ?? 0) + 1 }), {
      fallback: { n: 0 },
    });
    return { before_version: before.version, after, version: storage.getVersioned("diag:counter").version };
  },
};

// ⚠️ NOT `export function` — the module is bundled to CJS and extism-js looks for
// `module.exports.run`. Using `export` makes esbuild treat this as ESM, silently
// drop the module.exports assignment below, and emit a wasm with no exported
// entry point. It BUILDS CLEANLY either way; only running it reveals the
// difference.
function run() {
  const req = input() ?? {};
  const op = req.op;

  const handler = OPS[op];
  if (!handler) {
    // Named ops only. An unknown op is a caller bug and must not be guessed at.
    output({ ok: false, error: `unknown op: ${op ?? "(none)"}`, ops: Object.keys(OPS) });
    return 0;
  }

  try {
    output({ ok: true, data: handler(req.payload) });
  } catch (err) {
    // A thrown host refusal (allowlist, size cap, storage unavailable) arrives
    // here. Surface the message rather than trapping — the caller gets a usable
    // error instead of an opaque "trap" outcome.
    log(`nfl-hub server module: ${op} failed: ${err.message}`);
    output({ ok: false, error: String(err.message ?? err) });
  }
  return 0;
}

module.exports = { run };
