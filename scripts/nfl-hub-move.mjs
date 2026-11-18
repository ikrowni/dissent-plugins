/**
 * nfl-hub as ONE folder Dissent Maker can bring in and publish as a signed file (plugin v3 step 8).
 *
 *   node scripts/nfl-hub-move.mjs           writes move/nfl-hub/
 *   node scripts/nfl-hub-move.mjs --check   exits 1 when move/nfl-hub/ is not what a fresh build makes
 *
 * WHY A SECOND FOLDER. plugins/nfl-hub/ is still the address-based plugin: plugins.dissent.chat serves it and
 * its manifest names a compiled server module (server/module-*.wasm), which every node that lists it still
 * fetches. A signed file may carry no compiled code at all (dissent-core pluginmodule/dplug.go), and its server
 * part is ONE server.js that imports nothing but "@dissent/plugin-kit/server-sdk" (studiobuild.Bundle). So the
 * Maker cannot take plugins/nfl-hub/ as it is. move/nfl-hub/ is that plugin in the Maker's shape:
 *   - every page file of plugins/nfl-hub/ (server/, scripts/ and tests/ stay behind — none is loaded by the page)
 *   - server.js: server/main.js and everything it imports (server/*.js, core/league/*.js) in one file, built
 *     exactly as server/build.sh bundles it (esbuild, CommonJS, platform neutral) — the only difference is that
 *     the SDK stays an import of "@dissent/plugin-kit/server-sdk", which the node fills with its own copy.
 *   - manifest.json without server_module (the signed file's server part is server.js).
 * It lives outside plugins/, so the deploy never ships it and no mirror ever sees it.
 */
import { build, version as esbuildVersion } from 'esbuild';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'plugins/nfl-hub');
const OUT = join(ROOT, 'move/nfl-hub');
const SDK_IMPORT = '@dissent/plugin-kit/server-sdk';
const LEAVE = new Set(['server', 'scripts', 'tests']);
const MAX_SERVER_JS = 256 * 1024; // dissent-core pluginmodule.MaxServerJSBytes
const check = process.argv.includes('--check');

if (!esbuildVersion.startsWith('0.28.')) throw new Error(`esbuild ${esbuildVersion}: expected 0.28.x (the bundle is checked byte for byte)`);

async function serverJS(version) {
  // Stage server/ beside core/ as build.sh does, with version.js generated from the manifest.
  const stage = mkdtempSync(join(tmpdir(), 'nfl-hub-move-'));
  try {
    mkdirSync(join(stage, 'server'));
    for (const f of readdirSync(join(SRC, 'server'))) if (f.endsWith('.js') && !f.includes('.test.')) cpSync(join(SRC, 'server', f), join(stage, 'server', f));
    cpSync(join(SRC, 'core/league'), join(stage, 'core/league'), { recursive: true });
    writeFileSync(join(stage, 'server/version.js'), `export const MODULE_VERSION = ${JSON.stringify(version)};\n`);
    const r = await build({
      entryPoints: ['server/main.js'], absWorkingDir: stage, bundle: true, format: 'cjs', platform: 'neutral', write: false, logLevel: 'silent',
      plugins: [{ name: 'node-sdk', setup(b) {
        b.onResolve({ filter: /(^|\/)sdk\/server-sdk\.js$/ }, () => ({ path: SDK_IMPORT, external: true }));
      } }],
    });
    // Built from inside the stage, esbuild's path comments read server/… and core/…, wherever it ran.
    return new TextDecoder().decode(r.outputFiles[0].contents);
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

function pageFiles(dir, rel = '') {
  const out = [];
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (!rel && LEAVE.has(n)) continue;
    if (n.startsWith('.') || /^readme/i.test(n) || n.includes('.test.')) continue;
    if (statSync(join(dir, r)).isDirectory()) out.push(...pageFiles(dir, r));
    else out.push(r);
  }
  return out;
}

const mf = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));
delete mf.server_module;
const want = new Map();
for (const f of pageFiles(SRC)) if (f !== 'manifest.json') want.set(f, readFileSync(join(SRC, f)));
want.set('manifest.json', Buffer.from(JSON.stringify(mf, null, 2) + '\n'));
const server = await serverJS(String(mf.version));
if (server.length > MAX_SERVER_JS) throw new Error(`server.js is ${Math.round(server.length / 1024)} KB — the node takes 256 KB at most`);
if (/require\((?!"@dissent\/plugin-kit\/server-sdk")/.test(server)) throw new Error('server.js requires something other than the SDK');
want.set('server.js', Buffer.from(server));

if (check) {
  const have = existsSync(OUT) ? pageFiles(OUT) : [];
  const bad = [];
  for (const [f, b] of want) if (!existsSync(join(OUT, f)) || !readFileSync(join(OUT, f)).equals(b)) bad.push(`${f} differs or is missing`);
  for (const f of have) if (!want.has(f)) bad.push(`${f} should not be there`);
  if (bad.length) { console.error(`move/nfl-hub is out of date — run node scripts/nfl-hub-move.mjs:\n  ${bad.slice(0, 20).join('\n  ')}`); process.exit(1); }
  console.log(`move/nfl-hub is up to date (${want.size} files, server.js ${Math.round(server.length / 1024)} KB)`);
} else {
  rmSync(OUT, { recursive: true, force: true });
  for (const [f, b] of want) { mkdirSync(join(OUT, f, '..'), { recursive: true }); writeFileSync(join(OUT, f), b); }
  console.log(`wrote move/nfl-hub: ${want.size} files, server.js ${Math.round(server.length / 1024)} KB (${mf.version})`);
}
