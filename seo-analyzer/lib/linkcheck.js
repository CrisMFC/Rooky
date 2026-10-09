'use strict';

const { fetchUrl, mapLimit } = require('./http');

/**
 * Verifica el estado de los enlaces externos (muestra limitada).
 * Solo se marcan como rotos 404/410, 5xx y dominios inexistentes; los 401/403/429
 * suelen ser bloqueos anti-bot y se marcan como "no verificables".
 */
async function checkExternalLinks(pages, { max = 100, concurrency = 6, timeout = 12000, userAgent, onProgress = () => {} } = {}) {
  const sources = new Map();
  for (const p of pages) {
    if (!p.analysis || p.status < 200 || p.status >= 300) continue;
    for (const l of p.analysis.links) {
      if (l.internal) continue;
      if (!sources.has(l.href)) sources.set(l.href, new Set());
      sources.get(l.href).add(p.url);
    }
  }
  const all = [...sources.keys()];
  const targets = all.slice(0, max);
  let done = 0;
  const results = await mapLimit(targets, concurrency, async (url) => {
    let res = await fetchUrl(url, { method: 'HEAD', timeout, userAgent, readBodyContent: false });
    if (res.status === 405 || res.status === 403 || res.status === 400 || res.status === 501 || (res.status === 404 && res.headers.server && /cloudflare|akamai/i.test(res.headers.server))) {
      res = await fetchUrl(url, { timeout, userAgent, maxBytes: 64 * 1024 });
    }
    done++;
    onProgress({ done, total: targets.length });
    const dns = res.error && /ENOTFOUND|DNS/.test(res.error);
    let state = 'ok';
    if (res.status === 404 || res.status === 410 || res.status >= 500 || dns) state = 'broken';
    else if (res.status === 0 || res.status === 401 || res.status === 403 || res.status === 429 || res.status === 999 || res.status >= 400) state = 'unverified';
    return { url, status: res.status, error: res.error, state, finalUrl: res.finalUrl, sources: [...sources.get(url)] };
  });
  return {
    totalExternal: all.length,
    checked: results.length,
    broken: results.filter((r) => r.state === 'broken'),
    unverified: results.filter((r) => r.state === 'unverified'),
    ok: results.filter((r) => r.state === 'ok').length,
  };
}

module.exports = { checkExternalLinks };
