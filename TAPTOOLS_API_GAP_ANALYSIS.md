# TapTools API Gap Analysis

**Status:** research synthesis, v1.
**Date:** 2026-06-03.
**Scope:** Which TapTools API capabilities become orphaned when TapTools shuts down, ranked by developer demand, and how reproducible each is from open Cardano data sources.
**Relationship to other work:** This is the **Cardano Data Layer** track. It is *separate from* the Cardano Memory Layer / FLOW-6 preservation work. Preservation answers "what disappears" (archival); this answers "what live API capability disappears, and is it worth rebuilding" (infrastructure).
**Companion documents:** `CARDANO_DATA_LAYER.md` (the data-infrastructure thesis), `MVP_REPLACEMENT_BLUEPRINT.md` (the minimum viable replacement design).

> **Method & honesty note.** This synthesis was produced from a four-stream parallel research pass (demand signal, endpoint inventory, alternative-source capability matrix, metadata/category gap). The research used web search; some specifics could not be fetched byte-for-byte and are flagged inline. The two items that most warrant manual confirmation before acting: (1) the exact TapTools OpenAPI endpoint list (some paths below are reconstructed from documented endpoint groups, not pulled from the live spec), and (2) the precise "Adam's post" wording (see §1).

---

## 1. The triggering event

TapTools is **winding down the entire company**, not merely deprecating or repricing its API.

- Official announcement: @TapTools on X, **2026-06-02** — *"After four years of building for Cardano, today we have difficult news to share."* (`x.com/TapTools/status/2061878260410241209`).
- Timeline reported as **~2 weeks** to full shutdown; the public API goes with the company.
- **No direct replacement has been announced.** Coverage explicitly names the developer/API disruption as the sharpest edge of the shutdown:
  - crypto.news — *"Developers who built products on the API face the biggest immediate disruption … no direct replacement has been announced."*
  - cryptonews.com — what is lost: *"native token prices, DeFi protocol metrics, NFT floor prices, and DEX liquidity … data that they cannot easily reconstruct from raw chain queries."*
  - AInvest — *"TapTools' Collapse Exposes Cardano's Analytics Gap."*
  - The Block — Hoskinson warns of a possible *"wave of failures"* following the wind-down.

**The "Adam's post" signal.** The user's framing was "use Adam's post as the signal." The most likely author is **Adam Dean** (Cardano dev/SPO, `@adamKDean`, GitHub `crypto2099`). A specific Adam Dean post explicitly framing "TapTools API demand becomes orphaned" **could not be verified** (X post bodies were not retrievable in the research pass). His documented adjacent stance — *let non-viable businesses fail and redirect effort to survivors* (re: JPG.store closure, Oct 2025) — is consistent with an orphaned-demand reading, but the exact quote should be confirmed directly at `x.com/adamKDean` before being cited. The thesis does **not** depend on it: the shutdown itself is the demand signal, corroborated by multiple outlets and by years of documented API dependence (DexHunter, Flux Point Studios, WAVE Digital Assets, Fren & Rush Labs bot, a Catalyst Fund12 "TapTools API Hackathon", and a community MCP server wrapping the API).

**Conclusion:** the gap is real, acute, and time-boxed. Existing Cardano infra (Blockfrost, Maestro, Koios, db-sync) covers *raw chain data* but **not** the aggregated price / market-cap / NFT-floor / liquidity layer developers actually consumed.

---

## 2. Demand classification of TapTools API capabilities

Demand is ranked by frequency across the shutdown coverage and the pre-shutdown API case studies — i.e., what developers actually built on, not what is technically interesting.

### HIGH demand — the orphaned core

| Capability | TapTools endpoint group (approx.) | Why high |
|---|---|---|
| **Token spot price (ADA/USD)** | `/token/prices`, `/token/prices/chg` | The single most-called class; powers nearly every dashboard, wallet, and bot. |
| **Token OHLCV / historical candles** | `/token/ohlcv` | Required for any price chart; the most-cited specific loss. |
| **Token market cap / FDV / supply** | `/token/mcap` | Core token-detail metric; every token list shows it. |
| **Top-token rankings** | `/token/top/mcap`, `/token/top/volume` | Backbone of leaderboard / "hot tokens" pages. |
| **DEX liquidity & 24h volume per token** | `/token/pools`, `/token/trading/stats` | Named directly in shutdown coverage; DeFi screeners depend on it. |
| **Market movers (gainers/losers)** | `/market/overview` | Extremely common homepage widget. |
| **NFT floor price + collection volume** | `/nft/collection/stats[/extended]` | The canonical NFT integration; floor feeds are everywhere. |

### MEDIUM demand

