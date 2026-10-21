// ul-store.js — your account's storage for this game (storage:user, through the host). It tells "nothing saved"
// from "not allowed": a player who chose "View Without Joining" on Dissent's consent card has granted nothing, and
// saving is refused. state: 'standalone' (no host: opened on its own), 'unknown' (not asked yet), 'ok', 'refused'
// (not granted), 'error' (anything else).
export class Store {
  /** call(action, params) → Promise of the host's data, rejecting with its error (the SDK's request). null: no host. */
  constructor(call) { this.call = call; this.state = call ? 'unknown' : 'standalone'; }
  get usable() { return this.state === 'ok' || this.state === 'unknown'; }
  async run(action, params) {
    if (!this.call) return { ok: false };
    try { const data = await this.call(action, { ...params, scope: 'user' }); this.state = 'ok'; return { ok: true, data }; }
    catch (e) { this.state = /not granted/.test(String(e?.message ?? e)) ? 'refused' : 'error'; return { ok: false }; }
  }
  async get(key) { const r = await this.run('storage:get', { key }); return r.ok ? r.data?.value ?? null : null; }
  async set(key, value) { return (await this.run('storage:set', { key, value })).ok; }
  async del(key) { return (await this.run('storage:delete', { key })).ok; }
}
