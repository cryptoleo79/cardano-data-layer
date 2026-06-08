# API Use Cases — `https://api.asy.life`

**Who can consume this today?** Ten concrete, realistic integrations for the
public, read-only Cardano Data Layer API. Every endpoint is a `GET`, requires no
key, is CORS-open (`Access-Control-Allow-Origin: *`), and returns a `_quality`
provenance block (or a flat `source` + `as_of` envelope on the legacy
`nft`/`onchain` routes) so the consumer always knows where a value came from and
how authoritative it is.

The recurring reason to use this API instead of calling raw Koios (or Blockfrost,
DexHunter, Minswap, OpenCNFT) directly is **consolidation + provenance**: one
base URL, no key management, on-the-fly fallback between upstreams, and a
machine-readable authority class (`A` on-chain / `B` official / `C` at-risk /
`D` community / `E` researcher) attached to every value. Raw Koios gives you the
number; it does not tell you how confident to be in it, does not cross-check the
price against a second DEX, and does not fall back to Blockfrost when it times
out.

---

## 1. DRep personal website

- **Consumer:** An individual DRep maintaining their own static campaign / record page.
- **What they build:** A "my voting record" widget that shows the DRep's current voting power, delegator count, and how they voted on recent governance actions — fetched live, client-side, with no backend.
- **Endpoints used:** `/dreps/:id`, `/votes`, `/actions/:id`
- **Example call:**
  ```bash
  curl -s "https://api.asy.life/dreps/drep1abc...xyz"
  ```
- **Why this API vs raw Koios:** A static personal site can call this directly from the browser because CORS is open and no key is exposed in client JS — calling Koios with a bearer token from the browser would leak the token. The `_quality` block (authority class `A`, observatory CC0 export) lets the DRep honestly label the data's provenance instead of presenting unsourced numbers.

## 2. Governance dashboard

- **Consumer:** A community governance-tracking dashboard (think a 1694.io / GovTool-style view).
- **What they build:** A live board of open governance actions, their type/outcome, recent vote flow, and the current treasury balance with an epoch-over-epoch series.
- **Endpoints used:** `/actions?type=&outcome=`, `/actions/:id`, `/votes`, `/dreps`, `/treasury`
- **Example call:**
  ```bash
  curl -s "https://api.asy.life/actions?type=TreasuryWithdrawals&outcome=enacted"
  curl -s "https://api.asy.life/treasury"
  ```
- **Why this API vs raw Koios:** Treasury on Koios is *derived* — you must stitch `/totals` together with proposal endpoints; here it's a single `/treasury` route returning the latest epoch, a balance series, and withdrawals pre-assembled. Filtering actions by `type`/`outcome` is built in rather than client-side over a raw list, and the `503`-on-missing-export behavior means the dashboard degrades gracefully instead of rendering fabricated rows.

## 3. Light wallet

- **Consumer:** A non-custodial light wallet (mobile or browser-extension).
- **What they build:** The per-asset row in a portfolio view — token ticker/logo, spot price in ADA and USD, and 24h context — for every native token a user holds.
- **Endpoints used:** `/token/price?unit=`, `/token/metadata?unit=`, `/token/:id`
- **Example call:**
  ```bash
  curl -s "https://api.asy.life/token/:id" \
    --url "https://api.asy.life/token/279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b"
  ```
- **Why this API vs raw Koios:** Koios has no price at all — a wallet would otherwise have to integrate DexHunter *and* Minswap *and* a metadata source separately. `/token/:id` merges CIP-26 metadata, on-chain supply, DEX-aggregate price (DexHunter with a Minswap cross-check), and holder count in **one** call, and USD is derived on-chain via the ADA/USDM pair rather than a third-party fiat oracle, so the wallet stays self-consistent.

## 4. Chain explorer

- **Consumer:** A lightweight block/asset explorer.
- **What they build:** An asset detail page: total/circulating supply, mint/burn counts, holder count and top-N holder distribution, plus metadata.
- **Endpoints used:** `/token/supply?unit=`, `/token/holders?unit=`, `/token/metadata?unit=`
- **Example call:**
  ```bash
  curl -s "https://api.asy.life/token/holders?unit=279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b"
  ```
