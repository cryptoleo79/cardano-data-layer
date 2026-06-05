// Data-quality envelope (Stream H). Every endpoint wraps its body with a
// `_quality` block so consumers always know: where the data came from, its
// authority class, how fresh it is, how confident we are, and its provenance.
//
// Authority classes (METHODOLOGY §24.3): A on-chain · B official · C at-risk
// platform · D community · E researcher.
// Refresh cadence vocabulary: 'realtime' | '~1m' | '~5m' | 'hourly' | 'daily'
//   | 'static' (archive-derived, changes only on re-seed) | 'on-demand' (proxied live).

const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);

/**
 * Wrap a response body with a data-quality block.
 * @param {object} body
 * @param {object} q - { source, authority_class, refresh, confidence, provenance, as_of }
 */
export function dq(body, q = {}) {
  const confidence = VALID_CONFIDENCE.has(q.confidence) ? q.confidence : 'high';
  return {
    ...body,
    _quality: {
      source: q.source ?? null,
      authority_class: q.authority_class ?? null,
      refresh: q.refresh ?? null,
      confidence,
      provenance: q.provenance ?? null,
      as_of: q.as_of ?? new Date().toISOString(),
    },
  };
}

/** Shorthand for a clean error body (still envelope-shaped for consistency). */
export function dqError(status, error, q = {}) {
  return { status, body: dq({ error }, { confidence: 'low', ...q }) };
}

export default dq;
