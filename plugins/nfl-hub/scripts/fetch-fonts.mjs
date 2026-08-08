#!/usr/bin/env node
// scripts/fetch-fonts.mjs — vendors the display face into assets/fonts/.
//
// Run from the plugin directory:  node scripts/fetch-fonts.mjs
//
// Vendored rather than loaded from fonts.googleapis.com: a plugin fetching fonts from
// Google leaks the viewer's IP to a third party on every render, and the plugin CSP
// scopes font-src to the asset origin so it would simply fail. Same approach as
// rl-hub/vendor/fonts. Barlow Condensed is SIL OFL 1.1.
//
// Only latin + latin-ext are kept. rl-hub also vendored vietnamese; the hub renders
// team abbreviations and English stat labels, so that subset is dead weight.
import { mkdir, writeFile } from 'node:fs/promises';

const OUT = new URL('../assets/fonts/', import.meta.url);
const CSS_URL =
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&display=swap';
// A browser UA is required or Google serves legacy truetype instead of woff2.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

await mkdir(OUT, { recursive: true });

const cssRes = await fetch(CSS_URL, { headers: { 'User-Agent': UA } });
if (!cssRes.ok) { console.error(`FAIL css: HTTP ${cssRes.status}`); process.exit(1); }
const css = await cssRes.text();

// Drop every @font-face block that is not latin or latin-ext.
const blocks = css.split('@font-face').slice(1)
  .map((b) => `@font-face${b.slice(0, b.indexOf('}') + 1)}`);
const keep = blocks.filter((b) => /U\+0000-00FF|U\+0100-02BA/.test(b));
if (!keep.length) { console.error('FAIL: no latin blocks found'); process.exit(1); }

let out = `/* Barlow Condensed, vendored ${new Date().toISOString().slice(0, 10)}.
   Vendored rather than loaded from fonts.googleapis.com: that leaks the viewer's IP
   to a third party on every render, and the plugin CSP scopes font-src to the asset
   origin so it would fail anyway. Same approach as rl-hub/vendor/fonts.
   SIL Open Font License 1.1. Latin + latin-ext only. */\n`;

let n = 0;
for (const block of keep) {
  const url = block.match(/url\((https:[^)]+)\)/)?.[1];
  if (!url) continue;
  const weight = block.match(/font-weight:\s*(\d+)/)?.[1] ?? '400';
  const subset = /U\+0000-00FF/.test(block) ? 'latin' : 'latin-ext';
  const name = `barlow-condensed-${weight}-${subset}.woff2`;
  const fRes = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!fRes.ok) { console.error(`FAIL ${name}: HTTP ${fRes.status}`); process.exit(1); }
  const buf = Buffer.from(await fRes.arrayBuffer());
  await writeFile(new URL(name, OUT), buf);
  out += `${block.replace(/url\(https:[^)]+\)/, `url(./${name})`)}\n`;
  console.log(`ok   ${name} (${Math.round(buf.length / 1024)} KiB)`);
  n += 1;
}

await writeFile(new URL('barlow-condensed.css', OUT), out);
console.log(`wrote barlow-condensed.css with ${n} faces`);
if (n < 3) { console.error('FAIL: expected at least 3 faces (600/700/800 latin)'); process.exit(1); }
