// Generates seed/categories.json and seed/projects.json from the Cardano Memory
// Layer archive (cardano-project-memory-archive). This is the synthesis described
// in MVP_REPLACEMENT_BLUEPRINT.md §4: the preservation archive seeds the project
// + category moat. Categories and project identities are re-curated under an open
// license and attributed to their source — NOT a wholesale republication of
// cardanocube's "all rights reserved" content (only neutral facts: slug, name,
// defunct status, and the public Wayback reference).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ARCHIVE = process.env.CDL_ARCHIVE || join(homedir(), 'cardano-project-memory-archive');
const here = new URL('.', import.meta.url).pathname;
const AS_OF = '2026-06-03';

// 74 categories observed at cardanocube.com/categories on 2026-06-03 (preserved
// in the archive at cardanocube/taxonomy/categories.custody.json).
const CATEGORY_SLUGS = [
  'ai','animals','art-nfts','asset-tokenization','audit','blockchain-explorers','blog','calendar',
  'charity-causes','club','community','community-building-management','computing-ai','consultancy',
  'cross-chain-assets','cross-chain-bridge','dao-tools','data','defense-system','defi','developer-tools',
  'education','exchanges-dex','full-node-wallet','funding','gambling','gaming','governance','hardware-wallets',
  'health-care','housing-property','identity','immutable-data','industry-solutions','infrastructure','insurance',
  'internet-of-things','investment','investment-management','ispo','job-platform','launchpad','layer-2-solution',
  'lending-borrowing','light-wallets','marketplaces','media','meetups-events','meme-coins','metaverse','music',
  'nft','nft-marketplaces','nfttools','partner-chain','payment','peer-to-peer','pfp-avatar-nfts','popular',
  'prediction-market','private-transactions','retail','shitcoin','social','stablecoin','staking-tools',
  'store-of-value','telecom','token-distribution-tooling','tools','utility','utility-nfts','wallets','youtube',
];

const titleize = (slug) => slug.split('-').map((w) => w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)).join(' ');

const categories = CATEGORY_SLUGS.map((slug) => ({
  slug,
  name: titleize(slug),
  source: 'cardanocube',
  source_url: `https://cardanocube.com/categories/${slug}`,
  as_of: AS_OF,
  taxonomy_note: 'Taxonomy observed as-found at cardanocube; preserved per-source, not consolidated.',
}));

// Projects: the cardanocube "graveyard" (curator-declared defunct), pulled from
// the archive custody manifests so each carries its real Wayback reference.
const projDir = join(ARCHIVE, 'cardanocube', 'projects');
const GRAVEYARD = new Set([
  'adax','blocktree','cardano-nuts','cerra-io','charlz-token','chibidango-heroes','cns','cobraking',
  'community-cyber-security-support','comunidadcardano','discoin','eikonikos','entheosai','lucid',
  'marketraker','occam-fi','occamrazer','pepeblue','rats-dao','virusx',
]);

const projects = [];
if (existsSync(projDir)) {
  for (const f of readdirSync(projDir)) {
    if (!f.endsWith('.custody.json')) continue;
    const slug = f.replace('.custody.json', '');
    if (!GRAVEYARD.has(slug)) continue;
    const c = JSON.parse(readFileSync(join(projDir, f), 'utf8'));
    projects.push({
      id: slug,
      name: titleize(slug),
      status: 'defunct',
      status_source: 'cardanocube /projects/graveyard',
      categories: [],
      source: 'cardanocube',
      source_url: c.source_url,
      archived_wayback_url: c.wayback_url || null,
      archived_sha256: c.sha256 || null,
      as_of: AS_OF,
      note: 'Curator-declared defunct ("graveyard"). Editorial profile preserved on the Wayback Machine; see archived_wayback_url. Seeded from cardano-project-memory-archive.',
    });
  }
} else {
  console.warn('archive projects dir not found:', projDir, '— writing categories only');
}
projects.sort((a, b) => a.id.localeCompare(b.id));

writeFileSync(join(here, 'categories.json'), JSON.stringify({ as_of: AS_OF, source: 'cardanocube', count: categories.length, categories }, null, 2));
writeFileSync(join(here, 'projects.json'), JSON.stringify({ as_of: AS_OF, source: 'cardanocube (graveyard)', count: projects.length, projects }, null, 2));
console.log(`wrote categories.json (${categories.length}) and projects.json (${projects.length})`);
