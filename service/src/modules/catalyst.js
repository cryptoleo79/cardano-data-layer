// catalyst.js — Catalyst Memory integration (Stream F), v1.
//
// READ-ONLY surface over the catalyst preservation archive at
// config.memory.catalystArchive (default ~/cardano-catalyst-archive). The
// archive is a chain-of-custody store: a top-level INDEX.json describes the
// subfolders (projectcatalyst-io, catalyst-core, ideascale, catalyst-explorer,
// milestones, on-chain) each with its own INDEX.json, optional CAPTURE_LOG/*.json
// session records, and per-artifact *.custody.json sidecars.
//
// The archive is deliberately SPARSE right now (FLOW-6 capture has just begun:
// a single Fund 9 landing-page capture under projectcatalyst-io). This module is
// honest about that: coverage equals what is preserved. It NEVER fabricates funds
// or proposals — everything returned is derived from files actually on disk.
//
// Routes:
//   GET /archive       canonical top-level INDEX.json (subfolders, classes, counts)
//   GET /funds         funds derivable from captured artifacts (parsed from URLs/ids)
//   GET /fund/:id      captures relating to one fund id
//   GET /proposals     proposal-level artifacts (currently pending — honest empty)

import fs from 'node:fs';
import path from 'node:path';
import { dq } from '../lib/envelope.js';
import { config } from '../config.js';

// Resolve the archive root. Prefer the per-request ctx.config (so tests can
// point at a fixture or a bogus path) and fall back to the imported config.
const archiveRoot = (ctx) => ctx?.config?.memory?.catalystArchive ?? config.memory.catalystArchive;

// Module-level provenance for the data-quality envelope. The archive's primary
// captures are projectcatalyst.io official pages (Class B); other subfolders
// carry their own authority class, surfaced per-item where known.
const DQ = {
  source: 'catalyst-archive',
  authority_class: 'B',
  refresh: 'static',
  provenance: 'Catalyst Memory archive (chain-of-custody)',
};
const wrap = (body, extra) => dq(body, { ...DQ, ...extra });

// ---- filesystem helpers (synchronous; the archive is small) ----------------

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// List *.json files under a directory (non-recursive).
function listJson(dir) {
  if (!exists(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(dir, f));
  } catch { return []; }
}

// Walk a subfolder for every *.custody.json sidecar (artifacts live under
// arbitrary depth, e.g. projectcatalyst-io/funds/9/index.html.custody.json).
function findCustody(dir, out = []) {
  if (!exists(dir)) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '.git') continue;
      findCustody(full, out);
    } else if (e.name.endsWith('.custody.json')) {
      out.push(full);
    }
  }
  return out;
}

// ---- fund-id derivation ----------------------------------------------------

// Pull a fund number out of any string that carries one. Recognises:
//   .../funds/9            (source_url path segment)
//   ...-projectcatalyst-io-f9   (capture session id suffix)
//   "F9" / "Fund 9"        (fund_coverage keys, notes)
// Returns the bare number as a string (e.g. "9") or null.
function fundFromString(s) {
  if (typeof s !== 'string') return null;
  let m = s.match(/\/funds?\/(\d+)/i);
  if (m) return m[1];
  m = s.match(/(?:^|[-_])f(?:und)?[-_]?(\d+)(?:$|[-_./])/i);
  if (m) return m[1];
  m = s.match(/\bfund\s+(\d+)\b/i);
  if (m) return m[1];
  return null;
}

// Collect the candidate strings from a custody manifest worth scanning for a
// fund id, in priority order (source_url is the canonical signal).
function custodyFundCandidates(c) {
  return [c.source_url, c.capture_session_id, ...(c.source_url_aliases || []), c.notes];
}

// ---- archive scan (single pass, reused by /funds, /fund/:id, /proposals) ----

