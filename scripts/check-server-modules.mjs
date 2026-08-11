#!/usr/bin/env node
/**
 * check-server-modules — is each manifest's declared WASM module actually here,
 * and is anything built but not yet signed?
 *
 * ⚠️ WHY. A plugin's server module is signed with a key whose private half is
 * deliberately NOT on the server, so promoting a new module is a manual step by
 * the owner. That is correct — a compromised VPS must not be able to forge a
 * module — but it means the client and the module ship on SEPARATE schedules, and
 * nothing used to notice when they drifted apart.
 *
 * That drift is not theoretical. nfl-hub 2.32.0 shipped its client while the
 * manifest still pointed at 2.31.0's module, so the new views called an op that
 * did not exist in the running module. The call was wrapped in `.catch(() => null)`,
 * so the feature rendered a polite empty state — graceful, and a lie. It was
 * found days later by reading a handoff note.
 *
 * Two different things, reported differently:
 *
 *   FAIL  — the manifest names a module file that is missing, or whose bytes do
 *           not hash to the declared sha256. That is a broken publish: the node
 *           verifies this hash and will refuse the module.
 *
 *   WARN  — a module .wasm exists in server/ that no manifest references. That
 *           means somebody built a module and it has not been signed and promoted
 *           yet. Not an error (it is a legitimate mid-flight state), but it is the
 *           exact condition that shipped 2.32.0's client without its module, so it
 *           is said out loud on every deploy rather than sitting silent in a tree.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const manifests = readdirSync('plugins', { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join('plugins', d.name, 'manifest.json'))
  .filter(existsSync);

let failed = 0;
let warned = 0;

for (const manifestPath of manifests) {
  const dir = dirname(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.error(`FAIL ${manifestPath}: unparseable — ${err.message}`);
    failed += 1;
    continue;
  }

  const serverDir = join(dir, 'server');
  const built = existsSync(serverDir)
    ? readdirSync(serverDir).filter((f) => f.endsWith('.wasm'))
    : [];

  const declared = manifest.server_module;
  if (!declared) {
    // A client-only plugin. Any .wasm sitting here is unreferenced by definition.
    for (const f of built) {
      console.log(`::warning::${dir}: ${f} is built but the manifest declares no server_module — it has not been signed and promoted.`);
      warned += 1;
    }
    continue;
  }

  const wanted = basename(declared.url ?? '');
  const wantedPath = join(serverDir, wanted);

  if (!wanted || !existsSync(wantedPath)) {
    console.error(`FAIL ${dir}: manifest declares server module ${wanted || '(no url)'} but that file is not in server/.`);
    failed += 1;
  } else {
    const actual = sha256(wantedPath);
    if (actual !== declared.sha256) {
      console.error(`FAIL ${dir}: ${wanted} hashes to ${actual.slice(0, 16)}… but the manifest declares ${String(declared.sha256).slice(0, 16)}….`);
      failed += 1;
    } else {
      console.log(`ok   ${dir}: ${wanted} matches the declared sha256.`);
    }
  }

  for (const f of built) {
    if (f === wanted) continue;
    console.log(`::warning::${dir}: ${f} is built but NOT referenced by the manifest — it is unsigned/unpromoted, so its ops do not exist in the running module.`);
    warned += 1;
  }
}

console.log(`\nchecked ${manifests.length} manifest(s): ${failed} failure(s), ${warned} warning(s)`);
process.exit(failed > 0 ? 1 : 0);
