# Market Coverage Audit

**Date:** 2026-06-09
**Scope:** `GET /tokens/top` (the Market Rankings page) and the token-market pipeline behind it (`service/src/modules/token.js`, `service/seed/tracked-tokens.json`, the OHLCV poller, and the DexHunter / Minswap / Koios sources).
**Trigger:** the rankings table is technically correct but visually reads as "top Cardano tokens," when it is in fact "top tokens among a 110-token tracked seed set" — and several of its numbers are distorted or empty.

This audit states the limitations explicitly rather than hiding them. The companion UI change adds a prominent "Experimental coverage" banner, a coverage metric, an honest per-tab empty-state, and renames the page **Market Rankings (Tracked Set)**.

---

## 1. Coverage: how much of the ecosystem is this?

| Measure | Value | Source |
|---|---|---|
| Tracked seed tokens | **110** | `seed/tracked-tokens.json` |
| Priced now (mcap computable) | **103 / 110** | live `/tokens/top?by=mcap` `computable` |
| Verified tradeable Cardano tokens | **≈ 1,044** | DexHunter `GET /swap/tokens` (live, 2026-06-09) |
| **Estimated ecosystem coverage** | **≈ 11 %** (110 / 1,044) | derived |

Against *all* Cardano native assets (millions, almost all non-tradeable) coverage is negligible; the meaningful denominator is **actively-traded tokens**, for which DexHunter's verified list (~1,044) is the best honest reference. **~11 %** is the figure to surface — not "the top Cardano tokens."

---

## 2. Why "major ecosystem assets are not dominating the list"

The mcap tab is dominated by stablecoins with broken supply, while volume and liquidity are entirely empty. Each cause below is verified against live data.

### 2a. Market-cap calculation uses **total supply, not circulating** — and the total is sometimes a mint cap

`mcap = latest poller price (ADA) × Koios asset_info.total_supply / 10^decimals` (`token.js` `topHandler` → `koiosSupply`).

Live spot-check (`/token/mcap`):

| Token | decimals | supply (reported) | price (ADA) | mcap (ADA) | reality |
|---|---|---|---|---|---|
| **DJED** | 6 | **1,000,000,000,000** | 5.70 | **5.70 trillion** | DJED circulating is single-digit millions. 1e12 is a mint-cap/placeholder, not circulating. |
| **SHEN** | 6 | **1,000,000,000,000** | 0.47 | **466 billion** | identical 1e12 to DJED → clearly not real circulating supply. |
| USDM | 6 | 14,665,889 | 5.83 | 85.5 M | plausible. |
| iUSD | 6 | 1,933,788 | 5.79 | 11.2 M | plausible. |
| SNEK | 0 | 76,715,880,000 | 0.0022 | 167.8 M | correct (SNEK is 0-decimals, 76.7 B). |
| AGIX | 8 | 225,925,303 | 0.54 | 121.5 M | plausible (bridged portion). |
| HOSKY | 0 | 1,000,000,000,001 | 4.5e-8 | 44.5 M | ~correct. |

**DJED and SHEN both report exactly `1,000,000,000,000`** — two different assets cannot share that round number as real circulating supply. Koios `total_supply` for these reflects a minting cap / mint-burn artifact, not circulating supply. Result: the two coins wrongly occupy ranks #1–#2 by mcap and crowd out genuinely large assets (SNEK, AGIX, WMT, IAG).

Even where `total_supply` is accurate, **total ≠ circulating**, so the ranking will never match the circulating-mcap leaderboards users expect from CMC/TapTools.

### 2b. Volume tab has **no data at all** (`computable = 0`)

`/tokens/top?by=volume` returns `computable: 0` — every `metric.ada` is `null`. Volume is summed from `ohlcv.v`, but the poller writes price ticks with **`v = null`** (the OHLCV handler itself notes "volume is null; per-interval on-chain volume not yet captured"). With all metrics null, the sort falls back to insertion order, so the tab shows a list that *looks* ranked but encodes nothing. This is the clearest "technically correct, visually misleading" case.

### 2c. Liquidity tab has **no data at all** (`computable = 0`)

`/tokens/top?by=liquidity` also returns `computable: 0`. Liquidity comes solely from `minswap.tokenStats(unit)`, which is currently returning `null` for every unit. Two consequences:
- the liquidity tab is empty (same arbitrary-order artifact as volume);
- it would be **Minswap-only even when working** — tokens whose depth lives on Splash / SundaeSwap / MuesliSwap / WingRiders would under-rank.

### 2d. Minswap source is down across the board → every price is single-source, confidence `low`

