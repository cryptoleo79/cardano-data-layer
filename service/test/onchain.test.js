// Tests for the on-chain proxy module. Runs with `node --test`.
//
// These must pass OFFLINE. We point the upstream base URLs at an unroutable
// host (TEST-NET-1, RFC 5737) before importing anything, so every real fetch
// fails fast and we assert the module degrades cleanly (503 source_unavailable
// or 200 with nulls) instead of throwing. Pure helpers (parseUnit, shaping) are
// tested directly with no network at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Force unreachable upstreams + tiny timeouts BEFORE importing the module/config.
// 192.0.2.0/24 (TEST-NET-1) is reserved and never routes.
process.env.KOIOS_BASE = 'http://192.0.2.1:9/koios';
process.env.CIP26_BASE = 'http://192.0.2.1:9/cip26';
process.env.BLOCKFROST_BASE = 'http://192.0.2.1:9/bf';
delete process.env.BLOCKFROST_PROJECT_ID; // ensure Blockfrost is "not configured"

const onchain = (await import('../src/modules/onchain.js')).default;
const { holdersHandler, supplyHandler, metadataHandler, parseUnit } = await import('../src/modules/onchain.js');

// A minimal fake ctx: cache passthrough (no caching between calls), noop log.
function fakeCtx() {
  return {
    log: () => {},
    config: undefined, // module imports config directly; not needed on ctx
    cache: { getOrSet: async (_k, _ttl, fn) => fn() }, // always recompute
  };
}

const SNEK = '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b';

test('module exports the expected shape', () => {
  assert.equal(onchain.name, 'onchain');
  assert.ok(Array.isArray(onchain.routes));
  const paths = onchain.routes.map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(paths.sort(), [
    'GET /token/holders',
    'GET /token/metadata',
    'GET /token/supply',
  ]);
  for (const r of onchain.routes) assert.equal(typeof r.handler, 'function');
});

test('parseUnit splits policy(56) + assetName and validates', () => {
  const { policy, nameHex, unit } = parseUnit(SNEK);
  assert.equal(policy.length, 56);
  assert.equal(policy, '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f');
  assert.equal(nameHex, '534e454b');
  assert.equal(unit, SNEK);

  // policy-only unit (empty asset name) is valid
  const p = parseUnit('a'.repeat(56));
  assert.equal(p.nameHex, '');

  // bad inputs throw a 400
  for (const bad of [undefined, '', 'xyz', 'zz'.repeat(40)]) {
    assert.throws(() => parseUnit(bad), (e) => e.status === 400, `should reject: ${bad}`);
  }
});

test('parseUnit is case-insensitive and trims', () => {
  const { policy } = parseUnit(`  ${SNEK.toUpperCase()}  `);
  assert.equal(policy, '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f');
});

test('holders handler degrades to 503 source_unavailable when offline', async () => {
  const res = await holdersHandler({ query: { unit: SNEK }, ctx: fakeCtx() });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'source_unavailable');
  assert.ok(res.body.source.includes('koios'));
  assert.ok(typeof res.body.as_of === 'string');
  assert.equal(res.body.unit, SNEK);
});

test('supply handler degrades to 503 source_unavailable when offline', async () => {
  const res = await supplyHandler({ query: { unit: SNEK }, ctx: fakeCtx() });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'source_unavailable');
  assert.ok(typeof res.body.as_of === 'string');
});

test('metadata handler degrades to 503 source_unavailable when offline', async () => {
  const res = await metadataHandler({ query: { unit: SNEK }, ctx: fakeCtx() });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'source_unavailable');
  assert.ok(res.body.source.includes('cip26'));
});

test('handlers reject a missing unit with 400 before any network call', async () => {
  for (const h of [holdersHandler, supplyHandler, metadataHandler]) {
    await assert.rejects(() => h({ query: {}, ctx: fakeCtx() }), (e) => e.status === 400);
  }
});

test('shapeHolders sorts by quantity desc and caps top-N / flags lower bound', () => {
  const { shapeHolders } = onchain._internal;
  const holders = [
    { address: 'addr_a', quantity: '100' },
    { address: 'addr_b', quantity: '999999999999999999999' }, // BigInt-range
    { address: 'addr_c', quantity: '5' },
  ];
  const res = shapeHolders('unit1', 'koios', { holders, capped: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.holder_count, 3);
  assert.equal(res.body.holder_count_is_lower_bound, true);
  assert.ok(res.body.note);
  // largest first (BigInt-safe)
  assert.equal(res.body.top_holders[0].address, 'addr_b');
  assert.equal(res.body.top_holders[2].address, 'addr_c');
  assert.equal(res.body.source, 'koios');
});

test('metadataFromKoios prefers registry, falls back to mint metadata', () => {
  const { metadataFromKoios } = onchain._internal;
  // registry path
  const viaReg = metadataFromKoios({
    token_registry_metadata: { name: 'Snek', ticker: 'SNEK', decimals: 0, url: 'https://snek.com' },
  });
  assert.equal(viaReg.name, 'Snek');
  assert.equal(viaReg.ticker, 'SNEK');

  // mint-metadata (CIP-25) path
  const viaMint = metadataFromKoios({
    policy_id: 'pol',
    asset_name_ascii: 'TOK',
    minting_tx_metadata: { '721': { pol: { TOK: { name: 'Token', symbol: 'TOK', image: 'ipfs://x' } } } },
  });
  assert.equal(viaMint.name, 'Token');
  assert.equal(viaMint.ticker, 'TOK');
  assert.equal(viaMint.logo, 'ipfs://x');

  // no metadata at all
  assert.equal(metadataFromKoios({}), null);
});
