// project.test.js — Project Memory (event-sourced curated layer).
//
// Fully local, no network. Points CDL_DB_PATH at a throwaway file BEFORE
// importing db.js, then drives the module through a fake ctx and asserts the
// event-sourced guarantees: seed-from-archive, append-only history, provenance,
// projection-is-derived, and the read-only API shapes.
//
// Run: node --test test/project.test.js

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'cdl-pm-test-'));
process.env.CDL_DB_PATH = join(tmpDir, 'test.sqlite');

const { db } = await import('../src/db.js');
const { config } = await import('../src/config.js');
const projectModule = await import('../src/modules/project.js');
const mod = projectModule.default;
const { append, eventCount, verifyChain } = await import('../src/projectmemory/eventstore.js');
const { rebuildProjections } = await import('../src/projectmemory/reducer.js');

const ctx = { db, config, log: () => {} };

before(async () => { await mod.init(ctx); });
after(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

const route = (path, p, q = {}) => mod.routes.find((r) => r.path === path).handler({ params: p, query: q, ctx });

test('seeded from archive into the event log', () => {
  assert.ok(eventCount() > 0, 'events were emitted by the seed');
});

test('GET /categories returns the cardanocube taxonomy (74)', async () => {
  const res = await route('/categories', {});
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 74);
  assert.equal(res.body.source, 'project-memory');
});

test('GET /projects lists defunct graveyard projects', async () => {
  const res = await route('/projects', {}, { status: 'defunct' });
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 20);
});

test('GET /project/:id carries per-field provenance + chain-of-custody evidence', async () => {
  const res = await route('/project/:id', { id: 'adax' });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'defunct');
  const nameClaim = res.body.fields.name?.[0];
  assert.ok(nameClaim, 'has a name claim');
  assert.equal(nameClaim.provenance.source.source_id, 'cardanocube'); // WHERE
  assert.ok(nameClaim.provenance.as_of, 'WHEN present');
  assert.ok(nameClaim.provenance.asserted_by, 'WHO present');
  const ev = nameClaim.provenance.evidence[0];
  assert.ok(ev && ev.ref.includes('web.archive.org'), 'evidence links to the Wayback archive');
  assert.ok(ev.sha256, 'evidence carries the archived sha256 (chain-of-custody)');
});

test('preserved TapTools rankings imported as token projects (Class C)', async () => {
  const res = await route('/projects', {}, { q: 'tt:', limit: 1000 });
  assert.ok(res.body.total >= 1, 'at least one TapTools token imported');
  const sample = res.body.projects[0];
  const detail = await route('/project/:id', { id: sample.id });
  const rankClaim = detail.body.fields.rank?.[0] || detail.body.fields.ticker?.[0];
  assert.equal(rankClaim.provenance.source.source_id, 'taptools-wayback');
  assert.equal(rankClaim.provenance.authority_class, 'C');
  assert.ok(rankClaim.provenance.evidence[0].ref.includes('web.archive.org'));
});

test('GET /history/:project is the append-only event log for the project', async () => {
  const res = await route('/history/:project', { project: 'adax' });
  assert.equal(res.status, 200);
  assert.ok(res.body.count >= 3, 'imported + name + status events at least');
  assert.ok(res.body.events.every((e) => e.hash && e.prev_hash), 'events are hash-chained');
  assert.equal(res.body.events[0].type, 'project.imported');
});

test('append-only: UPDATE and DELETE on pm_event are rejected', () => {
  assert.throws(() => db.prepare('UPDATE pm_event SET actor = ? WHERE seq = 1').run('tamper'), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM pm_event WHERE seq = 1').run(), /append-only/);
});

test('hash chain verifies', () => {
  assert.equal(verifyChain().ok, true);
});

test('projections are a pure function of the log (rebuild is stable)', async () => {
  const before = (await route('/projects', {}, { limit: 1000 })).body.total;
  rebuildProjections();
  const afterCount = (await route('/projects', {}, { limit: 1000 })).body.total;
  assert.equal(afterCount, before, 'rebuilding projections from the log yields the same state');
});

test('superseding a claim preserves the old one (nothing overwritten)', async () => {
  // assert a new name for adax; the old claim must remain as superseded.
  append('claim.asserted', { actor: 'test', subject: 'adax', payload: {
    project_id: 'adax', field: 'name', value: 'Adax (renamed)', source_id: 'researcher', authority_class: 'E', as_of: '2026-06-04', asserted_by: 'test' } });
  rebuildProjections();
  const detail = await route('/project/:id', { id: 'adax' });
  assert.equal(detail.body.fields.name[0].value, 'Adax (renamed)', 'current value updated');
  assert.ok(detail.body.superseded_claim_count >= 1, 'the prior name claim is preserved as superseded');
  const hist = await route('/history/:project', { project: 'adax' });
  assert.ok(hist.body.count >= 4, 'history grew; nothing was deleted');
});

test('unknown project → 404', async () => {
  const res = await route('/project/:id', { id: 'does-not-exist' });
  assert.equal(res.status, 404);
});
