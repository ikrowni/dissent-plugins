#!/usr/bin/env node
// scripts/plugin-harness.mjs — drive a plugin in a real browser, with a real host.
//
// WHY: a plugin renders inside a sandboxed srcdoc iframe and talks to the app
// over postMessage. Load it without a host and every capability call hangs, so
// every data view sits empty — which looks exactly like a broken plugin and is
// not one. This stands up the host side so the views actually load, and reports
// console errors, failed requests and empty panes.
//
// ⚠️ THE STUBS COPY THE REAL PAYLOADS, NOT WHAT THE CALLER HOPES FOR. In
// particular `fetch:external` resolves with { status, body, content_type } and
// **no `ok` field** — a plugin that checks `res.ok` throws on every SUCCESS.
// That exact bug shipped once and broke every panel while the node logged
// nothing but 200s. A harness that invents an `ok` would hide it again.
//
//   node scripts/plugin-harness.mjs nfl-hub               # sweep every view
//   node scripts/plugin-harness.mjs nfl-hub --shot out.png --view standings
import { chromium } from 'playwright';
import { readFileSync, readdirSync } from 'node:fs';

const plugin = process.argv[2] ?? 'nfl-hub';
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : process.argv[i + 1];
};
const APP = 'https://app.dissent.chat';
const PLUGIN_URL = `https://plugins.dissent.chat/plugins/${plugin}/plugin.html`;

/** The host half: injected into the PARENT page, replies over postMessage. */
function installHost({ pluginUrl, csp, saves, overlay }) {
  const store = new Map();

  window.addEventListener('message', async (e) => {
    const msg = e.data;
    if (!msg || msg.type !== 'dissent:request') return;
    const frame = document.getElementById('pf');
    const reply = (ok, data, error) => frame.contentWindow.postMessage(
      { type: 'dissent:response', id: msg.id, ok, data, error }, '*',
    );

    try {
      switch (msg.action) {
        case 'fetch:external': {
          // ⚠️ PROXIED THROUGH NODE, exactly as the real host proxies through the
          // node's /plugins/fetch. Fetching from the page instead puts the app's
          // origin on the request and CORS blocks every upstream that does not
          // send ACAO — which is most of them, and which made three working views
          // look broken.
          const r = await window.__harnessFetch({
            url: String(msg.params.url),
            method: msg.params.method ?? 'GET',
            headers: msg.params.headers ?? null,
            body: msg.params.body ?? null,
          });
          // ⚠️ EXACTLY the node's shape — status/body/content_type, no `ok`.
          reply(true, r);
          return;
        }
        // ⚠️ The real host answers { value } (dissent-core personal_plugin_data.go); the SDK reads
        // `.value`. Replying the bare value made every stored read look empty.
        case 'storage:get': reply(true, store.has(msg.params.key) ? { value: store.get(msg.params.key) } : null); return;
        case 'storage:set': store.set(msg.params.key, msg.params.value); reply(true, true); return;
        case 'storage:delete': store.delete(msg.params.key); reply(true, true); return;
        // --overlay: answered as dissent-client providers/overlayContext.ts does.
        case 'overlay.context':
          if (overlay) reply(true, { game: overlay.game, surface: overlay.surface, width: overlay.width, height: overlay.height, panelOpen: true });
          else reply(false, null, 'not running in the overlay');
          return;
        case 'identity:get': reply(true, { id: 'harness-user', displayName: 'Harness' }); return;
        case 'profile:read': reply(true, { displayName: 'Harness', avatarUrl: null }); return;
        // ⚠️ Refused rather than faked: a module call needs a real install and a
        // verified session, and a stubbed answer would test the stub.
        case 'module:invoke': reply(false, null, 'module:invoke unavailable in the harness'); return;
        // Real projection snapshots (--saves), or what web answers without them.
        case 'game.saves.currentRun': reply(true, saves ? saves['current-run-after'] : { status: 'desktop_only' }); return;
        case 'game.saves.runs': reply(true, saves ? saves.runs : { status: 'desktop_only' }); return;
        case 'game.saves.run': reply(true, !saves ? { status: 'desktop_only' } : saves[`run-${msg.params.id}`] ?? { status: 'not_found' }); return;
        case 'game.saves.profileStats': reply(true, saves ? saves['profile-stats'] : { status: 'desktop_only' }); return;
        default: reply(false, null, `unknown action: ${msg.action}`); return;
      }
    } catch (err) {
      reply(false, null, String(err?.message ?? err));
    }
  });

  return (async () => {
    const html = await (await fetch(pluginUrl, { cache: 'no-store' })).text();
    const f = document.createElement('iframe');
    f.id = 'pf';
    f.setAttribute('sandbox', 'allow-scripts allow-popups allow-modals allow-forms');
    f.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:99999';
    // Mirror the app (dissent-client pluginSandbox.ts injectPluginHead): a <base> for the
    // plugin's folder plus the CSP, at the TOP of <head>. Appending before </head> without a
    // base resolved every relative link against app.dissent.chat, so a plugin using
    // relative paths loaded nothing here while working in the real app (found 2026-09-13).
    const dir = pluginUrl.slice(0, pluginUrl.lastIndexOf('/') + 1);
    f.srcdoc = html.replace(/<head[^>]*>/i, (m) => `${m}<base href="${dir}">${csp}`);
    document.body.appendChild(f);
    await new Promise((r) => { f.onload = r; setTimeout(r, 4000); });
    // The plugin waits for dissent:init before it boots.
    // --overlay: init exactly as dissent-client src/overlay/pluginSurfaces.ts builds it.
    f.contentWindow.postMessage(overlay ? {
      type: 'dissent:init',
      theme: {},
      user: null,
      context: {
        serverId: '', serverName: '', pluginConfig: {},
        contextType: 'personal', placement: 'overlay',
        surface: overlay.surface, game: overlay.game, installId: 'harness', coreUrl: 'https://node.dissent.chat',
      },
    } : {
      type: 'dissent:init',
      user: { id: 'harness-user', username: 'harness', permissions: ['fetch:external', 'storage:server', 'storage:user', 'identity', 'members:read', 'realtime'] },
      theme: {},
      context: { serverId: 'harness', channelId: 'harness', installId: 'harness', coreUrl: 'https://node.dissent.chat' },
    }, '*');
    if (overlay) {
      // As OverlayShell.tsx does when the panel layer opens.
      await new Promise((r) => setTimeout(r, 3000));
      f.contentWindow.postMessage({ type: 'dissent:event', event: 'overlay.context.changed', data: null }, '*');
    }
    return true;
  })();
}

