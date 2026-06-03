// project.js — THE MOAT.
//
// A curated, versioned project + category store, seeded from the Cardano Memory
// Layer preservation archive (see ../../CARDANO_DATA_LAYER.md). Unlike the
// token/NFT modules — which are thin, swappable proxies over commodity market
// data — this module owns UNIQUE and PERISHABLE data: which projects exist,
// what categories the ecosystem used, and which projects have gone defunct.
// That information disappears when a curator's site sunsets, so we preserve it
// here with full provenance and an append-only audit trail.
//
// Design rules that make this a "moat" rather than a cache:
//   1. Provenance is never dropped. Every record keeps `source`, `source_url`,
//      `as_of`, and (for projects) the public `archived_wayback_url` +
//      `archived_sha256` so a claim can always be traced back to its capture.
//   2. State is never silently overwritten. The versioned upsert writes a
//      `project_history` row for every changed field, so historical/perishable
//      state (e.g. "this used to be active, now it's defunct") is auditable.
//   3. We do not invent. Seeded projects carry empty categories[] because we do
//      not yet have verified category assignments; we expose them as
//      `unclassified` rather than guessing. Taxonomy is preserved as-found,
//      per-source, never consolidated.
//
// Zero external dependencies: Node built-ins + the shared db helpers only.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Create the moat's tables if they don't already exist. Idempotent.
 * Called from init(ctx); takes the shared db so tests can pass a fresh handle.
 */
function createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS category (
      slug          TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      source        TEXT,
      source_url    TEXT,
      as_of         TEXT,
      taxonomy_note TEXT
    );

    CREATE TABLE IF NOT EXISTS project (
      id                   TEXT PRIMARY KEY,
      name                 TEXT NOT NULL,
      status               TEXT,
      status_source        TEXT,
      source               TEXT,
      source_url           TEXT,
      archived_wayback_url TEXT,
      archived_sha256      TEXT,
      as_of                TEXT,
      note                 TEXT
    );

    CREATE TABLE IF NOT EXISTS project_category (
      project_id    TEXT NOT NULL,
      category_slug TEXT NOT NULL,
      PRIMARY KEY (project_id, category_slug)
    );

    -- Append-only audit log. We INSERT, never UPDATE/DELETE. Every change to a
    -- project field that the versioned upsert detects is recorded here so the
    -- perishable history of a project is never lost.
    CREATE TABLE IF NOT EXISTS project_history (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    TEXT NOT NULL,
      changed_at    TEXT NOT NULL,
      field         TEXT NOT NULL,
      old_value     TEXT,
      new_value     TEXT,
      change_source TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_project_status   ON project(status);
    CREATE INDEX IF NOT EXISTS idx_pc_category      ON project_category(category_slug);
    CREATE INDEX IF NOT EXISTS idx_history_project  ON project_history(project_id);
  `);
}

// ---------------------------------------------------------------------------
// Versioned upsert (the heart of the moat)
// ---------------------------------------------------------------------------

// The project fields we track for history. Provenance fields (source, source_url,
// archived_*) are included: if an archive reference changes we want to know.
const TRACKED_FIELDS = [
  'name',
  'status',
  'status_source',
  'source',
  'source_url',
  'archived_wayback_url',
  'archived_sha256',
  'as_of',
  'note',
];

const nowIso = () => new Date().toISOString();

/**
 * Insert or update a single project, writing a `project_history` row for every
 * field whose value actually changed. This is the only write path for projects;
 * it is used by both the seed loader and the standalone `npm run seed` job.
 *
 * It is intentionally NOT exposed as a public HTTP route in the MVP — writes are
 * curator-driven via the seed pipeline — but it is the documented, reusable
 * mechanism that makes reconciliation auditable rather than destructive.
 *
 * @param {object}  db          shared node:sqlite DatabaseSync handle
 * @param {object}  incoming    project record (id required; categories[] optional)
 * @param {object}  [opts]
 * @param {string}  [opts.changeSource]  who/what initiated the change (for the audit)
 * @returns {{ action:'inserted'|'updated'|'unchanged', changes:string[] }}
 */
export function upsertProject(db, incoming, { changeSource = 'seed' } = {}) {
  if (!incoming || !incoming.id) throw new Error('upsertProject: project.id is required');

  const existing = db.prepare('SELECT * FROM project WHERE id = ?').get(incoming.id);
  const changedAt = nowIso();

  if (!existing) {
    // Brand-new project. Insert the row, then record an audit entry per
    // non-null field so even the initial seed is captured in history.
    db.prepare(`
      INSERT INTO project (id, name, status, status_source, source, source_url,
                           archived_wayback_url, archived_sha256, as_of, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      incoming.id,
      incoming.name ?? null,
      incoming.status ?? null,
      incoming.status_source ?? null,
      incoming.source ?? null,
      incoming.source_url ?? null,
      incoming.archived_wayback_url ?? null,
      incoming.archived_sha256 ?? null,
      incoming.as_of ?? null,
      incoming.note ?? null,
    );

    const insHist = db.prepare(`
      INSERT INTO project_history (project_id, changed_at, field, old_value, new_value, change_source)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const field of TRACKED_FIELDS) {
      const val = incoming[field] ?? null;
      if (val == null) continue;
      insHist.run(incoming.id, changedAt, field, null, String(val), changeSource);
    }
    syncCategories(db, incoming.id, incoming.categories);
    return { action: 'inserted', changes: TRACKED_FIELDS.filter((f) => incoming[f] != null) };
  }

  // Existing project: diff tracked fields, write history only for real changes,
  // then apply the changes in a single UPDATE.
  const changed = [];
  const insHist = db.prepare(`
    INSERT INTO project_history (project_id, changed_at, field, old_value, new_value, change_source)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const field of TRACKED_FIELDS) {
    if (!(field in incoming)) continue; // caller didn't supply this field — leave it
    const oldVal = existing[field] ?? null;
    const newVal = incoming[field] ?? null;
    if (String(oldVal) === String(newVal)) continue; // no-op; nothing to record
    insHist.run(
      incoming.id,
      changedAt,
      field,
      oldVal == null ? null : String(oldVal),
      newVal == null ? null : String(newVal),
      changeSource,
    );
    changed.push(field);
  }

  if (changed.length) {
    const setSql = changed.map((f) => `${f} = ?`).join(', ');
    const values = changed.map((f) => incoming[f] ?? null);
    db.prepare(`UPDATE project SET ${setSql} WHERE id = ?`).run(...values, incoming.id);
  }

  // Category links are reconciled when the caller explicitly provides them.
  if (Array.isArray(incoming.categories)) syncCategories(db, incoming.id, incoming.categories);

  return { action: changed.length ? 'updated' : 'unchanged', changes: changed };
}

/**
 * Replace a project's category links with the supplied set. We do NOT invent
 * assignments: an empty/absent array leaves the project unclassified, which is
 * the correct state for seeded graveyard projects until verified assignments
 * exist. Category history is not audited (links are a derived relation, not a
 * perishable fact about the project itself).
 */
function syncCategories(db, projectId, categories) {
  if (!Array.isArray(categories)) return;
  db.prepare('DELETE FROM project_category WHERE project_id = ?').run(projectId);
  const ins = db.prepare(
    'INSERT OR IGNORE INTO project_category (project_id, category_slug) VALUES (?, ?)',
  );
  for (const slug of categories) {
    if (slug) ins.run(projectId, String(slug));
  }
}

/**
 * Insert a category if absent, or update mutable fields if present. Categories
 * are taxonomy reference data; we keep them in sync with the seed but do not
 * audit them in project_history (that table is project-scoped).
 */
