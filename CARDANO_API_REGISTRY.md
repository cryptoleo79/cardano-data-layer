# Cardano API Registry

**Status:** research synthesis, v1. **Date:** 2026-06-05.
**Purpose:** Inventory every useful Cardano data API, classified **LIVE / PARTIAL / MISSING**, with — per source — endpoints, data available, rate limits, cost, license, reliability, and replacement difficulty. The map of what Cardano data exists, where it comes from, and what gaps remain.
**Companion:** `CARDANO_API_GAP_ANALYSIS.md` (what disappears / unique vs reproducible / what we should provide).
**Method note:** Compiled from a five-stream parallel research pass (web-verified against official docs). Some commercial/JS-rendered specifics could not be machine-fetched and are flagged **(unverified)** inline rather than guessed.

Status legend: **LIVE** = public API works today · **PARTIAL** = some data via API but incomplete/undocumented/gated · **MISSING** = no public API (website-only or gone).
Authority classes (METHODOLOGY §24.3): **A** on-chain · **B** official · **C** at-risk platform · **D** community · **E** researcher.

---

## Master status board

| Source | Domain(s) | Status | Auth class | Cost headline |
|---|---|---|---|---|
| Koios | Token, NFT, Governance, on-chain | **LIVE** | A/B | Free 5k–50k/day; Pro ~$30/mo |
| Blockfrost | Token, NFT, Governance, on-chain | **LIVE** | A/B | Free 50k/day; paid tiers |
| CardanoScan | Token, on-chain, (gov partial) | **PARTIAL** | B | Free key + Pro (quote) |
| cardano-db-sync / GraphQL | everything (self-host) | **LIVE** (self-host) | A | Infra cost only |
| DexHunter | Token price/OHLCV, DEX | **LIVE** | C | Keyed, free for devs (unverified) |
| Minswap | Token price/OHLCV/mcap, DEX | **LIVE** | C | Free, public |
| Charli3 Price API | Token price/OHLCV (17k tokens) | **LIVE** | C | Key (pricing unverified) |
| DefiLlama | DEX volume/TVL, project category | **PARTIAL** (Cardano token-level) | D | Free; Pro $300/mo |
| TapTools | Token+NFT+wallet (widest) | **LIVE — SUNSETTING** | C | Paid-only; **API dies ~mid-June 2026** |
| OpenCNFT | NFT floor/volume/sales/rankings | **LIVE** | D | Free + attribution |
| JPG Store API | NFT marketplace data | **MISSING** | — | Platform sunset 2026-05-23 |
| cnft.tools | NFT rarity/floor | **PARTIAL** | D | Undocumented, no ToS |
| NMKR | NFT minting/issuance | **LIVE** | D | Keyed/paid (minting-oriented) |
| CardanoCube | Project metadata/categories | **MISSING** (website-only) | D | Free view; **all rights reserved** |
| Built on Cardano | Project metadata/tags | **PARTIAL** | D | Free, **1000 req/day total** |
| Developer Portal Showcase | Project metadata | **PARTIAL** (MIT git data) | B | Free (MIT) |
| adastack.io | Project directory | **MISSING** (live closed; archive stale) | D | — |
| CIP-72 / CRFA registry | Project metadata (on-chain/registry) | **emerging** | B/D | Free (MIT) |
| gov.tools (GovTool) | Governance + off-chain proposals | **PARTIAL** | A/B | Free (self-host) |
| SyncGovHub | Governance (AI rationale) | **PARTIAL** | C | Free tier (60/min) |
| 1694.io / AdaStat / Cexplorer | Governance explorers | **PARTIAL** (UI-only) | C/D | Free UI |
| projectcatalyst.io | Catalyst funds/results | **PARTIAL** (no API) | B | Free (web/files) |
| Catalyst Explorer (Lidonation) | Catalyst (all) | **PARTIAL→LIVE** | B/D | Free (Apache-2.0) |
| IdeaScale | Catalyst historical proposals | **PARTIAL (at-risk)** | C | Key + admin-token-gated |