// --overlay <surface id>: host the plugin as an overlay panel of that manifest surface, at its size.
const overlaySurface = arg('--overlay');
let overlay = null;
if (overlaySurface) {
  const manifest = JSON.parse(readFileSync(new URL(`../plugins/${plugin}/manifest.json`, import.meta.url), 'utf8'));
  const surface = manifest.overlay?.surfaces?.find((x) => x.id === overlaySurface);
  if (!surface) throw new Error(`${plugin} declares no overlay surface "${overlaySurface}"`);
  overlay = { surface: surface.id, game: manifest.overlay.games[0], width: surface.size[0], height: surface.size[1] };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: overlay ? { width: overlay.width, height: overlay.height } : { width: 1600, height: 1100 } });

const errors = []; const badResponses = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('requestfailed', (r) => badResponses.push(`FAILED ${r.url().slice(0, 120)} :: ${r.failure()?.errorText}`));
page.on('response', (r) => {
  const u = r.url();
  if (r.status() >= 400) badResponses.push(`HTTP ${r.status()} ${u.slice(0, 120)}`);
  const ct = (r.headers()['content-type'] ?? '').split(';')[0];
  // ⚠️ A wrong MIME is how a missing asset presents on an SPA host: the path
  // 200s with index.html, so status alone never reveals it.
  if (/\.(js|css|json|png)(\?|$)/.test(u) && ct === 'text/html') badResponses.push(`WRONG-MIME ${u.slice(0, 120)}`);
});

