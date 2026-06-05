// Token module tests (node --test). Must pass OFFLINE.
//
// We import the token module and call each handler directly with a fake ctx.
// Network calls may fail (or succeed) depending on the environment; the module
// is designed to answer with a structured body either way, so we assert on
// SHAPE (status is a number, body carries `source` and `as_of`) and on graceful
// error handling (bad input -> 4xx with an error), never on live values.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TtlCache } from '../src/cache.js';
import { config } from '../src/config.js';
import { db } from '../src/db.js';
import tokenModule from '../src/modules/token.js';

// A well-formed unit (MIN). Used for shape checks; resolution may or may not hit
// the network — either is acceptable for these tests.
const MIN = '29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c64d494e';

function fakeCtx() {
  return { cache: new TtlCache(), config, db, log: () => {} };
}

function handlerFor(path) {
  const r = tokenModule.routes.find((x) => x.path === path);
  assert.ok(r, `route ${path} should be registered`);
  return r.handler;
}

// Run init once so the ohlcv table exists for the offline-readable routes.
test('init creates the ohlcv table', async () => {
  await tokenModule.init(fakeCtx());
  // If the table is missing this throws; the assertion is "does not throw".
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ohlcv'").get();
  assert.equal(row?.name, 'ohlcv');
});

test('module exports the expected shape', () => {
  assert.equal(tokenModule.name, 'token');
  assert.equal(typeof tokenModule.init, 'function');
  assert.ok(Array.isArray(tokenModule.routes));
  const paths = tokenModule.routes.map((r) => r.path).sort();
  assert.deepEqual(paths, [
    '/token/:id', '/token/list', '/token/mcap', '/token/ohlcv',
    '/token/price', '/token/search', '/tokens/top',
  ]);
});

test('route ordering: literals are registered before /token/:id', () => {
  const order = tokenModule.routes.map((r) => r.path);
  const idIdx = order.indexOf('/token/:id');
  assert.equal(idIdx, order.length - 1, '/token/:id must be LAST');
  for (const lit of ['/token/price', '/token/ohlcv', '/token/mcap', '/token/search', '/token/list']) {
    assert.ok(order.indexOf(lit) < idIdx, `${lit} must precede /token/:id`);
  }
});

test('every handler body carries the _quality envelope', async () => {
  // lovelace price is fully offline-resolvable and exercises dq().
  const handler = handlerFor('/token/price');
  const res = await handler({ query: { unit: 'lovelace' }, ctx: fakeCtx() });
  assert.ok(res.body._quality, 'body has _quality');
  assert.ok('authority_class' in res.body._quality);
  assert.ok('provenance' in res.body._quality);
  assert.ok('refresh' in res.body._quality);
});

// --- input validation: these are pure (no network) and must be deterministic ---

test('price: missing unit -> 400 error shape', async () => {
  const handler = handlerFor('/token/price');
  try {
    await handler({ query: {}, ctx: fakeCtx() });
    assert.fail('should have thrown for missing unit');
  } catch (err) {
    assert.equal(err.status, 400);
    assert.match(err.message, /unit/);
    assert.equal(err.source, 'token');
  }
});

test('price: invalid unit -> 400 error shape', async () => {
  const handler = handlerFor('/token/price');
  try {
    await handler({ query: { unit: 'not-a-unit!' }, ctx: fakeCtx() });
    assert.fail('should have thrown for invalid unit');
  } catch (err) {
    assert.equal(err.status, 400);
  }
});

test('ohlcv: invalid interval -> 400', async () => {
  const handler = handlerFor('/token/ohlcv');
  try {
    await handler({ query: { unit: MIN, interval: 'bogus' }, ctx: fakeCtx() });
    assert.fail('should have thrown for invalid interval');
  } catch (err) {
    assert.equal(err.status, 400);
  }
});

test('top: invalid by -> 400', async () => {
  const handler = handlerFor('/tokens/top');
  try {
    await handler({ query: { by: 'nonsense' }, ctx: fakeCtx() });
    assert.fail('should have thrown for invalid by');
  } catch (err) {
    assert.equal(err.status, 400);
  }
});

// --- shape checks: tolerate either live data or graceful nulls ---

test('lovelace price returns a structured body (no network needed)', async () => {
  const handler = handlerFor('/token/price');
  const res = await handler({ query: { unit: 'lovelace' }, ctx: fakeCtx() });
  assert.equal(typeof res.status, 'number');
  assert.equal(res.status, 200);
  assert.ok('source' in res.body, 'body has source');
  assert.ok('as_of' in res.body, 'body has as_of');
  assert.equal(res.body.price.ada, 1);
  // usd may be null offline; if present it must be a number.
  assert.ok(res.body.price.usd === null || typeof res.body.price.usd === 'number');
});

