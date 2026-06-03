// Tiny path router. Supports static segments and :params. No deps.
// Routes are registered as { method, path, handler }. The handler receives
// ({ req, query, params, ctx }) and returns { status, body, headers? }.

function compile(path) {
  const keys = [];
  const pattern = path
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) { keys.push(seg.slice(1)); return '([^/]+)'; }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${pattern}/?$`), keys };
}

export class Router {
  constructor() { this.routes = []; }

  add(method, path, handler, meta = {}) {
    const { regex, keys } = compile(path);
    this.routes.push({ method: method.toUpperCase(), path, regex, keys, handler, meta });
  }

  /** Find a match; returns { handler, params } or null. */
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method.toUpperCase()) continue;
      const m = r.regex.exec(pathname);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return null;
  }

  list() {
    return this.routes.map((r) => ({ method: r.method, path: r.path, ...r.meta }));
  }
}

export default Router;
