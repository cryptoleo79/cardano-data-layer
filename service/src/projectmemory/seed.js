// Project Memory — seed (PM-BUILD-5).
//
// Bootstraps the layer by EMITTING EVENTS (never by writing projections), so the
// event log remains the source of truth and projections rebuild from it. The
// seed imports, with chain-of-custody preserved on every claim:
//   - cardanocube taxonomy (74 categories)         -> source cardanocube (D)
//   - cardanocube graveyard projects (defunct)     -> source cardanocube (D), evidence = archive wayback+sha
//   - preserved TapTools historical rankings        -> source taptools-wayback (C), evidence = archive wayback+sha
//
// No manual editing: every value traces to an archived artifact. Seeds only when
// the log is empty (idempotent at the bootstrap level).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.js';
import { db } from '../db.js';
import { append, eventCount } from './eventstore.js';

const ARCHIVE = process.env.CDL_ARCHIVE || join(homedir(), 'cardano-project-memory-archive');
const ACTOR = 'machine:seed';

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }

// Pull the ranked "# N TICKER" list out of a preserved TapTools ranking-grid snapshot.
function parseTapToolsRanks(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&');
  const out = [];
  const seen = new Set();
  const re = /#\s*(\d{1,3})\s+([A-Za-z][A-Za-z0-9]{1,11})\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const rank = Number(m[1]);
    const ticker = m[2];
    if (rank < 1 || rank > 100 || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push({ rank, ticker });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

// Find the content-bearing charts snapshot with the most ranked entries.
function bestTapToolsSnapshot() {
  const dir = join(ARCHIVE, 'taptools-via-wayback', 'rankings', 'charts');
  if (!existsSync(dir)) return null;
  let best = null;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.html')) continue;
    const custodyPath = join(dir, `${f}.custody.json`);
    if (!existsSync(custodyPath)) continue;
    const ranks = parseTapToolsRanks(readFileSync(join(dir, f), 'utf8'));
    if (!best || ranks.length > best.ranks.length) {
      best = { file: f, custody: readJson(custodyPath), ranks };
    }
  }
  return best && best.ranks.length ? best : null;
}

export function seedIfEmpty() {
  if (eventCount() > 0) return { seeded: false, reason: 'log not empty' };

  let categories = 0, projects = 0, tokens = 0;

  // --- sources ---
  append('source.registered', { actor: ACTOR, payload: {
    source_id: 'cardanocube', kind: 'cardanocube', authority_class: 'D',
    url: 'https://cardanocube.com', label: 'CardanoCube community directory' } });
  append('source.registered', { actor: ACTOR, payload: {
    source_id: 'taptools-wayback', kind: 'taptools-wayback', authority_class: 'C',
    url: 'https://taptools.io', label: 'TapTools (preserved via Wayback Machine)' } });

  // --- cardanocube taxonomy ---
  const catFile = join(config.seedDir, 'categories.json');
  if (existsSync(catFile)) {
    const cj = readJson(catFile);
    for (const c of cj.categories) {
      append('category.added', { actor: ACTOR, ts: c.as_of, payload: {
        slug: c.slug, name: c.name, source_id: 'cardanocube', as_of: c.as_of, taxonomy_note: c.taxonomy_note } });
      categories++;
    }
  }

  // --- cardanocube graveyard projects (defunct), with chain-of-custody ---
  const projFile = join(config.seedDir, 'projects.json');
  if (existsSync(projFile)) {
    const pj = readJson(projFile);
    for (const p of pj.projects) {
      const evidence = [];
      if (p.archived_wayback_url) {
        evidence.push({ kind: 'wayback', ref: p.archived_wayback_url, sha256: p.archived_sha256 || null,
          description: 'Archived editorial profile (chain-of-custody from cardano-project-memory-archive)' });
      }
      append('project.imported', { actor: ACTOR, subject: p.id, ts: p.as_of, payload: { id: p.id, kind: 'project' } });
      append('claim.asserted', { actor: ACTOR, subject: p.id, ts: p.as_of, payload: {
        project_id: p.id, field: 'name', value: p.name, source_id: 'cardanocube', authority_class: 'D',
        as_of: p.as_of, asserted_by: ACTOR, evidence } });
      append('claim.asserted', { actor: ACTOR, subject: p.id, ts: p.as_of, payload: {
        project_id: p.id, field: 'status', value: 'defunct', source_id: 'cardanocube', authority_class: 'D',
        as_of: p.as_of, asserted_by: ACTOR, evidence,
        // status provenance note: cardanocube /projects/graveyard listing
      } });
      projects++;
    }
  }

  // --- preserved TapTools historical rankings, with chain-of-custody ---
  const tt = bestTapToolsSnapshot();
  if (tt) {
    const asOf = `${tt.custody.capture_date || ''}` || null;
    const evidence = [{ kind: 'wayback', ref: tt.custody.wayback_url, sha256: tt.custody.sha256 || null,
      description: `TapTools ranking-grid snapshot ${tt.file} (chain-of-custody from cardano-project-memory-archive)` }];
    for (const { rank, ticker } of tt.ranks) {
      const id = `tt:${ticker}`;
      append('project.imported', { actor: ACTOR, subject: id, ts: asOf, payload: { id, kind: 'token' } });
      append('claim.asserted', { actor: ACTOR, subject: id, ts: asOf, payload: {
        project_id: id, field: 'ticker', value: ticker, source_id: 'taptools-wayback', authority_class: 'C',
        as_of: asOf, asserted_by: ACTOR, evidence } });
      append('claim.asserted', { actor: ACTOR, subject: id, ts: asOf, payload: {
        project_id: id, field: 'rank', value: rank, source_id: 'taptools-wayback', authority_class: 'C',
        as_of: asOf, asserted_by: ACTOR, evidence } });
      tokens++;
    }
  }

  // --- Built on Cardano directory: projects + category assignments ---
  let boc = 0, bocAssign = 0;
  const bocFile = join(config.seedDir, 'builtoncardano-projects.json');
  if (existsSync(bocFile)) {
    const bj = readJson(bocFile);
    append('source.registered', { actor: ACTOR, payload: {
      source_id: 'builtoncardano', kind: 'builtoncardano', authority_class: 'B',
      url: bj.source_url, label: 'Built on Cardano directory (Cardano Foundation)' } });
    const ev = [{ kind: 'url', ref: bj.source_url,
      description: 'Listed in the Built on Cardano ecosystem directory (Cardano Foundation curation)' }];
    const mk = (id, field, value) => append('claim.asserted', { actor: ACTOR, subject: id, ts: bj.as_of, payload: {
      project_id: id, field, value, source_id: 'builtoncardano', authority_class: 'B', as_of: bj.as_of, asserted_by: ACTOR, evidence: ev } });
    for (const p of bj.projects) {
      append('project.imported', { actor: ACTOR, subject: p.id, ts: bj.as_of, payload: { id: p.id, kind: 'project' } });
      mk(p.id, 'name', p.name);
      if (p.link) mk(p.id, 'website', p.link);
      if (p.description) mk(p.id, 'description', p.description);
      mk(p.id, 'status', p.status);
      for (const slug of p.categories) {
        append('category.assigned', { actor: ACTOR, subject: p.id, ts: bj.as_of, payload: {
          project_id: p.id, category_slug: slug, source_id: 'builtoncardano', authority_class: 'B',
          as_of: bj.as_of, confidence: 'high', evidence: ev } });
        bocAssign++;
      }
      boc++;
    }
  }

  return { seeded: true, sources: 3, categories, projects, tokens, boc, bocAssign, snapshot: tt?.file || null };
}

/**
 * Enrich existing projects with sourced external links (website / github /
 * documentation / whitepaper) from the Built on Cardano ecosystem directory.
 * Every value is a real link the directory itself publishes — nothing is guessed
 * or inferred. Audit links are deliberately NOT added: the source does not expose
 * them, and we never fabricate. Appends to the existing log; idempotent via a
 * 'via' marker. Returns counts.
 */
export function seedBocEnrichment() {
  const file = join(config.seedDir, 'builtoncardano-enrichment.json');
  if (!existsSync(file)) return { ran: false, reason: 'no seed file' };

  // Incremental: collect the (project_id, field) pairs already imported via this
  // enrichment so re-running with an EXPANDED seed only appends the new ones
  // (and re-imports never duplicate). The 'via' marker lives in the event
  // payload, so we read it from the log.
  const done = new Set();
  for (const row of db.prepare(
    "SELECT payload FROM pm_event WHERE type='claim.asserted' AND payload LIKE '%\"via\":\"boc-enrichment\"%'",
  ).all()) {
    try { const p = JSON.parse(row.payload); done.add(`${p.project_id} ${p.field}`); } catch { /* skip */ }
  }

  const ej = readJson(file);
  const asOf = ej.as_of;
  const evidence = [{ kind: 'url', ref: ej.source_url, sha256: ej.sha256 || null,
    description: 'Built on Cardano ecosystem directory (Cardano Foundation curation), captured listing' }];
  const FIELDS = ['website', 'github', 'documentation', 'whitepaper'];
  let claims = 0;
  const counts = { website: 0, github: 0, documentation: 0, whitepaper: 0 };
  for (const p of ej.projects || []) {
    if (!p.id) continue;
    for (const f of FIELDS) {
      const v = p[f];
      if (!v || done.has(`${p.id} ${f}`)) continue;
      append('claim.asserted', { actor: ACTOR, subject: p.id, ts: asOf, payload: {
        project_id: p.id, field: f, value: v, source_id: 'builtoncardano', authority_class: 'B',
        as_of: asOf, asserted_by: ACTOR, confidence: 'high', via: 'boc-enrichment', evidence } });
      claims++; counts[f]++;
    }
  }
  return { ran: claims > 0, claims, ...counts };
}

/**
 * Enrich existing projects with sourced external links from cardanocube project
 * pages — the cardanocube-origin projects (bare-slug ids) that the Built on
 * Cardano directory does not cover. Each link is verbatim from a cardanocube
 * project page preserved via the Wayback Machine; the seed file records, per
 * project, the raw id_ snapshot URL and the SHA-256 of the exact captured bytes,
 * which become the claim's chain-of-custody evidence. Social links and audit
 * links are NOT imported (the page exposes the former as social-only and the
 * latter not at all); nothing is fabricated. Appends to the existing log and is
 * idempotent via a 'via:cardanocube-enrichment' marker. Returns counts.
 */
export function seedCardanocubeEnrichment() {
  const file = join(config.seedDir, 'cardanocube-enrichment.json');
  if (!existsSync(file)) return { ran: false, reason: 'no seed file' };

  // Incremental: skip (project_id, field) pairs already imported by this enrichment.
  const done = new Set();
  for (const row of db.prepare(
    "SELECT payload FROM pm_event WHERE type='claim.asserted' AND payload LIKE '%\"via\":\"cardanocube-enrichment\"%'",
  ).all()) {
    try { const p = JSON.parse(row.payload); done.add(`${p.project_id} ${p.field}`); } catch { /* skip */ }
  }

  const ej = readJson(file);
  const asOf = ej.as_of;
  const FIELDS = ['website', 'github', 'documentation', 'whitepaper'];
  let claims = 0;
  const counts = { website: 0, github: 0, documentation: 0, whitepaper: 0 };
  for (const p of ej.projects || []) {
    if (!p.id) continue;
    // Per-project evidence: the exact snapshot we read these links from.
    const ev = p.evidence || {};
    const evidence = [{ kind: 'wayback', ref: ev.wayback_url || ej.source_url, sha256: ev.sha256 || null,
      description: `cardanocube project page for "${p.id}" (chain-of-custody from the Wayback Machine; SHA-256 of the captured bytes)` }];
    for (const f of FIELDS) {
      const v = p[f];
      if (!v || done.has(`${p.id} ${f}`)) continue;
      append('claim.asserted', { actor: ACTOR, subject: p.id, ts: asOf, payload: {
        project_id: p.id, field: f, value: v, source_id: 'cardanocube', authority_class: 'D',
        as_of: asOf, asserted_by: ACTOR, confidence: 'medium', via: 'cardanocube-enrichment', evidence } });
      claims++; counts[f]++;
    }
  }
  return { ran: claims > 0, claims, ...counts };
}

// Humanize a cardanocube project slug into a display name ("rejuve-ai" -> "Rejuve Ai").
function humanizeSlug(slug) {
  return slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

/**
 * Import cardanocube per-category project assignments — the 13 categories the
 * Built-on-Cardano directory doesn't cover (ai, infrastructure, governance, …).
 * Every assignment traces to a preserved cardanocube category page (Wayback URL
 * + SHA-256), authority class D. Unlike seedIfEmpty this runs against a NON-empty
 * log: it only appends, and is idempotent (a 'via' marker on the events means a
 * re-run is a no-op). Categories the source has dropped (e.g. a 404'd category)
 * are recorded as category.deprecated rather than fabricated. Returns counts.
 */
export function seedCardanocubeCategories() {
  const file = join(config.seedDir, 'cardanocube-categories.json');
  if (!existsSync(file)) return { ran: false, reason: 'no seed file' };
  // Idempotency: if we already imported this batch, do nothing.
  const already = db.prepare(
    "SELECT 1 FROM pm_event WHERE type IN ('category.assigned','category.deprecated') AND payload LIKE '%\"via\":\"cardanocube-categories\"%' LIMIT 1",
  ).get();
  if (already) return { ran: false, reason: 'already imported' };

  const cj = readJson(file);
  const asOf = cj.as_of;
  let assigned = 0, deprecated = 0, newProjects = 0;
  for (const c of cj.categories || []) {
    if (c.deprecated) {
      append('category.deprecated', { actor: ACTOR, ts: asOf, payload: {
        slug: c.slug, source_id: 'cardanocube', reason: c.note || 'removed from source taxonomy', via: 'cardanocube-categories' } });
      deprecated++;
      continue;
    }
    if (!c.projects || !c.projects.length) continue;
    const evidence = [{ kind: 'wayback', ref: c.wayback_url, sha256: c.sha256 || null,
      description: `cardanocube /categories/${c.slug} listing (chain-of-custody from the Wayback Machine)` }];
    for (const pid of c.projects) {
      const had = db.prepare('SELECT 1 FROM pm_project WHERE id = ?').get(pid);
      append('project.imported', { actor: ACTOR, subject: pid, ts: asOf, payload: { id: pid, kind: 'project' } });
      if (!had) {
        append('claim.asserted', { actor: ACTOR, subject: pid, ts: asOf, payload: {
          project_id: pid, field: 'name', value: humanizeSlug(pid), source_id: 'cardanocube', authority_class: 'D',
          as_of: asOf, asserted_by: ACTOR, evidence, note: 'display name derived from the cardanocube project slug' } });
        newProjects++;
      }
      append('category.assigned', { actor: ACTOR, subject: pid, ts: asOf, payload: {
        project_id: pid, category_slug: c.slug, source_id: 'cardanocube', authority_class: 'D',
        as_of: asOf, confidence: 'medium', via: 'cardanocube-categories', evidence } });
      assigned++;
    }
  }
  return { ran: true, assigned, deprecated, newProjects };
}
