// catalyst.test.js — Stream F module tests (node --test).
//
// Offline/local: these exercise the catalyst module's handlers directly against
// the real catalyst preservation archive at config.memory.catalystArchive. The
// archive is deliberately SPARSE (FLOW-6 capture has just begun), so the tests
// assert shapes and the _quality envelope while TOLERATING missing/empty data:
// if the archive dir is absent they assert the graceful 503 path instead of
// failing, and they never require any specific fund/proposal to exist.
//
// Point CDL_CATALYST_ARCHIVE at a real archive to exercise the happy paths.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import mod from '../src/modules/catalyst.js';
import { config } from '../src/config.js';
import { TtlCache } from '../src/cache.js';

const ctx = { config, cache: new TtlCache(), log: () => {} };
const ARCHIVE = config.memory.catalystArchive;
const haveArchive = existsSync(ARCHIVE);

const handler = (p, method = 'GET') =>
  mod.routes.find((r) => r.path === p && r.method === method)?.handler;

const call = (p, { query = {}, params = {}, c = ctx } = {}) =>
  handler(p)({ query, params, ctx: c });

// Every body must carry the data-quality envelope with the Catalyst provenance.
function assertQuality(body, { confidence } = {}) {
  assert.ok(body._quality, 'response carries _quality');
  assert.equal(body._quality.source, 'catalyst-archive');
  assert.ok(['A', 'B', 'C', 'D', 'E'].includes(body._quality.authority_class), 'authority_class is a valid class');
  assert.equal(body._quality.refresh, 'static');
  assert.equal(body._quality.provenance, 'Catalyst Memory archive (chain-of-custody)');
  assert.ok(typeof body._quality.as_of === 'string' && body._quality.as_of.length > 0);
  if (confidence) assert.equal(body._quality.confidence, confidence);
}

test('module shape: name + ordered routes (literals before /fund/:id)', () => {
  assert.equal(mod.name, 'catalyst');
  const paths = mod.routes.map((r) => r.path);
  for (const lit of ['/archive', '/funds', '/proposals']) {
    assert.ok(paths.indexOf(lit) < paths.indexOf('/fund/:id'), `${lit} before /fund/:id`);
  }
  for (const p of ['/archive', '/funds', '/fund/:id', '/proposals']) {
    assert.equal(typeof handler(p), 'function', `handler for ${p}`);
  }
});

test('GET /archive — canonical index or graceful 503', async () => {
  const { status, body } = await call('/archive');
  if (!haveArchive) {
    assert.equal(status, 503);
    assert.equal(body.error, 'source_unavailable');
    assertQuality(body, { confidence: 'low' });
    return;
  }
  assert.equal(status, 200);
  assertQuality(body);
  assert.ok(body.subfolders && typeof body.subfolders === 'object', 'has subfolders map');
  assert.ok(typeof body.coverage_note === 'string', 'carries honest coverage note');
  // Spot-check the documented subfolder shape if any exist (tolerant of empties).
  for (const [name, meta] of Object.entries(body.subfolders)) {
    assert.ok(typeof name === 'string');
    assert.ok('source_authority_class' in meta);
    assert.ok('artifact_count' in meta);
  }
});

test('GET /funds — funds derived from captures (sparse-tolerant)', async () => {
  const { status, body } = await call('/funds');
  assertQuality(body);
  if (!haveArchive) {
    assert.equal(status, 503);
    return;
  }
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.funds), 'funds is an array');
  assert.equal(body.total_funds, body.funds.length);
  assert.ok(typeof body.coverage_note === 'string');
  // Shape every derived fund without requiring any specific one to exist.
  for (const f of body.funds) {
    assert.ok('fund' in f && 'fund_label' in f);
    assert.equal(f.fund_label, `F${f.fund}`);
    assert.ok(Number.isInteger(f.artifact_count));
    assert.ok(Array.isArray(f.sources));
  }
});

test('GET /fund/:id — captures for a fund, or enveloped 404', async () => {
  if (!haveArchive) {
    const { status, body } = await call('/fund/:id', { params: { id: '9' } });
    assert.equal(status, 503);
    assertQuality(body, { confidence: 'low' });
    return;
  }
  // Pick a fund that the /funds endpoint actually reports, if any.
  const funds = (await call('/funds')).body.funds;
  if (funds.length) {
    const id = funds[0].fund;
    for (const variant of [id, `F${id}`]) { // accepts "9" and "F9"
      const { status, body } = await call('/fund/:id', { params: { id: variant } });
      assert.equal(status, 200, `fund ${variant} resolves`);
      assertQuality(body);
      assert.equal(body.fund, id);
      assert.equal(body.fund_label, `F${id}`);
      assert.ok(Array.isArray(body.captures) && body.captures.length > 0);
      const cap = body.captures[0];
      assert.ok('source_url' in cap && 'sha256' in cap && 'capture_date' in cap && 'authority_class' in cap);
    }
  }
  // An absent fund must 404, still enveloped — never fabricated.
  const miss = await call('/fund/:id', { params: { id: '999999' } });
  assert.equal(miss.status, 404);
  assertQuality(miss.body, { confidence: 'low' });
  assert.equal(miss.body.error, 'not_found');
  assert.deepEqual(miss.body.captures, []);
});

test('GET /proposals — honest list (likely empty / pending)', async () => {
  const { status, body } = await call('/proposals');
  assertQuality(body);
  if (!haveArchive) {
    assert.equal(status, 503);
    return;
  }
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.proposals), 'proposals is an array');
  assert.equal(body.total, body.proposals.length);
  assert.ok(typeof body.note === 'string', 'carries a note about coverage/pending state');
  // If any proposal-level artifact exists, it must be a real capture, not invented.
  for (const p of body.proposals) {
    assert.ok('proposal_id' in p && 'source_url' in p && 'sha256' in p);
  }
});

test('graceful 503 when the archive dir is missing', async () => {
  const bogus = { config: { memory: { catalystArchive: '/nonexistent/catalyst/archive' } }, cache: new TtlCache(), log: () => {} };
  for (const p of ['/archive', '/funds', '/proposals']) {
    const { status, body } = await call(p, { c: bogus });
    assert.equal(status, 503, `${p} → 503 on missing dir`);
    assert.equal(body.error, 'source_unavailable');
    assertQuality(body, { confidence: 'low' });
  }
  const fund = await call('/fund/:id', { params: { id: '9' }, c: bogus });
  assert.equal(fund.status, 503);
  assert.equal(fund.body.error, 'source_unavailable');
});
