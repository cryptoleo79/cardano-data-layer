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
//   GET /project/:id          one project, with per-field provenance + evidence
//   GET /categories           the (per-source, as-found) taxonomy
//   GET /history/:project     the append-only event history for one project

import { initEventStore, eventCount, verifyChain } from '../projectmemory/eventstore.js';
import { initProjections } from '../projectmemory/schema.js';
import { rebuildProjections } from '../projectmemory/reducer.js';
import { seedIfEmpty } from '../projectmemory/seed.js';
import { listProjects, getProject, listCategories, historyForProject } from '../projectmemory/read.js';

const nowIso = () => new Date().toISOString();

export async function init(ctx) {
  initEventStore();        // append-only log + tamper-evident triggers
  initProjections();       // read-model tables
  const seed = seedIfEmpty(); // bootstrap from the archive (events only), once
  const replayed = rebuildProjections(); // derive projections purely from the log
  const chain = verifyChain();
  ctx.log?.(`project-memory: events=${eventCount()} seeded=${seed.seeded} replayed=${replayed} chain_ok=${chain.ok}` +
    (seed.seeded ? ` (cats=${seed.categories} projects=${seed.projects} tokens=${seed.tokens} snapshot=${seed.snapshot})` : ''));
}

async function projectsHandler({ query }) {
  return { status: 200, body: { ...listProjects(query), source: 'project-memory', as_of: nowIso() } };
}

async function projectHandler({ params }) {
  const p = getProject(params.id);
  if (!p) return { status: 404, body: { error: 'not_found', id: params.id } };
  return { status: 200, body: { ...p, source: 'project-memory', as_of: nowIso() } };
}

async function categoriesHandler() {
  return { status: 200, body: { ...listCategories(), source: 'project-memory', as_of: nowIso() } };
}

async function historyHandler({ params }) {
  const h = historyForProject(params.project);
  if (!h.exists && h.count === 0) return { status: 404, body: { error: 'not_found', id: params.project } };
  return { status: 200, body: { project: params.project, count: h.count, events: h.events, source: 'project-memory (event log)', as_of: nowIso() } };
}

export default {
  name: 'project-memory',
  init,
  routes: [
    { method: 'GET', path: '/projects', handler: projectsHandler, meta: { desc: 'list curated projects (read-only)' } },
    { method: 'GET', path: '/project/:id', handler: projectHandler, meta: { desc: 'project with per-field provenance + evidence' } },
    { method: 'GET', path: '/categories', handler: categoriesHandler, meta: { desc: 'per-source taxonomy' } },
    { method: 'GET', path: '/history/:project', handler: historyHandler, meta: { desc: 'append-only event history for a project' } },
  ],
  internals: { verifyChain },
};
