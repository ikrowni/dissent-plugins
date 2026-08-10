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

const plugin = process.argv[2] ?? 'nfl-hub';
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : process.argv[i + 1];
};
const APP = 'https://app.dissent.chat';
const PLUGIN_URL = `https://plugins.dissent.chat/plugins/${plugin}/plugin.html`;

/** The host half: injected into the PARENT page, replies over postMessage. */
function installHost({ pluginUrl, csp }) {
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
        case 'storage:get': reply(true, store.get(msg.params.key) ?? null); return;
        case 'storage:set': store.set(msg.params.key, msg.params.value); reply(true, true); return;
        case 'storage:delete': store.delete(msg.params.key); reply(true, true); return;
        case 'identity:get': reply(true, { id: 'harness-user', displayName: 'Harness' }); return;
        case 'profile:read': reply(true, { displayName: 'Harness', avatarUrl: null }); return;
        // ⚠️ Refused rather than faked: a module call needs a real install and a
        // verified session, and a stubbed answer would test the stub.
        case 'module:invoke': reply(false, null, 'module:invoke unavailable in the harness'); return;
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
    f.srcdoc = html.replace('</head>', csp + '</head>');
    document.body.appendChild(f);
    await new Promise((r) => { f.onload = r; setTimeout(r, 4000); });
    // The plugin waits for dissent:init before it boots.
    f.contentWindow.postMessage({
      type: 'dissent:init',
      user: { id: 'harness-user', username: 'harness', permissions: ['fetch:external', 'storage:server', 'storage:user', 'identity', 'members:read', 'realtime'] },
      theme: {},
      context: { serverId: 'harness', channelId: 'harness', installId: 'harness', coreUrl: 'https://node.dissent.chat' },
    }, '*');
    return true;
  })();
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });

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

await page.evaluate(installHost, { pluginUrl: PLUGIN_URL, csp });
const frame = await (await page.waitForSelector('#pf')).contentFrame();
await page.waitForTimeout(6000);

const only = arg('--view');
const views = only ? [only] : ['league', 'game', 'standings', 'leaders', 'news', 'fantasy', 'myleague'];

console.log(`\n${plugin} — ${views.length} view(s)\n`);
for (const v of views) {
  const before = errors.length;
  await frame.locator(`[data-view="${v}"]`).click().catch(() => {});
  await page.waitForTimeout(5000);
  const text = (await frame.locator('#main').textContent().catch(() => '')) ?? '';
  const chars = text.trim().length;
  const imgs = await frame.locator('#main img').count().catch(() => 0);
  const broken = await frame.evaluate(() => [...document.querySelectorAll('#main img')]
    .filter((i) => i.complete && i.naturalWidth === 0).length).catch(() => 0);
  const flag = chars < 60 ? ' ⚠ EMPTY' : '';
  console.log(`  ${v.padEnd(10)} chars=${String(chars).padStart(6)}  imgs=${String(imgs).padStart(3)}`
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