test('ohlcv reads the table and returns a structured body offline', async () => {
  const handler = handlerFor('/token/ohlcv');
  const res = await handler({ query: { unit: MIN, interval: '1h', limit: '5' }, ctx: fakeCtx() });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.candles));
  assert.ok('source' in res.body);
  assert.ok('as_of' in res.body);
  // Offline / fresh DB: expect an empty set with a guiding note.
  if (res.body.candles.length === 0) assert.ok(res.body.note, 'empty candles carries a note');
});

test('price for a valid unit answers with a structured body (live or graceful)', async () => {
  const handler = handlerFor('/token/price');
  let res;
  try {
    res = await handler({ query: { unit: MIN }, ctx: fakeCtx() });
  } catch (err) {
    // A network failure must surface as an error WITH a numeric status, not a raw throw.
    assert.equal(typeof err.status, 'number');
    return;
  }
  assert.equal(typeof res.status, 'number');
  assert.ok('source' in res.body);
  assert.ok('as_of' in res.body);
  assert.ok('confidence' in res.body);
  // ada is either a number (live) or null (offline) — both valid.
  assert.ok(res.body.price.ada === null || typeof res.body.price.ada === 'number');
});

test('mcap answers with a structured body (live or graceful)', async () => {
  const handler = handlerFor('/token/mcap');
  let res;
  try {
    res = await handler({ query: { unit: MIN }, ctx: fakeCtx() });
  } catch (err) {
    assert.equal(typeof err.status, 'number');
    return;
  }
  assert.equal(typeof res.status, 'number');
  assert.ok('source' in res.body);
  assert.ok('as_of' in res.body);
  assert.ok('mcap' in res.body);
  assert.ok(res.body.mcap.ada === null || typeof res.body.mcap.ada === 'number');
});

test('search: missing q -> 400', async () => {
  const handler = handlerFor('/token/search');
  try {
    await handler({ query: {}, ctx: fakeCtx() });
    assert.fail('should have thrown for missing q');
  } catch (err) {
    assert.equal(err.status, 400);
  }
});

test('search finds seed tokens offline (local set always works)', async () => {
  const handler = handlerFor('/token/search');
  const res = await handler({ query: { q: 'SNEK' }, ctx: fakeCtx() });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.results));
  // SNEK is in the seed set, so a local match is guaranteed regardless of network.
  assert.ok(res.body.results.some((r) => r.ticker === 'SNEK'), 'SNEK seed match present');
  assert.ok(res.body._quality, 'search body carries _quality');
});

test('list returns the known set offline', async () => {
  await tokenModule.init(fakeCtx());
  const handler = handlerFor('/token/list');
  const res = await handler({ query: {}, ctx: fakeCtx() });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.tokens));
  assert.ok(res.body.tokens.length >= 3, 'at least the seed tokens are listed');
  assert.ok(res.body._quality);
});

test('detail: invalid id -> 400', async () => {
  const handler = handlerFor('/token/:id');
  try {
    await handler({ params: { id: 'bogus!' }, ctx: fakeCtx() });
    assert.fail('should have thrown for invalid id');
  } catch (err) {
    assert.equal(err.status, 400);
  }
});

test('detail answers with a merged body (live or graceful)', async () => {
  const handler = handlerFor('/token/:id');
  let res;
  try {
    res = await handler({ params: { id: MIN }, ctx: fakeCtx() });
  } catch (err) {
    assert.equal(typeof err.status, 'number');
    return;
  }
  assert.equal(res.status, 200);
  assert.equal(res.body.unit, MIN);
  assert.ok('metadata' in res.body);
  assert.ok('supply' in res.body);
  assert.ok('price' in res.body);
  assert.ok('holders' in res.body);
  assert.ok(res.body._quality, 'detail body carries _quality');
  // Sub-parts degrade to null offline — must never throw.
  assert.ok(res.body.supply === null || typeof res.body.supply === 'number');
  assert.ok(res.body.holders.count === null || typeof res.body.holders.count === 'number');
});

test('top answers with a partial-coverage ranking body (live or graceful)', async () => {
  const handler = handlerFor('/tokens/top');
  let res;
  try {
    res = await handler({ query: { by: 'mcap', limit: '3' }, ctx: fakeCtx() });
  } catch (err) {
    assert.equal(typeof err.status, 'number');
    return;
  }
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.ranking));
  assert.equal(res.body.coverage, 'partial');
  assert.ok('source' in res.body);
  assert.ok('as_of' in res.body);
  assert.ok(res.body.note, 'top carries a partial-coverage note');
});
