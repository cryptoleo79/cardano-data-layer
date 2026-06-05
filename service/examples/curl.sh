#!/usr/bin/env bash
# Cardano Data Layer — runnable curl examples.
#
# Usage:
#   ./curl.sh                      # run against http://127.0.0.1:8787
#   BASE=https://your-host ./curl.sh
#
# The Data Layer is READ-ONLY and needs NO auth. Every token/market/project/
# governance/catalyst response carries a `_quality` data-quality block.
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:8787}"

# A few well-known sample units / policies (seed set + a popular NFT policy).
SNEK="279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b"
MIN="29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c64d494e"
NFT_POLICY="40fa2aa67258b4ce7b5782f74831d46a84c59a0ff0c28262fab21728"

# Pretty-print JSON if jq is available; otherwise pass through.
pp() { if command -v jq >/dev/null 2>&1; then jq .; else cat; fi; }
hit() { echo; echo "### GET $1"; curl -sS "$BASE$1" | pp; }

echo "# Cardano Data Layer examples  (BASE=$BASE)"

# --- System ---
hit "/health"
hit "/routes"

# --- Token ---
hit "/token/price?unit=$SNEK"
hit "/token/ohlcv?unit=$SNEK&interval=1h&limit=24"
hit "/token/mcap?unit=$SNEK"
hit "/tokens/top?by=mcap&limit=10"
hit "/token/search?q=snek"
hit "/token/list"
hit "/token/holders?unit=$SNEK"
hit "/token/supply?unit=$SNEK"
hit "/token/metadata?unit=$SNEK"
hit "/token/$SNEK"

# --- Market (planned from spec) ---
hit "/price/$SNEK"
hit "/ohlcv/$SNEK?interval=1h&limit=24"
hit "/markets"
hit "/price/history/$SNEK?limit=50"

# --- NFT ---
hit "/nft/collection/stats?policy=$NFT_POLICY"
hit "/nft/collection/sales?policy=$NFT_POLICY&page=1"

# --- Project / Category ---
hit "/projects"
hit "/project/search?q=min"
hit "/project/minswap"
hit "/categories"
hit "/category/dex"
hit "/history/minswap"

# --- Governance (planned from spec) ---
hit "/dreps"
hit "/dreps/drep1exampleid"
hit "/actions?type=TreasuryWithdrawals"
hit "/actions/exampleactionid"
hit "/votes"
hit "/treasury"

# --- Catalyst (planned from spec) ---
hit "/archive"
hit "/funds"
hit "/fund/9"
hit "/proposals"

echo
echo "# done."
