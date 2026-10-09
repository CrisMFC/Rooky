'use strict';

const cheerio = require('cheerio');
const { fetchUrl } = require('./http');

/**
 * Descarga y analiza sitemaps (incluye índices de sitemaps y .xml.gz).
 */
async function loadSitemaps(origin, declared = [], { timeout = 20000, maxSitemaps = 15, maxUrls = 50000, userAgent } = {}) {
  const candidates = declared.length ? [...declared] : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/sitemap-index.xml`, `${origin}/wp-sitemap.xml`];
  const visited = new Set();
  const sitemaps = [];
  const urls = [];
  const urlSet = new Set();
  let lastmodCount = 0;
  let entriesTotal = 0;
  const queue = [...candidates];

  while (queue.length && visited.size < maxSitemaps) {
    const sm = queue.shift();
    if (visited.has(sm)) continue;
    visited.add(sm);
    const res = await fetchUrl(sm, { timeout, maxBytes: 50 * 1024 * 1024, userAgent });
    const entry = { url: sm, status: res.status, error: res.error, type: null, urlCount: 0, declared: declared.includes(sm), valid: false };
    if (!res.ok) {
      // Las rutas por defecto que no existen no son relevantes si no se declararon
      if (entry.declared || sitemaps.length === 0) sitemaps.push(entry);
      continue;
    }
    const text = res.text.trim();
    if (!/<(urlset|sitemapindex)[\s>]/i.test(text)) {
      entry.error = 'El contenido no es un sitemap XML válido';
      sitemaps.push(entry);
      continue;
    }
    entry.valid = true;
    const $ = cheerio.load(text, { xml: true });
    if ($('sitemapindex').length) {
      entry.type = 'índice';
      $('sitemap > loc').each((_, el) => {
        const loc = $(el).text().trim();
        if (loc && !visited.has(loc)) queue.push(loc);
        entry.urlCount++;
      });
    } else {
      entry.type = 'urlset';
      $('url').each((_, el) => {
        const loc = $(el).find('loc').first().text().trim();
        if (!loc) return;
        entry.urlCount++;
        entriesTotal++;
        if ($(el).find('lastmod').length) lastmodCount++;
        if (urls.length < maxUrls && !urlSet.has(loc)) {
          urlSet.add(loc);
          urls.push(loc);
        }
      });
    }
    sitemaps.push(entry);
    // Si encontramos uno por defecto, no probar el resto de rutas por defecto
    if (!declared.length && entry.valid) {
      for (let i = queue.length - 1; i >= 0; i--) if (candidates.includes(queue[i])) queue.splice(i, 1);
    }
  }

  // Si no se encontró ninguno, dejar solo un registro claro
  const found = sitemaps.filter((s) => s.valid);
  return {
    found: found.length > 0,
    sitemaps: found.length ? sitemaps.filter((s) => s.valid || s.declared) : sitemaps.slice(0, 1),
    urls,
    totalUrls: urls.length,
    lastmodRatio: entriesTotal ? Math.round((lastmodCount / entriesTotal) * 100) : 0,
  };
}

module.exports = { loadSitemaps };
