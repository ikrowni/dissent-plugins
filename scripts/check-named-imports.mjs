#!/usr/bin/env node
// check-named-imports.mjs — every `import { x } from './y.js'` in a plugin names something y.js really exports.
//
// WHY: a plugin's modules load in the browser, and a named import of something that is not exported is a SyntaxError
// for the WHOLE module graph: the D&D Hub would not start at all. No unit test loads the Hub's entry files, and
// check-plugin-imports.mjs checks where imports point, not what they name. The page-reader work (2026-10-06) removed an
// export that dnd-hub-main.js still imported; this catches that class.
//
//   node scripts/check-named-imports.mjs            # all plugins; exits 1 on any problem
//   node scripts/check-named-imports.mjs dnd-hub    # one plugin
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../plugins');
// server/: modules built to WASM with an SDK copied in at build time (check-server-modules.mjs covers them).
const SKIP = new Set(['vendor', 'node_modules', 'server']);
const walk = d => readdirSync(d).flatMap(f => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? (SKIP.has(f) ? [] : walk(p)) : p.endsWith('.js') ? [p] : [];
});

const cache = new Map();
/** The names a module exports ('*' when it re-exports a whole module: anything may come through). */
export function exportsOf(src) {
  const s = src, out = new Set();
  for (const m of s.matchAll(/export\s+(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  // export const a = 1, b = [2, 3], c = { d: 4 };  — the names before each top-level `=`
  for (const m of s.matchAll(/export\s+(?:const|let|var)\s+([\s\S]*?);/g)) {
    let depth = 0, part = '';
    for (const ch of m[1]) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) { const n = part.match(/^\s*([A-Za-z_$][\w$]*)\s*=/); if (n) out.add(n[1]); part = ''; } else part += ch;
    }
    const n = part.match(/^\s*([A-Za-z_$][\w$]*)\s*=/); if (n) out.add(n[1]);
  }
  for (const m of s.matchAll(/export\s*\{([^}]*)\}/g)) for (const p of m[1].split(',')) { const n = p.trim().split(/\s+as\s+/).pop(); if (n) out.add(n); }
  if (/export\s+default\b/.test(s)) out.add('default');
  if (/export\s*\*\s*from/.test(s)) out.add('*');
  return out;
}

export function check(files) {
  const problems = [];
  let n = 0;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
      const target = resolve(dirname(f), m[2].split('?')[0]);
      if (!existsSync(target)) { problems.push(`${f.replace(ROOT + '/', '')}: imports ${m[2]}, which does not exist`); continue; }
      if (!cache.has(target)) cache.set(target, exportsOf(readFileSync(target, 'utf8')));
      const have = cache.get(target);
      for (const p of m[1].split(',')) {
        const name = p.trim().split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        n++;
        if (!have.has(name) && !have.has('*')) problems.push(`${f.replace(ROOT + '/', '')}: imports { ${name} } from ${m[2]}, which does not export it`);
      }
    }
  }
  return { n, problems };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const only = process.argv.slice(2);
  const dirs = (only.length ? only : readdirSync(ROOT)).map(d => join(ROOT, d)).filter(d => existsSync(d) && statSync(d).isDirectory());
  const { n, problems } = check(dirs.flatMap(walk));
  for (const p of problems) console.log(`✗ ${p}`);
  console.log(`${n} named imports checked · ${problems.length} problem(s)`);
  process.exit(problems.length ? 1 : 0);
}