---

## 1. On-chain / infrastructure

### Koios — **LIVE** (A/B) — `https://api.koios.rest/api/v1`
Decentralised, community-run REST over `cardano-db-sync` (multiple SPO instances + failover). Broadest governance coverage of any hosted API.

| Endpoint group | Data | Rate limits | Cost | License | Reliability | Replacement diff. |
|---|---|---|---|---|---|---|
| Asset (`/asset_info`, `/asset_addresses`, `/asset_token_registry`, `/asset_history`, `/asset_summary`) | Token/NFT info, **CIP-26 metadata passthrough**, supply, mint/burn, **per-asset holder list** | tiered | free tiers | open-source; public data (explicit redistribution clause unverified) | high (multi-instance) | medium (db-sync self-host) |
| Address/Account | balances, UTxOs, asset holdings, tx history, stake | tiered | free | same | high | medium |
| **Governance** (`/drep_list`, `/drep_info`, `/drep_metadata`, `/drep_votes`, `/drep_delegators`, `/proposal_list`, `/proposal_voting_summary`, `/vote_list`, `/committee_info`, `/pool_votes`, `/treasury_withdrawals`, `/totals`) | Full Conway governance: DReps, proposals/actions, votes, committee, treasury/reserve pots (CIP-129 IDs) | tiered | free | same | high | medium (db-sync ≥13.2) |
| Pool/Epoch/Block/Tx | pools, epoch params, blocks, tip, tx info/submit | tiered | free | same | high | medium |

Tiers (verified koios.rest/pricing): Public 5,000/day no key (30s timeout); Free 50,000/day wallet-signed token; Pro 500,000/day ~$29.99/mo **(unverified)**; Premium 1.2M/day ~$74.99/mo **(unverified)**; Custom contact. Treasury = derived (`/totals` + proposal endpoints), no single endpoint.

### Blockfrost — **LIVE** (A/B) — `https://cardano-mainnet.blockfrost.io/api/v0`
Hosted commercial; best DX, OpenAPI-specified, strongest free request volume.

| Endpoint group | Data | Rate limits | Cost | License | Reliability | Replacement diff. |
|---|---|---|---|---|---|---|
| Assets (`/assets`, `/assets/{a}`, `/assets/{a}/addresses`, `/assets/{a}/history`) | token/NFT, **CIP-26 + CIP-68 metadata**, supply, **holder addresses** | 10 req/s + 500 burst | free tier | commercial ToS (redistribution restricted) | high | hard |
| Governance (`/governance/dreps*`, `/governance/proposals*`) | DRep list/detail/delegators/metadata/updates/votes; proposals (incl. treasury withdrawals), committee | 10 req/s + 500 burst | free | commercial ToS | high | hard |
| Addresses/Accounts/Blocks/Epochs/Pools/Tx/Metadata/IPFS | full chain primitives + IPFS pinning | 10 req/s + 500 burst | free + paid | commercial ToS | high | hard (IPFS) |

Pricing: STARTER free forever **50,000 req/day**, no card; 10 req/s, 500 burst. DEVELOPER/ENTERPRISE prices **(unverified — behind dashboard)**; Pay-As-You-Go (incl. ADA) offered.

### CardanoScan — **PARTIAL** (B) — `https://api.cardanoscan.io/api/v1`
Explorer-backed (StricaHQ). Strong explorer lookups; governance shallow; pricing opaque.

| Endpoint group | Data | Rate limits | Cost | License | Reliability | Replacement diff. |
|---|---|---|---|---|---|---|
| Asset / Address / Transaction / Block / Pool | asset info+supply, balances, tx (incl. DRep delegation fields), blocks, pools | per-plan (undocumented) | free key + Pro (quote) | commercial ToS | established | hard (closed) |
| Governance | DRep delegation at tx level; full DRep/action/vote listing **unconfirmed** | per-plan | Pro-gated | commercial ToS | established | hard |

