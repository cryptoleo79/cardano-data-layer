// project.test.js — tests for THE MOAT (project + category store).
//
// Fully local: no network. We point CDL_DB_PATH at a fresh temp file BEFORE
// importing db.js (config reads the env at import time), then import the module
// and drive it through a fake ctx — the same ctx shape the server passes.
//
// Run: node --test test/project.test.js

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --- Point the DB at a throwaway file BEFORE any module imports db/config. ---
const tmpDir = mkdtempSync(join(tmpdir(), 'cdl-project-test-'));
process.env.CDL_DB_PATH = join(tmpDir, 'test.sqlite');

// Now import. Dynamic imports guarantee they happen after the env is set.
const { db } = await import('../src/db.js');
const { config } = await import('../src/config.js');
const projectModule = await import('../src/modules/project.js');
const mod = projectModule.default;

const log = () => {};
const ctx = { db, config, log };

before(async () => {
  // init() creates tables and seeds (store starts empty in the temp DB).
  await mod.init(ctx);
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// Small helper to call a route handler the way the server would.
const call = (handler, { params = {}, query = {} } = {}) =>
  handler({ req: {}, params, query, ctx });

test('seed loads 74 categories', async () => {
  const res = await call(findRoute('/categories').handler);
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 74);
  assert.equal(res.body.categories.length, 74);
  // Envelope conventions.
  assert.ok(res.body.source, 'has source');
  assert.ok(res.body.as_of, 'has as_of');
});

test('seed loads 20 defunct projects', async () => {
  const res = await call(findRoute('/projects').handler, { query: { status: 'defunct' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 20, 'total defunct count');
  assert.ok(res.body.projects.every((p) => p.status === 'defunct'));
});

test('/project/adax returns the archived_wayback_url (provenance preserved)', async () => {
  const res = await call(findRoute('/project/:id').handler, { params: { id: 'adax' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.project.id, 'adax');
  assert.ok(
    res.body.project.archived_wayback_url &&
      res.body.project.archived_wayback_url.includes('web.archive.org'),
    'archived_wayback_url present',
  );
  // Seeded graveyard projects have no verified category assignments.
  assert.deepEqual(res.body.project.categories, []);
  assert.equal(res.body.project.unclassified, true);
});

test('seeded project records initial history rows', async () => {
  const res = await call(findRoute('/project/:id').handler, { params: { id: 'adax' } });
  assert.ok(Array.isArray(res.body.history));
  assert.ok(res.body.history.length > 0, 'initial seed wrote history');
  // The wayback url should appear as an initial-history new_value.
  assert.ok(
    res.body.history.some((h) => h.field === 'archived_wayback_url' && h.new_value),
    'history captured archived_wayback_url',
  );
});

test('a simulated field change writes a project_history row (versioned upsert)', async () => {
  const beforeRows = db
    .prepare('SELECT COUNT(*) AS n FROM project_history WHERE project_id = ?')
    .get('adax').n;

  // Change a real field through the documented versioned upsert.
  const result = projectModule.upsertProject(
    db,
    { id: 'adax', note: 'Re-confirmed defunct on a later review (test change).' },
    { changeSource: 'test' },
  );
  assert.equal(result.action, 'updated');
  assert.ok(result.changes.includes('note'));

  const afterRows = db
    .prepare('SELECT COUNT(*) AS n FROM project_history WHERE project_id = ?')
    .get('adax').n;
  assert.equal(afterRows, beforeRows + 1, 'exactly one new history row for the changed field');

  // The newest history row should reflect the change with old + new values.
  const last = db
    .prepare('SELECT * FROM project_history WHERE project_id = ? ORDER BY id DESC LIMIT 1')
    .get('adax');
  assert.equal(last.field, 'note');
  assert.equal(last.change_source, 'test');
  assert.ok(last.new_value.includes('Re-confirmed defunct'));
  assert.notEqual(last.old_value, last.new_value);
});

test('re-applying the same value is a no-op (idempotent, no spurious history)', async () => {
  const beforeRows = db.prepare('SELECT COUNT(*) AS n FROM project_history').get().n;
  // Upsert adax with its current note again — nothing should change.
  const current = db.prepare('SELECT note FROM project WHERE id = ?').get('adax').note;
  const result = projectModule.upsertProject(db, { id: 'adax', note: current }, { changeSource: 'test' });
  assert.equal(result.action, 'unchanged');
  const afterRows = db.prepare('SELECT COUNT(*) AS n FROM project_history').get().n;
  assert.equal(afterRows, beforeRows, 'no history rows written for an unchanged upsert');
});

test('/category/:slug returns detail (defi exists) with the standard envelope', async () => {
  const res = await call(findRoute('/category/:slug').handler, { params: { slug: 'defi' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.category.slug, 'defi');
  assert.ok(res.body.source && res.body.as_of);
  assert.ok(Array.isArray(res.body.projects));
});

test('unknown category and project yield 404', async () => {
  await assert.rejects(
    () => call(findRoute('/category/:slug').handler, { params: { slug: 'no-such-cat' } }),
    (e) => e.status === 404,
  );
  await assert.rejects(
    () => call(findRoute('/project/:id').handler, { params: { id: 'no-such-project' } }),
    (e) => e.status === 404,
  );
});

// --- helper: locate a route handler by its registered path ---
function findRoute(path) {
  const r = mod.routes.find((x) => x.path === path);
  if (!r) throw new Error(`route not found in module: ${path}`);
  return r;
}
