// CIP-26 token registry adapter — https://tokens.cardano.org/metadata
//
// The Cardano Foundation token registry implements CIP-26: off-chain, signed
// token metadata (ticker, name, decimals, logo, url, description). Fully free,
// no key. Subject = policyId + hexAssetName (concatenated, no separator).
//
// API shapes (verified live on 2026-06-03):
//   - GET  /{subject}            → { subject, name:{value,...}, ticker:{value}, ...
//                                     decimals:{value}, logo:{value}, url:{value},
//                                     description:{value} }
//                                   Each property is an object with a `value`
//                                   field plus signatures/sequenceNumber. 404 when
//                                   the subject is not registered.
//   - POST /metadata/query       body { subjects:[...], properties:[...] }
//                                   → { subjects: [ { subject, name:{value}, ... } ] }
//
// This adapter flattens the {value} wrappers into plain scalars.

import { fetchJSON, UpstreamError } from '../http.js';
import { config } from '../config.js';

const SOURCE = 'cip26';
const PROPS = ['name', 'ticker', 'decimals', 'logo', 'url', 'description'];

const base = () => config.sources.cip26.base.replace(/\/+$/, '');

/** Pull the `.value` out of a CIP-26 property wrapper, tolerating plain scalars. */
function val(prop) {
  if (prop == null) return null;
  if (typeof prop === 'object' && 'value' in prop) return prop.value;
  return prop;
}

/** Flatten a raw registry record into plain { subject, name, ticker, ... }. */
function flatten(rec) {
  if (!rec || typeof rec !== 'object') return null;
  return {
    subject: rec.subject ?? null,
    name: val(rec.name) ?? null,
    ticker: val(rec.ticker) ?? null,
    decimals: val(rec.decimals) ?? null,
    logo: val(rec.logo) ?? null,
    url: val(rec.url) ?? null,
    description: val(rec.description) ?? null,
  };
}

/**
 * GET /{subject} — metadata for a single subject.
 * @param {string} subject policyId+hexAssetName
 * @returns {Promise<object|null>} flattened metadata, or null if not registered.
 */
export async function metadata(subject) {
  try {
    const rec = await fetchJSON(`${base()}/${subject}`, { source: SOURCE, timeoutMs: 10_000 });
    return flatten(rec);
  } catch (err) {
    // Unregistered subjects 404 — that's "no metadata", not an error.
    if (err instanceof UpstreamError && err.status === 404) return null;
    throw err;
  }
}

/**
 * POST /metadata/query — batch lookup.
 * @param {string[]} subjects
 * @param {string[]} [properties=PROPS]
 * @returns {Promise<object[]>} array of flattened records (only registered ones).
 */
export async function batch(subjects, properties = PROPS) {
  if (!Array.isArray(subjects) || subjects.length === 0) return [];
  const res = await fetchJSON(`${base()}/metadata/query`, {
    method: 'POST',
    body: { subjects, properties },
    source: SOURCE,
    timeoutMs: 12_000,
  });
  const rows = res?.subjects;
  if (!Array.isArray(rows)) return [];
  return rows.map(flatten).filter(Boolean);
}

export default { metadata, batch };
