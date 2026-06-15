// SQLite via Node 22's built-in node:sqlite (no external dependency).
// One shared synchronous connection; fine for an MVP read-mostly service.
// Each module owns its own tables and creates them in its init(ctx) hook.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
// Wait (rather than immediately erroring with SQLITE_BUSY) when another writer
// holds the lock — e.g. the OHLCV/market poller cron writing while the service
// rebuilds projections at startup. Without this, a concurrent write surfaced as
// "database is locked" and aborted module init.
db.exec('PRAGMA busy_timeout = 8000;');

/** Convenience: run a statement with params, return changes info. */
export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}
/** Convenience: first row or undefined. */
export function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}
/** Convenience: all rows. */
export function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

export default db;
