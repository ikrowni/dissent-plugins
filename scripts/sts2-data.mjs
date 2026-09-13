#!/usr/bin/env node
/**
 * sts2-data — build STS2 Companion's bundled data and art from Spire Codex.
 *
 * Run by hand when Slay the Spire 2 patches. Spec docs/superpowers/specs/2026-09-13-sts2-companion-design.md §2.
 *
 *   node scripts/sts2-data.mjs            # use the cache; download only what is missing
 *   node scripts/sts2-data.mjs --refresh  # re-download the export, card list and changelog
 *
 * ⚠️ RATE LIMITS: the export is 10/hour SHARED across all Spire Codex users, and the site
 * allows 300 requests/minute per IP. Everything is cached in scripts/sts2/.cache/
 * (gitignored) and reused; images are fetched once, ever, and downloads are PACED to ~4/s
 * so a first build of ~1300 images stays under the per-IP limit.
 *
 * REFUSES — exits 1, writing nothing into the plugin — when:
 *   - any pack or data file would exceed 2 MB (the node's per-resource cap)
 *   - the plugin would exceed 256 files (the node's resource-count cap)
 *   - the plugin's data + art would exceed 16 MB in total (the node's resource-total cap)
 *   - any card, relic, potion, power or monster has no downloadable image at all
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { normalize, imageJobs } from './sts2/normalize.mjs';
import { packImages } from './sts2/pack.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const CACHE = join(ROOT, 'scripts/sts2/.cache');
const PLUGIN = join(ROOT, 'plugins/sts2-companion');
const MAX_FILE = 2 * 1024 * 1024;
const MAX_FILES = 256;
// The node's maxResourceTotal. Kept below it so the plugin's own code still fits.
const MAX_TOTAL = 16 * 1024 * 1024;
const BUDGET_FOR_BUNDLE = 14 * 1024 * 1024;
const refresh = process.argv.includes('--refresh');

mkdirSync(join(CACHE, 'img'), { recursive: true });

const MIN_GAP_MS = 250;
let nextSlot = 0;
/** Serialise download STARTS to one per MIN_GAP_MS across every worker. */
async function pace() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

/** A cache entry counts only if it is non-empty. A failed write or conversion leaves an empty
 *  file, and trusting it packed 18 zero-length cards on 2026-09-13. */
const usable = (p) => existsSync(p) && statSync(p).size > 0;

async function download(url, dest) {
  await pace();
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'dissent-sts2-companion-build' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error(`empty response ${url}`);
  writeFileSync(`${dest}.part`, buf);
  renameSync(`${dest}.part`, dest);
  return buf;
}

async function cachedJson(name, url) {
  const p = join(CACHE, name);
  if (refresh || !usable(p)) await download(url, p);
  return JSON.parse(readFileSync(p, 'utf8'));
}

