// Project Memory — projection schema (PM-BUILD-1 / PM-BUILD-3).
//
// These tables are a DERIVED read-model: every row is reproducible by replaying
// pm_event through the reducer. They may be dropped and rebuilt at any time
// (rebuildProjections). The event log is the source of truth; these are a cache
// for fast reads. Provenance (source / asserted_by / as_of / evidence) is
// first-class on every claim — that is the whole point of the layer.

import { db } from '../db.js';

export const PROJECTION_TABLES = [
  'pm_project_category', 'pm_evidence', 'pm_challenge', 'pm_claim',
  'pm_category', 'pm_project', 'pm_source',
];

export function initProjections() {
  db.exec(`
    -- WHERE a fact came from (provenance origin)
    CREATE TABLE IF NOT EXISTS pm_source (
      source_id   TEXT PRIMARY KEY,
      kind        TEXT,            -- taptools-wayback | cardanocube | archive | onchain | researcher
      authority_class TEXT,        -- A..E (METHODOLOGY §24.3)
      url         TEXT,
      captured_at TEXT,
      archive_wayback_url TEXT,    -- chain-of-custody into the preservation archive
      archive_sha256 TEXT,
      label       TEXT,
      registered_seq INTEGER
    );

    -- subject entity (thin; all substantive fields are claims)
    CREATE TABLE IF NOT EXISTS pm_project (
      id          TEXT PRIMARY KEY,
      kind        TEXT,            -- project | token
      name        TEXT,            -- denormalized current name claim (convenience)
      status      TEXT,            -- denormalized current status claim
      unclassified INTEGER DEFAULT 1,
      created_seq INTEGER,
      last_seq    INTEGER
    );

    -- a sourced assertion about one field of one project (the substance)
    CREATE TABLE IF NOT EXISTS pm_claim (
      claim_id    TEXT PRIMARY KEY,    -- clm_<seq>
      project_id  TEXT NOT NULL,
      field       TEXT NOT NULL,       -- name | status | ticker | rank | description | ...
      value       TEXT,
      source_id   TEXT,                -- -> pm_source (WHERE)
      authority_class TEXT,
      as_of       TEXT,                -- WHEN
      asserted_by TEXT,                -- WHO
      state       TEXT,                -- active | superseded | contested | rejected
      asserted_seq INTEGER,
      superseded_by_seq INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_pm_claim_project ON pm_claim (project_id, field, state);

    -- WHAT EVIDENCE supports a claim
    CREATE TABLE IF NOT EXISTS pm_evidence (
      evidence_id TEXT PRIMARY KEY,    -- ev_<seq>_<i>
      claim_id    TEXT NOT NULL,
      kind        TEXT,                -- wayback | onchain | url | sha256 | document
      ref         TEXT,
      sha256      TEXT,
      description TEXT,
      attached_seq INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_pm_evidence_claim ON pm_evidence (claim_id);

    -- taxonomy (per-source, preserved as-found)
    CREATE TABLE IF NOT EXISTS pm_category (
      slug        TEXT PRIMARY KEY,
      name        TEXT,
      source_id   TEXT,
      as_of       TEXT,
      taxonomy_note TEXT,
      deprecated  INTEGER DEFAULT 0,
      alias_of    TEXT,
      added_seq   INTEGER
    );

    -- project<->category membership claims (multi-valued; provenance-carrying)
    CREATE TABLE IF NOT EXISTS pm_project_category (
      project_id    TEXT NOT NULL,
      category_slug TEXT NOT NULL,
      source_id     TEXT,
      authority_class TEXT,
      as_of         TEXT,
      state         TEXT,            -- active | superseded
      asserted_seq  INTEGER,
      PRIMARY KEY (project_id, category_slug)
    );

    -- challenge ENTITY only (data model; no moderation workflow/UI in this build)
    CREATE TABLE IF NOT EXISTS pm_challenge (
      challenge_id  TEXT PRIMARY KEY,  -- ch_<seq>
      target_claim_id TEXT,
      target_project_id TEXT,
      actor         TEXT,
      grounds       TEXT,
      state         TEXT,              -- open | resolved
      opened_seq    INTEGER
    );
  `);
}

export function dropProjections() {
  for (const t of PROJECTION_TABLES) db.exec(`DROP TABLE IF EXISTS ${t};`);
}
