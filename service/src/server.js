// HTTP server. Zero external deps: node:http + the tiny Router.
// Auto-discovers every module in src/modules/*.js, runs its optional init(ctx),
// and registers its routes. Adding a feature = dropping a file in modules/.

import http from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { TtlCache } from './cache.js';
import { Router } from './router.js';
import { config } from './config.js';
import { db } from './db.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);
const ctx = { db, cache: new TtlCache(), config, log };
const STARTED = Date.now();

const router = new Router();

// --- built-in routes (first-class deployment endpoints) ---
router.add('GET', '/health', async () => ({
  status: 200,
  body: { ok: true, service: 'cardano-data-layer', version: '0.1.0', uptime_s: Math.floor((Date.now() - STARTED) / 1000), routes: router.list().length, time: new Date().toISOString() },
}));
router.add('GET', '/routes', async () => ({ status: 200, body: { routes: router.list() } }));

// /openapi.json — the OpenAPI 3.1 spec, served verbatim.
const openapiPath = new URL('../openapi.json', import.meta.url);
router.add('GET', '/openapi.json', async () => {
  try {
    const s = await readFile(openapiPath, 'utf8');
    return { status: 200, body: s, headers: { 'content-type': 'application/json; charset=utf-8' } };
  } catch { return { status: 404, body: { error: 'openapi_not_found' } }; }
});

// /docs — the human documentation landing page.
const docsPath = new URL('../public/docs.html', import.meta.url);
router.add('GET', '/docs', async () => {
  try {
    const s = await readFile(docsPath, 'utf8');
    return { status: 200, body: s, headers: { 'content-type': 'text/html; charset=utf-8' } };
  } catch { return { status: 404, body: { error: 'docs_not_found' } }; }
});
// '/' redirects to the docs.
router.add('GET', '/', async () => ({ status: 302, body: '', headers: { location: '/docs' } }));

// --- auto-load modules ---
const modulesDir = new URL('./modules/', import.meta.url);
const loaded = [];
try {
  const files = (await readdir(modulesDir)).filter((f) => f.endsWith('.js'));
  for (const f of files.sort()) {
    const mod = (await import(new URL(f, modulesDir))).default;
    if (!mod || !Array.isArray(mod.routes)) { log('skip (no routes export):', f); continue; }
    if (typeof mod.init === 'function') {
      try { await mod.init(ctx); } catch (e) { log(`module ${mod.name} init failed:`, e.message); }
    }
    for (const r of mod.routes) router.add(r.method, r.path, r.handler, { module: mod.name, ...(r.meta || {}) });
    loaded.push(`${mod.name}(${mod.routes.length})`);
  }
} catch (e) {
  log('module load error:', e.message);
}
log('loaded modules:', loaded.join(', ') || '(none yet)');

// --- request dispatch ---
function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', ...headers });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { return send(res, 400, { error: 'bad_request' }); }

  const found = router.match(req.method, url.pathname);
  if (!found) return send(res, 404, { error: 'not_found', path: url.pathname });

  const query = Object.fromEntries(url.searchParams.entries());
  try {
    const result = await found.route.handler({ req, query, params: found.params, ctx });
    const { status = 200, body = {}, headers = {} } = result || {};
    send(res, status, body, headers);
    log(req.method, url.pathname, status, `${Date.now() - started}ms`);
  } catch (err) {
    const status = err && Number.isInteger(err.status) ? err.status : 500;
    send(res, status, { error: status >= 500 ? 'internal_error' : 'upstream_error', message: err?.message, source: err?.source });
    log(req.method, url.pathname, status, `${Date.now() - started}ms`, 'ERR', err?.message);
  }
});

server.listen(config.port, config.host, () => {
  log(`cardano-data-layer listening on http://${config.host}:${config.port}`);
});

export { server, ctx, router };
