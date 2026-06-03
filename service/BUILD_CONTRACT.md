# Build contract — cardano-data-layer service

Read this before adding a module. The foundation is built and runnable. Your job is to add **one vertical slice** without touching shared files.

## Stack (hard constraints)

- **Node 22 ESM, zero runtime dependencies.** Use only Node built-ins: `node:http` (already wired), `node:sqlite` (via `src/db.js`), global `fetch` (via `src/http.js`). **Do not add npm packages.** Do not add a build step. Files are plain `.js` ESM.
- Run with `npm start` (which is `node src/server.js`). Tests with `node --test`.

## How a module is loaded

`src/server.js` auto-imports every `src/modules/*.js`, calls its optional `init(ctx)`, then registers its `routes`. You only create files; you never edit `server.js` or the router.

A module file **default-exports**:

```js
export default {
  name: 'token',                       // unique short name
  async init(ctx) { /* create tables, start jobs — optional */ },
  routes: [
    { method: 'GET', path: '/token/price', handler: priceHandler, meta: { desc: 'spot price' } },
  ],
};
```

A **handler** is `async ({ req, query, params, ctx }) => ({ status, body, headers? })`:
- `query` — parsed querystring object (all strings).
- `params` — path params (e.g. `/project/:id` → `params.id`).
- `ctx` — `{ db, cache, config, log }` (shared). `ctx.cache.getOrSet(key, ttlMs, fn)` for caching. `ctx.config` is `src/config.js`.
- Return `{ status, body }`. Throw an `UpstreamError` (from `src/http.js`) or any error with a numeric `.status` to produce a clean error response.

## Shared helpers you should use

- `src/http.js` → `fetchJSON(url, { method, headers, body, timeoutMs, retries, source })` and `UpstreamError`.
- `src/db.js` → `db`, plus `run/get/all(sql, ...params)` convenience.
- `src/config.js` → `config.sources.*` base URLs + keys; `config.cache.*` TTLs.
- `src/cache.js` → already instantiated as `ctx.cache`.

## Adapters

Put each upstream client in `src/sources/<name>.js`, exporting plain async functions that return normalized JS objects. Keep adapters dumb (fetch + shape); put policy (caching, fallbacks) in the module. If a source has no configured key, **degrade gracefully**: return `null`/`{ available:false }` and let the module answer `{ status: 503, body: { error:'source_unavailable', source } }` — never crash the server.

## Response conventions

- Every successful body includes a `source` field naming the upstream(s) used and an `as_of` ISO timestamp.
- For derived/low-confidence values (e.g. price of an illiquid token) include `confidence: 'high'|'low'`.
- Money: return both `ada` and `usd` where applicable; if USD unavailable, set `usd: null`.
- Never fabricate. If you can't get a value, return `null` with a `note`, not a guess.

## Scope discipline (from MVP_REPLACEMENT_BLUEPRINT.md)

Build only the assigned routes. Out of scope for the MVP: technical indicators, NFT rarity/traits, DeFi debt, per-asset NFT detail, full wallet PnL. Don't build a TapTools clone — thin proxies for commodity data, real care only on the project/category moat.

## Module assignments

| Module file | Routes | Sources | Notes |
|---|---|---|---|
| `modules/token.js` (+ `sources/minswap.js`, `sources/dexhunter.js`) | `/token/price`, `/token/ohlcv`, `/token/mcap`, `/tokens/top` | Minswap, DexHunter, Koios/Blockfrost (supply) | OHLCV reads from the `ohlcv` table the poller fills; `jobs/ohlcv-poller.js` polls price for `config.poller.units` and inserts candles. |
| `modules/onchain.js` (+ `sources/koios.js`, `sources/blockfrost.js`, `sources/cip26.js`) | `/token/holders`, `/token/supply`, `/token/metadata` | Koios, Blockfrost, CIP-26 | Holders+supply from Koios/Blockfrost; metadata from CIP-26 batch (`POST /metadata/query`) merged with on-chain. |
| `modules/nft.js` (+ `sources/opencnft.js`) | `/nft/collection/stats`, `/nft/collection/sales` | OpenCNFT | Put the source behind a small interface so it's swappable (jpg.store is dead; OpenCNFT could follow). |
| `modules/project.js` (+ `jobs/seed-project-store.js`) | `/categories`, `/category/:slug`, `/projects`, `/project/:id` | local SQLite seeded from `seed/*.json` | **The moat.** Versioned project + category store. `init` creates tables and loads seed if empty. Records carry `source`, `as_of`, and an append-only history. |

## Test

Add a `test/<module>.test.js` using `node --test` that at least asserts each route returns a sane shape against the running router (you can import handlers directly and call them with a fake ctx, or hit the live server). Network-dependent assertions should be resilient/skippable when the upstream is unreachable.
