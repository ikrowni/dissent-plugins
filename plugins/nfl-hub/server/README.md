# nfl-hub server module

The first `server_module` any Dissent plugin has shipped. This is the half of the
plugin the **node** executes — with no user present — which is what makes a native
fantasy league possible at all (waiver resolution, lineup locks, scoring runs and
a draft clock all need to happen when nobody is watching).

The browser half of the plugin is unchanged and lives in `../core` and `../views`.

## Build

```bash
./build.sh
```

Bundles `main.js` (esbuild → CJS), compiles it with `extism-js`, and prints the
`sha256` and `size` that the manifest's `server_module` block needs.

⚠️ **`module.wasm` is committed.** The signature pins exact bytes, and
`extism-js` output is not guaranteed byte-reproducible across toolchain versions
— so a rebuild can invalidate a signature that is otherwise still valid. Keeping
the signed artifact in git means the bytes that were signed are always
recoverable. Rebuild only when `main.js` actually changes, and re-sign when you do.

## Verify it before asking for a signature

```bash
cd ~/projects/dissent-core
go run ./cmd/plugin-module-check ~/dissent-plugins/plugins/nfl-hub/server/module.wasm '{"op":"ping"}'
```

Runs the module through the real runtime — same Extism, same host functions, same
limits — against a throwaway in-memory store.

⚠️ **"It compiled" proves very little.** A module bundled as ESM instead of CJS
builds perfectly cleanly and exports **no entry point at all**. That is why
`main.js` uses `module.exports = { run }` and *not* `export function run`, and why
this check exists: signing costs a human round trip and must not be spent on an
artifact nobody ran.

## Publish (needs the owner)

⚠️ **The signing private key is deliberately not on the node.** A key on the VPS
would let anyone with VPS access sign code the node then trusts and executes,
which defeats signing entirely. So this step cannot be automated:

```bash
node scripts/plugin-module-key.mjs sign nfl-hub module.wasm
```

Then add to `../manifest.json`:

```json
"server_module": {
  "url": "https://plugins.dissent.chat/plugins/nfl-hub/server/module.wasm",
  "sha256": "<from build.sh>",
  "size": <from build.sh>,
  "signature": "<from the sign command>"
}
```

⚠️ **Publishing requires a re-hash or the plugin goes offline.** Stored hashes pin
published bytes, so a routine release makes them mismatch, the verify job suspends
the plugin, and suspension blocks install and `/plugins/fetch`:

```bash
/home/ubuntu/bin/dissent-core --rehash-registry=nfl-hub
```

## Ops

Named ops only — an unknown op is a caller bug and is never guessed at.

| Op | What |
|---|---|
| `ping` | Liveness; echoes its payload and reports the module version |
| `diag:storage` | Proves storage round-trips under this install's scope |
| `diag:swap` | Proves compare-and-swap works — the primitive all roster ownership rests on |

Invoked via `POST /api/v1/servers/:id/plugins/:pid/invoke` with
`{"payload": {"op": "ping"}}`.

Design: `docs/superpowers/specs/2026-08-09-nfl-fantasy-league-design.md`.