export function upsertCategory(db, cat) {
  if (!cat || !cat.slug) throw new Error('upsertCategory: category.slug is required');
  db.prepare(`
    INSERT INTO category (slug, name, source, source_url, as_of, taxonomy_note)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name          = excluded.name,
      source        = excluded.source,
      source_url    = excluded.source_url,
      as_of         = excluded.as_of,
      taxonomy_note = excluded.taxonomy_note
  `).run(
    cat.slug,
    cat.name ?? cat.slug,
    cat.source ?? null,
    cat.source_url ?? null,
    cat.as_of ?? null,
    cat.taxonomy_note ?? null,
  );
}

// ---------------------------------------------------------------------------
// Seed loading
// ---------------------------------------------------------------------------

/** Read + parse a seed file from config.seedDir. */
function readSeed(seedDir, file) {
  return JSON.parse(readFileSync(join(seedDir, file), 'utf8'));
}

/**
 * Load both seed files into the store via the versioned upsert. Idempotent:
 * re-running records history only for fields that actually changed. Returns a
 * summary suitable for logging. Shared by init() and the standalone job.
 *
 * @param {object} db
 * @param {string} seedDir
 * @param {object} [opts] { changeSource, log }
 */
export function loadSeed(db, seedDir, { changeSource = 'seed', log = () => {} } = {}) {
  const catSeed = readSeed(seedDir, 'categories.json');
  const projSeed = readSeed(seedDir, 'projects.json');

  // Categories first so any future category links reference real rows.
  let catCount = 0;
  for (const cat of catSeed.categories || []) {
    upsertCategory(db, cat);
    catCount += 1;
  }

  const summary = { categories: catCount, inserted: 0, updated: 0, unchanged: 0, changedFields: 0 };
  for (const proj of projSeed.projects || []) {
    const res = upsertProject(db, proj, { changeSource });
    summary[res.action] += 1;
    summary.changedFields += res.changes.length;
  }

  log(
    `seed loaded: ${summary.categories} categories; projects ` +
    `inserted=${summary.inserted} updated=${summary.updated} unchanged=${summary.unchanged} ` +
    `(history rows written for ${summary.changedFields} field changes)`,
  );
  return { ...summary, catSource: catSeed.source, projSource: projSeed.source, as_of: catSeed.as_of };
}

// ---------------------------------------------------------------------------
// Module init
// ---------------------------------------------------------------------------