| Capability | Endpoint group | Note |
|---|---|---|
| Token holder count & top holders | `/token/holders`, `/token/holders/top` | Trust/health & whale-watching; headline of the DexHunter integration. |
| NFT trending / top collections | `/nft/top/volume`, `/nft/top/timeframe` | NFT leaderboards. |
| NFT trades / sales history | `/nft/collection/trades` | Sales feeds, bots. |
| NFT holder distribution | `/nft/collection/holders/distribution` | Concentration/health. |
| Wallet / portfolio valuation | `/wallet/portfolio/positions`, `/wallet/value/trended` | Backbone of portfolio trackers. |
| Aggregate market stats | `/market/stats` | Overview widgets. |
| Standardized integration feed | `/integration/*` (CoinGecko/DEX-screener shape) | Third-party data feeds. |
| On-chain supply | `/onchain/asset/supply` | Needed for accurate market-cap math. |

### LOW demand

| Capability | Endpoint group | Note |
|---|---|---|
| Technical indicators (EMA/RSI/MACD) | `/token/indicators` | Client-computable from OHLCV. |
| DeFi lending exposure (loans/offers per token) | `/token/debt/*` | Niche. |
| NFT rarity / traits | `/nft/collection/traits[/rarity]` | Served well by existing rarity tools. |
| Fiat quote currencies, exchange/pair config | `/token/quote/available`, `/integration/exchange` | Config lookups. |
| Per-asset NFT detail | `/nft/asset/*` | Long-tail. |

---

## 3. Reproducibility from open sources

Capability-by-capability: can it be rebuilt from open Cardano data, and how hard. Sources: Koios, Blockfrost, Cardanoscan (on-chain); Minswap, DexHunter, DefiLlama (DeFi/market); OpenCNFT (NFT); CIP-26 token registry (metadata); db-sync (fallback). Full per-source capability matrix is in the appendix.

| TapTools capability | Demand | Reproducible? | Best open source(s) | Difficulty | Maintenance burden |
|---|---|---|---|---|---|
| Token spot price | HIGH | **MEDIUM** | Minswap aggregator estimate, DexHunter quotes | Medium — quote-shaped, not a clean spot field; skews to liquid tokens | Medium — depends on DEX APIs staying up |
| Token OHLCV | HIGH | **MEDIUM** | Minswap per-pool candles; else build from swap events | Medium-High — cross-DEX consolidation is DIY | High — must persist a time series yourself |
| Market cap / FDV | HIGH | **MEDIUM** | (Koios/Blockfrost supply) × (derived price) | Medium — mechanical multi-source join | Medium |
| Top-token rankings | HIGH | **MEDIUM** | Derived from the price + mcap + volume you compute | Medium — only as good as inputs | Medium |
| DEX liquidity & volume/token | HIGH | **MEDIUM-EASY** | Minswap pool metrics (`liquidity_usd`, `volume_usd_24h/7d`); DexHunter cross-DEX | Medium — per-DEX coverage gaps | Medium |
| Market movers | HIGH | **MEDIUM** | Derived from your own price series | Medium | Medium |
| NFT floor + volume + sales + distribution | HIGH/MED | **EASY** | OpenCNFT (purpose-built, open, by policy ID) | Low — single calls | Low-Medium — depends on OpenCNFT surviving + its marketplace coverage |
| Token holders / top holders | MED | **EASY** | Koios `asset_addresses`, Blockfrost `/assets/{asset}/addresses` | Low (count for huge tokens needs paging) | Low |
| Token off-chain metadata | MED | **EASY** | CIP-26 `tokens.cardano.org/metadata` (batch `POST /metadata/query`); re-served by Koios/Blockfrost | Low | Low — but opt-in coverage gaps |
| Wallet / portfolio | MED | **MEDIUM** | Koios/Blockfrost holdings × your price layer | Medium — needs the price layer first | Medium |
| On-chain supply | MED | **EASY** | Koios / Blockfrost asset endpoints | Low | Low |
| Technical indicators | LOW | **EASY** | Compute client-side from OHLCV | Low | None (push to client) |
| Project/dApp metadata (desc, category, audit, launch) | MED | **HARD** | No open API — website-only (cardanocube, builtoncardano thin/rate-limited, DefiLlama DeFi-only) | High — requires curation | High — editorial upkeep |
| Project category / taxonomy | MED | **HARD** | No open ecosystem-wide API (cardanocube website-only; builtoncardano tags / DefiLlama categories partial) | High — editorial | High |

**The shape of the gap:** the NFT block, token holders, token metadata, and supply are *easy* to reproduce from existing open APIs. A clean **universal token price / OHLCV / market-cap layer** is *medium* — assemble-it-yourself from DEX quotes + on-chain supply, and you must persist the history. **Project & category metadata** is *hard* — no open source serves it; it is curated and perishable. (This is exactly where the Memory Layer archive becomes a seed asset — see `MVP_REPLACEMENT_BLUEPRINT.md` §4.)

