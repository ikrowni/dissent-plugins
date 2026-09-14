// services/sts2-stats/src/db.mjs — one SQLite file. Never Dissent's database.
//
// A contributor is an id and a HASH of their delete token. A run is its canonical-JSON hash, the build,
// the UTC day number it arrived (not a timestamp), and the contribution. Nothing else — no address, no
// account, no time of day.

import { DatabaseSync } from 'node:sqlite';

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS contributors (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      created_day INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      key TEXT PRIMARY KEY,
      contributor_id TEXT NOT NULL,
      build TEXT NOT NULL,
      received_day INTEGER NOT NULL,
      body TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS runs_contributor ON runs (contributor_id);
    CREATE INDEX IF NOT EXISTS runs_build ON runs (build);
  `);
  return db;
}
