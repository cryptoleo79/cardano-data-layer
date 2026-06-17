// project.js — Project Memory (the curated layer / "the moat"), v1.
//
// Event-sourced and READ-ONLY, per PROJECT_MEMORY_IMPLEMENTATION_PLAN.md and
// the PM-BUILD phases. The append-only event log (src/projectmemory/eventstore)
// is the single source of truth; the tables this serves are projections rebuilt
// from that log. Every value is a provenance-bearing claim (who / where / when /
// what evidence), and nothing is ever overwritten or deleted.
//
// This module exposes ONLY reads — there are no write paths. Adding/updating/
// challenging metadata (the governed write side) is deliberately not built yet
// (PROJECT_MEMORY_GOVERNANCE_MODEL.md describes it). The goal here is to prove
// the model end to end: seed from the archive → event log → projections → reads.
//
// Routes:
//   GET /projects             list curated projects
//   GET /project/search?q=    substring search over project id/name
//   GET /category/:slug       one category + its active project assignments
//   GET /categories           the (per-source, as-found) taxonomy
//   GET /history/:project     the append-only event history for one project
//   GET /project/:id          one project, with per-field provenance + evidence

import { initEventStore, eventCount, verifyChain } from '../projectmemory/eventstore.js';
import { initProjections } from '../projectmemory/schema.js';
import { rebuildProjections } from '../projectmemory/reducer.js';
import { seedIfEmpty, seedCardanocubeCategories, seedBocEnrichment, seedCardanocubeEnrichment } from '../projectmemory/seed.js';
import { listProjects, getProject, listCategories, historyForProject } from '../projectmemory/read.js';
import { dq } from '../lib/envelope.js';

const nowIso = () => new Date().toISOString();

// Module-level provenance for the data-quality envelope. Project Memory is
// event-sourced and seeded from the preservation archive; the underlying claims
// are mostly community/curated (Class D, cardanocube) with some at-risk-platform
// rankings (Class C, taptools-wayback) — hence 'mixed'. Honest and simple.
const DQ = {
  source: 'project-memory',
  authority_class: 'D',
  refresh: 'static',
  provenance: 'Project Memory — event-sourced, seeded from cardano-project-memory-archive',
};
const wrap = (body, extra) => dq({ ...body, as_of: nowIso() }, { ...DQ, ...extra });

export async function init(ctx) {
  initEventStore();        // append-only log + tamper-evident triggers
  initProjections();       // read-model tables
  const seed = seedIfEmpty(); // bootstrap from the archive (events only), once
  rebuildProjections();       // build projections so the category import can see existing projects
  // Incremental, idempotent: import cardanocube per-category assignments for the
  // categories Built-on-Cardano doesn't cover (appends to the existing log).
  const cc = seedCardanocubeCategories();
  // Incremental, idempotent: enrich projects with sourced external links
  // (website/github/documentation/whitepaper) from Built on Cardano.
  const en = seedBocEnrichment();
  // Incremental, idempotent: enrich the cardanocube-origin projects (the ones
  // Built on Cardano doesn't cover) with sourced external links harvested from
  // their preserved cardanocube project pages.
  const ce = seedCardanocubeEnrichment();
  const replayed = rebuildProjections(); // re-derive projections from the full log
  const chain = verifyChain();
  ctx.log?.(`project-memory: events=${eventCount()} seeded=${seed.seeded} replayed=${replayed} chain_ok=${chain.ok}` +
    (seed.seeded ? ` (cats=${seed.categories} projects=${seed.projects} tokens=${seed.tokens} snapshot=${seed.snapshot})` : '') +
    (cc.ran ? ` (cardanocube-cats: assigned=${cc.assigned} new_projects=${cc.newProjects} deprecated=${cc.deprecated})` : ` (cardanocube-cats: ${cc.reason})`) +
    (en.ran ? ` (boc-enrich: claims=${en.claims} web=${en.website} gh=${en.github} docs=${en.documentation} wp=${en.whitepaper})` : ` (boc-enrich: ${en.reason})`) +
    (ce.ran ? ` (cc-enrich: claims=${ce.claims} web=${ce.website} gh=${ce.github} docs=${ce.documentation} wp=${ce.whitepaper})` : ` (cc-enrich: ${ce.reason})`));
}

