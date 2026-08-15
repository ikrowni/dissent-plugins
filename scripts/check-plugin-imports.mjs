/**
 * Fail when a plugin imports something a mirror could never serve.
 *
 * WHY THIS EXISTS. `internal/pluginmirror.RelPath` (dissent-core) will only mirror a
 * resource that resolves **under the plugin's own directory**. Everything else keeps
 * loading from whoever published it — so a plugin with one `../shared.js` import is
 * permanently tied to the publisher's CDN no matter how carefully it is mirrored.
 *
 * ⚠️ AND IT LOOKS FINE UNTIL IT ISN'T. On the publisher's own host every one of these
 * paths resolves, so nothing 404s, no test fails and the plugin renders correctly. The
 * breakage only appears on a *different* node, or when the publisher's host goes away —
 * which is the exact dependency mirroring exists to remove. Five plugins were held back
 * from mirroring on 2026-08-15 for this reason and none of them looked broken.
 *
 * THE THREE VERDICTS, and why cross-plugin is not simply banned:
 *
 *   ok        resolves inside the plugin's own directory, or is `../plugin-sdk.js` —
 *             the one shared module the NODE itself serves (`plugin_sdk.go`), so it needs
 *             no copy and resolves on any mirroring node.
 *   error     reaches a file at the plugins ROOT (other than the SDK), or escapes the
 *             plugins root altogether. Neither can ever be mirrored. Vendor it with
 *             `scripts/vendor-shared.mjs`.
 *   warn      reaches into ANOTHER plugin's directory. This resolves correctly, but only
 *             while that other plugin is also mirrored on the same node — a real
 *             dependency that is invisible in both manifests. Reported so it is a known
 *             coupling rather than a surprise, not failed, because the alternative
 *             (duplicating a shared event-type vocabulary) is worse.
 *
 * Usage:
 *   node scripts/check-plugin-imports.mjs           # exit 1 on any error
 *   node scripts/check-plugin-imports.mjs --strict  # exit 1 on warnings too
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";

const PLUGINS_DIR = new URL("../plugins/", import.meta.url).pathname;

/** The one root module the node serves from its own origin, so it needs no vendoring. */
const NODE_SERVED_ROOT_MODULE = "plugin-sdk.js";

// Mirrors declare-resources.mjs: what is never declared cannot affect mirroring.
const SKIP_DIRS = new Set([
  "node_modules", ".git", "vendor", "server", "tests", "test", "__tests__", "fixtures",
]);
const SCANNABLE = /\.(js|mjs|html)$/i;
// Tests are not fetched by the running plugin and are excluded from `resources`
// declaration for the same reason, so their imports cannot affect mirroring.
const IS_TEST = (name) => /\.(test|spec)\.[a-z]+$/i.test(name);

/**
 * Every relative specifier in a file: static `from '…'`, bare `import '…'`, re-exports,
 * and dynamic `import('…')`. Only relative ones matter — a bare specifier is not a URL a
 * plugin fetches, and an absolute URL is caught by RelPath's same-origin rule instead.
 */
function specifiers(src) {
  const out = [];
  const patterns = [
    /(?:^|[^\w$])(?:import|export)\s[\s\S]*?\sfrom\s*['"](\.[^'"]*)['"]/g,
    /(?:^|[^\w$])import\s*['"](\.[^'"]*)['"]/g,
    /\bimport\s*\(\s*['"](\.[^'"]*)['"]\s*\)/g,
    /<script[^>]+src\s*=\s*['"](\.[^'"]*)['"]/gi,
    /<link[^>]+href\s*=\s*['"](\.[^'"]*)['"]/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) out.push(m[1]);
  }
  return out;
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), out);
    } else if (SCANNABLE.test(e.name) && !IS_TEST(e.name)) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

const pluginIds = readdirSync(PLUGINS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name))
  .map((e) => e.name)
  .sort();

const errors = [];
const warnings = [];

for (const id of pluginIds) {
  const root = join(PLUGINS_DIR, id);
  for (const file of walk(root)) {
    const src = readFileSync(file, "utf8");
    for (const spec of specifiers(src)) {
      // Strip the cache-busting query some plugins append (`?v=20260502p4`).
      const clean = spec.split("?")[0].split("#")[0];
      if (!clean) continue;

      const target = resolve(dirname(file), clean);
      const where = `${relative(PLUGINS_DIR, file)} → ${spec}`;

      const fromPluginsRoot = relative(PLUGINS_DIR, target);
      if (fromPluginsRoot.startsWith("..")) {
        errors.push(
          `${where}\n      escapes the plugins root entirely — this never resolved anywhere ` +
            `except by accident of the CDN serving one directory at two prefixes.`,
        );
        continue;
      }

      const segments = fromPluginsRoot.split(sep);
      if (segments.length === 1) {
        if (segments[0] === NODE_SERVED_ROOT_MODULE) continue; // node serves it
        errors.push(
          `${where}\n      imports the root module '${segments[0]}', which a mirror may ` +
            `not copy. Vendor it: add it to scripts/vendor-shared.mjs and import the local copy.`,
        );
        continue;
      }

      const owner = segments[0];
      if (owner !== id) {
        warnings.push(
          `${where}\n      reaches into '${owner}' — resolves only while '${owner}' is ` +
            `ALSO mirrored on the same node.`,
        );
      }
    }
  }
}

for (const w of warnings) console.warn(`  warn  ${w}`);
for (const e of errors) console.error(`✗ ERROR ${e}`);

const strict = process.argv.includes("--strict");
console.log(
  `\n${pluginIds.length} plugins scanned · ${errors.length} error(s) · ${warnings.length} cross-plugin dependency(ies)`,
);

if (errors.length > 0) {
  console.error(
    `\nThese plugins cannot be fully mirrored. They will look correct on the publisher's ` +
      `own host and break on every other node.`,
  );
  process.exit(1);
}
if (strict && warnings.length > 0) process.exit(1);
console.log("No unmirrorable imports.");
