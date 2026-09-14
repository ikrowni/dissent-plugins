#!/usr/bin/env node
// STS2 Companion's community stats service. Not part of Dissent: a plugin's own service, which any plugin
// developer could run. Listens on 127.0.0.1 only — Caddy is the only thing that reaches it.
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDb } from './src/db.mjs';
import { createLimits } from './src/limits.mjs';
import { createHandler } from './src/app.mjs';
import { pluginData } from './src/data.mjs';
import { createParty } from './src/party.mjs';

const DB_PATH = process.env.STS2_STATS_DB ?? '/home/ubuntu/sts2-stats/stats.db';
const PORT = Number(process.env.PORT ?? 8095);
mkdirSync(dirname(DB_PATH), { recursive: true });

const server = http.createServer(createHandler({ db: openDb(DB_PATH), data: pluginData(), limits: createLimits(), party: createParty() }));
server.requestTimeout = 15_000;
server.listen(PORT, '127.0.0.1', () => console.log(`sts2-stats listening on 127.0.0.1:${PORT}`));
