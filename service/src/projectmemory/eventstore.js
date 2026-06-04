// Project Memory — event store (PM-BUILD-1 / PM-BUILD-2).
//
// The append-only event log is the SINGLE SOURCE OF TRUTH. Every fact about
// every project enters as an immutable event; current state (projections) is
// derived by replaying the log. Nothing is ever overwritten or deleted:
//   - the only write operation is append();
//   - SQLite triggers RAISE(ABORT) on any UPDATE or DELETE of pm_event;
//   - each event is hash-chained to its predecessor (prev_hash + hash), so any
//     tampering with historical events is detectable via verifyChain().
//
// This file knows nothing about projections — it is pure, ordered, verifiable
// history. See reducer.js for how events become queryable state.

import { createHash } from 'node:crypto';
import { db } from '../db.js';

const GENESIS = '0'.repeat(64);

export function initEventStore() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pm_event (
      seq       INTEGER PRIMARY KEY AUTOINCREMENT, -- total order
      ts        TEXT    NOT NULL,                  -- ISO timestamp (event time / as_of)
      type      TEXT    NOT NULL,                  -- e.g. project.imported, claim.asserted
      subject   TEXT,                              -- primary entity id (project id) for fast history lookup
      actor     TEXT    NOT NULL,                  -- who emitted it (pubkey/label/'machine:seed')
      payload   TEXT    NOT NULL,                  -- JSON
      prev_hash TEXT    NOT NULL,
      hash      TEXT    NOT NULL
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_pm_event_subject ON pm_event (subject, seq);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_pm_event_type ON pm_event (type, seq);');
  // Append-only enforcement — the log is immutable history.
  db.exec(`CREATE TRIGGER IF NOT EXISTS pm_event_no_update BEFORE UPDATE ON pm_event
           BEGIN SELECT RAISE(ABORT, 'pm_event is append-only: UPDATE forbidden'); END;`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS pm_event_no_delete BEFORE DELETE ON pm_event
           BEGIN SELECT RAISE(ABORT, 'pm_event is append-only: DELETE forbidden'); END;`);
}

function canonical(ts, type, subject, actor, payloadStr, prevHash) {
  // Order-sensitive, newline-delimited canonical form for hashing.
  return [prevHash, ts, type, subject ?? '', actor, payloadStr].join('\n');
}

/**
 * Append one event. The ONLY mutation of pm_event.
 * @param {string} type
 * @param {object} opts - { actor, subject?, payload?, ts? }
 *   ts is optional; pass an explicit timestamp for deterministic seeding, omit
 *   for live events (defaults to now).
 * @returns the stored event (with seq + hash)
 */
export function append(type, { actor, subject = null, payload = {}, ts } = {}) {
  if (!type || !actor) throw new Error('append requires type and actor');
  const payloadStr = JSON.stringify(payload ?? {});
  const stamp = ts || new Date().toISOString();
  const last = db.prepare('SELECT hash FROM pm_event ORDER BY seq DESC LIMIT 1').get();
  const prevHash = last ? last.hash : GENESIS;
  const hash = createHash('sha256').update(canonical(stamp, type, subject, actor, payloadStr, prevHash)).digest('hex');
  const info = db.prepare(
    'INSERT INTO pm_event (ts, type, subject, actor, payload, prev_hash, hash) VALUES (?,?,?,?,?,?,?)',
  ).run(stamp, type, subject, actor, payloadStr, prevHash, hash);
  return { seq: Number(info.lastInsertRowid), ts: stamp, type, subject, actor, payload, prev_hash: prevHash, hash };
}

function hydrate(rows) {
  return rows.map((e) => ({ ...e, payload: JSON.parse(e.payload) }));
}

/** All events in order (the full history). */
export function allEvents() {
  return hydrate(db.prepare('SELECT * FROM pm_event ORDER BY seq ASC').all());
}

/** Events concerning one subject (project id), in order — backs GET /history/:project. */
export function eventsForSubject(subject) {
  return hydrate(db.prepare('SELECT * FROM pm_event WHERE subject = ? ORDER BY seq ASC').all(subject));
}

export function eventCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM pm_event').get().n;
}

/** Re-walk the chain and confirm no historical event was altered. */
export function verifyChain() {
  let prev = GENESIS;
  for (const e of db.prepare('SELECT * FROM pm_event ORDER BY seq ASC').all()) {
    const h = createHash('sha256').update(canonical(e.ts, e.type, e.subject, e.actor, e.payload, prev)).digest('hex');
    if (e.prev_hash !== prev || e.hash !== h) return { ok: false, seq: e.seq, reason: 'hash mismatch' };
    prev = e.hash;
  }
  return { ok: true, head: prev, count: eventCount() };
}

export { GENESIS };
