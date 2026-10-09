'use strict';

const { fetchUrl } = require('./http');
const { analyzeHtml } = require('./onpage');
const { canonicalizeUrl, isSameSite, hasSkippedExtension } = require('./urlutil');
const { isAllowed } = require('./robots');

const KEEP_HEADERS = [
  'content-type', 'content-encoding', 'cache-control', 'server', 'x-robots-tag', 'strict-transport-security',
  'content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy',
  'last-modified', 'etag', 'vary', 'link', 'content-language',
];

function pickHeaders(h) {
  const out = {};
  for (const k of KEEP_HEADERS) if (h[k] !== undefined) out[k] = h[k];
  return out;
}

function isHtmlResponse(res) {
  const ct = String(res.headers['content-type'] || '').toLowerCase();
  if (ct) return ct.includes('text/html') || ct.includes('application/xhtml');
  return /^\s*(<!doctype html|<html)/i.test(res.text.slice(0, 500));
}

/**
 * Rastrea un sitio en anchura (BFS) respetando robots.txt y los límites indicados.
 */
async function crawlSite(startUrl, opts = {}) {
  const {
    maxPages = 50,
    maxDepth = 5,
    concurrency = 4,
    timeout = 20000,
    respectRobots = true,
    robots = null,
    robotsUserAgent = 'rookyseo',
    sitemapUrls = [],
    userAgent,
    onProgress = () => {},
    shouldStop = () => false,
  } = opts;

  const start = canonicalizeUrl(startUrl);
  const pages = [];
  const seen = new Set([start]);
  const analyzedFinal = new Set();
  const queue = [{ url: start, depth: 0, fromSitemap: false }];
  const blockedByRobots = [];
  const inlinks = new Map(); // destino -> Map(origen -> anchor)
  let sitemapQueued = false;
  let started = 0;
  let active = 0;

  const addInlink = (target, source, anchor, nofollow) => {
    let m = inlinks.get(target);
    if (!m) {
      m = new Map();
      inlinks.set(target, m);
    }
    if (!m.has(source)) m.set(source, { anchor, nofollow });
  };

  const robotsCheck = (url) => {
    if (!respectRobots || !robots) return { allowed: true };
    const u = new URL(url);
    return isAllowed(robots, robotsUserAgent, u.pathname + u.search);
  };

  const enqueueSitemapUrls = () => {
    if (sitemapQueued) return;
    sitemapQueued = true;
    for (const raw of sitemapUrls) {
      const u = canonicalizeUrl(raw);
      if (!u || seen.has(u) || !isSameSite(u, start) || hasSkippedExtension(u)) continue;
      seen.add(u);
      queue.push({ url: u, depth: null, fromSitemap: true });
    }
  };

  async function processItem(item) {
    const res = await fetchUrl(item.url, { timeout, userAgent });
    const record = {
      url: item.url,
      finalUrl: res.finalUrl,
      depth: item.depth,
      fromSitemap: item.fromSitemap,
      status: res.status,
      error: res.error,
      redirects: res.redirects,
      timeMs: res.timeMs,
      ttfbMs: res.ttfbMs,
      bytes: res.bytes,
      contentType: String(res.headers['content-type'] || ''),
      headers: pickHeaders(res.headers),
      isHtml: false,
      analysis: null,
      duplicateOf: null,
    };

    if (res.status >= 200 && res.status < 300 && isHtmlResponse(res)) {
      record.isHtml = true;
      const finalCanon = canonicalizeUrl(res.finalUrl);
      const external = !isSameSite(res.finalUrl, start);
      if (external) {
        record.redirectsOffsite = true;
      } else if (analyzedFinal.has(finalCanon)) {
        record.duplicateOf = finalCanon;
      } else {
        analyzedFinal.add(finalCanon);
        seen.add(finalCanon);
        try {
          record.analysis = analyzeHtml(res.text, res.finalUrl, res);
        } catch (err) {
          record.error = `No se pudo analizar el HTML: ${err.message}`;
        }
        if (record.analysis) {
          const childDepth = item.depth === null ? null : item.depth + 1;
          for (const link of record.analysis.links) {
            if (!link.internal) continue;
            if (link.href !== item.url && link.href !== finalCanon) addInlink(link.href, item.url, link.anchor, link.nofollow);
            if (seen.has(link.href)) continue;
            if (hasSkippedExtension(link.href)) continue;
            if (childDepth !== null && childDepth > maxDepth) continue;
            seen.add(link.href);
            queue.push({ url: link.href, depth: childDepth, fromSitemap: false });
          }
        }
      }
    }
    pages.push(record);
    onProgress({ crawled: pages.length, queued: queue.length, url: item.url, status: res.status });
  }

  await new Promise((resolve) => {
    const pump = () => {
      if (!queue.length && active === 0) enqueueSitemapUrls();
      while (active < concurrency && queue.length && started < maxPages && !shouldStop()) {
        const item = queue.shift();
        const check = robotsCheck(item.url);
        if (!check.allowed) {
          blockedByRobots.push({ url: item.url, rule: check.rule });
          continue;
        }
        started++;
        active++;
        processItem(item)
          .catch((err) => {
            pages.push({ url: item.url, finalUrl: item.url, depth: item.depth, status: 0, error: `Error interno: ${err.message}`, redirects: [], headers: {}, isHtml: false, analysis: null });
          })
          .finally(() => {
            active--;
            pump();
          });
      }
      if (active === 0 && (!queue.length || started >= maxPages || shouldStop())) {
        if (!queue.length && !sitemapQueued && started < maxPages && !shouldStop()) {
          enqueueSitemapUrls();
          if (queue.length) {
            pump();
            return;
          }
        }
        resolve();
      }
    };
    pump();
  });

  // Enlaces entrantes internos por página
  for (const p of pages) {
    const m = inlinks.get(p.url);
    p.inlinks = m ? m.size : 0;
    p.inlinkSamples = m ? [...m.entries()].slice(0, 10).map(([from, v]) => ({ from, anchor: v.anchor, nofollow: v.nofollow })) : [];
  }

  return {
    startUrl: start,
    pages,
    blockedByRobots,
    uncrawled: queue.length,
    discoveredUrls: seen.size,
    inlinks,
  };
}

module.exports = { crawlSite };