Free-tier req/s + req/day and Pro USD pricing **not published** (docs 403 to fetchers; Pro is quote-based). SDK: `StricaHQ/cardanoscan-python`.

### Alternatives — **LIVE (self-host)** (A)
- **cardano-db-sync** (IOG) — the Postgres source Koios/Blockfrost wrap. Everything (tokens, holders, full Conway governance tables) with no rate limits or data-license restriction, at the cost of a full node + large DB. The canonical replacement target.
- **Cardano GraphQL** (CF) — GraphQL over db-sync; maintained, heavier to run.
- **Maestro** (gomaestro.org) — commercial managed UTxO API, DeFi tooling; free tier + paid **(limits/pricing unverified)**.
- **Ogmios** — WebSocket JSON-RPC to a node (chain-sync/tx-submit/state-query); low-level building block, not indexed REST.

---

## 2. DeFi / market data

### Minswap — **LIVE** (C) — `https://api-mainnet-prod.minswap.org`
Public, no auth. Strongest **free** replacement for TapTools price/OHLCV/mcap on the dominant Cardano DEX.

| Endpoint | Data | Rate limits | Cost | License | Reliability | Replacement diff. |
|---|---|---|---|---|---|---|
| `/v1/assets`, `/v1/assets/metrics`, `/v1/assets/:id/metrics` | price, 24h/7d volume, liquidity, **market cap, supply**, price change | 429 on excess (numbers undocumented) | free/public | not documented | high (core DEX) | n/a (primary) |
| `/v1/assets/:id/price/candlestick`, `/price/timeseries` | **OHLCV candles**, historical price | 429 | free | — | high | n/a |
| `/v1/pools/metrics`, pool timeseries | liquidity, volume, fees, APR, TVL | 429 | free | — | high | n/a |
| Aggregator API | best swap routes + price across DEXes | — | free | — | high | medium |

Coverage Minswap-centric (good proxy, not all-DEX). Notably exposes mcap+supply (narrows the hardest TapTools gap).

### DexHunter — **LIVE** (C) — `https://api-us.dexhunterv3.app` (+ `charts.dhapi.io`)
DEX **aggregator** (15+ DEXes). Best cross-DEX spot price; the strongest single price replacement. Auth `X-Partner-Id`.

| Endpoint | Data | Rate limits | Cost | License | Reliability | Replacement diff. |
|---|---|---|---|---|---|---|
| `/swap/averagePrice/ADA/{id}`, `/swap/adaValue` | aggregated ADA price, ADA→USD | undocumented | keyed; "free for devs" (per Catalyst proposal, not ToS) | proprietary; no redistribution grant stated | high | n/a |
| `POST /charts` (charts.dhapi.io) | OHLCV candlesticks | undocumented | keyed | proprietary | high | n/a |
| `/stats/pools/*`, `/stats/pairs/*`, `/stats/daily_stats/*` | liquidity, pairs, 24h stats | undocumented | keyed | proprietary | high | n/a |
| `/swap/tokens`, `/trending`, swap build/estimate/DCA | token search, trending, tx-building | undocumented | keyed | proprietary | high | hard (tx) |

Rate limits, pricing tiers, redistribution license **not in public docs** — confirm with support@dexhunter.io.

### Charli3 Price API — **LIVE** (C) — `https://api.charli3.io/api/v1`
Oracle provider; REST built to the **TradingView** spec; advertises **17,000+ tokens across all DEXes** with an "Aggregate" manipulation-resistant price. Closest single drop-in for TapTools OHLCV + aggregated spot. Cost/key/limits/redistribution **not stated in docs** (verify portal.charli3.io/dev/terms). Also offers on-chain oracle feeds (unique).

### DefiLlama — **PARTIAL** (D) for Cardano token-level — `https://api.llama.fi`
Excellent chain/DEX TVL & volume + cross-chain coin price; **weak on Cardano native-token granularity** (token prices via CoinGecko → long-tail uncovered; no per-token holders).

