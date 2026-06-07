// Transforms the Built on Cardano directory dump (/tmp/projects_out.json, the
// SSG payload of builtoncardano.com/ecosystem/all) into a committed seed file
// for Project Memory: seed/builtoncardano-projects.json. Run once to (re)generate.
// Category assignments are derived from each project's `industries` via an
// explicit, auditable map — no hidden edits. Source authority = B (Cardano
// Foundation-curated directory).
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = process.env.BOC_SRC || '/tmp/projects_out.json';
const projects = JSON.parse(readFileSync(SRC, 'utf8'));

// industry → Project Memory category slug (verified subset of the 74 slugs).
const MAP = {
  'user tools':'tools','nft collections':'nft','defi':'defi','art':'art-nfts','games & gaming':'gaming',
  'project building resources':'developer-tools','developer tools':'developer-tools','community & learning':'community',
  'industry solutions':'industry-solutions','wallets':'wallets','wallet':'wallets','wallet library':'wallets',
  'utility':'utility','dex':'exchanges-dex','light wallet':'light-wallets','nft marketplace':'nft-marketplaces',
  'memecoins':'meme-coins','shitcoin':'shitcoin','blockchain explorer':'blockchain-explorers','metaverse':'metaverse',
  'launchpad & accelerator':'launchpad','lending protocol':'lending-borrowing','staking':'staking-tools',
  'stake pool operator tools':'staking-tools','stake pool monitoring tool':'staking-tools','stake pool services':'staking-tools',
  'animal':'animals','nft explorer':'nfttools','nft & token minting':'nfttools','nft minting':'nfttools','club':'club',
  'pfp & avatar':'pfp-avatar-nfts','calendar':'calendar','youtube channel':'youtube','investment management':'investment-management',
  'blog':'blog','charity & causes':'charity-causes','dao tool':'dao-tools','dao tools':'dao-tools',
  'asset tokenization':'asset-tokenization','housing & property':'housing-property','media':'media','podcast':'media',
  'meetups & events':'meetups-events','social bots & tools':'social','social':'social',
  'community building & management':'community-building-management','defense system':'defense-system','funding':'funding',
  'project catalyst':'funding','hardware wallet':'hardware-wallets','calculator':'tools','gambling':'gambling',
  'immutable data':'immutable-data','stablecoin':'stablecoin','token distribution tool':'token-distribution-tooling',
  'decentralized identity':'identity','identity':'identity','education':'education','developer education':'education',
  'p2p swap':'peer-to-peer','payment solution':'payment','retail':'retail','store of value':'store-of-value',
  'iot':'internet-of-things','cross chain assets':'cross-chain-assets','consultant':'consultancy','telecom':'telecom',
  'audit':'audit','computing & ai':'computing-ai','full node wallet':'full-node-wallet','healthcare':'health-care',
  'insurance':'insurance','job platform':'job-platform','layer 2 solutions':'layer-2-solution','private transaction':'private-transactions',
};
// industries that denote a defunct project (status, not category).
const DEFUNCT = new Set(['project graveyard','failed project','rug pull','exit scam']);

const norm = (s) => String(s || '').replace(/&amp;/g, '&').trim().toLowerCase();

const out = [];
const seenSlug = new Set();
for (const p of projects) {
  const slug = p.slug && p.slug.trim();
  if (!slug || seenSlug.has(slug)) continue;
  seenSlug.add(slug);
  const inds = (p.industries || []).map(norm);
  const cats = [...new Set(inds.map((i) => MAP[i]).filter(Boolean))];
  const defunct = inds.some((i) => DEFUNCT.has(i));
  out.push({
    id: `boc:${slug}`,            // namespace to avoid collision with cardanocube/taptools ids
    name: String(p.name || slug).replace(/&amp;/g, '&'),
    link: (p.link || '').trim() || null,
    description: (p.description || '').replace(/&amp;/g, '&').slice(0, 280) || null,
    categories: cats,
    status: defunct ? 'defunct' : 'active',
  });
}

const dst = new URL('./builtoncardano-projects.json', import.meta.url).pathname;
writeFileSync(dst, JSON.stringify({
  source: 'builtoncardano',
  source_url: 'https://builtoncardano.com/ecosystem/all',
  authority_class: 'B',
  as_of: '2026-06-07',
  note: 'Cardano-Foundation-curated Built on Cardano directory (SSG payload; documented JSON API was 404 on capture date). Categories mapped from project industries via an explicit map.',
  count: out.length,
  projects: out,
}, null, 2));
const withCats = out.filter((p) => p.categories.length).length;
console.log(`wrote ${out.length} projects (${withCats} with >=1 category, ${out.filter(p=>p.status==='defunct').length} defunct) -> builtoncardano-projects.json`);
