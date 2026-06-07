# TapTools Upstream Dependency Graph

**Status:** research synthesis, v1. **Date:** 2026-06-07.
**Question this document answers:** Where does *every* TapTools feature get its data from, and what survives — and is reproducible — after TapTools disappears?
**Method:** Feature inventory enumerated byte-for-byte from the preserved TapTools OpenAPI spec (`taptools-openapi-v2.0.5.json`, 61 endpoints, 10 groups). Source classification and replacement mapping cross-referenced against the local research corpus (cited inline). No network used.

**Local sources cited (all under `~/`):**
- `cardano-project-memory-archive/taptools-via-wayback/api/taptools-openapi-v2.0.5.json` — the preserved spec (feature inventory + several self-disclosed upstreams in endpoint descriptions).
- `cardano-data-layer/CARDANO_API_REGISTRY.md` — every alternative source, capability matrix, license/limits. *(cited `[REG]`)*
- `cardano-data-layer/TAPTOOLS_API_GAP_ANALYSIS.md` — demand ranking + reproducibility matrix. *(cited `[GAP]`)*
- `cardano-data-layer/CARDANO_DATA_LAYER.md` — the data-infrastructure thesis (reproducible vs. perishable). *(cited `[DL]`)*

**Honesty boundary.** TapTools' *internal* computations (cross-DEX price aggregation weighting, time-series persistence, manipulation filtering, ranking exclusion rules, portfolio valuation logic) are not exposed by the spec and cannot be observed. Where a feature depends on such an internal calc, it is marked **D = unknown** and flagged. Two upstreams are *self-disclosed in the spec itself* and are treated as verified: prices are "aggregated across all supported DEXs" (`POST /token/prices`), and circulating supply for market cap is pulled from the public `github.com/minswap/market-cap` repo (`/token/mcap` description). Everything else is inferred from the documented data shape, not from TapTools source code.

---

## PHASE 1 — Feature inventory (every visible endpoint group)

61 endpoints in 10 groups. Per group: what it returns, where the data originates, derived-source, the internal calc TapTools applies, and confidence.

Confidence legend: **High** = source self-disclosed in spec or trivially on-chain · **Med** = strongly implied by data shape + corpus · **Low** = depends on an unobservable internal calc.

### 1. Token price (`/token/prices` [POST], `/token/quote`, `/token/quote/available`, `/token/prices/chg`)
- **Returns:** spot price per token unit (batch ≤100), ADA/USD quote, % change across `[5m,1h,4h,6h,24h,7d,30d,60d,90d]`.
- **Source:** DEX swap events. *Spec self-discloses:* prices "aggregated across all supported DEXs."
- **Derived-source:** none external — TapTools aggregates raw DEX pool/swap data itself.
- **Internal calc:** cross-DEX aggregation (which DEXs, what weighting, outlier/manipulation handling) — **unobservable**.
- **Confidence:** High (source) / Low (the aggregation method).

### 2. Token OHLCV (`/token/ohlcv`)
- **Returns:** open/high/low/close/volume candles, aggregated across all pools *or* per pool by `onchainID`.
- **Source:** DEX swap events over time → continuously persisted time series.
- **Derived-source:** none external.
- **Internal calc:** cross-DEX consolidation **and** continuous time-series persistence (the candle history itself is the asset — it cannot be backfilled later `[DL §5]`).
- **Confidence:** High (source) / Low (persisted series is TapTools-internal).

