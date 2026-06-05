// Market module tests (node --test). Must pass OFFLINE.
//
// We import the market module and call each handler directly with a fake ctx.
// Network calls may fail or succeed depending on the environment; the module is
// designed to answer with a structured, envelope-wrapped body either way, so we
// assert on SHAPE (numeric status, presence of `_quality`) and on graceful error
// handling (bad input -> 4xx), never on live values.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TtlCache } from '../src/cache.js';
import { config } from '../src/config.js';
import { db } from '../src/db.js';
import marketModule from '../src/modules/market.js';

// A well-formed unit (SNEK). Used for shape checks; resolution may or may not hit
// the network — either is acceptable for these tests.
const SNEK = '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b';

function fakeCtx() {
  return { cache: new TtlCache(), config, db, log: () => {} };
}

function handlerFor(path) {
  const r = marketModule.routes.find((x) => x.path === path);
  assert.ok(r, `route ${path} should be registered`);
  return r.handler;
}

// Assert the data-quality envelope is present and well-shaped.
function assertQuality(body) {
  assert.ok(body._quality, 'body carries a _quality block');
  assert.ok('source' in body._quality, '_quality has source');
  assert.ok('authority_class' in body._quality, '_quality has authority_class');
  assert.ok('refresh' in body._quality, '_quality has refresh');
  assert.ok('confidence' in body._quality, '_quality has confidence');
  assert.ok('provenance' in body._quality, '_quality has provenance');
  assert.ok('as_of' in body._quality, '_quality has as_of');
  assert.ok(['high', 'medium', 'low'].includes(body._quality.confidence), 'confidence is valid');
}

test('init creates the ohlcv table', async () => {
  await marketModule.init(fakeCtx());
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ohlcv'").get();
  assert.equal(row?.name, 'ohlcv');
});

test('module exports the expected shape', () => {
  assert.equal(marketModule.name, 'market');
  assert.equal(typeof marketModule.init, 'function');
  assert.ok(Array.isArray(marketModule.routes));
  assert.equal(marketModule.routes.length, 4);
  const paths = marketModule.routes.map((r) => r.path);
  assert.deepEqual(paths, ['/markets', '/price/history/:id', '/price/:id', '/ohlcv/:id']);
  // /markets (literal) must come before any /:id route.
  const firstParam = paths.findIndex((p) => p.includes(':id'));
  assert.ok(paths.indexOf('/markets') < firstParam, '/markets before parameterized routes');
});

// --- input validation: pure (no network), deterministic ---

test('price: missing id -> 400 error shape', async () => {
  const handler = handlerFor('/price/:id');
  try {
    await handler({ params: {}, query: {}, ctx: fakeCtx() });
    assert.fail('should have thrown for missing id');
  } catch (err) {
    assert.equal(err.status, 400);
    assert.match(err.message, /id/);
    assert.equal(err.source, 'market');
  }
});

test('price: invalid id -> 400 error shape', async () => {
  const handler = handlerFor('/price/:id');
  try {
    await handler({ params: { id: 'not-a-unit!' }, query: {}, ctx: fakeCtx() });
    assert.fail('should have thrown for invalid id');
  } catch (err) {
    assert.equal(err.status, 400);
  }
});

test('ohlcv: invalid interval -> 400', async () => {
  const handler = handlerFor('/ohlcv/:id');
  try {
    await handler({ params: { id: SNEK }, query: { interval: 'bogus' }, ctx: fakeCtx() });
    assert.fail('should have thrown for invalid interval');
  } catch (err) {
    assert.equal(err.status, 400);
  }
});

test('history: invalid id -> 400', async () => {
  const handler = handlerFor('/price/history/:id');
  try {
    await handler({ params: { id: 'nope!' }, query: {}, ctx: fakeCtx() });
    assert.fail('should have thrown for invalid id');
  } catch (err) {
    assert.equal(err.status, 400);
  }
});

// --- shape checks: offline-safe (DB reads) ---

test('markets returns an envelope-wrapped overview offline', async () => {
  await marketModule.init(fakeCtx());
  const handler = handlerFor('/markets');
  const res = await handler({ params: {}, query: {}, ctx: fakeCtx() });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.markets));
  assert.equal(typeof res.body.tracked_units, 'number');
  assert.equal(typeof res.body.count, 'number');
  assertQuality(res.body);
  assert.equal(res.body._quality.authority_class, 'C');
});

test('ohlcv reads the table and returns an envelope-wrapped body offline', async () => {
  await marketModule.init(fakeCtx());
  const handler = handlerFor('/ohlcv/:id');
  const res = await handler({ params: { id: SNEK }, query: { interval: '1h', limit: '5' }, ctx: fakeCtx() });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.candles));
  assert.equal(res.body.interval, '1h');
  assert.ok(res.body.note, 'carries a note');
  assertQuality(res.body);
});

test('history reads raw ticks and returns an envelope-wrapped body offline', async () => {
  await marketModule.init(fakeCtx());
  const handler = handlerFor('/price/history/:id');
  const res = await handler({ params: { id: SNEK }, query: { limit: '10' }, ctx: fakeCtx() });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.ticks));
  assert.equal(res.body.interval, 'raw');
  assert.equal(typeof res.body.count, 'number');
  assertQuality(res.body);
});

test('lovelace price returns an envelope-wrapped body (no network needed)', async () => {
  const handler = handlerFor('/price/:id');
  const res = await handler({ params: { id: 'lovelace' }, query: {}, ctx: fakeCtx() });
  assert.equal(res.status, 200);
  assert.equal(res.body.price.ada, 1);
  assert.ok(res.body.price.usd === null || typeof res.body.price.usd === 'number');
  assertQuality(res.body);
});

test('price for a valid unit answers with an envelope-wrapped body (live or graceful)', async () => {
  const handler = handlerFor('/price/:id');
  let res;
  try {
    res = await handler({ params: { id: SNEK }, query: {}, ctx: fakeCtx() });
  } catch (err) {
    // A network failure must surface as an error WITH a numeric status.
    assert.equal(typeof err.status, 'number');
    return;
  }
  assert.equal(res.status, 200);
  assert.ok('confidence' in res.body);
  assert.ok(res.body.price.ada === null || typeof res.body.price.ada === 'number');
  assertQuality(res.body);
});