- **Why this API vs raw Koios:** Holder lists are exactly where free Koios gets rate-limited (5k/day) and occasionally times out; this service transparently falls back Koios → Blockfrost and serves cached values on transient upstream errors, so the explorer page keeps rendering. The `holder_count_is_lower_bound` flag and the honest `note` on `/token/supply` ("excludes treasury/locked tokens which are not knowable on-chain") spare the explorer from over-claiming precision.

## 5. Builder / project directory page

- **Consumer:** An ecosystem directory or "Built on Cardano"-style catalogue.
- **What they build:** A browsable project catalogue with per-category filtering and a project detail page that shows where each field came from.
- **Endpoints used:** `/projects`, `/project/search?q=`, `/project/:id`, `/categories`, `/category/:slug`, `/history/:project`
- **Example call:**
  ```bash
  curl -s "https://api.asy.life/category/dex"
  curl -s "https://api.asy.life/project/minswap"
  ```
- **Why this API vs raw Koios:** This data does not exist on Koios at all — project/category metadata is the largest open gap in the Cardano data landscape (CardanoCube is "all rights reserved", Built on Cardano is thin and capped at 1000 req/day total). The Data Layer exposes an event-sourced Project Memory with **per-field provenance and evidence** plus an append-only `/history/:project` log, so a directory can show "category: DEX (source: cardanocube, authority D)" rather than an unsourced tag.

## 6. SPO / stake-pool operator tool

- **Consumer:** An SPO running an operator-facing ops panel or delegator-comms tool.
- **What they build:** A governance-context panel for delegators — current treasury trajectory, recent governance actions an SPO might pool-vote on, and a market overview for tracked tokens the pool's community cares about.
- **Endpoints used:** `/treasury`, `/actions`, `/markets`, `/tokens/top?by=`
- **Example call:**
  ```bash
  curl -s "https://api.asy.life/tokens/top?by=mcap&limit=10"
  curl -s "https://api.asy.life/markets"
  ```
- **Why this API vs raw Koios:** An SPO box already runs a node; the value here is *not re-deriving* market and treasury views from scratch. `/markets` and `/tokens/top` give a tracked-set overview in one call (honestly labeled `coverage: partial` so it is not mistaken for a full ecosystem ranking), and treasury comes pre-assembled rather than computed from `/totals` + proposals.

## 7. Researcher / Jupyter notebook

- **Consumer:** An academic or data analyst working in a notebook.
- **What they build:** A reproducible governance-and-treasury dataset — DRep power distribution, action outcomes, vote records, and the treasury time series — for analysis, with citable provenance.
- **Endpoints used:** `/dreps`, `/votes`, `/actions?type=&outcome=`, `/treasury`, `/openapi.json`
- **Example call:**
  ```bash
  curl -s "https://api.asy.life/treasury" -o treasury.json
  curl -s "https://api.asy.life/votes" -o votes.json
  ```
- **Why this API vs raw Koios:** Reproducibility. Every response carries an `as_of` timestamp, an `authority_class`, and a human-readable `provenance` string, so a paper can cite exactly which snapshot and which upstream produced each figure — the governance/treasury data is backed by the observatory's **CC0** exports, which is a clean license for republication. Raw Koios gives no `as_of`-stamped, license-clear envelope and no consolidated treasury series.

## 8. Discord / Telegram bot

- **Consumer:** A community-server price/governance bot.
- **What they build:** Slash commands like `/price MIN`, `/mcap`, and `/gov` that post a token's price, market cap, or the latest governance action into a chat channel.
- **Endpoints used:** `/token/search?q=`, `/token/price?unit=`, `/token/mcap?unit=`, `/actions`
- **Example call:**
  ```bash
  curl -s "https://api.asy.life/token/search?q=MIN"
  curl -s "https://api.asy.life/token/mcap?unit=29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c64d494e"
  ```
- **Why this API vs raw Koios:** A bot wants ticker → price in one hop; `/token/search` resolves a human ticker to a unit (over the tracked/seed set plus DexHunter) and `/token/mcap` returns `price x on-chain supply` already computed. Koios has no price and no search-by-ticker, so the bot would otherwise juggle three upstreams and their separate keys — here it is one keyless base URL with built-in caching, which matters for chat-bot request spikes.

