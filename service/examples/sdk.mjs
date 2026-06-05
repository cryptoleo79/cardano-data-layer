// Cardano Data Layer — tiny zero-dependency JS SDK.
//
// A thin wrapper over the read-only HTTP API. No deps; uses the global `fetch`
// available in Node 18+ and modern browsers. Every successful body includes the
// `_quality` data-quality block (see ../API.md); this client returns the parsed
// body verbatim so you can read both the data and its provenance.
//
// Usage:
//   import { CardanoDataLayer } from './sdk.mjs';
//   const cdl = new CardanoDataLayer('http://127.0.0.1:8787');
//   const price = await cdl.price('lovelace');
//   console.log(price._quality);            // where the number came from
//
// Run the demo at the bottom:
//   BASE=http://127.0.0.1:8787 node examples/sdk.mjs

export class CardanoDataLayer {
  /** @param {string} [base] Base URL. Defaults to env BASE or local dev. */
  constructor(base = (globalThis.process?.env?.BASE) || 'http://127.0.0.1:8787') {
    this.base = base.replace(/\/+$/, '');
  }

  /**
   * Low-level GET. Throws on network failure; on HTTP >= 400 it returns the
   * parsed error body (which is still envelope-shaped) rather than throwing, so
   * callers can inspect `error`/`_quality`. Pass { throwOnError: true } to opt in.
   */
  async get(path, query = {}, opts = {}) {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    const body = await res.json().catch(() => ({ error: 'invalid_json', status: res.status }));
    if (!res.ok && opts.throwOnError) {
      const err = new Error(`HTTP ${res.status} for ${path}: ${body?.error ?? 'error'}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  // --- System ---
  health() { return this.get('/health'); }
  routes() { return this.get('/routes'); }

  // --- Token ---
  tokenPrice(unit) { return this.get('/token/price', { unit }); }
  tokenOhlcv(unit, { interval = '1h', limit = 100 } = {}) { return this.get('/token/ohlcv', { unit, interval, limit }); }
  tokenMcap(unit) { return this.get('/token/mcap', { unit }); }
  tokensTop({ by = 'mcap', limit = 10 } = {}) { return this.get('/tokens/top', { by, limit }); }
  tokenSearch(q) { return this.get('/token/search', { q }); }
  tokenList() { return this.get('/token/list'); }
  tokenHolders(unit) { return this.get('/token/holders', { unit }); }
  tokenSupply(unit) { return this.get('/token/supply', { unit }); }
  tokenMetadata(unit) { return this.get('/token/metadata', { unit }); }
  /** Merged token detail (metadata + supply + price + holders). */
  token(id) { return this.get(`/token/${encodeURIComponent(id)}`); }

  // --- Market (planned from spec) ---
  price(id) { return this.get(`/price/${encodeURIComponent(id)}`); }
  ohlcv(id, { interval = '1h', limit = 100 } = {}) { return this.get(`/ohlcv/${encodeURIComponent(id)}`, { interval, limit }); }
  markets() { return this.get('/markets'); }
  priceHistory(id, { limit = 100 } = {}) { return this.get(`/price/history/${encodeURIComponent(id)}`, { limit }); }

  // --- NFT ---
  nftStats(policy) { return this.get('/nft/collection/stats', { policy }); }
  nftSales(policy, { page = 1 } = {}) { return this.get('/nft/collection/sales', { policy, page }); }

  // --- Project / Category ---
  projects({ q, limit, offset } = {}) { return this.get('/projects', { q, limit, offset }); }
  projectSearch(q, { limit, offset } = {}) { return this.get('/project/search', { q, limit, offset }); }
  project(id) { return this.get(`/project/${encodeURIComponent(id)}`); }
  history(project) { return this.get(`/history/${encodeURIComponent(project)}`); }
  categories() { return this.get('/categories'); }
  category(slug) { return this.get(`/category/${encodeURIComponent(slug)}`); }

  // --- Governance (planned from spec) ---
  dreps() { return this.get('/dreps'); }
  drep(id) { return this.get(`/dreps/${encodeURIComponent(id)}`); }
  actions({ type, outcome } = {}) { return this.get('/actions', { type, outcome }); }
  action(id) { return this.get(`/actions/${encodeURIComponent(id)}`); }
  votes() { return this.get('/votes'); }
  treasury() { return this.get('/treasury'); }

  // --- Catalyst (planned from spec) ---
  archive() { return this.get('/archive'); }
  funds() { return this.get('/funds'); }
  fund(id) { return this.get(`/fund/${encodeURIComponent(id)}`); }
  proposals() { return this.get('/proposals'); }
}

export default CardanoDataLayer;

// ---------------------------------------------------------------------------
// Usage demo — runs only when this file is executed directly (not on import).
// ---------------------------------------------------------------------------
const isMain = import.meta.url === `file://${globalThis.process?.argv?.[1]}`;
if (isMain) {
  const cdl = new CardanoDataLayer();
  const SNEK = '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b';
  const q = (b) => b?._quality ?? b?.source ?? '(no quality block)';

  console.log(`Cardano Data Layer SDK demo  (base=${cdl.base})\n`);
  try {
    const health = await cdl.health();
    console.log('health        :', health);

    const price = await cdl.tokenPrice(SNEK);
    console.log('\ntoken/price   :', price.price ?? price.error);
    console.log('  _quality    :', q(price));

    const supply = await cdl.tokenSupply(SNEK);
    console.log('\ntoken/supply  :', supply.total_supply ?? supply.error);
    console.log('  source      :', supply.source ?? '(n/a)');

    const projects = await cdl.projects({ limit: 3 });
    console.log('\nprojects(3)   :', (projects.projects ?? []).map((p) => p.id ?? p.name));
    console.log('  _quality    :', q(projects));

    // These may 503 until governance.js/catalyst.js + their exports are present.
    const treasury = await cdl.treasury();
    console.log('\ntreasury      :', treasury.latest_epoch ?? treasury.error ?? '(unavailable)');
  } catch (err) {
    console.error('demo error    :', err.message);
    console.error('Is the server running?  npm start  (default http://127.0.0.1:8787)');
    globalThis.process?.exit?.(1);
  }
}
