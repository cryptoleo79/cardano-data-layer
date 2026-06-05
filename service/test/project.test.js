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
const { Router } = await import('../src/router.js');

// A real router populated in mod.routes order, exactly as server.js does. Used to
// prove route-ordering end to end (the dispatcher picks the search handler for
// /project/search and the detail handler for /project/<id>).
const dispatchRouter = new Router();
for (const r of mod.routes) dispatchRouter.add(r.method, r.path, r.handler, { module: mod.name });
async function dispatch(rawPath) {
  const url = new URL(rawPath, 'http://localhost');
  const found = dispatchRouter.match('GET', url.pathname);
  if (!found) return { status: 404, matchedPath: null, body: { error: 'no_route' } };
  const query = Object.fromEntries(url.searchParams.entries());
  const res = await found.route.handler({ query, params: found.params, ctx });
  return { status: res.status, body: res.body, matchedPath: found.route.path };
}

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

test('every response carries the data-quality envelope', async () => {
  for (const [path, p, q] of [
    ['/projects', {}, {}],
    ['/categories', {}, {}],
    ['/project/:id', { id: 'adax' }, {}],
    ['/history/:project', { project: 'adax' }, {}],
  ]) {
    const res = await route(path, p, q);
    assert.ok(res.body._quality, `${path} has _quality`);
    assert.equal(res.body._quality.source, 'project-memory');
    assert.equal(res.body._quality.refresh, 'static');
    assert.ok(res.body._quality.provenance.includes('Project Memory'));
  }
});

test('GET /project/search substring-matches id and name', async () => {
  const res = await route('/project/search', {}, { q: 'adax' });
  assert.equal(res.status, 200);
  assert.equal(res.body.q, 'adax');
  assert.ok(res.body.total >= 1, 'finds adax');
  assert.ok(res.body.projects.some((x) => x.id === 'adax'));
  assert.ok(res.body._quality, 'search carries _quality');
});

test('GET /project/search with empty q returns an empty result (no error)', async () => {
  const res = await route('/project/search', {}, { q: '' });
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 0);
  assert.equal(res.body.count, 0);
  assert.deepEqual(res.body.projects, []);
});

test('search route is registered before /project/:id', () => {
  const paths = mod.routes.map((r) => r.path);
  assert.ok(paths.indexOf('/project/search') < paths.indexOf('/project/:id'),
    '/project/search must precede /project/:id');
  assert.ok(paths.indexOf('/category/:slug') < paths.indexOf('/project/:id'));
  assert.equal(paths[paths.length - 1], '/project/:id', '/project/:id is LAST');
});

test('GET /category/:slug returns a known category (defi) with its assignments', async () => {
  // defi exists in the cardanocube taxonomy; the bootstrap seed emits no
  // category.assigned events, so the active member list is honestly empty.
  const res = await route('/category/:slug', { slug: 'defi' });
  assert.equal(res.status, 200);
  assert.equal(res.body.category.slug, 'defi');
  assert.ok(res.body.category.name, 'category has a name');
  assert.equal(res.body.category.source_id, 'cardanocube');
  assert.ok(Array.isArray(res.body.projects));
  assert.equal(res.body.project_count, res.body.projects.length);
  assert.ok(res.body._quality, 'category carries _quality');
});

test('GET /category/:slug surfaces active assignments once one is emitted', async () => {
  // The event-sourced way: assign an existing project to defi, rebuild, read.
  append('category.assigned', { actor: 'test', subject: 'adax', payload: {
    project_id: 'adax', category_slug: 'defi', source_id: 'researcher', authority_class: 'E', as_of: '2026-06-04' } });
  rebuildProjections();
  const res = await route('/category/:slug', { slug: 'defi' });
  assert.equal(res.status, 200);
  const member = res.body.projects.find((p) => p.id === 'adax');
  assert.ok(member, 'adax now appears under defi');
  assert.ok(member.assignment, 'member carries assignment provenance');
  assert.equal(member.assignment.source_id, 'researcher');
  assert.ok(res.body.project_count >= 1);
});

test('GET /category/:slug for unknown slug → 404', async () => {
  const res = await route('/category/:slug', { slug: 'no-such-category-zzz' });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'not_found');
  assert.ok(res.body._quality, '404 still envelope-shaped');
});

// --- end-to-end dispatch through the real Router (route-ordering proof) ---

test('E2E: /project/search?q=occam routes to search and finds occam-fi + occamrazer', async () => {
  const r = await dispatch('/project/search?q=occam');
  assert.equal(r.matchedPath, '/project/search', 'matched the literal search route, not /project/:id');
  assert.equal(r.status, 200);
  const ids = r.body.projects.map((p) => p.id);
  assert.ok(ids.includes('occam-fi'), 'finds occam-fi');
  assert.ok(ids.includes('occamrazer'), 'finds occamrazer');
  assert.ok(r.body._quality, 'carries _quality');
});

test('E2E: /project/<id> still routes to the detail handler', async () => {
  const r = await dispatch('/project/adax');
  assert.equal(r.matchedPath, '/project/:id');
  assert.equal(r.status, 200);
  assert.equal(r.body.id, 'adax');
});

test('E2E: /category/defi routes to the category handler', async () => {
  const r = await dispatch('/category/defi');
  assert.equal(r.matchedPath, '/category/:slug');
  assert.equal(r.status, 200);
  assert.equal(r.body.category.slug, 'defi');
});

test('E2E: /categories is not shadowed by /category/:slug', async () => {
  const r = await dispatch('/categories');
  assert.equal(r.matchedPath, '/categories');
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 74);
});