### 3. Token market cap + supply (`/token/mcap`, `/asset/supply`, `/integration/asset`)
- **Returns:** circulating supply, total supply, market cap, FDV.
- **Source (supply):** *Spec self-discloses* circulating supply from `github.com/minswap/market-cap` (open, community-maintained). Total/on-chain supply is on-chain.
- **Derived-source (mcap):** mcap = (TapTools price) × (minswap/market-cap circulating supply) — a join, not a primary measurement.
- **Internal calc:** the multiplication + which supply figure; ranking exclusions (see #7).
- **Confidence:** High (supply repo + on-chain supply disclosed) / Med (the mcap join).

### 4. Liquidity (`/token/pools`, `/token/top/liquidity`)
- **Returns:** a token's active liquidity pools; tokens ranked by DEX liquidity ("includes both AMM and order book liquidity").
- **Source:** DEX pool state (AMM reserves + order-book depth) on-chain / per-DEX.
- **Derived-source:** none external.
- **Internal calc:** cross-DEX liquidity summation + USD valuation.
- **Confidence:** High (source) / Med (aggregation).

### 5. Volume + trades + trading stats (`/token/trades`, `/token/trading/stats`, `/token/top/volume`)
- **Returns:** individual DEX trades market-wide; aggregated per-token trading stats; top tokens by volume per timeframe.
- **Source:** DEX swap events (on-chain).
- **Derived-source:** none external.
- **Internal calc:** trade classification + per-token/timeframe aggregation.
- **Confidence:** High (source) / Med (aggregation).

### 6. Token metadata / links (`/token/links`)
- **Returns:** a token's social links "if they have been provided to TapTools."
- **Source:** **TapTools editorial** — user/project-submitted, *not* derived from chain or a registry.
- **Derived-source:** none.
- **Internal calc:** none — curated intake.
- **Confidence:** High (spec says "provided to TapTools" → editorial).
- **Note:** distinct from off-chain token metadata (name/ticker/logo), which TapTools surfaces from CIP-26/CIP-25 — but the *links* endpoint is curated.

### 7. Rankings (`/token/top/mcap`, `/token/top/volume`, `/token/top/liquidity`)
- **Returns:** descending leaderboards by mcap / volume / liquidity.
- **Source:** derived entirely from features #1–#5 above.
- **Derived-source:** TapTools' own price/mcap/volume/liquidity outputs.
- **Internal calc:** ranking + **editorial exclusion rules** — spec discloses `/token/top/mcap` "excludes deprecated tokens (e.g. MELD V1)". That exclusion list is a curated editorial judgment, **unobservable**.
- **Confidence:** Med (mechanics) / Low (the exclusion list).

### 8. Token holders (`/token/holders`, `/token/holders/top`)
- **Returns:** holder *count* (coalesced by stake key) + top holders.
- **Source:** on-chain asset address set, aggregated by `coalesce(stake_address, address)` (spec-disclosed).
- **Derived-source:** none — pure on-chain indexer read.
- **Internal calc:** stake-key coalescing (standard, reproducible).
- **Confidence:** High.

### 9. Technical indicators (`/token/indicators`)
- **Returns:** EMA, RSI, MACD, etc. (latest values).
- **Source:** computed *from* TapTools' own OHLCV (#2).
- **Derived-source:** internal OHLCV.
- **Internal calc:** standard TA formulas (public, client-reproducible) over their candle series.
- **Confidence:** High (formulas) / inherits OHLCV's Low for the underlying series.

### 10. DeFi loans (`/token/debt/loans`, `/token/debt/offers`)
- **Returns:** active P2P loans + loan offers per token. Spec: "Currently only supports P2P protocols like Lenfi and Levvy."
- **Source:** per-protocol lending smart-contract state (Lenfi, Levvy) on-chain.
- **Derived-source:** none external — TapTools indexes each protocol's contracts.
- **Internal calc:** per-protocol contract parsing + cross-protocol aggregation.
- **Confidence:** Med (source clear) / Low (per-protocol parsing is bespoke).

### 11. Market stats (`/market/stats`)
- **Returns:** aggregated 24h DEX volume + total active addresses (24h, stake-coalesced).
- **Source:** DEX swaps (volume) + on-chain tx graph (active addresses).
- **Derived-source:** TapTools' own volume layer + an on-chain address scan.
- **Internal calc:** ecosystem-wide aggregation.
- **Confidence:** Med.

### 12. NFT collection stats (`/nft/collection/stats[/extended]`, `/nft/collection/info`, `/nft/collection/ohlcv`, `/nft/collection/volume/trended`, `/nft/collection/trades[/stats]`, `/nft/collection/assets`)
- **Returns:** floor, lifetime + timeframe volume, supply, listings, sales/trade history, floor-price OHLCV; collection info (name/socials/logo).
- **Source:** marketplace listing + sale events (jpg.store et al.), on-chain mint/asset set; collection *info* (name/socials/logo) is part curated, part on-chain CIP-25.
- **Derived-source:** marketplace event indexing.
- **Internal calc:** floor computation, listings dedup, volume aggregation, OHLCV persistence.
- **Confidence:** High (source class) / Med (collection-info socials are partly editorial).

### 13. NFT holders & distribution (`/nft/collection/holders/distribution`, `/holders/top`, `/holders/trended`)
- **Returns:** distribution buckets, top holders, trended holder count. (Counts listed + staked NFTs as owned — spec-disclosed.)
- **Source:** on-chain asset ownership + marketplace/stake-contract state.
- **Derived-source:** none external.
- **Internal calc:** bucketing + listed/staked attribution.
- **Confidence:** High.

### 14. NFT listings (`/nft/collection/listings[/depth|/individual|/trended]`)
- **Returns:** active listing count, depth, individual listings, trended.
- **Source:** marketplace listing state.
- **Derived-source:** marketplace indexing.
- **Internal calc:** listing aggregation across marketplaces.
- **Confidence:** Med (source) / Low (jpg.store-era marketplace coverage now perishable — see Phase 5).

### 15. NFT rarity & traits (`/nft/collection/traits/rarity[/rank]`, `/traits/price`, `/nft/asset/traits`, `/nft/asset/stats`, `/nft/asset/sales`)
- **Returns:** trait rarity, rarity rank, per-trait price floors, per-asset stats/sales.
- **Source:** on-chain CIP-25 metadata (traits) + marketplace sales (price).
- **Derived-source:** none external.
- **Internal calc:** rarity scoring algorithm (method-dependent — multiple valid schemes; **TapTools' specific scoring is unobservable**).
- **Confidence:** Med (trait source) / Low (rarity score method).

### 16. NFT rankings & market stats (`/nft/top/timeframe`, `/nft/top/volume[/extended]`, `/nft/market/stats[/extended]`, `/nft/market/volume/trended`, `/nft/marketplace/stats`)
- **Returns:** top collections by mcap/volume/gainers-losers; market-wide and per-marketplace NFT stats.
- **Source:** derived from #12–#14.
- **Derived-source:** TapTools' own NFT layer.
- **Internal calc:** ranking + market aggregation.
- **Confidence:** Med.

### 17. Wallet / portfolio (`/wallet/portfolio/positions`, `/wallet/value/trended`, `/wallet/trades/tokens`)
- **Returns:** current positions (incl. staked-in-contract + LP/farm), trended value in 4h intervals (tokens + NFTs + LP/farm + custodial staking + loan-involved assets), token trade history.
- **Source:** on-chain wallet holdings (Koios/Blockfrost-class) **×** TapTools' entire price/floor/LP-valuation stack.
- **Derived-source:** on-chain holdings + every internal valuation layer above.
- **Internal calc:** position valuation — LP/farm position pricing, staked-asset attribution, loan-collateral valuation, 4h trended persistence. The **most composite** internal calc in the API.
- **Confidence:** High (holdings source) / Low (the valuation stack).

### 18. On-chain primitives (`/address/info`, `/address/utxos`, `/transaction/utxos`, `/integration/block`, `/integration/latest-block`, `/integration/events`, `/integration/pair`, `/integration/exchange`, `/metrics`)
- **Returns:** address balance/stake/credential, UTxOs, tx UTxOs, blocks, block-range events, DEX pair/exchange details (CoinGecko/DEX-screener integration shape), API request count.
- **Source:** raw on-chain data (db-sync-class indexer) + DEX registry.
- **Derived-source:** none — direct chain reads.
- **Internal calc:** none material (standard indexing).
- **Confidence:** High.

---

## PHASE 2 — Source classification (A/B/C/D)

Class **A** = direct upstream (TapTools consumes a specific external feed) · **B** = derived (TapTools computes from raw on-chain/DEX data it indexes itself) · **C** = editorial/curated (submitted to / judged by TapTools) · **D** = unknown internal calc (not observable from the spec).

| Feature group | Class | Rationale |
|---|---|---|
| Token price (spot, quote, % chg) | **B + D** | Computed from DEX swaps it indexes (B); the cross-DEX aggregation weighting is **D**. |
| Token OHLCV | **B + D** | Persisted candle series from DEX swaps (B); consolidation + persistence is **D**. |
| Market cap | **A + B** | **A:** circulating supply from `minswap/market-cap` repo (self-disclosed). **B:** ×price join. |
| Supply (on-chain / total) | **B** | Direct on-chain read. |
| Liquidity | **B + D** | DEX pool state (B); cross-DEX AMM+order-book summation (D). |
| Volume / trades / trading stats | **B** | DEX swap events, aggregated. |
| Token links (socials) | **C** | "provided to TapTools" — submitted. |
| Token off-chain metadata (name/ticker/logo) | **A** | CIP-26 registry + on-chain CIP-25 passthrough. |
| Rankings (token) | **B + C** | Derived from B layers; the deprecated-token **exclusion list** is **C** (editorial). |
| Token holders / distribution | **B** | On-chain address set, stake-coalesced. |
| Technical indicators | **B** | Public TA formulas over internal OHLCV. |
| DeFi loans (Lenfi/Levvy) | **B + D** | Per-protocol contract state (B); bespoke per-protocol parsing (D). |
| Market stats | **B** | DEX volume + on-chain active-address scan. |
| NFT floor / volume / sales / OHLCV | **B** | Marketplace event indexing. |
| NFT collection info (name/socials/logo) | **B + C** | On-chain CIP-25 (B) + curated socials (C). |
| NFT holders / distribution | **B** | On-chain ownership + contract state. |
| NFT listings | **B** | Marketplace listing state (coverage now perishable). |
| NFT rarity / traits | **B + D** | CIP-25 traits (B); rarity-score method (D). |
| NFT rankings / market stats | **B** | Derived from NFT B layers. |
| Wallet / portfolio | **B + D** | On-chain holdings (B) × the full valuation stack (**D**, the most composite). |
| On-chain primitives (address/tx/block/integration) | **B** | Direct chain/DEX-registry reads. |

**Distribution:** Almost everything TapTools serves is **Class B** — it is fundamentally an *indexer + aggregator*, not a reseller of third-party feeds. There is effectively **one Class-A external dependency** (the `minswap/market-cap` supply repo) plus CIP-26/CIP-25 metadata passthrough. The genuinely irreplaceable residue is **C** (curated links/socials, ranking exclusions) and **D** (the unobservable aggregation/valuation/rarity calcs).

---

## PHASE 3 — Reproducibility from open sources

For each feature: can we rebuild it from Koios / Blockfrost / DexHunter / Minswap / Spectrum / WingRiders / OpenCNFT / CardanoScan / DefiLlama / CardanoCube / Built on Cardano? `[GAP appendix]`, `[REG]`.

| Feature | Reproducible? | Best open source(s) |
|---|---|---|
| Token spot price | **Yes** | DexHunter (cross-DEX aggregate), Minswap (`/assets/metrics`); Charli3 17k-token aggregate `[REG §2]` |
| Token OHLCV | **Partial** | Minswap per-pool candles; DexHunter `POST /charts`; Charli3 (TradingView spec). Cross-DEX consolidation + history = DIY persistence `[GAP §3]` |
| Token % change | **Yes** (derived) | Computed from your own price series |
| Market cap + circulating supply | **Partial** | **Same `minswap/market-cap` repo TapTools uses** (public) × derived price; Minswap `/assets/metrics` exposes mcap+supply directly `[REG §2]` |
| Total / on-chain supply | **Yes** | Koios `/asset_info`, Blockfrost `/assets/{a}` |
| Liquidity per token | **Yes/Partial** | Minswap pool metrics, DexHunter `/stats/pools`; per-DEX coverage gaps (Spectrum/WingRiders best via aggregator) |
| Volume / trades / trading stats | **Partial** | Minswap, DexHunter daily stats; DefiLlama DEX volume by chain (aggregate) `[REG §2]` |
| Token links / socials | **No** (editorial) | None open — curated. Built on Cardano has thin tags; not socials. |
| Token off-chain metadata (name/logo/ticker) | **Yes** | CIP-26 (`tokens.cardano.org/metadata`), re-served by Koios/Blockfrost |
| Rankings (mcap/vol/liq) | **Partial** | Derivable from the above; the **deprecated-token exclusion list is not** reproducible (editorial) |
| Token holders + distribution | **Yes** | Koios `/asset_addresses`, Blockfrost `/assets/{a}/addresses`; CardanoScan partial `[GAP appendix]` |
| Technical indicators | **Yes** | Client-compute from OHLCV |
| DeFi loans | **Partial** | Lenfi/Levvy on-chain contracts (self-index); no open aggregator |
| Market stats (eco-wide) | **Partial** | DefiLlama (DEX volume/TVL by chain) + Koios active-address scan |
| NFT floor / volume / sales / OHLCV | **Yes** | **OpenCNFT** (purpose-built, open, by policy ID) `[REG §3]` |
| NFT collection info (name/logo) | **Yes/Partial** | On-chain CIP-25 + OpenCNFT; curated socials = No |
| NFT holders / distribution | **Yes** | OpenCNFT; on-chain ownership via Koios/Blockfrost |
| NFT listings (live) | **Partial** | OpenCNFT (marketplace coverage shrinking post-jpg.store sunset `[REG §3]`) |
| NFT rarity / traits | **Partial** | CIP-25 traits via Koios/Blockfrost (compute rarity yourself); cnft.tools partial/undocumented |
| NFT rankings / market stats | **Yes/Partial** | OpenCNFT `/rank`, `/2/market/rank/*` |
| Wallet / portfolio valuation | **Partial** | Koios/Blockfrost holdings × your price layer; LP/farm/loan valuation = DIY `[GAP §3]` |
| On-chain primitives | **Yes** | Koios / Blockfrost / CardanoScan / db-sync |
| **Project metadata (desc/category/audit/launch/team)** | **No** | No open API. CardanoCube website-only + "all rights reserved"; Built on Cardano thin/1k-req-day; DefiLlama DeFi-only; CIP-72/CRFA emerging `[DL §3]` `[REG §4]` |
| **Project classification / taxonomy** | **No** | No open ecosystem-wide category API exists `[DL verdict]` |

Sources that do **not** replace any TapTools feature directly: **CardanoCube** and **Built on Cardano** map to *project metadata/classification* — which TapTools largely did **not** serve via its API (TapTools' project/category richness lived in its website/editorial layer, not the 61 API endpoints). They are replacements for the *web product*, not the *API*. **Spectrum / WingRiders** have no documented public analytics REST APIs — reach them via DexHunter/Minswap aggregation or on-chain reads `[GAP appendix]`.

---

## PHASE 4 — Feature → Source → Replacement (core deliverable)

The dependency graph, in the "Price → DexHunter / Metadata → CIP-26 / Classification → editorial (no replacement)" style.

```
TOKEN PRICE          → DEX swaps (B, self-aggregated)        → DexHunter (cross-DEX) / Minswap / Charli3
TOKEN OHLCV          → DEX swaps + internal persistence (B/D)→ Minswap+DexHunter candles + SELF-PERSIST history
TOKEN %CHANGE        → internal price series (B)             → derive from your own series
MARKET CAP           → minswap/market-cap repo (A) × price   → SAME repo + derived price  [direct upstream survives!]
SUPPLY (on-chain)    → chain (B)                             → Koios / Blockfrost
LIQUIDITY            → DEX pools AMM+orderbook (B/D)         → Minswap / DexHunter (partial cross-DEX)
VOLUME / TRADES      → DEX swaps (B)                         → Minswap / DexHunter / DefiLlama (aggregate)
TOKEN LINKS (social) → TapTools editorial (C)               → NO direct replacement (curated)
TOKEN METADATA       → CIP-26 + CIP-25 (A)                  → CIP-26 (tokens.cardano.org) / Koios / Blockfrost
TOKEN RANKINGS       → internal B layers + exclusion list (C)→ derive; exclusion list NOT reproducible (editorial)
TOKEN HOLDERS        → chain, stake-coalesced (B)            → Koios / Blockfrost / CardanoScan
INDICATORS           → internal OHLCV (B)                    → client-compute from OHLCV
DEFI LOANS           → Lenfi/Levvy contracts (B/D)          → self-index those contracts (no open aggregator)
MARKET STATS         → DEX vol + active-addr scan (B)        → DefiLlama + Koios scan (partial)
NFT FLOOR/VOL/SALES  → marketplace events (B)               → OpenCNFT
NFT OHLCV/DISTRIB    → marketplace + chain (B)              → OpenCNFT + Koios/Blockfrost
NFT COLLECTION INFO  → CIP-25 + curated socials (B/C)        → CIP-25 + OpenCNFT; socials NOT reproducible
NFT LISTINGS (live)  → marketplace state (B)                → OpenCNFT (coverage shrinking, jpg.store gone)
NFT RARITY/TRAITS    → CIP-25 + scoring method (B/D)        → CIP-25 traits; rarity score = DIY (method differs)
NFT RANKINGS         → internal NFT layers (B)              → OpenCNFT /rank
WALLET / PORTFOLIO   → chain holdings × full valuation (B/D)→ Koios/Blockfrost holdings × YOUR price layer (LP/farm/loan = DIY)
ON-CHAIN PRIMITIVES  → chain (B)                            → Koios / Blockfrost / CardanoScan / db-sync
─────────────────────────────────────────────────────────────────────────────────────
PROJECT METADATA*    → TapTools editorial (C)               → NO open replacement (CardanoCube locked; BoC thin)
PROJECT CLASSIFICATION* → TapTools editorial (C)            → NO open replacement (no eco-wide category API)
       *web-product features, largely NOT in the 61-endpoint API surface
```

**Read of the graph:** strip away the two unobservable internal layers (D = aggregation/valuation/rarity method) and the two editorial layers (C = curated socials + ranking exclusions + project metadata/classification), and **every remaining TapTools API feature maps to an open source.** The API is ~90% commodity-reproducible; the irreplaceable part is small but real.

---

## PHASE 5 — Impossible to reproduce → preservation priority

What cannot be rebuilt from open sources, ranked by preservation urgency.

| Rank | What is lost | Why irreproducible | Recoverable later? | Preservation action |
|---|---|---|---|---|
| **1** | **Project descriptions / category assignments / taxonomy / launch dates / audit status / team** (web-product editorial) | No open API serves it; CardanoCube is "all rights reserved" + website-only; the *historical state* (what was classified as what, when) was never API-exposed `[DL §3,§5]` | **No** — perishable; dies with the source | **Highest.** Already partly captured: Project Memory archive (cardanocube taxonomy ~74 categories + 20 graveyard profiles, TapTools pre-SPA ranking grids, 2,224-URL historical index) `[DL Memory-Layer §]` |
| **2** | **Historical price/OHLCV candle series** | DEX trade *events* survive on-chain, but consolidated cross-DEX OHLCV must be computed *continuously*; a gap in the record cannot be backfilled `[DL §5]` | **No** for the gap; on-chain events allow forward re-derivation only | **High.** Start persisting candles now; cannot recover the shutdown-window gap retroactively |
| **3** | **Token links / NFT collection socials** (curated submissions) | Submitted to TapTools, not on chain or in any registry | Partly — if the project site/Twitter still lives | **Medium.** Snapshot now; tied to project-metadata capture |
| **4** | **Ranking exclusion rules + rarity scoring method** (internal calcs) | Editorial/algorithmic judgments not exposed by the spec | The *outputs* (rank grids) are snapshottable; the *method* is not | **Medium.** Snapshot the rendered ranking grids (done); accept the method is unobservable |
| **5** | **The OpenAPI spec + Terms themselves** | Goes dark with the company | No, once offline | **Done** — `taptools-openapi-v2.0.5.json` preserved with custody record; `[REG §2]` flags archiving terms |

Everything **not** in this table — prices, supply, holders, volume, liquidity, NFT floors, on-chain primitives, metadata — is reproducible from live open sources and therefore *not* a preservation priority. It is an *infrastructure rebuild* priority instead (see Phase 6).

---

## OUTPUT — Master capability table

For every capability: original source → replacement source → rebuild difficulty → preservation importance.

| Capability | TapTools source (class) | Replacement source | Rebuild difficulty | Preservation importance |
|---|---|---|---|---|
| Token spot price | DEX swaps, self-aggregated (B/D) | DexHunter / Minswap / Charli3 | Medium (quote-shaped, skews liquid) | Low (reproducible) |
| Token OHLCV | DEX swaps + persistence (B/D) | Minswap/DexHunter candles + self-persist | Medium-High (history is DIY) | **High** (gap unbackfillable) |
| Token % change | internal price series (B) | derive from own series | Low | Low |
| Market cap | `minswap/market-cap` repo (A) × price | **same repo** + derived price | Medium (join) | Low (upstream is public) |
| Supply (on-chain/total) | chain (B) | Koios / Blockfrost | Low | Low |
| Liquidity | DEX pools (B/D) | Minswap / DexHunter | Medium (cross-DEX gaps) | Low |
| Volume / trades | DEX swaps (B) | Minswap / DexHunter / DefiLlama | Medium | Low |
| Token links / socials | editorial (C) | **none** (curated) | N/A (curation) | **Medium** |
| Token off-chain metadata | CIP-26/CIP-25 (A) | CIP-26 / Koios / Blockfrost | Low | Low (durable: git + on-chain) |
| Token rankings | B layers + exclusion list (B/C) | derive; exclusion list = none | Medium / N/A for exclusions | **Medium** (snapshot grids) |
| Token holders + distribution | chain, coalesced (B) | Koios / Blockfrost | Low | Low |
| Technical indicators | internal OHLCV (B) | client-compute | Low | Low |
| DeFi loans (Lenfi/Levvy) | protocol contracts (B/D) | self-index contracts | High (bespoke) | Low |
| Market stats (eco-wide) | DEX vol + addr scan (B) | DefiLlama + Koios | Medium | Low |
| NFT floor/volume/sales | marketplace events (B) | **OpenCNFT** | Low | Low-Med (OpenCNFT survival) |
| NFT OHLCV / volume trended | marketplace (B) | OpenCNFT | Medium | Low |
| NFT collection info (name/logo) | CIP-25 + curated (B/C) | CIP-25 + OpenCNFT | Low; socials N/A | Medium (socials) |
| NFT holders / distribution | chain + contracts (B) | OpenCNFT / Koios | Low | Low |
| NFT listings (live) | marketplace state (B) | OpenCNFT (shrinking coverage) | Medium | Low |
| NFT rarity / traits | CIP-25 + scoring (B/D) | CIP-25 traits; rarity DIY | Medium; method N/A | Low-Med |
| NFT rankings / market stats | internal NFT (B) | OpenCNFT /rank | Medium | Low |
| Wallet / portfolio valuation | holdings × valuation stack (B/D) | Koios/Blockfrost × your price layer | High (LP/farm/loan DIY) | Low (re-derivable live) |
| On-chain primitives | chain (B) | Koios / Blockfrost / db-sync | Low | Low (permanent on-chain) |
| **Project metadata** (web product) | editorial (C) | **none open** (CardanoCube locked, BoC thin) | High (curation) | **Highest** (perishable) |
| **Project classification/taxonomy** (web product) | editorial (C) | **none open** (no eco-wide API) | High (curation) | **Highest** (perishable) |
| OpenAPI spec + Terms | TapTools docs | — | N/A | **Highest** (archive — done) |

---

## What THIS project already covers

The two tracks in `~/cardano-data-layer/` and the Project Memory archive between them already neutralize the bulk of the loss:

- **The Cardano Data Layer maps the commodity layer to open sources.** Per `CARDANO_API_REGISTRY.md` and `TAPTOOLS_API_GAP_ANALYSIS.md`, every Class-B feature — price, OHLCV, mcap (incl. the *same* `minswap/market-cap` upstream TapTools uses), supply, holders, liquidity, volume, NFT floor/volume/sales, on-chain primitives, token metadata — has a documented open replacement (Koios / Blockfrost / DexHunter / Minswap / Charli3 / OpenCNFT / CIP-26). The `MVP_REPLACEMENT_BLUEPRINT.md` minimal surface re-floats the HIGH-demand consumers. **This is the on-ramp, and it is solved on paper.**

- **Project Memory preserves the editorial/historical residue** — the Class-C/perishable part that *cannot* be reproduced from any open source: the cardanocube taxonomy + graveyard project profiles, the TapTools pre-SPA ranking grids, the historical-project index, and the OpenAPI spec itself (with chain-of-custody). Per `CARDANO_DATA_LAYER.md`, this is the *moat* and the only part that justifies new neutral infrastructure rather than a clone — and it is being captured before the source goes dark.

Together: **the reproducible ~90% is an infrastructure rebuild (assembly of open APIs); the irreproducible ~10% is an archival capture (already underway).** The Data Layer serves the live commodity view; Project Memory holds provenance for the perishable editorial view, referenced as a seed under a separate trust boundary `[DL Memory-Layer §]`.

## Honest unknowns

- **TapTools' internal calcs are invisible.** Cross-DEX price aggregation weighting, OHLCV consolidation, liquidity USD valuation, the deprecated-token ranking exclusion list, NFT rarity scoring, and the full portfolio-valuation stack (LP/farm/loan-collateral pricing) are **Class D** — inferable in *shape* from the spec but not in *method*. A replacement will produce *similar* numbers, not *identical* ones.
- **Redistribution license of the source feeds** (DexHunter, Charli3, TapTools' own Terms) is unverified `[REG §2]` — a legal, not technical, blocker noted but not resolved here.
- **OpenCNFT single-source-of-truth + shrinking marketplace coverage** (post-jpg.store sunset) is the fragile point in the otherwise-easy NFT replacement `[REG §3]`.
- Per-protocol **DeFi loan** parsing (Lenfi/Levvy) and **Spectrum/WingRiders** analytics have no open aggregator — reachable only by self-indexing or DEX-aggregator proxy.

---

*Wrote this file to `~/cardano-data-layer/TAPTOOLS_DEPENDENCY_GRAPH.md`. Feature inventory enumerated from the preserved OpenAPI spec (61 endpoints); classification and replacement mapping cross-referenced against the three local research docs cited above. No network used.*
