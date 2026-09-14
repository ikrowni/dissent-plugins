# sts2-stats — STS2 Companion's community stats service

**A plugin's own service, not part of Dissent.** Any plugin developer could run the same thing. Stopping it
affects no part of Dissent; STS2 Companion falls back to its bundled snapshot.

Design: `docs/superpowers/specs/2026-09-13-sts2-community-stats-design.md` (monorepo), plan
`docs/superpowers/plans/2026-09-14-sts2-stats-service.md`.

## What it keeps, and what it never keeps

- A **contributor** is a random id the plugin generated plus a SHA-256 of a random delete token. No account, no name.
- A **run** is the contribution (`plugins/sts2-companion/core/contribution.js`): no run id, no timestamp, duration
  rounded to ten minutes, plus the UTC day number it arrived.
- 🔴 **No IP address is ever written.** Rate limits key addresses by a salted hash held in memory, with the salt
  replaced every UTC day. Caddy has no access log for this host. A test scans the database for the address.
- **Delete** erases every run from a contributor and forgets the id.
- Raw runs are kept for the newest three game builds; published aggregates publish nothing under 50 runs
  (30 offers for a card).

## Routes

| | |
|---|---|
| `POST /v1/runs` | `{ contributor_id, delete_token, runs: [1..20 contributions] }` → `{ ok, accepted, duplicates, refused: [{ index, reason }] }`. 403 on a token that does not match the id. Body ≤ 1 MB. |
| `POST /v1/contributors/delete` | `{ contributor_id, delete_token }` → `{ ok, deleted }` |
| `GET /v1/stats/latest.json`, `stats-<build>.json` | Static, served by Caddy with `ETag`; written nightly by `publish.mjs` |

Limits: 300 runs/day per contributor, 600/day per address.

## Files

| | |
|---|---|
| `server.mjs` | Listens on `127.0.0.1:8095` (env `PORT`, `STS2_STATS_DB`) |
| `publish.mjs` | Prune old builds, aggregate, write `STS2_STATS_OUT` |
| `src/app.mjs` · `db.mjs` · `limits.mjs` · `aggregate.mjs` · `data.mjs` | Routes · schema · limits · counts · the plugin's bundled data |
| `deploy/` | systemd: `sts2-stats.service` (256 MB, 25% CPU), `sts2-stats-publish.service` + `.timer` (04:17 UTC) |

The plausibility rules and the contribution format live in the plugin (`core/plausible.js`, `core/contribution.js`),
so the plugin and the service can never disagree about them.

## Run the tests

```bash
cd ~/dissent-plugins && npx vitest run services/sts2-stats plugins/sts2-companion/core
```

## Deploy

```bash
mkdir -p /home/ubuntu/sts2-stats && sudo mkdir -p /var/www/sts2-stats/v1/stats && sudo chown -R ubuntu:ubuntu /var/www/sts2-stats
sudo cp deploy/sts2-stats.service deploy/sts2-stats-publish.service deploy/sts2-stats-publish.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now sts2-stats.service sts2-stats-publish.timer
```

The Caddy host block lives in the monorepo's `caddy/Caddyfile` (`sts2-stats.plugins.dissent.chat`). After a code
change: `sudo systemctl restart sts2-stats`.
