// Upstream fetch helpers built on Node 22's global fetch. Timeout + bounded
// retry + consistent UA. Throws UpstreamError on failure so module handlers can
// map it to a clean { status, body } response.

import { config } from './config.js';

export class UpstreamError extends Error {
  constructor(message, { status = 502, source, cause } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.source = source;
    this.cause = cause;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET (or other method) a URL and parse JSON.
 * @param {string} url
 * @param {object} [opts]
 * @param {string} [opts.method]
 * @param {object} [opts.headers]
 * @param {any} [opts.body] - JSON-serialized if present
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.retries]
 * @param {string} [opts.source] - label for errors
 */
export async function fetchJSON(url, opts = {}) {
  const { method = 'GET', headers = {}, body, timeoutMs = 12_000, retries = 2, source } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        signal: ac.signal,
        headers: {
          'accept': 'application/json',
          'user-agent': config.userAgent,
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new UpstreamError(`upstream ${res.status}`, { status: 502, source });
        if (attempt < retries) { await sleep(250 * (attempt + 1)); continue; }
        throw lastErr;
      }
      if (!res.ok) {
        throw new UpstreamError(`upstream ${res.status} for ${url}`, { status: res.status === 404 ? 404 : 502, source });
      }
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof UpstreamError) { lastErr = err; if (err.status === 404) throw err; }
      else lastErr = new UpstreamError(`fetch failed: ${err.message}`, { status: 504, source, cause: err });
      if (attempt < retries) { await sleep(250 * (attempt + 1)); continue; }
      throw lastErr;
    }
  }
  throw lastErr;
}

export default fetchJSON;
