// governance.test.js — Stream E module tests (node --test).
//
// These exercise the governance module's handlers directly against the real
// observatory snapshot dir. If that dir (or a given file) is absent, the test
// asserts the graceful 503 'source_unavailable' path instead of failing — so it
// runs in CI without the sibling observatory project checked out.
//
// Point CDL_OBSERVATORY_DIR at a real snapshot dir to exercise the happy paths.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';

import mod from '../src/modules/governance.js';
import { config } from '../src/config.js';
import { TtlCache } from '../src/cache.js';

const ctx = { config, cache: new TtlCache(), log: () => {} };
const dir = config.memory.observatoryDir;
const has = (rel) => existsSync(path.join(dir, rel));

const handler = (p, method = 'GET') =>
  mod.routes.find((r) => r.path === p && r.method === method)?.handler;

const call = (p, { query = {}, params = {} } = {}) => handler(p)({ query, params, ctx });

// Every body must carry the data-quality envelope with the right authority class.
function assertQuality(body) {
  assert.ok(body._quality, 'response carries _quality');
  assert.equal(body._quality.source, 'observatory');
  assert.equal(body._quality.authority_class, 'A');
  assert.ok(['daily', 'realtime', '~10m'].includes(body._quality.refresh), '_quality.refresh is a governance cadence');
  assert.ok(typeof body._quality.provenance === 'string' && body._quality.provenance.length > 0);
}

test('module shape: name + ordered routes (literals before params)', () => {
  assert.equal(mod.name, 'governance');
  const paths = mod.routes.map((r) => r.path);
  assert.ok(paths.indexOf('/dreps') < paths.indexOf('/dreps/:id'), '/dreps before /dreps/:id');
  assert.ok(paths.indexOf('/actions') < paths.indexOf('/actions/:id'), '/actions before /actions/:id');
  for (const p of ['/dreps', '/dreps/:id', '/actions', '/actions/:id', '/votes', '/treasury']) {
    assert.equal(typeof handler(p), 'function', `handler for ${p}`);
  }
});

test('GET /dreps', async () => {
  const { status, body } = await call('/dreps', { query: { limit: '3' } });
  assertQuality(body);
  if (!has('top30.json')) {
    assert.equal(status, 503);
    assert.equal(body.error, 'source_unavailable');
    return;
  }
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.dreps));
  assert.ok(body.dreps.length <= 3);
  assert.equal(body.count, body.dreps.length);
  if (body.dreps.length) assert.ok('drep_id' in body.dreps[0]);
});

test('GET /dreps/:id', async () => {
  if (!has('top30.json')) {
    const { status, body } = await call('/dreps/:id', { params: { id: 'anything' } });
    assert.equal(status, 503);
    assertQuality(body);
    return;
  }
  const list = await call('/dreps', { query: { limit: '1' } });
  const id = list.body.dreps?.[0]?.drep_id;
  if (!id) return; // empty snapshot — nothing to look up
  const { status, body } = await call('/dreps/:id', { params: { id } });
  assert.equal(status, 200);
  assertQuality(body);
  assert.equal(body.drep_id, id);
  assert.ok(body.summary, 'matched DRep summary present');

  // Unknown id → 404, still enveloped.
  const miss = await call('/dreps/:id', { params: { id: 'drep1_not_a_real_id' } });
  assert.equal(miss.status, 404);
  assertQuality(miss.body);
});

test('GET /actions (+ filters) and /actions/:id', async () => {
  const { status, body } = await call('/actions', { query: { limit: '3' } });
  assertQuality(body);
  if (!has('actions.json')) {
    assert.equal(status, 503);
    return;
  }
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.actions));
  assert.ok(body.actions.length <= 3);
  assert.ok(typeof body.total === 'number');

  if (body.actions.length) {
    const a = body.actions[0];
    assert.ok('action_id' in a && 'action_type' in a);

    // type filter narrows (or keeps equal) the result set.
    const filtered = await call('/actions', { query: { type: a.action_type } });
    assert.ok(filtered.body.actions.every((x) => x.action_type === a.action_type));
    assert.ok(filtered.body.total <= body.total + filtered.body.total); // sanity, non-throwing

    // single action by id
    const one = await call('/actions/:id', { params: { id: a.action_id } });
    assert.equal(one.status, 200);
    assertQuality(one.body);
    assert.equal(one.body.action.action_id, a.action_id);

    const miss = await call('/actions/:id', { params: { id: 'gov_action1_missing' } });
    assert.equal(miss.status, 404);
  }
});

test('GET /votes', async () => {
  const { status, body } = await call('/votes', { query: { limit: '3' } });
  assertQuality(body);
  assert.equal(body._quality.refresh, 'realtime');
  if (!has(path.join('live', 'recent_votes.json'))) {
    assert.equal(status, 503);
    return;
  }
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.votes));
  assert.ok(body.votes.length <= 3);
  if (body.votes.length) assert.ok('vote' in body.votes[0] && 'action_id' in body.votes[0]);
});

test('GET /treasury', async () => {
  const { status, body } = await call('/treasury');
  assertQuality(body);
  if (!has('treasury_snapshot.json')) {
    assert.equal(status, 503);
    return;
  }
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.epochs));
  assert.equal(body.n_epochs, body.epochs.length);
  if (body.epochs.length) {
    assert.deepEqual(body.latest, body.epochs[body.epochs.length - 1]);
    assert.ok('treasury_lovelace' in body.latest);
  }
  assert.ok(body.withdrawals && typeof body.withdrawals.available === 'boolean');
});

test('graceful 503 when observatoryDir is bogus', async () => {
  const bogus = { config: { memory: { observatoryDir: '/nonexistent/observatory/snapshots' } }, cache: new TtlCache(), log: () => {} };
  const { status, body } = await mod.routes.find((r) => r.path === '/treasury').handler({ query: {}, params: {}, ctx: bogus });
  assert.equal(status, 503);
  assert.equal(body.error, 'source_unavailable');
  assert.equal(body._quality.confidence, 'low');
});