// Read the top-level index and, for each declared subfolder, gather its index,
// capture-log session records, and custody artifacts. Returns a normalised view
// that the route handlers slice. Returns null if the archive dir is missing.
function scanArchive(ARCHIVE) {
  if (!exists(ARCHIVE)) return null;
  const topIndex = readJson(path.join(ARCHIVE, 'INDEX.json'));
  const subfolders = (topIndex && topIndex.subfolders) || {};

  const sources = [];
  for (const [name, meta] of Object.entries(subfolders)) {
    const dir = path.join(ARCHIVE, name);
    const subIndex = readJson(path.join(dir, meta.subfolder_index ? path.basename(meta.subfolder_index) : 'INDEX.json'))
      || readJson(path.join(dir, 'INDEX.json'));
    const authority_class = (subIndex && subIndex.source_authority_class) || meta.source_authority_class || null;

    // Session records (CAPTURE_LOG/*.json).
    const sessions = listJson(path.join(dir, 'CAPTURE_LOG'))
      .map((p) => ({ path: path.relative(ARCHIVE, p), record: readJson(p) }))
      .filter((s) => s.record);

    // Per-artifact custody sidecars (walked, any depth).
    const custody = findCustody(dir)
      .map((p) => ({ path: path.relative(ARCHIVE, p), record: readJson(p) }))
      .filter((s) => s.record);

    sources.push({ name, authority_class, dir, meta, subIndex, sessions, custody });
  }

  return { topIndex, subfolders, sources };
}

// Build a normalised list of every capture (custody artifact + session record),
// each tagged with its source subfolder, authority class, and derived fund id.
function allCaptures(scan) {
  const captures = [];
  for (const src of scan.sources) {
    for (const a of src.custody) {
      const c = a.record;
      let fund = null;
      for (const s of custodyFundCandidates(c)) { fund = fundFromString(s); if (fund) break; }
      captures.push({
        kind: 'artifact',
        source: src.name,
        authority_class: c.source_authority_class || src.authority_class,
        fund,
        artifact_path: a.path,
        source_url: c.source_url ?? null,
        wayback_url: c.wayback_url ?? null,
        sha256: c.sha256 ?? null,
        content_type: c.content_type ?? null,
        http_status: c.http_status ?? null,
        capture_date: c.capture_date ?? null,
        capture_method: c.capture_method ?? null,
        capture_operator: c.capture_operator ?? null,
        capture_session_id: c.capture_session_id ?? null,
        notes: c.notes ?? null,
      });
    }
    // Session-level records that have a target URL but no custody match also
    // describe a fund; record them too (no double counting — they are kind
    // 'session' and the fund tallies in /funds count artifacts only).
    for (const s of src.sessions) {
      const r = s.record;
      const fund = fundFromString(r.session_target_root_url) || fundFromString(r.capture_session_id);
      captures.push({
        kind: 'session',
        source: src.name,
        authority_class: r.session_target_authority_class || src.authority_class,
        fund,
        session_path: s.path,
        source_url: r.session_target_root_url ?? null,
        sha256: r.rollup_sha256 ?? null,
        capture_date: r.session_start ?? null,
        capture_operator: r.capture_operator ?? null,
        capture_session_id: r.capture_session_id ?? null,
        artifact_count: r.artifact_count ?? null,
        notes: r.notes ?? null,
      });
    }
  }
  return captures;
}

const COVERAGE_NOTE =
  'Coverage equals what has been preserved. The Catalyst archive is sparse: ' +
  'only captured artifacts are listed here, never the full set of Catalyst funds/proposals.';

// ---- handlers --------------------------------------------------------------

// GET /archive — the canonical top-level INDEX.json, verbatim plus a coverage note.
async function archiveHandler({ ctx }) {
  const ARCHIVE = archiveRoot(ctx);
  if (!exists(ARCHIVE)) {
    return { status: 503, body: wrap({ error: 'source_unavailable' }, { confidence: 'low' }) };
  }
  const topIndex = readJson(path.join(ARCHIVE, 'INDEX.json'));
  if (!topIndex) {
    return { status: 503, body: wrap({ error: 'source_unavailable' }, { confidence: 'low' }) };
  }
  return { status: 200, body: wrap({ ...topIndex, coverage_note: COVERAGE_NOTE }) };
}