async function projectsHandler({ query }) {
  return { status: 200, body: wrap({ ...listProjects(query), source: 'project-memory' }) };
}

// Literal route — MUST be registered before /project/:id so 'search' is not an id.
async function projectSearchHandler({ query }) {
  const q = (query.q || '').trim();
  if (!q) {
    return { status: 200, body: wrap({ q: '', total: 0, count: 0, projects: [], source: 'project-memory' }) };
  }
  const res = listProjects({ q, limit: query.limit ?? 100, offset: query.offset ?? 0 });
  return { status: 200, body: wrap({ q, ...res, source: 'project-memory' }) };
}

async function projectHandler({ params }) {
  const p = getProject(params.id);
  if (!p) return { status: 404, body: wrap({ error: 'not_found', id: params.id }, { confidence: 'low' }) };
  return { status: 200, body: wrap({ ...p, source: 'project-memory' }) };
}

async function categoriesHandler() {
  const base = listCategories();
  // Explicit per-category coverage status so there is no ambiguity (every
  // category is populated, pending, or deprecated — never silently empty).
  const categories = base.categories.map((c) => ({
    ...c,
    status: c.deprecated ? 'deprecated' : (c.project_count > 0 ? 'populated' : 'pending'),
  }));
  const summary = {
    populated: categories.filter((c) => c.status === 'populated').length,
    pending: categories.filter((c) => c.status === 'pending').length,
    deprecated: categories.filter((c) => c.status === 'deprecated').length,
  };
  return { status: 200, body: wrap({ ...base, categories, coverage: summary, source: 'project-memory' }) };
}

// One category + its active project assignments, read inline from the projection
// tables via ctx.db (read.js is owned by another concern; we don't extend it).
async function categoryHandler({ params, ctx }) {
  const slug = params.slug;
  const cat = ctx.db.prepare('SELECT * FROM pm_category WHERE slug = ?').get(slug);
  if (!cat) return { status: 404, body: wrap({ error: 'not_found', slug }, { confidence: 'low' }) };

  const members = ctx.db.prepare(
    `SELECT p.id, p.kind, p.name, p.status, p.unclassified,
            pc.authority_class, pc.as_of, pc.source_id
       FROM pm_project_category pc
       JOIN pm_project p ON p.id = pc.project_id
      WHERE pc.category_slug = ? AND pc.state = 'active'
      ORDER BY p.id`,
  ).all(slug);

  const body = {
    category: {
      slug: cat.slug,
      name: cat.name,
      deprecated: !!cat.deprecated,
      alias_of: cat.alias_of,
      source_id: cat.source_id,
      as_of: cat.as_of,
      taxonomy_note: cat.taxonomy_note,
    },
    project_count: members.length,
    projects: members.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      status: r.status,
      unclassified: !!r.unclassified,
      assignment: { authority_class: r.authority_class, as_of: r.as_of, source_id: r.source_id },
    })),
    source: 'project-memory',
  };
  return { status: 200, body: wrap(body) };
}

async function historyHandler({ params }) {
  const h = historyForProject(params.project);
  if (!h.exists && h.count === 0) return { status: 404, body: wrap({ error: 'not_found', id: params.project }, { confidence: 'low' }) };
  return { status: 200, body: wrap({ project: params.project, count: h.count, events: h.events, source: 'project-memory (event log)' }) };
}

export default {
  name: 'project-memory',
  init,
  // Ordering is load-bearing: literal routes before the parameterized catch-all.
  // /project/search before /project/:id; /category/:slug + /categories before /project/:id.
  routes: [
    { method: 'GET', path: '/projects', handler: projectsHandler, meta: { desc: 'list curated projects (read-only)' } },
    { method: 'GET', path: '/project/search', handler: projectSearchHandler, meta: { desc: 'substring search over project id/name' } },
    { method: 'GET', path: '/category/:slug', handler: categoryHandler, meta: { desc: 'one category + its active project assignments' } },
    { method: 'GET', path: '/categories', handler: categoriesHandler, meta: { desc: 'per-source taxonomy' } },
    { method: 'GET', path: '/history/:project', handler: historyHandler, meta: { desc: 'append-only event history for a project' } },
    { method: 'GET', path: '/project/:id', handler: projectHandler, meta: { desc: 'project with per-field provenance + evidence' } },
  ],
  internals: { verifyChain },
};