async function init(ctx) {
  const { db, config, log } = ctx;
  createTables(db);

  // Seed only when the store is empty, so we never clobber curated edits on a
  // normal server start. Re-seeding / reconciliation is the job of `npm run seed`.
  const haveCats = db.prepare('SELECT COUNT(*) AS n FROM category').get().n;
  const haveProjs = db.prepare('SELECT COUNT(*) AS n FROM project').get().n;
  if (haveCats === 0 && haveProjs === 0) {
    loadSeed(db, config.seedDir, { changeSource: 'seed:init', log });
  } else {
    log(`project store present (categories=${haveCats}, projects=${haveProjs}); skipping seed`);
  }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/** Build the standard envelope fields. */
const SOURCE = 'cardano-data-layer/project-store (seeded from cardano-project-memory-archive)';

function categoryRow(db, slug) {
  return db.prepare('SELECT * FROM category WHERE slug = ?').get(slug);
}

function projectCategories(db, projectId) {
  return db
    .prepare('SELECT category_slug FROM project_category WHERE project_id = ? ORDER BY category_slug')
    .all(projectId)
    .map((r) => r.category_slug);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/** GET /categories — list all categories with their project counts. */
async function listCategories({ ctx }) {
  const { db } = ctx;
  const rows = db.prepare(`
    SELECT c.slug, c.name,
           (SELECT COUNT(*) FROM project_category pc WHERE pc.category_slug = c.slug) AS project_count
    FROM category c
    ORDER BY c.slug
  `).all();
  return {
    status: 200,
    body: {
      source: SOURCE,
      as_of: nowIso(),
      count: rows.length,
      categories: rows,
    },
  };
}

/** GET /category/:slug — category detail plus the projects in it. */
async function getCategory({ params, ctx }) {
  const { db } = ctx;
  const cat = categoryRow(db, params.slug);
  if (!cat) {
    const err = new Error(`category not found: ${params.slug}`);
    err.status = 404;
    throw err;
  }
  const projects = db.prepare(`
    SELECT p.* FROM project p
    JOIN project_category pc ON pc.project_id = p.id
    WHERE pc.category_slug = ?
    ORDER BY p.id
  `).all(params.slug);

  return {
    status: 200,
    body: {
      source: SOURCE,
      as_of: nowIso(),
      category: cat,
      project_count: projects.length,
      projects,
    },
  };
}

/**
 * GET /projects?status=&category=&q=&limit=&offset=
 * Filterable list with a total count. `q` is a substring match on name OR id.
 */
async function listProjects({ query, ctx }) {
  const { db } = ctx;
  const where = [];
  const args = [];

  if (query.status) { where.push('p.status = ?'); args.push(query.status); }
  if (query.category) {
    where.push('p.id IN (SELECT project_id FROM project_category WHERE category_slug = ?)');
    args.push(query.category);
  }
  if (query.q) {
    where.push('(LOWER(p.name) LIKE ? OR LOWER(p.id) LIKE ?)');
    const needle = `%${String(query.q).toLowerCase()}%`;
    args.push(needle, needle);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // Total ignoring pagination, for client paging.
  const total = db.prepare(`SELECT COUNT(*) AS n FROM project p ${whereSql}`).get(...args).n;

  // Clamp pagination to sane bounds.
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 50, 1), 500);
  const offset = Math.max(Number.parseInt(query.offset, 10) || 0, 0);

  const rows = db.prepare(`
    SELECT p.* FROM project p
    ${whereSql}
    ORDER BY p.id
    LIMIT ? OFFSET ?
  `).all(...args, limit, offset);

  // Attach categories so each project is self-describing. Empty array means the
  // project is genuinely unclassified (we don't guess); flag it explicitly.
  const projects = rows.map((p) => {
    const categories = projectCategories(db, p.id);
    return { ...p, categories, unclassified: categories.length === 0 };
  });

  return {
    status: 200,
    body: {
      source: SOURCE,
      as_of: nowIso(),
      total,
      limit,
      offset,
      count: projects.length,
      filters: {
        status: query.status ?? null,
        category: query.category ?? null,
        q: query.q ?? null,
      },
      projects,
    },
  };
}

/** GET /project/:id — full record incl. categories and append-only history. */
async function getProject({ params, ctx }) {
  const { db } = ctx;
  const proj = db.prepare('SELECT * FROM project WHERE id = ?').get(params.id);
  if (!proj) {
    const err = new Error(`project not found: ${params.id}`);
    err.status = 404;
    throw err;
  }
  const categories = projectCategories(db, proj.id);
  const history = db
    .prepare('SELECT * FROM project_history WHERE project_id = ? ORDER BY id')
    .all(proj.id);

  return {
    status: 200,
    body: {
      source: SOURCE,
      as_of: nowIso(),
      project: {
        ...proj,
        categories,
        unclassified: categories.length === 0,
      },
      history,
    },
  };
}

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------

export default {
  name: 'project',
  init,
  routes: [
    { method: 'GET', path: '/categories',     handler: listCategories, meta: { desc: 'list all categories with project counts' } },
    { method: 'GET', path: '/category/:slug', handler: getCategory,    meta: { desc: 'category detail + projects in it' } },
    { method: 'GET', path: '/projects',       handler: listProjects,   meta: { desc: 'filterable project list (status, category, q, limit, offset)' } },
    { method: 'GET', path: '/project/:id',    handler: getProject,     meta: { desc: 'full project record incl. categories + version history' } },
  ],
};
