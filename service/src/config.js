// Central configuration. All values come from environment variables with safe
// defaults, so the service runs with zero setup and no secrets in the repo.
// Source access models (see ../TAPTOOLS_API_GAP_ANALYSIS.md appendix):
//   - Koios: public tier needs no key (5k req/day). Optional bearer token.
//   - Blockfrost: needs a free project_id (BLOCKFROST_PROJECT_ID) for /assets.
//   - CIP-26 token registry: fully free, no key.
//   - OpenCNFT: open with an X-Api-Key; attribution required.
//   - Minswap / DexHunter: keyed-but-free; DexHunter needs X-Partner-Id.
// A source with no key still loads; its module degrades gracefully and reports
// `source_unavailable` rather than crashing.

const env = process.env;
const int = (v, d) => (v == null || v === '' ? d : Number.parseInt(v, 10));

export const config = {
  port: int(env.PORT, 8787),
  host: env.HOST || '127.0.0.1',
  userAgent: env.CDL_USER_AGENT || 'cardano-data-layer/0.1 (+https://github.com/cryptoleo79)',
  dbPath: env.CDL_DB_PATH || new URL('../data/cdl.sqlite', import.meta.url).pathname,
  seedDir: env.CDL_SEED_DIR || new URL('../seed/', import.meta.url).pathname,

  // cache TTLs (ms)
  cache: {
    price: int(env.CDL_TTL_PRICE, 60_000),
    holders: int(env.CDL_TTL_HOLDERS, 600_000),
    metadata: int(env.CDL_TTL_METADATA, 3_600_000),
    nft: int(env.CDL_TTL_NFT, 300_000),
    supply: int(env.CDL_TTL_SUPPLY, 600_000),
    rankings: int(env.CDL_TTL_RANKINGS, 120_000),
  },

  // upstream sources
  sources: {
    koios: { base: env.KOIOS_BASE || 'https://api.koios.rest/api/v1', token: env.KOIOS_TOKEN || null },
    blockfrost: {
      base: env.BLOCKFROST_BASE || 'https://cardano-mainnet.blockfrost.io/api/v0',
      projectId: env.BLOCKFROST_PROJECT_ID || null,
    },
    cip26: { base: env.CIP26_BASE || 'https://tokens.cardano.org/metadata' },
    opencnft: { base: env.OPENCNFT_BASE || 'https://api.opencnft.io/2', apiKey: env.OPENCNFT_API_KEY || null },
    minswap: { base: env.MINSWAP_BASE || 'https://api.minswap.org' },
    dexhunter: { base: env.DEXHUNTER_BASE || 'https://api-us.dexhunterv3.app', partnerId: env.DEXHUNTER_PARTNER_ID || null },
  },

  // ohlcv poller cadence (ms) and which units to track
  poller: {
    intervalMs: int(env.CDL_POLL_INTERVAL, 300_000), // 5 min
    units: (env.CDL_POLL_UNITS || '').split(',').map((s) => s.trim()).filter(Boolean),
  },
};

export default config;