| Endpoint | Data | Rate limits | Cost | License | Reliability | Replacement diff. |
|---|---|---|---|---|---|---|
| `/prices/current|historical/{coins}`, `/chart` | spot + historical price (CoinGecko-sourced) | "standard" free (rpm unpublished); Pro higher | free; Pro **$300/mo** | open data, attribution | high | medium |
| `/overview/dexs[/chain]`, `/summary/dexs/{p}` | DEX volume by chain/protocol (Cardano incl.) | same | free | open | high | n/a |
| `/protocols`, `/protocol/{slug}`, chain TVL | protocol & chain TVL, **category tags**, audits, twitter | same | free; `/categories` Pro-only | open | high | n/a |
| `/stablecoins*` | stablecoin mcap by chain | same | free | open | high | n/a |

### TapTools — **LIVE — SUNSETTING** (C) — `https://openapi.taptools.io/api/v1` · auth `x-api-key`
Company wind-down announced 2026-06-02/03; API expected dark **~mid-to-late June 2026**. Widest single-source surface on Cardano. **Paid-only, no free tier.** Endpoint paths verified via a live integrator (TapMirror); param schemas live in JS-rendered docs.

| Endpoint group | Data | Cost | License | Replacement diff. |
|---|---|---|---|---|
| `/token/quote`, `/token/prices/chg`, `/token/ohlcv`, `/token/mcap`, `/token/top/*` | price, % change, OHLCV, **mcap+supply**, rankings | paid | **redistribution UNVERIFIED** (assume restricted) | price/OHLCV easy; **mcap/supply hard** |
| `/token/holders`, `/token/holders/top` | **holder count + distribution** | paid | unverified | **hard** (needs full indexer) |
| `/token/trades`, `/token/trading/stats`, `/token/indicators`, `/token/debt/loans` | trades, volume, TA, **cross-protocol loans** | paid | unverified | indicators easy; loans hard |
| `/market/stats` | **ecosystem-wide aggregate stats** | paid | unverified | hard |
| `/nft/*` | floor, volume, trades, listings, distribution | paid | unverified | medium (OpenCNFT) |
| `/wallet/portfolio/positions`, `/wallet/value/trended` | **portfolio valuation** | paid | unverified | hard |
| `/integration/*`, `/onchain/*` | asset supply, blocks, DEX pairs | paid | unverified | medium (Koios) |

**UNIQUE / hardest to replace:** unified mcap+circulating supply per token; holder counts/distribution; cross-protocol loan aggregation; wallet portfolio valuation; ecosystem market stats. **Action: archive `taptools.io/terms` + the API Terms + the OpenAPI spec before the site goes offline.**

> Per-DEX SundaeSwap/WingRiders/GeniusYield/MuesliSwap have their own SDKs/APIs but are best consumed via DexHunter/Minswap-aggregator/Charli3 than individually.

---

## 3. NFT data

### OpenCNFT — **LIVE** (D) — `https://api.opencnft.io` (v1 `/1/`, v2 `/2/`)
Strongest remaining free NFT API; the lowest-effort jpg.store replacement. Open, no key. **License: must credit OpenCNFT with a homepage link.** Rate limits **not published**; v2 docs unmaintained since 2023.

| Endpoint | Data | Replacement diff. |
|---|---|---|
| `/1/policy/{policy}` | collection stats: floor, volume, sales, mint, holders, listings | medium |
| `/1/policy/{policy}/floor_price` | current floor | medium |
| `/1/policy/{policy}/transactions` | sales/tx history | hard (reconstruct from contract txs) |
| `/1/asset/{asset}[/tx]` | per-asset info + sales | medium-hard |
| `/1/rank`, `/2/market/rank/collection`, `/2/market/rank/nft` | rankings (volume/floor), rarity + last price | hard |

