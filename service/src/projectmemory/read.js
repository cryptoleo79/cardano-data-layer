// Project Memory — read layer (backs the read-only API, PM-BUILD-4).
// Pure reads over the projection tables; assembles per-field provenance.

import { all, get } from '../db.js';
import { eventsForSubject } from './eventstore.js';

function sourceOf(sourceId) {
  if (!sourceId) return null;
  const s = get('SELECT * FROM pm_source WHERE source_id = ?', sourceId);
  if (!s) return { source_id: sourceId };
  return {
    source_id: s.source_id, kind: s.kind, authority_class: s.authority_class, url: s.url,
    captured_at: s.captured_at, archive_wayback_url: s.archive_wayback_url, archive_sha256: s.archive_sha256, label: s.label,
  };
}

function evidenceFor(claimId) {
  return all('SELECT kind, ref, sha256, description FROM pm_evidence WHERE claim_id = ? ORDER BY evidence_id', claimId)
    .map((e) => ({ kind: e.kind, ref: e.ref, sha256: e.sha256, description: e.description }));
}

/** A claim row → the full provenance-bearing shape (who/where/when/what evidence). */
function shapeClaim(c) {
  return {
    claim_id: c.claim_id,
    field: c.field,
    value: c.value,
    state: c.state,
    provenance: {
      asserted_by: c.asserted_by,       // WHO
      source: sourceOf(c.source_id),    // WHERE
      authority_class: c.authority_class,
      as_of: c.as_of,                   // WHEN
      evidence: evidenceFor(c.claim_id),// WHAT EVIDENCE
    },
    asserted_seq: c.asserted_seq,
    superseded_by_seq: c.superseded_by_seq,
  };
}

export function listProjects({ status, category, q, limit = 100, offset = 0 } = {}) {
  const where = [];
  const args = [];
  if (status) { where.push('p.status = ?'); args.push(status); }
  if (q) { where.push('(p.id LIKE ? OR p.name LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  let join = '';
  if (category) { join = `JOIN pm_project_category pc ON pc.project_id = p.id AND pc.state = 'active'`; where.push('pc.category_slug = ?'); args.push(category); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get(`SELECT COUNT(*) AS n FROM pm_project p ${join} ${clause}`, ...args).n;
  const lim = Math.min(Math.max(Number.parseInt(limit, 10) || 100, 1), 1000);
  const off = Math.max(Number.parseInt(offset, 10) || 0, 0);
  const rows = all(
    `SELECT p.id, p.kind, p.name, p.status, p.unclassified FROM pm_project p ${join} ${clause} ORDER BY p.id LIMIT ? OFFSET ?`,
    ...args, lim, off,
  );
  return {
    total,
    count: rows.length,
    limit: lim,
    offset: off,
    projects: rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, status: r.status, unclassified: !!r.unclassified })),
  };
}

export function getProject(id) {
  const p = get('SELECT * FROM pm_project WHERE id = ?', id);
  if (!p) return null;
  const active = all(`SELECT * FROM pm_claim WHERE project_id = ? AND state IN ('active','contested') ORDER BY field, asserted_seq`, id);
  // group active claims by field (subjective fields may legitimately have >1)
  const fields = {};
  for (const c of active) (fields[c.field] ||= []).push(shapeClaim(c));
  const supersededCount = get(`SELECT COUNT(*) AS n FROM pm_claim WHERE project_id = ? AND state = 'superseded'`, id).n;
  const categories = all(
    `SELECT pc.category_slug, c.name, pc.authority_class, pc.as_of, pc.source_id
       FROM pm_project_category pc LEFT JOIN pm_category c ON c.slug = pc.category_slug
      WHERE pc.project_id = ? AND pc.state = 'active' ORDER BY pc.category_slug`, id,
  ).map((r) => ({ slug: r.category_slug, name: r.name, authority_class: r.authority_class, as_of: r.as_of, source: sourceOf(r.source_id) }));
  return {
    id: p.id,
    kind: p.kind,
    name: p.name,
    status: p.status,
    unclassified: !!p.unclassified,
    fields,
    categories,
    superseded_claim_count: supersededCount,
    created_seq: p.created_seq,
    last_seq: p.last_seq,
  };
}

export function listCategories() {
  const rows = all(`
    SELECT c.slug, c.name, c.deprecated, c.alias_of, c.source_id,
           (SELECT COUNT(*) FROM pm_project_category pc WHERE pc.category_slug = c.slug AND pc.state = 'active') AS project_count
      FROM pm_category c ORDER BY c.slug`);
  return {
    count: rows.length,
    categories: rows.map((r) => ({
      slug: r.slug, name: r.name, project_count: r.project_count,
      deprecated: !!r.deprecated, alias_of: r.alias_of, source: sourceOf(r.source_id),
    })),
  };
}

/** The append-only history for one project — the events themselves, in order. */
export function historyForProject(id) {
  const exists = get('SELECT 1 FROM pm_project WHERE id = ?', id);
  const events = eventsForSubject(id).map((e) => ({
    seq: e.seq, ts: e.ts, type: e.type, actor: e.actor, payload: e.payload, hash: e.hash, prev_hash: e.prev_hash,
  }));
  return { exists: !!exists, count: events.length, events };
}