async function main() {
  const zip = join(CACHE, 'export-eng.zip');
  if (refresh || !usable(zip)) await download('https://spire-codex.com/api/exports/eng', zip);
  const fromZip = (f) => JSON.parse(execFileSync('unzip', ['-p', zip, f], { maxBuffer: 64 * 1024 * 1024 }));

  const data = normalize({
    cards: fromZip('cards.json'),
    apiCards: await cachedJson('api-cards.json', 'https://spire-codex.com/api/cards'),
    relics: fromZip('relics.json'),
    potions: fromZip('potions.json'),
    powers: fromZip('powers.json'),
    monsters: fromZip('monsters.json'),
    events: fromZip('events.json'),
    encounters: fromZip('encounters.json'),
    keywords: fromZip('keywords.json'),
    changelogs: await cachedJson('changelogs.json', 'https://spire-codex.com/api/changelogs'),
  });

  // Cards packed by character, then compendium order, so a character filter touches few packs.
  const jobs = imageJobs(data).sort((a, b) => a.id.localeCompare(b.id));
  const cardOrder = new Map(data.cards.map((c) => [c.id, `${c.color}:${String(c.order).padStart(4, '0')}`]));
  jobs.sort((a, b) => {
    const ka = cardOrder.get(a.id.split(':')[1]) ?? a.id;
    const kb = cardOrder.get(b.id.split(':')[1]) ?? b.id;
    return a.group.localeCompare(b.group) || ka.localeCompare(kb);
  });

  const missing = [];
  const optionalMissing = [];
  const images = [];
  let done = 0;
  const queue = [...jobs];
  async function worker() {
    for (let job = queue.shift(); job; job = queue.shift()) {
      // Originals and resized variants are cached SEPARATELY, so changing a size re-derives
      // from disk instead of re-downloading from Spire Codex.
      const srcKey = createHash('sha1').update(job.url).digest('hex');
      // ⚠️ Keep the real extension: ImageMagick reads `.raw` as camera RAW (DNG) and fails.
      const original = join(CACHE, 'img', `${srcKey}.webp`);
      const cached = join(CACHE, 'img', `${createHash('sha1').update(`${job.url}|${job.resize ?? ''}`).digest('hex')}.variant.webp`);
      try {
        if (!usable(original)) await download(job.url, original);
        if (!usable(cached)) {
          const part = `${cached}.part.webp`;
          // `[0]`: some cards ("ancient") are ANIMATED WebP, and ImageMagick 6 cannot write a
          // resized animation ("Invalid frame dimensions"). Frame 0 is the complete card, and
          // the plugin animates nothing anyway (the overlay's frame-budget rule).
          if (job.resize) execFileSync('convert', [`${original}[0]`, '-resize', job.resize, '-quality', '78', `webp:${part}`]);
          else writeFileSync(part, readFileSync(original));
          if (statSync(part).size === 0) throw new Error('conversion produced an empty file');
          renameSync(part, cached);
        }
        images.push({ ...job, bytes: new Uint8Array(readFileSync(cached)) });
      } catch (e) {
        (job.optional ? optionalMissing : missing).push(`${job.id} (${e.message.split('\n')[0]})`);
      }
      done += 1;
      if (done % 100 === 0) console.log(`  images ${done}/${jobs.length}`);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));

  if (optionalMissing.length) {
    console.warn(`sts2-data: ${optionalMissing.length} optional image(s) unavailable — the view falls back to base art:\n  ${optionalMissing.join('\n  ')}`);
  }
  if (missing.length) {
    console.error(`sts2-data: REFUSING — ${missing.length} image(s) could not be fetched:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }

  // Restore the deterministic order the parallel download scrambled.
  const position = new Map(jobs.map((j, i) => [j.id, i]));
  images.sort((a, b) => position.get(a.id) - position.get(b.id));
  const { packs, index } = packImages(images);

  const files = new Map();
  for (const cat of ['cards', 'relics', 'potions', 'powers', 'monsters', 'events', 'encounters', 'keywords']) {
    files.set(`data/${cat}.json`, Buffer.from(JSON.stringify(data[cat])));
  }
  files.set('data/meta.json', Buffer.from(JSON.stringify(data.meta, null, 2)));
  files.set('art/index.json', Buffer.from(JSON.stringify(index)));
  for (const p of packs) files.set(`art/${p.name}`, Buffer.from(p.bytes));

  const total = [...files.values()].reduce((n, b) => n + b.length, 0);
  if (total > BUDGET_FOR_BUNDLE) {
    console.error(`sts2-data: REFUSING — data + art is ${(total / 1e6).toFixed(1)} MB; the node caps a plugin at ${MAX_TOTAL / 1048576} MB in total and ${BUDGET_FOR_BUNDLE / 1048576} MB is left for data + art`);
    process.exit(1);
  }
  const tooBig = [...files].filter(([, b]) => b.length > MAX_FILE).map(([n, b]) => `${n} (${b.length})`);
  if (tooBig.length) {
    console.error(`sts2-data: REFUSING — over the node's 2 MB per-file cap:\n  ${tooBig.join('\n  ')}`);
    process.exit(1);
  }
  const existingOther = existsSync(PLUGIN)
    ? walk(PLUGIN).filter((f) => !f.startsWith('data/') && !f.startsWith('art/') && f !== 'manifest.json' && !/\.test\.js$|README/.test(f))
    : [];
  if (existingOther.length + files.size > MAX_FILES) {
    console.error(`sts2-data: REFUSING — ${existingOther.length + files.size} files, over the node's ${MAX_FILES} cap`);
    process.exit(1);
  }

  rmSync(join(PLUGIN, 'data'), { recursive: true, force: true });
  rmSync(join(PLUGIN, 'art'), { recursive: true, force: true });
  for (const [name, bytes] of files) {
    mkdirSync(dirname(join(PLUGIN, name)), { recursive: true });
    writeFileSync(join(PLUGIN, name), bytes);
  }
  console.log(`sts2-data: game ${data.meta.gameVersion} · ${data.cards.length} cards · ${images.length} images in ${packs.length} packs · ${(total / 1e6).toFixed(1)} MB · ${files.size} files`);
}

function walk(dir, base = dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p, base) : [p.slice(base.length + 1)];
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