// The proxy the harness's fetch:external goes through. Runs in Node, so it is
// not subject to the page's origin — the same reason the real capability is a
// server-side proxy rather than a browser fetch.
await page.exposeFunction('__harnessFetch', async ({ url, method, headers, body }) => {
  try {
    const r = await fetch(url, { method, headers: headers ?? undefined, body: body ?? undefined });
    return { status: r.status, body: await r.text(), content_type: r.headers.get('content-type') ?? '' };
  } catch (err) {
    return { status: 0, body: String(err?.message ?? err), content_type: '' };
  }
});

await page.goto(APP);
const assetOrigins = [...new Set([APP, new URL(PLUGIN_URL).origin])].join(' ');
const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; `
  + `script-src 'unsafe-inline' 'unsafe-eval' ${assetOrigins}; style-src 'unsafe-inline' ${assetOrigins}; `
  + `img-src data: blob: ${assetOrigins} https://node.dissent.chat; font-src data: ${assetOrigins}; `
  + `connect-src ${assetOrigins} https://node.dissent.chat; media-src blob: ${assetOrigins}; `
  + `frame-src 'none'; form-action 'none'; base-uri ${assetOrigins}">`;

// --saves <dir>: answer game.saves.* from REAL projection snapshots (scripts/sts2/save-snapshots.mjs).
// Without it the harness answers as web does: desktop_only.
const savesDir = arg('--saves');
const saves = savesDir
  ? Object.fromEntries(readdirSync(savesDir).filter((f) => f.endsWith('.json') && f !== 'provenance.json')
    .map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(`${savesDir}/${f}`, 'utf8'))]))
  : null;

await page.evaluate(installHost, { pluginUrl: PLUGIN_URL, csp, saves, overlay });
const frame = await (await page.waitForSelector('#pf')).contentFrame();
await page.waitForTimeout(6000);

if (overlay) {
  await page.waitForTimeout(3000);
  const active = await frame.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName.toLowerCase()}[${a.getAttribute('type') ?? ''}]` : 'none'; });
  console.log(`overlay ${overlay.surface} ${overlay.width}x${overlay.height} — activeElement=${active}`);
}
const only = arg('--view');
// --click 'sel|sel|…' drives any plugin; --root names the element whose content is measured.
const rootSel = arg('--root', '#main');
const clicks = arg('--click');
const steps = clicks ? clicks.split('|')
  : (only ? [only] : ['league', 'game', 'standings', 'leaders', 'news', 'fantasy', 'myleague']).map((v) => `[data-view="${v}"]`);

console.log(`\n${plugin} — ${steps.length} step(s)\n`);
for (const step of steps) {
  const before = errors.length;
  await frame.locator(step).first().click({ timeout: 5000 }).catch(() => console.log(`  ⚠ NOT FOUND ${step}`));
  await page.waitForTimeout(5000);
  const text = (await frame.locator(rootSel).textContent().catch(() => '')) ?? '';
  const chars = text.trim().length;
  const imgs = await frame.locator(`${rootSel} img`).count().catch(() => 0);
  const broken = await frame.evaluate((sel) => [...document.querySelectorAll(`${sel} img`)]
    .filter((i) => i.complete && i.naturalWidth === 0).length, rootSel).catch(() => 0);
  const flag = chars < 60 ? ' ⚠ EMPTY' : '';
  console.log(`  ${step.slice(0, 34).padEnd(34)} chars=${String(chars).padStart(6)}  imgs=${String(imgs).padStart(3)}`
    + `  brokenImgs=${broken}  newErrors=${errors.length - before}${flag}`);
}

const shot = arg('--shot');
if (shot) { await page.screenshot({ path: shot }); console.log(`\nscreenshot -> ${shot}`); }

console.log('\nconsole errors:');
[...new Set(errors)].slice(0, 15).forEach((e) => console.log('  ' + e));
if (errors.length === 0) console.log('  none');
console.log('bad responses:');
[...new Set(badResponses)].slice(0, 15).forEach((e) => console.log('  ' + e));
if (badResponses.length === 0) console.log('  none');

await browser.close();