Every `/token/mcap` response carries `confidence: low` and `note: "single-source price; not cross-checked"`. Price `confidence: high` requires DexHunter **and** Minswap to agree within 5 % (`resolvePrice`). Minswap is returning `null` everywhere right now, so **no price is cross-checked** and **every** ranking value is low-confidence. This is the same Minswap outage that empties the liquidity tab (2c).

### 2e. Token selection is a hand-curated 110-token seed with no decimals

`seed/tracked-tokens.json` = 110 tokens (38 unattributed + 72 `dexhunter-verified`). **None carry a `decimals` field**, so decimals depend entirely on Koios `token_registry_metadata`, which defaults to `0` when missing (`token.js:181`). A token that is really 6-decimals but lacks registry decimals would have its supply — and mcap — overstated by 10^6. (No current top-10 token is confirmed to hit this, but it is an unguarded failure mode baked into the seed.)

---

## 3. Audit questions answered

### Which major tokens are missing from the tracked set?
The seed covers many leaders (SNEK, MIN, AGIX, WMT/WMTX, DJED, SHEN, USDM, iUSD, INDY, MELD, LQ, GENS, NMKR, COPI, IAG, SUNDAE, BOOK, NEWM, VYFI…). Candidates that appear **absent or only present under a stale ticker**, to verify for inclusion:
- **USDA** (Anzens stablecoin) — absent.
- **iBTC** (Indigo synthetic) — absent (iETH and iUSD are present).
- **LENFI** — present only as the old ticker **AADA**; should be reconciled to LENFI.
- **FET** — present only as **AGIX**; SingularityNET rebranded to FET. Needs reconciliation.
- **STRIKE** (Strike Finance), **WRT** (WingRiders), **SPLASH** (Splash), **BTN** (Butane) — verify rank, likely missing.
- Liquid-staking tokens (LSTs) — none tracked.

> Method note: this list is "candidates to verify," not a definitive missing-set. We have no ground-truth ranking to diff against, which is itself a coverage limitation.

### Which tracked tokens have bad metadata?
- The seed carries **no decimals** for any token (§2e) — metadata completeness gap.
- Rebranded tickers (**AADA→LENFI, AGIX→FET**) are stale.

### Which tracked tokens have incorrect supply?
- **DJED** and **SHEN**: reported supply `1,000,000,000,000` is a mint-cap artifact, not circulating (§2a) — the highest-impact defect, since it controls the #1/#2 mcap ranks.
- All tokens: **total supply is used where circulating is intended**, so every mcap is conceptually overstated relative to a circulating-mcap leaderboard.

### Which tracked tokens have stale prices?
- Prices are **last poller tick**, not live, on the rankings path (by design, for speed). Freshness = poller cadence (~5 m) and depends on the poller having ticked that unit.
- **Every** price is currently single-source / not cross-checked (Minswap down, §2d) → confidence `low` across the board.

---

## 4. Path from "110 tracked" to trustworthy coverage

Ordered by trust-per-effort. (Recommendations — not yet implemented; no schema change is required for 4a–4d.)

1. **Fix supply → use circulating, not raw total.** Cap or correct mint-artifact supplies (DJED/SHEN), and prefer a circulating measure. At minimum, flag tokens whose `total_supply` looks like a round mint cap and drop them from the mcap sort (or mark `confidence: low`). *Highest impact — fixes the #1/#2 distortion.*
2. **Restore the Minswap cross-check** (or add a second DEX source) so prices reach `confidence: high` and the liquidity tab populates. Investigate the current Minswap outage.
3. **Capture real volume** in the poller (`ohlcv.v`) or drop the volume tab until it has data — do not render an empty table as a ranking.
4. **Carry decimals in the seed** so mcap can't silently break on missing Koios registry decimals; reconcile stale tickers (AADA→LENFI, AGIX→FET).
5. **Grow the seed toward the tradeable universe** — ingest DexHunter's ~1,044 verified tokens (or the top-N by liquidity) so coverage rises from ~11 % toward the set users actually trade.

## 5. Until then — honesty in the UI (implemented)

- A prominent **"Experimental coverage"** banner at the top of the rankings page.
- The page is renamed **Market Rankings (Tracked Set)**.
- A coverage metric: **Tracked 110 · Priced 103 · ≈11 % of ~1,044 verified tradeable tokens**.
- Volume and liquidity tabs show an **explicit "metric not available" notice** when `computable = 0`, instead of an arbitrary-order table.
- The mcap caveat (total-supply, single-source, last-tick) is stated on the page, not just in `_quality`.

Limitations are made explicit, not hidden.
