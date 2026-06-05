# Cardano Data Layer — API reference

Neutral, read-only Cardano data infrastructure. One HTTP API surfaces token
markets, on-chain facts, NFT collections, and four curated **memory layers**
(Project, Governance, Treasury, Catalyst), each labeled with its authority class
and provenance.

- **Read-only.** There are no write paths. Every route is `GET`.
- **No authentication.** The Data Layer itself requires no API key. (Some
  *upstream* sources need keys at the operator side — see
  [Upstream sources & rate limits](#upstream-sources--rate-limits).)
- **Every response carries a data-quality block.** Successful responses from the
  token, market, project, governance, and catalyst modules embed a `_quality`
  object so consumers always know where a value came from, how authoritative and
  fresh it is, and how confident the service is in it.

> Machine-readable spec: [`openapi.json`](./openapi.json) (OpenAPI 3.1).
> Runnable examples: [`examples/curl.sh`](./examples/curl.sh),
> [`examples/sdk.mjs`](./examples/sdk.mjs).

Default base URL for local dev: `http://127.0.0.1:8787`.

## The `_quality` block

```json
"_quality": {
  "source": "dexhunter+minswap",
  "authority_class": "C",
  "refresh": "on-demand",
  "confidence": "high",
  "provenance": "DexHunter aggregate average price (Minswap cross-check); USD derived on-chain via ADA/USDM",
  "as_of": "2026-06-05T00:00:00.000Z"
}
```

| Field | Meaning |
| --- | --- |
| `source` | The upstream(s) that produced the value (e.g. `koios`, `dexhunter+minswap`). |
| `authority_class` | `A` on-chain · `B` official · `C` at-risk platform · `D` community · `E` researcher. |
| `refresh` | `realtime` \| `~1m` \| `~5m` \| `hourly` \| `daily` \| `static` \| `on-demand`. |
| `confidence` | `high` \| `medium` \| `low`. |
| `provenance` | Human-readable description of how the value was derived. |
| `as_of` | ISO 8601 timestamp the response was produced. |

> **Envelope coverage note (honest):** the `token`, `market`, `project`,
> `governance`, and `catalyst` modules wrap responses with the nested `_quality`
> block. The older `nft` and `onchain` modules (`/token/holders`,
> `/token/supply`, `/token/metadata`, `/nft/*`) and the `/tokens/top` handler
> currently emit a **flatter** envelope — top-level `source` + `as_of`, no nested
> `_quality` object. This is the live behavior at the time of writing.

## All endpoints

### System

| Method | Path | Summary |
| --- | --- | --- |
| GET | `/health` | Liveness probe + service identity. |
| GET | `/routes` | List every registered route. |

### Token

| Method | Path | Summary |
| --- | --- | --- |
| GET | `/token/price?unit=` | Spot price (ADA + USD), confidence, source. |
| GET | `/token/ohlcv?unit=&interval=&limit=` | OHLCV candles bucketed on read. |
| GET | `/token/mcap?unit=` | Market cap = price x on-chain supply. |
| GET | `/tokens/top?by=&limit=` | Partial ranking (mcap/volume/liquidity) over a tracked/seed set. |
| GET | `/token/search?q=` | Search tracked/seed tokens + DexHunter. |
| GET | `/token/list` | Known tokens (seed set + tracked units). |
| GET | `/token/holders?unit=` | Holder count + top-N holders (Koios→Blockfrost). |
| GET | `/token/supply?unit=` | Total / circulating supply (Koios→Blockfrost). |
| GET | `/token/metadata?unit=` | Ticker / name / decimals / logo / url (CIP-26→on-chain). |
| GET | `/token/:id` | Merged detail: metadata + supply + price + holder count. |

### Market

> Planned from spec (`market.js` not yet on disk at time of writing).

| Method | Path | Summary |
| --- | --- | --- |
| GET | `/price/:id` | Spot price ADA + USD (DexHunter, Minswap cross-check). |
| GET | `/ohlcv/:id?interval=&limit=` | Candles aggregated from the `ohlcv` table. |
| GET | `/markets` | Market overview: tracked counts + latest tick per unit. |
| GET | `/price/history/:id?limit=` | Raw tick history for a unit. |

### NFT

| Method | Path | Summary |
| --- | --- | --- |
| GET | `/nft/collection/stats?policy=` | Floor / volume / listings / owners / supply (OpenCNFT). |
| GET | `/nft/collection/sales?policy=&page=` | Recent collection sales/trades. |

### Project

| Method | Path | Summary |
| --- | --- | --- |
| GET | `/projects` | List curated projects (read-only). |
| GET | `/project/search?q=` | Substring search over project id/name. |
| GET | `/project/:id` | One project with per-field provenance + evidence. |
| GET | `/history/:project` | Append-only event history for one project. |

### Category

| Method | Path | Summary |
| --- | --- | --- |
| GET | `/categories` | The per-source, as-found taxonomy. |
| GET | `/category/:slug` | One category + its active project assignments. |

### Governance

> Planned from spec (`governance.js` not yet on disk at time of writing).
> Backed by the observatory's CC0 snapshot exports. Missing export → `503`.

| Method | Path | Summary |
| --- | --- | --- |
| GET | `/dreps` | Top DReps from the top30 export. |
| GET | `/dreps/:id` | One DRep by `drep_id`. |
| GET | `/actions?type=&outcome=` | Governance actions. |
| GET | `/actions/:id` | One action by `action_id`. |
| GET | `/votes` | Recent votes (live export). |
| GET | `/treasury` | Treasury snapshot: latest epoch + series + withdrawals. |

### Catalyst

> Planned from spec (`catalyst.js` not yet on disk at time of writing).
> Backed by the chain-of-custody preservation archive. Coverage is **sparse**;
> the service never fabricates proposals. Missing archive → `503`.

| Method | Path | Summary |
| --- | --- | --- |
| GET | `/archive` | Archive `INDEX.json` (subfolders, authority classes, counts). |
| GET | `/funds` | Funds derivable from captured artifacts. |
| GET | `/fund/:id` | Captures relating to one fund id. |
| GET | `/proposals` | Proposals derivable from captures (sparse). |

**Total: 34 endpoints documented** (2 System, 10 Token, 4 Market, 2 NFT,
4 Project, 2 Category, 6 Governance, 4 Catalyst).

---

## Examples

### 1. Health (System)

```bash
curl -s http://127.0.0.1:8787/health
```

```json
{
  "ok": true,
  "service": "cardano-data-layer",
  "version": "0.1.0"
}
```

### 2. Token spot price (Token)

```bash
curl -s "http://127.0.0.1:8787/token/price?unit=279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b"
```

```json
{
  "unit": "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b",
  "price": { "ada": 0.00234, "usd": 0.00103 },
  "confidence": "high",
  "source": "dexhunter+minswap",
  "as_of": "2026-06-05T00:00:00.000Z",
  "_quality": {
    "source": "dexhunter+minswap",
    "authority_class": "C",
    "refresh": "on-demand",
    "confidence": "high",
    "provenance": "DexHunter aggregate average price (Minswap cross-check); USD derived on-chain via ADA/USDM",
    "as_of": "2026-06-05T00:00:00.000Z"
  }
}
```

### 3. Token supply (Token / on-chain proxy — flat envelope)

```bash
curl -s "http://127.0.0.1:8787/token/supply?unit=279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b"
```

```json
{
  "unit": "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b",
  "source": "koios",
  "as_of": "2026-06-05T00:00:00.000Z",
  "total_supply": "76715880000000",
  "circulating_supply": "76715880000000",
  "decimals": 0,
  "mint_count": 1,
  "burn_count": 0,
  "note": "circulating_supply equals on-chain total (minted − burned); excludes treasury/locked tokens which are not knowable on-chain"
}
```

> This route uses the legacy flat envelope (top-level `source` + `as_of`); no
> nested `_quality` block.

### 4. NFT collection stats (NFT — flat envelope)

```bash
curl -s "http://127.0.0.1:8787/nft/collection/stats?policy=40fa2aa67258b4ce7b5782f74831d46a84c59a0ff0c28262fab21728"
```

```json
{
  "policy": "40fa2aa67258b4ce7b5782f74831d46a84c59a0ff0c28262fab21728",
  "floor": { "ada": 1200, "usd": null },
  "volume": { "ada": 9850000, "usd": null },
  "listings": 342,
  "owners": 4871,
  "supply": 9999,
  "note": "usd unavailable: no fiat price source wired into this service",
  "source": "opencnft",
  "as_of": "2026-06-05T00:00:00.000Z"
}
```

### 5. Project detail (Project)

```bash
curl -s http://127.0.0.1:8787/project/minswap
```

```json
{
  "id": "minswap",
  "name": "Minswap",
  "kind": "protocol",
  "status": "active",
  "fields": { "category": { "value": "DEX", "authority_class": "D", "source_id": "cardanocube" } },
  "source": "project-memory",
  "as_of": "2026-06-05T00:00:00.000Z",
  "_quality": {
    "source": "project-memory",
    "authority_class": "D",
    "refresh": "static",
    "confidence": "high",
    "provenance": "Project Memory — event-sourced, seeded from cardano-project-memory-archive",
    "as_of": "2026-06-05T00:00:00.000Z"
  }
}
```

### 6. Treasury snapshot (Governance — planned from spec)

```bash
curl -s http://127.0.0.1:8787/treasury
```

```json
{
  "latest_epoch": 540,
  "epochs": [
    { "epoch": 539, "treasury_ada": 1648200000 },
    { "epoch": 540, "treasury_ada": 1659400000 }
  ],
  "_quality": {
    "source": "governance/treasury-memory",
    "authority_class": "A",
    "refresh": "daily",
    "confidence": "high",
    "provenance": "Governance/Treasury Memory — observatory CC0 export",
    "as_of": "2026-06-05T00:00:00.000Z"
  }
}
```

> If the underlying export file is missing, this route returns `503` with an
> envelope-shaped error body (`confidence: "low"`) rather than crashing.

---

## Upstream sources & rate limits

The Data Layer requires **no auth from clients**. It does, however, proxy and
cache a number of upstream sources. Operators configure keys via environment
(`.env`); rate limits below are the upstream limits the service is designed
around.

| Source | Used for | Access / key | Rate limit (free tier) |
| --- | --- | --- | --- |
| **Koios** | supply, holders, asset_info, on-chain metadata | Free; optional bearer token raises limits | ~5,000 requests/day (free) |
| **Blockfrost** | fallback for supply/holders/metadata | Free project key | ~10 requests/sec (free key) |
| **DexHunter** | DEX-aggregate spot price, token search, OHLCV ticks | Keyed but free | per-key fair-use |
| **Minswap** | price cross-check, liquidity stats | Free | fair-use |
| **CIP-26 token registry** | off-chain token metadata | Free | fair-use |
| **OpenCNFT** | NFT collection stats + sales | Free, **attribution required** | fair-use |
| **Observatory CC0 exports** | DReps, actions, votes, treasury | Local files (CC0) | n/a (read from disk) |
| **Catalyst preservation archive** | archive index, funds, proposals | Local files (chain-of-custody) | n/a (read from disk) |

Notes:

- **Caching.** The service caches upstream responses (per-route TTLs in
  `config.cache`) and can serve a stale value on transient upstream errors, so
  client-side request volume rarely maps 1:1 to upstream calls.
- **Graceful degradation.** When an upstream is unreachable and no cached value
  exists, routes return `4xx`/`503` with an `error` field; the server never
  crashes.
- **No fabrication.** Unknown values are returned as `null` with a `note`. USD
  on NFT routes is always `null` (no fiat oracle wired). USD on token routes is
  derived purely on-chain via the ADA/USDM pair and is `null` when that pair is
  not routable.
- **OpenCNFT attribution.** Consumers surfacing NFT data should credit OpenCNFT.
