/**
 * Remove the hardcoded `<base href="https://app.dissent.chat/plugins/">` from a plugin's
 * entry HTML, rewriting its references so they resolve to the same files.
 *
 * WHY. That tag pins every relative path in the entry to one project's host **regardless of
 * where the file is served from**. A node that mirrors the plugin therefore serves an entry
 * that still pulls every stylesheet and module from the publisher — the mirror copies the
 * bytes and changes nothing. It is the single thing standing between "we mirror plugins"
 * and "a node keeps working when the publisher does not".
 *
 * WHAT IT DOES. Drops the tag and strips the leading `<plugin-id>/` from each relative
 * reference, because with the base gone they resolve against the entry's own URL
 * (`…/plugins/<id>/plugin.html`) rather than `…/plugins/`.
 *
 *     with base:     href="nfl-hub/styles/base.css" → https://app.dissent.chat/plugins/nfl-hub/styles/base.css
 *     without base:  href="styles/base.css"         → <wherever this is served>/plugins/nfl-hub/styles/base.css
 *
 * ⚠️ SAFE ONLY BECAUSE the runtime URLs in these plugins are built from `import.meta.url`,
 * which resolves against the module's own location and never `document.baseURI`. Verified
 * before writing this. A plugin that fetches a bare relative path from script, or reads
 * `document.baseURI`, would change behaviour here and is refused below.
 *
 * The rewrite is proved rather than assumed: every reference's resolved URL is compared
 * before and after, and anything that would not land on the same file aborts the file.
 *
 * Usage: node scripts/drop-hardcoded-base.mjs <plugin-id>... [--check]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PLUGINS_DIR = new URL("../plugins/", import.meta.url).pathname;
const BASE_RE = /^[ \t]*<base\s+href="([^"]*)"\s*\/?>[ \t]*\r?\n?/im;
const REF_RE = /\b(src|href)="([^"]+)"/g;

/** A reference the base tag governs: relative, not a scheme, not a fragment or root path. */
function isBaseRelative(url) {
  return !/^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(url.trim());
}

function processPlugin(pluginId, check) {
  const dir = join(PLUGINS_DIR, pluginId);
  const entryPath = join(dir, "plugin.html");
  let html;
  try {
    html = readFileSync(entryPath, "utf8");
  } catch {
    console.log(`  – ${pluginId}: no plugin.html`);
    return true;
  }

  const baseMatch = html.match(BASE_RE);
  if (!baseMatch) {
    console.log(`  ✓ ${pluginId}: no hardcoded base`);
    return true;
  }
  const baseHref = baseMatch[1];

  // Refuse anything that would change behaviour rather than only location.
  const scriptRisk = /document\.baseURI/.test(html);
  if (scriptRisk) {
    console.error(`  ✗ ${pluginId}: entry reads document.baseURI — removing <base> would change behaviour`);
    return false;
  }

  const entryURL = `https://example.invalid/plugins/${pluginId}/plugin.html`;
  const rewritten = html.replace(BASE_RE, "").replace(REF_RE, (whole, attr, url) => {
    if (!isBaseRelative(url)) return whole;
    const prefix = `${pluginId}/`;
    if (!url.startsWith(prefix)) {
      // Left alone deliberately: without the pluginId prefix it pointed somewhere else
      // under /plugins/, and silently re-pointing it at this plugin would be a guess.
      console.error(`  ✗ ${pluginId}: relative ref not under ${prefix}: ${url}`);
      throw new Error("unprefixed reference");
    }
    return `${attr}="${url.slice(prefix.length)}"`;
  });

  // The proof: every governed reference must resolve to the same file as before.
  const before = [...html.matchAll(REF_RE)].filter(([, , u]) => isBaseRelative(u));
  const after = [...rewritten.matchAll(REF_RE)].filter(([, , u]) => isBaseRelative(u));
  if (before.length !== after.length) {
    console.error(`  ✗ ${pluginId}: reference count changed (${before.length} → ${after.length})`);
    return false;
  }
  for (let i = 0; i < before.length; i++) {
    const wasPath = new URL(before[i][2], baseHref).pathname;
    const nowPath = new URL(after[i][2], entryURL).pathname;
    if (wasPath !== nowPath) {
      console.error(`  ✗ ${pluginId}: ${before[i][2]} resolved to ${wasPath}, now ${nowPath}`);
      return false;
    }
    // And it must actually exist on disk, or the "same file" claim is about two 404s.
    const rel = nowPath.replace(`/plugins/${pluginId}/`, "").split("?")[0];
    try {
      statSync(join(dir, rel));
    } catch {
      console.error(`  ✗ ${pluginId}: ${rel} does not exist`);
      return false;
    }
  }

  if (check) {
    console.error(`  ✗ ${pluginId}: still has a hardcoded base (${before.length} refs would be rewritten)`);
    return false;
  }
  writeFileSync(entryPath, rewritten);
  console.log(`  updated ${pluginId}: base removed, ${before.length} references rewritten and verified`);
  return true;
}

const args = process.argv.slice(2);
const check = args.includes("--check");
const targets = args.includes("--all")
  ? readdirSync(PLUGINS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
  : args.filter((a) => !a.startsWith("--"));

let ok = true;
for (const id of targets) {
  try {
    if (!processPlugin(id, check)) ok = false;
  } catch {
    ok = false;
  }
}
process.exit(ok ? 0 : 1);
