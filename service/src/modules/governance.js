// governance.js — Governance + Treasury Memory integration (Stream E).
//
// READ-ONLY surface over the Cardano Delegation Observatory's CC0 snapshot
// exports (config.memory.observatoryDir). The observatory derives these from
// Koios (on-chain governance), so every claim here is authority class A.
//
// Files consumed (shapes confirmed against the live snapshot, methodology 0.8):
//   top30.json               { entries: [ { rank, drep_id, name, voting_weight_*, delegator_count, ... } ] }
//   dreps/<drep_id>.json     per-DRep detail (daily_flow, overlay_events, voting_weight_series, vote_history)
//   actions.json             { n_actions, actions: [ { action_id, action_type, title, outcome, drep_*_count } ] }
//   live/recent_votes.json   { n_votes, votes: [ { vote_epoch, vote_block_time, drep_id, vote, action_id, ... } ] }
//   treasury_snapshot.json   { n_epochs, epochs: [ { epoch_no, treasury_lovelace, reserves_lovelace, ... } ] }
//   treasury_withdrawals.json{ n_withdrawals, withdrawals: [ { action_id, amount_lovelace, outcome, ... } ] }
//
// Nothing here writes. If a source file is missing or unreadable we return a
// 503 'source_unavailable' envelope rather than crashing the request.
//
// Routes (literal before parameterized, per the router contract):
//   GET /dreps?limit=        top DReps from top30.json .entries
//   GET /dreps/:id           one DRep (matched by drep_id; merges dreps/<id>.json if present)
//   GET /actions?type=&outcome=  governance actions (filterable) from actions.json
//   GET /actions/:id         one action by action_id
//   GET /votes?limit=        recent votes from live/recent_votes.json
//   GET /treasury            latest treasury state + epoch series (+ withdrawals)

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { dq } from '../lib/envelope.js';

// Module-level provenance for the data-quality envelope. On-chain-derived
// governance (Koios) → authority class A. Daily snapshot cadence; the live
// votes feed refreshes faster (~10m).
const DQ = {
  source: 'observatory',
  authority_class: 'A',
  refresh: 'daily',
  provenance: 'Governance/Treasury Memory — observatory CC0 export (Koios-derived)',
};

const observatoryDir = (ctx) => ctx.config?.memory?.observatoryDir;

// Read + parse a JSON file under the observatory snapshot dir, with a short-TTL
// cache (snapshots regenerate daily). Returns { ok, data } or { ok:false }.
// Never throws — callers turn !ok into a 503 envelope.
function loadJson(ctx, relPath, ttlMs = 60_000) {
  const dir = observatoryDir(ctx);
  if (!dir) return { ok: false };
  const full = path.join(dir, relPath);
  const cacheKey = `governance:${full}`;
  const cached = ctx.cache?.get(cacheKey);
  if (cached !== undefined) return cached;
  let result;
  try {
    result = { ok: true, data: JSON.parse(readFileSync(full, 'utf8')) };
  } catch {
    result = { ok: false };
  }
  ctx.cache?.set(cacheKey, result, ttlMs);
  return result;
}

const unavailable = (file) => ({
  status: 503,
  body: dq({ error: 'source_unavailable', file }, { ...DQ, confidence: 'low' }),
});

const toInt = (v, d) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

// GET /dreps?limit= — top DReps from top30.json .entries
async function drepsHandler({ query, ctx }) {
  const res = loadJson(ctx, 'top30.json');
  if (!res.ok) return unavailable('top30.json');
  const all = Array.isArray(res.data.entries) ? res.data.entries : [];
  const limit = toInt(query.limit, all.length);
  const dreps = all.slice(0, Math.max(0, limit));
  return {
    status: 200,
    body: dq(
      {
        snapshot_date: res.data.snapshot_date ?? null,
        epoch: res.data.epoch ?? null,
        total: all.length,
        count: dreps.length,
        dreps,
      },
      DQ,
    ),
  };
}

// GET /dreps/:id — one DRep matched by drep_id; merges per-DRep detail file if present.
async function drepHandler({ params, ctx }) {
  const res = loadJson(ctx, 'top30.json');
  if (!res.ok) return unavailable('top30.json');
  const all = Array.isArray(res.data.entries) ? res.data.entries : [];
  const summary = all.find((d) => d.drep_id === params.id) || null;

  // Per-DRep file lives at <observatoryDir>/dreps/<drep_id>.json (optional).
  const detailRes = loadJson(ctx, path.join('dreps', `${params.id}.json`));
  const detail = detailRes.ok ? detailRes.data : null;

  if (!summary && !detail) {
    return { status: 404, body: dq({ error: 'not_found', drep_id: params.id }, { ...DQ, confidence: 'low' }) };
  }
  return {
    status: 200,
    body: dq(
      {
        drep_id: params.id,
        summary,
        detail,
        has_detail: !!detail,
      },
      DQ,
    ),
  };
}

