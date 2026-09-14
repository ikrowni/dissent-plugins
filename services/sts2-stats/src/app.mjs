// services/sts2-stats/src/app.mjs — the service's only two dynamic routes. Everything else is a static
// file Caddy serves.

import { createHash } from 'node:crypto';
import { canonicalJSON } from '../../../plugins/sts2-companion/core/contribution.js';
import { checkContribution } from '../../../plugins/sts2-companion/core/plausible.js';

export const MAX_BODY = 1024 * 1024;
export const MAX_RUNS = 20;

const ID_RE = /^[a-z0-9-]{16,64}$/;
const TOKEN_RE = /^[a-f0-9]{32,128}$/;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const dayOf = (ms) => Math.floor(ms / 86_400_000);

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    // Over the cap: stop buffering but keep reading, so the 413 reaches the caller rather than a reset
    // socket. Caddy's request_body limit refuses larger bodies before they get here.
    req.on('data', (c) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY) { reject(new HttpError(413, 'body over 1 MB')); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'invalid json')); }
    });
    req.on('error', reject);
  });
}

/** Caddy puts the client first in X-Forwarded-For; the service listens on 127.0.0.1 only, so only Caddy reaches it. */
const clientAddress = (req) => String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '';

export function createHandler({ db, data, limits, now = () => Date.now() }) {
  const getContributor = db.prepare('SELECT token_hash FROM contributors WHERE id = ?');
  const addContributor = db.prepare('INSERT INTO contributors (id, token_hash, created_day) VALUES (?, ?, ?)');
  const hasRun = db.prepare('SELECT 1 AS x FROM runs WHERE key = ?');
  const addRun = db.prepare('INSERT INTO runs (key, contributor_id, build, received_day, body) VALUES (?, ?, ?, ?, ?)');
  const deleteRuns = db.prepare('DELETE FROM runs WHERE contributor_id = ?');
  const deleteContributor = db.prepare('DELETE FROM contributors WHERE id = ?');

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', ...(status === 413 ? { connection: 'close' } : {}) });
    res.end(JSON.stringify(body));
  };

  return async (req, res) => {
    try {
      const path = new URL(req.url, 'http://service').pathname;
      if (path !== '/v1/runs' && path !== '/v1/contributors/delete') return send(res, 404, { ok: false, error: 'not found' });
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST only' });

      const body = await readJson(req);
      const id = body?.contributor_id;
      const token = body?.delete_token;
      if (typeof id !== 'string' || !ID_RE.test(id) || typeof token !== 'string' || !TOKEN_RE.test(token)) {
        return send(res, 400, { ok: false, error: 'contributor_id and delete_token required' });
      }
      const known = getContributor.get(id);
      if (known && known.token_hash !== sha256(token)) return send(res, 403, { ok: false, error: 'contributor' });

      if (path === '/v1/contributors/delete') {
        if (!known) return send(res, 200, { ok: true, deleted: 0 });
        const r = deleteRuns.run(id);
        deleteContributor.run(id);
        return send(res, 200, { ok: true, deleted: Number(r.changes) });
      }

      const runs = body.runs;
      if (!Array.isArray(runs) || runs.length < 1 || runs.length > MAX_RUNS) {
        return send(res, 400, { ok: false, error: `runs: 1 to ${MAX_RUNS}` });
      }
      if (!known) addContributor.run(id, sha256(token), dayOf(now()));

      const room = limits.take(id, clientAddress(req), runs.length);
      let accepted = 0; let duplicates = 0;
      const refused = [];
      for (let i = 0; i < runs.length; i++) {
        if (i >= room) { refused.push({ index: i, reason: 'rate_limited' }); continue; }
        const verdict = await checkContribution(runs[i], data);
        if (!verdict.ok) { refused.push({ index: i, reason: verdict.reason }); continue; }
        const key = sha256(canonicalJSON(runs[i]));
        if (hasRun.get(key)) { duplicates += 1; continue; }
        addRun.run(key, id, runs[i].build, dayOf(now()), JSON.stringify(runs[i]));
        accepted += 1;
      }
      return send(res, 200, { ok: true, accepted, duplicates, refused });
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { ok: false, error: e.message });
      return send(res, 500, { ok: false, error: 'server error' });
    }
  };
}