(v2 dedicated floor/volume/holders-distribution endpoints **unconfirmed**; v1 paths are the reliable ones.)

### JPG Store API — **MISSING** — `server.jpgstoreapis.com`
**Platform sunset 2026-05-23.** Homepage = goodbye page; data host returns a Cloudflare challenge, not JSON. Never a formally documented public API. Smart contracts remain on-chain (open-source `contracts-v3`); reconstructing data means self-indexing. Treat as removed.

### cnft.tools — **PARTIAL** (D) — `api.cnft.tools` (undocumented)
Rarity/analytics product with an undocumented API host: rarity ranks, traits, floor, 7d volume, on-market counts. **No published docs/keys/limits/ToS** (redistribution rights unknown). Recently gated behind Discord wallet registration.

### Others
- **NMKR** — **LIVE** keyed/paid minting API (mint/IPFS/policy/sales for your own projects); not a marketplace-wide analytics replacement.
- **CNFT.IO** — OpenCNFT's upstream sales source; no documented public data API (PARTIAL/UNKNOWN).
- **Wayup / Tokhun** — newer marketplaces; public APIs **unconfirmed** (candidates to check for a live-listings replacement).

---

## 4. Project / ecosystem metadata

The defining question: API or website-only? Most are curated/editorial → "replacement difficulty" = curation burden, and licensing is the binding constraint.

| Source | API? | Data | Rate/Cost | License | Status |
|---|---|---|---|---|---|
| **Built on Cardano** | Yes (Firebase fn): `/projects`, `/projectName?slug=`, `/projectsByTerm`, `/projects-by-epoch` | logo, name, **industries (tags)**, description, website link | free; **1000 req/day total** | proprietary (no open license) | **PARTIAL** (thin; no socials/team/audit/on-chain ids) |
| **CardanoCube** | **No** (website-only) | rich: categories, descriptions, logos, websites + socials on detail pages | free view | **"all rights reserved"** (republication restricted) | **MISSING** (largest directory, locked) |
| **DefiLlama** (project meta) | Yes: `/protocols` (name, category, chains, url, description, logo, audits, twitter, listedAt) | DeFi/TVL protocols only | free; `/categories` Pro $300/mo | open (most permissive) | **PARTIAL** (DeFi-only scope) |
| **Dev Portal Showcase** | No hosted API, but **MIT data in public git** (`cardano-foundation/developer-portal` → `src/data/showcases.js`) | title, description, website, source, tags | free | **MIT** (republishable) | **PARTIAL** (open data; selective coverage) |
| **adastack.io** | **No** (live site closed-source; archived repo MIT but stale MDX) | dApps, guides, libraries | free view | mixed (MIT archive only) | **MISSING** |
| **cardano.org/apps** | **No** (website-only) | name, desc, category tags, 30d tx count, status flags | free view | no open license stated | **MISSING** |

**Emerging standards (not yet live sources):**
- **CIP-72** dApp Registration & Discovery (tx metadata label 1667): on-chain anchor → off-chain doc with **category enum + social links + script IDs**. The canonical future source for this exact data, queryable on-chain — but early/under-adopted.
- **CRFA off-chain data registry** (`Cardano-Fans/crfa-offchain-data-registry`, MIT): JSON-in-repo, **richest schema** (projectName, link, twitter, category/subCategory, description, features, releases, contracts, **audits**, **scripts/on-chain ids**); no hosted API (read the repo).

---

## 5. Governance

