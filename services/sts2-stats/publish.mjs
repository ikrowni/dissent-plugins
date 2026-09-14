#!/usr/bin/env node
// Nightly: prune old builds, aggregate, write the static stats files Caddy serves.
import { mkdirSync } from 'node:fs';
import { openDb } from './src/db.mjs';
import { publish } from './src/aggregate.mjs';
import { pluginData } from './src/data.mjs';

const DB_PATH = process.env.STS2_STATS_DB ?? '/home/ubuntu/sts2-stats/stats.db';
const OUT = process.env.STS2_STATS_OUT ?? '/var/www/sts2-stats/v1/stats';
mkdirSync(OUT, { recursive: true });
const stats = await publish({ db: openDb(DB_PATH), data: pluginData(), outDir: OUT });
const cells = Object.values(stats.builds).reduce((n, b) => n + b.cells.length, 0);
console.log(`sts2-stats publish: ${Object.keys(stats.builds).length} builds, ${cells} published cells`);