## 9. Token-info widget (embeddable)

- **Consumer:** A third-party site embedding a small token card (project homepage, blog, news site).
- **What they build:** A drop-in `<script>`/iframe widget showing a token's logo, price, market cap, and a small OHLCV sparkline, fetched entirely client-side.
- **Endpoints used:** `/token/metadata?unit=`, `/token/price?unit=`, `/token/mcap?unit=`, `/token/ohlcv?unit=&interval=&limit=`
- **Example call:**
  ```bash
  curl -s "https://api.asy.life/token/ohlcv?unit=279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b&interval=1h&limit=24"
  ```
- **Why this API vs raw Koios:** An embeddable widget *must* run from the browser with no secret — CORS `*` and no key make this the only one of the upstreams that can be dropped into client JS safely. OHLCV candles are bucketed on read from collected ticks, so the widget asks for `interval=1h&limit=24` and gets a ready-to-plot series instead of assembling candles from raw DEX trades.

## 10. NFT collection page

- **Consumer:** An NFT project's own minting/landing site, or a marketplace-style collection view.
- **What they build:** A collection header (floor, total volume, listings, owners, supply) plus a "recent sales" feed.
- **Endpoints used:** `/nft/collection/stats?policy=`, `/nft/collection/sales?policy=&page=`
- **Example call:**
  ```bash
  curl -s "https://api.asy.life/nft/collection/stats?policy=40fa2aa67258b4ce7b5782f74831d46a84c59a0ff0c28262fab21728"
  ```
- **Why this API vs raw Koios:** Koios does not provide NFT floor/volume/sales analytics — that data came from jpg.store (now sunset) and OpenCNFT. This service wraps OpenCNFT behind a stable, keyless URL and handles the attribution-required licensing context for you. It is honest that `usd` is always `null` (no fiat oracle wired) rather than inventing a dollar figure — useful for a collection page that should not misstate value.

---

## Bonus domain: Catalyst preservation

Beyond the ten above, the **Catalyst** module (`/archive`, `/funds`, `/fund/:id`,
`/proposals`) lets a Catalyst-history or research consumer browse a
chain-of-custody preservation archive of fund artifacts. Coverage is
deliberately **sparse** and the service never fabricates proposals — a missing
archive returns `503` rather than guessed data. This is the only place several at-risk
IdeaScale/Catalyst artifacts survive in a queryable, provenance-stamped form.

---

## Integration notes

- **No key, no auth.** Every route is a `GET`; there is nothing to sign up for and no token to rotate. (Upstream keys, where needed, are held server-side by the operator, never by the consumer.)
- **CORS open (`*`).** Safe to call directly from browser JavaScript — light wallets, embeddable widgets, and static DRep sites can integrate with zero backend.
- **`_quality` on (almost) everything.** Token, market, project, governance, and catalyst responses carry a nested `_quality` block (`source`, `authority_class` A–E, `refresh`, `confidence`, `provenance`, `as_of`). The legacy `nft` and `onchain` routes (`/token/holders`, `/token/supply`, `/token/metadata`, `/nft/*`, `/tokens/top`) emit a **flatter** envelope — top-level `source` + `as_of`, no nested object. Consumers should read both shapes.
- **Read-only, no fabrication.** Unknown values come back as `null` with a `note` (e.g. NFT `usd` is always `null`; token `usd` is `null` when the ADA/USDM pair is not routable). Missing governance/catalyst exports return `4xx`/`503` with an envelope-shaped error rather than crashing or inventing data.
- **Rate expectations.** No published per-client quota; the service caches upstream responses with per-route TTLs and can serve a stale value on transient upstream errors, so client request volume rarely maps 1:1 to upstream calls. Be a good citizen — cache on your side and avoid tight polling loops. The binding limits are the upstreams' free tiers (Koios ~5k/day, Blockfrost ~10 req/s, DexHunter/Minswap fair-use) which this layer is designed to amortize across all consumers.
- **Attribution.** Consumers surfacing NFT data should credit **OpenCNFT** (its license requires it). Governance/treasury data is CC0.
- **Discoverability.** `GET /routes` lists every live route; `GET /openapi.json` is the machine-readable OpenAPI 3.1 spec; `GET /health` is the liveness probe.
