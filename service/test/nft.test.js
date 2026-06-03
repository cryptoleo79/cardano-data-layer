// Tests for the NFT module. Run: node --test test/nft.test.js
//
// These MUST pass offline. We exercise the handlers directly with a fake ctx and
// a fake (injected) source for the happy/validation paths, and separately assert
// that a genuinely failing source yields a clean 503 (never a throw/crash).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import nftModule, { _setSource } from '../src/modules/nft.js';
import { openCnftSource } from '../src/sources/opencnft.js';

// Minimal ctx with a pass-through cache (computes every time, no real TTL state).
const ctx = {
  cache: { getOrSet: async (_k, _ttl, fn) => fn() },
  config: { cache: { nft: 0 } },
};

const POLICY = 'd5e6bf0500378d4f0da4e8dde6becec7621cd8cbf5cbb9b87013d4cc'; // SpaceBudz
const handler = (path) => nftModule.routes.find((r) => r.path === path).handler;

test('module exports the expected shape', () => {
  assert.equal(nftModule.name, 'nft');
  assert.equal(nftModule.routes.length, 2);
  for (const r of nftModule.routes) {
    assert.equal(r.method, 'GET');
    assert.equal(typeof r.handler, 'function');
  }
});

test('source interface is swappable (has required members)', () => {
  for (const m of ['name', 'collectionStats', 'collectionSales']) {
    assert.ok(m in openCnftSource, `source missing ${m}`);
  }
  assert.equal(typeof openCnftSource.collectionStats, 'function');
  assert.equal(typeof openCnftSource.collectionSales, 'function');
});

test('stats: rejects invalid policy with 400', async () => {
  const res = await handler('/nft/collection/stats')({ query: { policy: 'nope' }, ctx });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_policy');
});

test('stats: happy path shape with a fake source', async () => {
  _setSource({
    name: 'opencnft',
    async collectionStats() {
      return { available: true, floor_ada: 12.5, volume_ada: 99000, listings: 42, owners: 1500, supply: 10000 };
    },
    async collectionSales() { return { available: true, page: 1, sales: [] }; },
  });
  try {
    const res = await handler('/nft/collection/stats')({ query: { policy: POLICY }, ctx });
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'opencnft');
    assert.match(res.body.as_of, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(res.body.floor.ada, 12.5);
    assert.equal(res.body.floor.usd, null); // no oracle
    assert.equal(res.body.volume.ada, 99000);
    assert.equal(res.body.listings, 42);
    assert.equal(res.body.owners, 1500);
    assert.equal(res.body.supply, 10000);
  } finally {
    _setSource(openCnftSource);
  }
});

test('sales: happy path shape with a fake source', async () => {
  _setSource({
    name: 'opencnft',
    async collectionStats() { return { available: true }; },
    async collectionSales(_p, { page }) {
      return { available: true, page, sales: [{ unit: 'abc', name: 'Bud #1', price_ada: 5000, marketplace: 'jpg.store', tx_hash: 'deadbeef', sold_at: '2024-01-01T00:00:00.000Z' }] };
    },
  });
  try {
    const res = await handler('/nft/collection/sales')({ query: { policy: POLICY, page: '2' }, ctx });
    assert.equal(res.status, 200);
    assert.equal(res.body.page, 2);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.source, 'opencnft');
    const sale = res.body.sales[0];
    assert.equal(sale.price.ada, 5000);
    assert.equal(sale.price.usd, null);
    assert.equal(sale.name, 'Bud #1');
    assert.equal(sale.price_ada, undefined); // collapsed into price.{ada,usd}
  } finally {
    _setSource(openCnftSource);
  }
});

test('stats: source unavailable -> clean 503 (no throw)', async () => {
  _setSource({
    name: 'opencnft',
    async collectionStats() { return { available: false, reason: 'upstream_error', status: 502 }; },
    async collectionSales() { return { available: false, reason: 'upstream_error', status: 502 }; },
  });
  try {
    const res = await handler('/nft/collection/stats')({ query: { policy: POLICY }, ctx });
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'source_unavailable');
  } finally {
    _setSource(openCnftSource);
  }
});

test('stats: not_found -> 404', async () => {
  _setSource({
    name: 'opencnft',
    async collectionStats() { return { available: false, reason: 'not_found', status: 404 }; },
    async collectionSales() { return { available: false, reason: 'not_found', status: 404 }; },
  });
  try {
    const res = await handler('/nft/collection/stats')({ query: { policy: POLICY }, ctx });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'collection_not_found');
  } finally {
    _setSource(openCnftSource);
  }
});

test('real adapter offline degrades gracefully (no throw)', async () => {
  // Using the REAL OpenCNFT source against an unreachable network must NOT throw;
  // it must return an unavailable marker -> the handler maps it to 503.
  _setSource(openCnftSource);
  const res = await handler('/nft/collection/stats')({ query: { policy: POLICY }, ctx });
  assert.ok([200, 404, 503].includes(res.status), `unexpected status ${res.status}`);
  if (res.status === 503) assert.equal(res.body.error, 'source_unavailable');
});