---

## 4. Difficulty / source-availability / maintenance summary

Three cost axes per capability cluster, to judge build order:

| Cluster | Source availability | Build difficulty | Ongoing maintenance | Verdict |
|---|---|---|---|---|
| NFT analytics | Good (OpenCNFT open) | Low | Low-Med | **Cheap win** — thin proxy over OpenCNFT |
| Token holders / supply / metadata | Excellent (Koios/Blockfrost/CIP-26, all open) | Low | Low | **Cheap win** — passthrough + light caching |
| Token price / OHLCV / mcap / rankings | Partial (DEX quotes, no clean feed) | Medium-High | High (time-series persistence) | **Core effort** — the real engineering |
| DEX liquidity / volume | Partial (Minswap good, others weak) | Medium | Medium | **Core effort** |
| Wallet / portfolio | Derived (needs price layer) | Medium | Medium | **Phase 2** — depends on price layer |
| Project / category metadata | None open | High (curation) | High (editorial) | **Genuine moat** — unique & perishable |

---

## 5. Minimum viable API

The smallest surface that re-floats the orphaned **HIGH-demand** consumers (wallets, dashboards, bots), with cheap wins bundled in:

1. `GET /token/price?unit=` — spot price ADA & USD (Minswap/DexHunter-derived, cached).
2. `GET /token/ohlcv?unit=&interval=` — candles (persisted from a price-polling job).
3. `GET /token/mcap?unit=` — price × on-chain supply.
4. `GET /tokens/top?by=mcap|volume` — rankings derived from the above.
5. `GET /token/holders?unit=` — holder count + top holders (Koios/Blockfrost passthrough).
6. `GET /token/metadata?unit=` — CIP-26 passthrough (+ on-chain CIP-25/68 merge).
7. `GET /nft/collection/stats?policy=` — floor + volume + sales (OpenCNFT proxy).
8. `GET /project/{id}` and `GET /categories`, `GET /category/{slug}` — the curated project/category layer (the moat; seeded from the Memory Layer archive).

Items 1–4 are the core engineering; 5–7 are thin proxies; 8 is the differentiator nothing else serves openly. Everything else (indicators, rarity, debt, per-asset NFT, fiat config) is explicitly **out of MVP scope** — client-computable or low-demand.

---

## Appendix — source-to-capability matrix

YES / PARTIAL / NO per (capability × source). Access models and caveats in `MVP_REPLACEMENT_BLUEPRINT.md` §3.

| Capability | Koios | DexHunter | Minswap | Cardanoscan | OpenCNFT | Blockfrost | DefiLlama | CIP-26 registry | db-sync |
|---|---|---|---|---|---|---|---|---|---|
| Token current price | NO | YES | YES | NO | NO | NO | PARTIAL | NO | NO |
| Token OHLCV | NO | PARTIAL | YES | NO | NO | NO | PARTIAL | NO | PARTIAL |
| DEX liquidity & volume/token | NO | YES | YES | NO | NO | NO | PARTIAL | NO | PARTIAL |
| Market cap / FDV | NO | PARTIAL | PARTIAL | NO | NO | PARTIAL | PARTIAL | NO | PARTIAL |
| Holder count & top holders | YES | NO | NO | PARTIAL | NO | YES | NO | NO | YES |
| Token off-chain metadata | YES | PARTIAL | PARTIAL | PARTIAL | NO | YES | NO | YES | PARTIAL |
| NFT floor price | NO | NO | NO | NO | YES | NO | NO | NO | NO |
| NFT volume & sales | NO | NO | NO | NO | YES | NO | NO | NO | PARTIAL |
| NFT holder distribution | PARTIAL | NO | NO | NO | YES | PARTIAL | NO | NO | PARTIAL |
| Project metadata | NO | NO | NO | NO | NO | NO | PARTIAL | NO | NO |
| Project category/taxonomy | NO | NO | NO | NO | NO | NO | PARTIAL | NO | NO |

Key access facts: Koios free (5k/day public, 50k keyed); Blockfrost free key (~10 req/s); OpenCNFT open with attribution; Minswap first-party docs/SDK; DexHunter partner-key, execution-oriented; CIP-26 fully free, opt-in coverage; DefiLlama free, DeFi-only + protocol category tags; db-sync = self-host, maximal control/effort. jpg.store API is **sunset** — route NFT needs to OpenCNFT. GeniusYield/SundaeSwap/WingRiders have **no documented public analytics REST APIs** — reach via aggregators or on-chain reads.