// GET /funds — funds derivable from captured artifacts, with per-fund counts.
async function fundsHandler({ ctx }) {
  const scan = scanArchive(archiveRoot(ctx));
  if (!scan) return { status: 503, body: wrap({ error: 'source_unavailable' }, { confidence: 'low' }) };

  const captures = allCaptures(scan);
  const byFund = new Map();
  for (const c of captures) {
    if (c.fund == null) continue;
    if (!byFund.has(c.fund)) {
      byFund.set(c.fund, { fund: c.fund, fund_label: `F${c.fund}`, artifact_count: 0, sessions: 0, sources: new Set() });
    }
    const f = byFund.get(c.fund);
    if (c.kind === 'artifact') f.artifact_count += 1;
    else f.sessions += 1;
    f.sources.add(c.source);
  }

  const funds = [...byFund.values()]
    .map((f) => ({ fund: f.fund, fund_label: f.fund_label, artifact_count: f.artifact_count, session_count: f.sessions, sources: [...f.sources] }))
    .sort((a, b) => Number(a.fund) - Number(b.fund));

  return {
    status: 200,
    body: wrap({
      total_funds: funds.length,
      funds,
      coverage_note: COVERAGE_NOTE,
    }),
  };
}

// GET /fund/:id — captures relating to one fund id (number, "9", or "F9").
async function fundHandler({ params, ctx }) {
  const scan = scanArchive(archiveRoot(ctx));
  if (!scan) return { status: 503, body: wrap({ error: 'source_unavailable' }, { confidence: 'low' }) };

  const id = String(params.id || '').replace(/^f/i, '').trim(); // accept "9" or "F9"
  const captures = allCaptures(scan).filter((c) => c.fund === id);

  if (captures.length === 0) {
    return {
      status: 404,
      body: wrap(
        { error: 'not_found', fund: id, fund_label: `F${id}`, captures: [], note: `No captures for fund F${id} are preserved yet. ${COVERAGE_NOTE}` },
        { confidence: 'low' },
      ),
    };
  }

  return {
    status: 200,
    body: wrap({
      fund: id,
      fund_label: `F${id}`,
      artifact_count: captures.filter((c) => c.kind === 'artifact').length,
      session_count: captures.filter((c) => c.kind === 'session').length,
      captures,
      coverage_note: COVERAGE_NOTE,
    }),
  };
}

// GET /proposals — proposal-level artifacts derivable from captures.
// A "proposal" capture is one whose source_url/path points at a single proposal
// (e.g. /f9/.../proposal/<id>, .../proposals/<id>, milestones proposal pages).
// This is expected to be empty for now: proposal-level capture is pending. We
// never synthesise proposals from fund pages.
function proposalFromCapture(c) {
  const candidates = [c.source_url, c.artifact_path];
  for (const s of candidates) {
    if (typeof s !== 'string') continue;
    const m = s.match(/\/proposals?\/([^/?#]+)/i);
    if (m) return m[1];
  }
  return null;
}

async function proposalsHandler({ ctx }) {
  const scan = scanArchive(archiveRoot(ctx));
  if (!scan) return { status: 503, body: wrap({ error: 'source_unavailable' }, { confidence: 'low' }) };

  const captures = allCaptures(scan);
  const proposals = [];
  for (const c of captures) {
    const pid = proposalFromCapture(c);
    if (!pid) continue;
    proposals.push({
      proposal_id: pid,
      fund: c.fund,
      fund_label: c.fund ? `F${c.fund}` : null,
      source: c.source,
      authority_class: c.authority_class,
      source_url: c.source_url,
      wayback_url: c.wayback_url ?? null,
      sha256: c.sha256 ?? null,
      capture_date: c.capture_date ?? null,
      artifact_path: c.artifact_path ?? null,
    });
  }

  return {
    status: 200,
    body: wrap({
      total: proposals.length,
      proposals,
      note: proposals.length === 0
        ? `Proposal-level capture is pending; no per-proposal artifacts are preserved yet. ${COVERAGE_NOTE}`
        : COVERAGE_NOTE,
    }),
  };
}

export default {
  name: 'catalyst',
  // Ordering is load-bearing: literal routes before the parameterized catch-all.
  // /archive, /funds, /proposals (literal) before /fund/:id.
  routes: [
    { method: 'GET', path: '/archive', handler: archiveHandler, meta: { desc: 'canonical Catalyst archive index (subfolders, authority classes, counts)' } },
    { method: 'GET', path: '/funds', handler: fundsHandler, meta: { desc: 'Catalyst funds derivable from captured artifacts (coverage = preserved)' } },
    { method: 'GET', path: '/proposals', handler: proposalsHandler, meta: { desc: 'proposal-level artifacts derivable from captures (sparse/pending)' } },
    { method: 'GET', path: '/fund/:id', handler: fundHandler, meta: { desc: 'captures relating to one Catalyst fund id' } },
  ],
};
