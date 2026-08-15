/**
 * Generate the vendored copies of the shared modules that live at the plugins root.
 *
 * WHY THIS EXISTS. A mirror may only copy files from **under a plugin's own directory**
 * (`internal/pluginmirror.RelPath` in dissent-core rejects anything else — reaching above
 * your directory is how one plugin would take another's files). So a plugin that does
 * `import { scrapeRLStats } from '../rl-scraper.js'` cannot be mirrored at all: the node
 * has nothing to enumerate, and the import keeps resolving to whoever published it. That
 * is what held `dnd-master`, `dnd-player`, `rl-hub`, `rl-sidebar` and `ufc-hub` back from
 * mirroring on 2026-08-15 while the other twelve went through.
 *
 * WHY GENERATED RATHER THAN COPIED BY HAND. Vendoring means N copies, and N copies drift.
 * `polymarket.js` says so in its own header, and it is right for a reason that is not
 * stylistic — it is the single choke point (`placeBet`) between a config setting and a
 * real-money order, and the whole argument for it collapses if a second copy can quietly
 * answer differently. So the module still lives in exactly one place and the copies are
 * *output*. `--check` fails the build when a copy stops matching, which is the only thing
 * that makes "one source of truth" true rather than aspirational.
 *
 * ⚠️ THE COPIES ARE BUILD OUTPUT. Never hand-edit one — edit the root module and re-run
 * this. Each generated file carries a header saying so.
 *
 * ⚠️ `plugin-sdk.js` IS NOT VENDORED and must not be. The node serves it from its own
 * origin at `/plugins/plugin-sdk.js` (see `plugin_sdk.go`), so `../plugin-sdk.js` resolves
 * on a mirroring node without being copied anywhere. It is the one shared module with a
 * real home. The import is rewritten per target *depth*, because a copy two directories
 * down needs `../../`.
 *
 * Usage:
 *   node scripts/vendor-shared.mjs            # write the copies
 *   node scripts/vendor-shared.mjs --check    # write nothing; exit 1 if any copy is stale
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const PLUGINS_DIR = new URL("../plugins/", import.meta.url).pathname;

/**
 * source: the module at the plugins root, which stays the single source of truth.
 * targets: where a copy is generated, relative to plugins/.
 *
 * A target's path determines the SDK import depth, so nesting is handled automatically —
 * `ufc-hub/core/…` gets `../../plugin-sdk.js` and `rl-hub/…` gets `../plugin-sdk.js`.
 *
 * ⚠️ `ufc-hub` already has a DIFFERENT `core/polymarket.js` (implied win probability for a
 * card). The trading module is vendored under a distinct name so the two never collide.
 */
const VENDORED = [
  {
    source: "rl-scraper.js",
    targets: ["rl-hub/rl-scraper.js", "rl-sidebar/rl-scraper.js"],
  },
  {
    source: "dnd-hub-shared-storage.js",
    targets: [
      "dnd-master/dnd-hub-shared-storage.js",
      "dnd-player/dnd-hub-shared-storage.js",
    ],
  },
  {
    source: "polymarket.js",
    targets: ["ufc-hub/core/polymarket-trade.js"],
  },
];

/** How many directories below plugins/ a target sits — i.e. how many `../` reach the root. */
function depthOf(target) {
  return target.split("/").length - 1;
}

function banner(source, target) {
  const up = "../".repeat(depthOf(target));
  return [
    `// ⚠️ GENERATED FILE — DO NOT EDIT.`,
    `//`,
    `// Vendored from plugins/${source} by scripts/vendor-shared.mjs.`,
    `// Edit that file and re-run the script; \`--check\` fails the deploy if this copy drifts.`,
    `//`,
    `// It is a copy because a mirror may only serve files from under this plugin's own`,
    `// directory, so importing '${up}${source}' directly would make the plugin unmirrorable.`,
    ``,
    ``,
  ].join("\n");
}

/** Rewrite the source's own SDK import for where the copy will live. */
function render(source, target) {
  const raw = readFileSync(join(PLUGINS_DIR, source), "utf8");
  const up = "../".repeat(depthOf(target));

  let seen = 0;
  const body = raw.replace(
    /(['"])\.\/plugin-sdk\.js\1/g,
    (_m, q) => {
      seen++;
      return `${q}${up}plugin-sdk.js${q}`;
    },
  );

  // A source that stopped importing the SDK is fine; one whose import shape changed is not.
  // Silently emitting a copy with an unresolvable './plugin-sdk.js' would present as the
  // plugin's features simply being absent, which is exactly the failure mode this whole
  // area keeps producing.
  if (raw.includes("plugin-sdk.js") && seen === 0) {
    throw new Error(
      `plugins/${source} references plugin-sdk.js but not as './plugin-sdk.js' — ` +
        `the rewrite would leave an unresolvable specifier in ${target}. Fix the source or this script.`,
    );
  }
  return banner(source, target) + body;
}

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);

const check = process.argv.includes("--check");
let stale = 0;
let wrote = 0;

for (const { source, targets } of VENDORED) {
  if (!existsSync(join(PLUGINS_DIR, source))) {
    console.error(`✗ missing source: plugins/${source}`);
    process.exit(1);
  }
  for (const target of targets) {
    const want = render(source, target);
    const path = join(PLUGINS_DIR, target);
    const have = existsSync(path) ? readFileSync(path, "utf8") : null;

    if (have === want) {
      console.log(`  ok    ${target}  (${sha(want)})`);
      continue;
    }
    if (check) {
      stale++;
      console.error(
        `✗ STALE  ${target}\n         regenerate with: node scripts/vendor-shared.mjs`,
      );
      continue;
    }
    writeFileSync(path, want);
    wrote++;
    console.log(`  write ${target}  ← plugins/${source}  (${sha(want)})`);
  }
}

if (check && stale > 0) {
  console.error(
    `\n${stale} vendored cop${stale === 1 ? "y is" : "ies are"} out of date with the root module.`,
  );
  process.exit(1);
}
console.log(
  check
    ? `\nAll vendored copies match their source.`
    : `\n${wrote} written, ${VENDORED.reduce((n, v) => n + v.targets.length, 0) - wrote} already current.`,
);