### Koios governance — **LIVE** (A) — see §1 (the leader: DReps, proposals, votes, committee, treasury via `/totals`+proposals).
### Blockfrost `/governance/*` — **LIVE** (A) — DReps/proposals/votes/committee; treasury only as proposal withdrawals (PARTIAL).
### gov.tools (GovTool, IntersectMBO) — **PARTIAL** (A/B) — `gov.tools`
- GovTool backend REST (Apache-2.0, self-hostable; wraps db-sync) — DReps, actions, votes, tallies. Intersect **discourages** external use of the public backend.
- **Proposal Pillar API** — **off-chain** draft proposals + discussion (data NOT on chain, no alternative source — unique). Data-use policy **"TBD"**.
### CIP-1694 / CIP-100 / CIP-119 metadata — **LIVE (standard)** — DRep/action metadata via on-chain `(anchor URL, hash)`. Resolution reliability is the risk (**anchor link-rot**); Koios/Blockfrost `*/metadata` proxy/cache it.
### Aggregators — **PARTIAL** (mostly UI-only)
- **1694.io** (Lido Nation), **AdaStat** (adastat.net), **Cexplorer** (cexplorer.io/governance) — rich governance UIs, **no documented public API** (data is on-chain; treat as UI value-add).
- **SyncGovHub** — `https://api.syncgovhub.com` (auth `x-api-key`): DRep/Proposal/**Rationale** APIs with AI/NL querying. Free tier 60 req/min, 1,000/day; paid pricing unpublished; single-operator.

---

## 6. Catalyst

### projectcatalyst.io — **PARTIAL** (B) — **no programmatic API**
Per-fund voting-results pages + downloadable CSV/PDF result files (e.g. `/funds/13/voting-results`, `fund10-voting-results.pdf`): proposals, YES/ABSTAIN tallies, voting power (ADA), unique wallets, funding outcomes. Preservation depends on scraping/archiving per fund. Mirrored at cardanocataly.st/statistics.

### Catalyst Explorer (Lido Nation) — **PARTIAL→LIVE** (B/D) — `https://www.lidonation.com/catalyst-explorer/api` (also catalystexplorer.com)
Open-source (Apache-2.0); commits to a free API. Proposals (filter by fund/challenge/tags/group/status), funds, challenges, groups, ideascale people, funding+milestone+review data, Jormungandr voting. **Exact endpoint paths + rate limits unverified** (JS-rendered docs). The single best Catalyst aggregator; single-operator risk.

### IdeaScale — **PARTIAL (at-risk)** (C) — `https://cardano.ideascale.com/a/rest/...` · auth `api_token`
Historical Catalyst ideas/proposals/comments/assessments for early funds. **Access admin-token-gated, vendor-controlled, being sunset** (Catalyst migrated off). **Highest preservation urgency** — once access lapses, historical proposal text/comments are effectively unrecoverable except via prior archives.

### Voting/results datasets — **PARTIAL** (B/community)
Official per-fund result files (authoritative); community tool backends (`ca-tool-backend`, OSS — reviews/assessments/KPIs); legacy **Jörmungandr** voting-chain data (raw historical votes; deprecated infra, survives via archives — very high replacement difficulty).

---

## Cross-cutting observations

1. **On-chain data is solved and reproducible.** Koios/Blockfrost (and self-host db-sync) cover token supply/holders/metadata and full Conway governance with no real gap. Authority A/B, durable.
2. **Market data is a multi-source assembly, not a single API** (post-TapTools). Minswap + DexHunter + Charli3 + DefiLlama together cover price/OHLCV/volume; **mcap+circulating-supply and holder distribution are the hard residue.**
3. **NFT data narrows to OpenCNFT** (jpg.store is gone). Single-source-of-truth risk + attribution requirement.
4. **Project/category metadata has no open, comprehensive API** — the largest structural gap (CardanoCube locked; builtoncardano thin; DefiLlama DeFi-only). CIP-72/CRFA are the open future but early.
5. **Catalyst historical data (IdeaScale, Jörmungandr) is perishable and at-risk** — archive now.
6. **Governance has strong on-chain APIs** but off-chain proposal discussion (GovTool Proposal Pillar) and metadata anchors are link-rot-exposed.

*Honest unknowns are flagged inline throughout; the most material are TapTools' redistribution terms + exact pricing, DexHunter/Charli3 limits+license, Blockfrost paid pricing, and Catalyst Explorer's exact endpoint surface.*
