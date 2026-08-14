/**
 * Write a plugin manifest's `resources` list: every client file, with a sha256 apiece.
 *
 * WHY THIS EXISTS. A registry stores one hash for the file at `manifest.url` — for a plugin
 * whose entry is a 2 KB HTML shell loading a 200 KB module tree, that is ~1% of the shipped
 * bytes and 0% of the executable logic. Declaring subresources is what gives the stored
 * hash real coverage, and it is also what lets another node MIRROR the plugin: without a
 * declared list there is nothing to enumerate, so a mirror can only ever copy the entry
 * file and the rest keeps loading from whoever published it.
 *
 * WHAT IS DECLARED. Everything under the plugin directory, except:
 *
 *   server/**        server modules have their own signed verification chain
 *                    (internal/pluginmodule) — they are not client subresources, and the
 *                    wasm blobs would blow the size budget for no gain.
 *   manifest.json    it is the thing being signed over; a manifest cannot declare itself.
 *   README*, *.test.js, *.spec.js
 *                    never fetched by the running plugin.
 *   anything over the per-resource cap
 *                    reported, not silently dropped — see the note printed at the end.
 *
 * Usage:
 *   node scripts/declare-resources.mjs <plugin-id> [--check]
 *   node scripts/declare-resources.mjs --all [--check]
 *
 * --check writes nothing and exits non-zero if a manifest is out of date. That is the form
 * to run in CI: a plugin published without refreshing this list has a manifest that no
 * longer describes what it ships.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const PLUGINS_DIR = new URL("../plugins/", import.meta.url).pathname;

// Mirrors the node's caps (internal/api/handlers/registry_integrity.go). Kept in step by
// the check below rather than by hope: a manifest that exceeds them is refused at
// verification time, which reads as a broken plugin.
const MAX_RESOURCE_BYTES = 2 * 1024 * 1024;
const MAX_RESOURCE_COUNT = 256;
const MAX_RESOURCE_TOTAL = 16 * 1024 * 1024;

// tests/ is excluded because a fixture is not something the running plugin fetches — and
// declaring one bites twice: it bloats every mirror with data nobody loads, and HTML
// fixtures cannot be verified at all, because Cloudflare rewrites HTML in flight on this
// host (it injected a beacon script into a scraped UFC page, so the bytes a verifier
// fetches are not the bytes that were published). Observed 2026-08-14.
const SKIP_DIRS = new Set(["server", "node_modules", ".git", "tests", "test", "__tests__", "fixtures"]);
// Any extension: .test.js, .test.mjs, .spec.ts — the running plugin fetches none of them.
const SKIP_FILE = (name) =>
  name === "manifest.json" ||
  name.startsWith("README") ||
  /\.(test|spec)\.[a-z]+$/i.test(name) ||
  name.endsWith(".md");

function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), base, out);
    } else if (entry.isFile() && !SKIP_FILE(entry.name)) {
      out.push(relative(base, join(dir, entry.name)).split(sep).join("/"));
    }
  }
  return out;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function buildResources(pluginId) {
  const dir = join(PLUGINS_DIR, pluginId);
  const manifestPath = join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  // The entry file is pinned by the registry's own plugin_hash, so declaring it again adds
  // nothing — and the mirror skips a resource whose path equals the entry anyway.
  const entry = String(manifest.url ?? "").split("/").pop();

  const oversize = [];
  const resources = [];
  let total = 0;

  for (const rel of walk(dir).sort()) {
    if (rel === entry) continue;
    const size = statSync(join(dir, rel)).size;
    if (size > MAX_RESOURCE_BYTES) {
      oversize.push({ rel, size });
      continue;
    }
    total += size;
    resources.push({ url: rel, sha256: sha256(join(dir, rel)) });
  }

  return { manifestPath, manifest, resources, total, oversize };
}

function fail(msg) {
  console.error(`  ✗ ${msg}`);
  process.exitCode = 1;
}

function run(pluginId, check) {
  const { manifestPath, manifest, resources, total, oversize } = buildResources(pluginId);

  if (resources.length > MAX_RESOURCE_COUNT) {
    fail(`${pluginId}: ${resources.length} resources exceeds the node's limit of ${MAX_RESOURCE_COUNT}`);
    return;
  }
  if (total > MAX_RESOURCE_TOTAL) {
    fail(`${pluginId}: ${(total / 1e6).toFixed(1)} MB exceeds the node's limit of ${MAX_RESOURCE_TOTAL / 1e6} MB`);
    return;
  }

  const current = JSON.stringify(manifest.resources ?? null);
  const next = JSON.stringify(resources);
  const changed = current !== next;

  if (check) {
    if (changed) {
      fail(`${pluginId}: manifest resources are out of date — run without --check`);
    } else {
      console.log(`  ✓ ${pluginId}: ${resources.length} resources, up to date`);
    }
    return;
  }

  manifest.resources = resources;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(
    `  ${changed ? "updated" : "unchanged"} ${pluginId}: ${resources.length} resources, ${(total / 1e6).toFixed(2)} MB`,
  );

  // Reported rather than silently skipped: an undeclared file is one the hash chain does
  // not cover and a mirror will not copy, so it keeps loading from the publisher.
  for (const o of oversize) {
    console.log(`    ⚠ not declared (${(o.size / 1e6).toFixed(1)} MB over the per-file cap): ${o.rel}`);
  }
}

const args = process.argv.slice(2);
const check = args.includes("--check");
const targets = args.includes("--all")
  ? readdirSync(PLUGINS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((id) => {
        try {
          statSync(join(PLUGINS_DIR, id, "manifest.json"));
          return true;
        } catch {
          return false;
        }
      })
      .sort()
  : args.filter((a) => !a.startsWith("--"));

if (targets.length === 0) {
  console.error("usage: declare-resources.mjs <plugin-id>... | --all  [--check]");
  process.exit(2);
}
for (const id of targets) run(id, check);