// GET /actions?type=&outcome= — governance actions from actions.json (filterable).
async function actionsHandler({ query, ctx }) {
  const res = loadJson(ctx, 'actions.json');
  if (!res.ok) return unavailable('actions.json');
  let actions = Array.isArray(res.data.actions) ? res.data.actions : [];
  const type = (query.type || '').trim();
  const outcome = (query.outcome || '').trim();
  if (type) actions = actions.filter((a) => a.action_type === type);
  if (outcome) actions = actions.filter((a) => a.outcome === outcome);
  const total = actions.length;
  if (query.limit != null) actions = actions.slice(0, Math.max(0, toInt(query.limit, total)));
  return {
    status: 200,
    body: dq(
      {
        snapshot_date: res.data.snapshot_date ?? null,
        filters: { type: type || null, outcome: outcome || null },
        total,
        count: actions.length,
        actions,
      },
      DQ,
    ),
  };
}

// GET /actions/:id — one action by action_id.
async function actionHandler({ params, ctx }) {
  const res = loadJson(ctx, 'actions.json');
  if (!res.ok) return unavailable('actions.json');
  const actions = Array.isArray(res.data.actions) ? res.data.actions : [];
  const action = actions.find((a) => a.action_id === params.id) || null;
  if (!action) {
    return { status: 404, body: dq({ error: 'not_found', action_id: params.id }, { ...DQ, confidence: 'low' }) };
  }
  return { status: 200, body: dq({ action }, DQ) };
}

// GET /votes?limit= — recent votes from live/recent_votes.json.
async function votesHandler({ query, ctx }) {
  const res = loadJson(ctx, path.join('live', 'recent_votes.json'), 600_000);
  if (!res.ok) return unavailable('live/recent_votes.json');
  const all = Array.isArray(res.data.votes) ? res.data.votes : [];
  const limit = toInt(query.limit, all.length);
  const votes = all.slice(0, Math.max(0, limit));
  return {
    status: 200,
    body: dq(
      {
        fetched_at: res.data.fetched_at ?? null,
        window_hours: res.data.window_hours ?? null,
        total: all.length,
        count: votes.length,
        votes,
      },
      // The live votes feed refreshes far faster than the daily snapshot.
      { ...DQ, refresh: 'realtime' },
    ),
  };
}

// GET /treasury — latest treasury state + epoch series (+ withdrawals if present).
async function treasuryHandler({ ctx }) {
  const res = loadJson(ctx, 'treasury_snapshot.json');
  if (!res.ok) return unavailable('treasury_snapshot.json');
  const epochs = Array.isArray(res.data.epochs) ? res.data.epochs : [];
  const latest = epochs.length ? epochs[epochs.length - 1] : null;

  // Withdrawals are an optional companion file; absence is not fatal here.
  const wRes = loadJson(ctx, 'treasury_withdrawals.json');
  const withdrawals = wRes.ok && Array.isArray(wRes.data.withdrawals) ? wRes.data.withdrawals : [];

  return {
    status: 200,
    body: dq(
      {
        snapshot_date: res.data.snapshot_date ?? null,
        n_epochs: epochs.length,
        latest,
        epochs,
        withdrawals: {
          available: wRes.ok,
          count: withdrawals.length,
          items: withdrawals,
        },
      },
      DQ,
    ),
  };
}

export default {
  name: 'governance',
  // Ordering is load-bearing: literal collection routes before the
  // parameterized detail routes (/dreps before /dreps/:id, /actions before /actions/:id).
  routes: [
    { method: 'GET', path: '/dreps', handler: drepsHandler, meta: { desc: 'top DReps from the observatory snapshot' } },
    { method: 'GET', path: '/dreps/:id', handler: drepHandler, meta: { desc: 'one DRep (by drep_id) + per-DRep detail if present' } },
    { method: 'GET', path: '/actions', handler: actionsHandler, meta: { desc: 'governance actions (filter by type/outcome)' } },
    { method: 'GET', path: '/actions/:id', handler: actionHandler, meta: { desc: 'one governance action by action_id' } },
    { method: 'GET', path: '/votes', handler: votesHandler, meta: { desc: 'recent DRep votes (live feed)' } },
    { method: 'GET', path: '/treasury', handler: treasuryHandler, meta: { desc: 'treasury snapshot: latest state + epoch series + withdrawals' } },
  ],
};
