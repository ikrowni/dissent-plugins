#!/usr/bin/env node
/**
 * live-check — drive the SHIPPED parsers against LIVE data.
 *
 *     node plugins/ufc-hub/tests/live-check.mjs
 *
 * NOT a vitest file, on purpose: it hits five third-party hosts and would make the
 * suite slow and flaky. Run it by hand after a deploy, and whenever a panel goes blank.
 *
 * WHY IT EXISTS: the unit tests run against frozen fixtures, so they prove the code is
 * self-consistent and nothing more. Every one of them stays green while a source
 * restyles its HTML, renames a field, or starts refusing us. This is the only check
 * that notices.
 *
 * ⚠️⚠️ THE USER-AGENT IS PART OF THE TEST. It MUST match `plugins_fetch.go` exactly.
 * Akamai (ESPN) allowlists *known* client UAs and 403s anything else, including a
 * custom Dissent one:
 *
 *     Chrome / Firefox / Safari / bare "Mozilla/5.0"        -> 403
 *     "Dissent-Plugin-Proxy/1.0", "Dissent-Node/1.0"        -> 403
 *     "Go-http-client/2.0", "curl/8.5.0", "okhttp/4.12.0"   -> 200
 *
 * A probe with the wrong UA reports a live outage that production does not have — I did
 * exactly that on 2026-08-08 and briefly believed ufc-hub was down. The inverse is also
 * true and is why ufc.com looked unreachable for months: ufc.com fingerprint-blocks
 * `curl` while allowing Go. **Never conclude a host is up or down from a probe whose
 * headers differ from the node's.**
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMonthIndex, monthKey, urls } from '../core/ufc-espn.js';
import { nearestEvent } from '../core/event-index.js';
import { parseEvent } from '../core/ufc-cloudfront.js';
import { athletesForEvent, joinAthletes } from '../core/espn-athletes.js';
import { cardUrl, joinMarkets, pct, american } from '../core/polymarket.js';
import { athleteUrl, eventPageUrl } from '../core/ufc-links.js';
import { parseEventPage, renderFor } from '../core/ufc-event-page.js';
import { parseAthlete } from '../core/ufc-athlete.js';
import { fightState } from '../core/fight-state.js';
import { CF_URL } from '../core/ufc-cf-client.js';

const dir = mkdtempSync(join(tmpdir(), 'ufc-live-'));
writeFileSync(join(dir, 'go.mod'), 'module livecheck\n\ngo 1.21\n');
writeFileSync(join(dir, 'main.go'), `package main

import ("fmt";"io";"net/http";"os";"time")

func main() {
	c := &http.Client{Timeout: 30 * time.Second}
	u, out := os.Args[1], os.Args[2]
	req, _ := http.NewRequest("GET", u, nil)
	// Exactly the headers plugins_fetch.go sends. See this file's header.
	req.Header.Set("User-Agent", "Go-http-client/2.0")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	r, e := c.Do(req)
	if e != nil { fmt.Fprintln(os.Stderr, e); os.Exit(1) }
	b, _ := io.ReadAll(r.Body)
	r.Body.Close()
	os.WriteFile(out, b, 0644)
	if r.StatusCode != 200 { fmt.Fprintf(os.Stderr, "HTTP %d for %s\\n", r.StatusCode, u); os.Exit(1) }
}
`);

let failures = 0;
const get = (url) => {
  execFileSync('go', ['run', 'main.go', url, join(dir, 'out')], { cwd: dir, stdio: 'pipe' });
  return readFileSync(join(dir, 'out'), 'utf8');
};
const json = (u) => JSON.parse(get(u));
const ok = (cond, msg) => {
  if (!cond) failures += 1;
  console.log(`  ${cond ? '✓' : '✗ FAIL'}  ${msg}`);
};

console.log('\n1. ESPN month index -> nearest event');
const idx = parseMonthIndex(json(urls.month(monthKey(new Date()))));
const sel = nearestEvent(idx);
ok(idx.length > 0, `${idx.length} events in the month index`);
ok(!!sel, `selected: ${sel?.name} (${sel?.startTime})`);

console.log('\n2. CloudFront event');
const cf = parseEvent(json(CF_URL(1324)));
ok(cf?.fights?.length > 0, `${cf?.fights?.length} fights, status=${cf?.status}`);
ok(cf.fights.every((f) => ['pre', 'in', 'post'].includes(fightState(f, cf))),
  `every fight resolves a state (main event: ${fightState(cf.fights[0], cf)})`);

console.log('\n3. ESPN athletes -> headshots + flags');
const month = json(urls.month(monthKey(new Date())));
const ath = joinAthletes(cf.fights, athletesForEvent(month, sel.id));
const want = cf.fights.flatMap((f) => f.fighters).length;
ok(ath.size === want, `${ath.size}/${want} fighters matched`);
ok(new Set([...ath.values()].map((v) => v.espnId)).size === ath.size,
  'every matched fighter has a DISTINCT espn id');

console.log('\n4. Polymarket');
const odds = joinMarkets(cf.fights, json(cardUrl(cf.startTime)));
// Not every fight is priced — 11 of 12 on the measured card — so this is a floor.
ok(odds.size >= Math.floor(cf.fights.length * 0.7),
  `${odds.size}/${cf.fights.length} fights priced`);
const main = odds.get(cf.fights[0].fightId);
const p = main?.byFighter?.[cf.fights[0].red.fighterId];
ok(p == null || (p > 0 && p < 1),
  main ? `main event: ${cf.fights[0].red.lastName} ${pct(p)}% (${american(p)})`
       : 'main event unpriced (allowed)');

console.log('\n5. ufc.com event page -> artwork');
const page = parseEventPage(get(eventPageUrl(cf.name, cf.startTime)));
ok(!!page.art, `art: ${page.art?.split('/').pop()?.slice(0, 56) ?? 'MISSING'}`);
ok(Object.keys(page.renders).length === want,
  `${Object.keys(page.renders).length}/${want} stance renders`);

console.log('\n6. ufc.com athlete page -> career stats');
const f0 = cf.fights[0].red;
const a = parseAthlete(get(athleteUrl(f0.ufcLink)));
ok(a.name === f0.name, `name: ${a.name}`);
ok(Object.keys(a.stats).length === 8, `${Object.keys(a.stats).length}/8 stats`);
ok(a.accuracy.striking != null,
  `striking ${a.accuracy.striking}%, takedown ${a.accuracy.takedown}%`);
ok(String(a.stats['Sig. Str. Defense'] ?? '').endsWith('%'),
  `defence carries its %: ${a.stats['Sig. Str. Defense']}`);

console.log(failures ? `\n${failures} CHECK(S) FAILED\n` : '\nall live checks passed\n');
process.exit(failures ? 1 : 0);
