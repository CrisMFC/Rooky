'use strict';

const { fetchUrl } = require('./http');
const { normalizeInputUrl, canonicalizeUrl, displayDomain, bareHost, originOf } = require('./urlutil');
const { crawlSite } = require('./crawler');
const { loadSitemaps } = require('./sitemap');
const tech = require('./technical');
const { aggregateSiteKeywords, keywordGap } = require('./keywords');
const { checkExternalLinks } = require('./linkcheck');
const ai = require('./ai');
const { runAudit } = require('./audit');
const { pageSpeed, openPageRank, DataForSeo, googleSuggest, LOCATIONS } = require('./integrations');

const BIG_PLATFORMS = /(^|\.)(wikipedia\.org|youtube\.com|amazon\.[a-z.]+|facebook\.com|instagram\.com|linkedin\.com|twitter\.com|x\.com|pinterest\.[a-z.]+|reddit\.com|quora\.com|tiktok\.com|google\.[a-z.]+|apple\.com|microsoft\.com|github\.com|medium\.com)$/i;

function brandFromHome(home, url) {
  const site = home && home.analysis && home.analysis.og['og:site_name'];
  if (site && site.length <= 40) return site;
  const host = bareHost(new URL(url).hostname);
  return host.split('.')[0];
}

function distribution(values, buckets) {
  return buckets.map(([label, test]) => ({ label, count: values.filter(test).length }));
}

/** Resumen ligero de cada página para enviar a la interfaz. */
function leanPage(p, problems) {
  const a = p.analysis;
  return {
    url: p.url,
    finalUrl: p.finalUrl,
    status: p.status,
    error: p.error || null,
    depth: p.depth,
    fromSitemap: !!p.fromSitemap,
    inlinks: p.inlinks || 0,
    timeMs: p.timeMs,
    ttfbMs: p.ttfbMs,
    bytes: p.bytes,
    contentType: p.contentType,
    redirects: (p.redirects || []).length,
    redirectChain: p.redirects || [],
    duplicateOf: p.duplicateOf || null,
    problems: problems || { error: 0, warning: 0, notice: 0 },
    ...(a
      ? {
          title: a.title,
          titleLength: a.titleLength,
          metaDescription: a.metaDescription,
          metaDescriptionLength: a.metaDescriptionLength,
          h1: a.headings.h1[0] || '',
          h1Count: a.headings.h1.length,
          h2Count: a.headings.h2.length,
          headingOutline: a.headingOutline.slice(0, 40),
          wordCount: a.wordCount,
          textRatio: a.textRatio,
          canonical: a.canonical,
          noindex: a.noindex,
          lang: a.lang,
          imageCount: a.imageCount,
          imagesMissingAlt: a.imagesMissingAlt,
          internalLinks: a.internalLinks,
          externalLinks: a.externalLinks,
          schemaTypes: [...a.jsonLd.types, ...a.microdataTypes],
          readability: a.readability,
          questionHeadings: a.questionHeadings.length,
          hasOg: !!(a.og['og:title'] && a.og['og:image']),
          viewport: !!a.viewport,
          hreflang: a.hreflang,
          inlinkSamples: p.inlinkSamples || [],
        }
      : {}),
  };
}

/**
 * Análisis completo de un sitio (sin integraciones de pago).
 */
async function analyzeSite(inputUrl, opts = {}, log = () => {}) {
  const {
    maxPages = 50,
    maxDepth = 5,
    concurrency = 4,
    timeout = 20000,
    respectRobots = true,
    checkExternal = true,
    maxExternal = 80,
    userAgent,
    shouldStop = () => false,
    label = '',
  } = opts;
  const prefix = label ? `[${label}] ` : '';
  const started = Date.now();
  const url = normalizeInputUrl(inputUrl);

  log(`${prefix}Conectando con ${url}…`);
  const first = await fetchUrl(url, { timeout, userAgent, maxBytes: 3 * 1024 * 1024 });
  if (first.status === 0) {
    // Si falla con https probamos con http
    if (url.startsWith('https://')) {
      const httpUrl = url.replace(/^https:/, 'http:');
      const retry = await fetchUrl(httpUrl, { timeout, userAgent, maxBytes: 3 * 1024 * 1024 });
      if (retry.status === 0) throw new Error(`No se pudo acceder a ${url}: ${first.error}`);
      Object.assign(first, retry);
    } else {
      throw new Error(`No se pudo acceder a ${url}: ${first.error}`);
    }
  }
  const startUrl = canonicalizeUrl(first.finalUrl);
  const origin = originOf(startUrl);
  const isHttps = startUrl.startsWith('https:');

  log(`${prefix}Leyendo robots.txt y sitemaps…`);
  const robots = await tech.checkRobots(origin, { timeout, userAgent });
  const sitemap = await loadSitemaps(origin, robots.sitemaps, { timeout, userAgent });
  log(`${prefix}robots.txt: ${robots.exists ? 'encontrado' : 'no encontrado'} · sitemap: ${sitemap.found ? `${sitemap.totalUrls} URLs` : 'no encontrado'}`);

  log(`${prefix}Rastreando hasta ${maxPages} páginas…`);
  let lastLogged = 0;
  const crawl = await crawlSite(startUrl, {
    maxPages,
    maxDepth,
    concurrency,
    timeout,
    respectRobots,
    robots: robots.parsed,
    sitemapUrls: sitemap.urls,
    userAgent,
    shouldStop,
    onProgress: ({ crawled, url: u, status }) => {
      if (crawled - lastLogged >= 5 || crawled === 1) {
        lastLogged = crawled;
        log(`${prefix}Rastreadas ${crawled} páginas (última: ${u} → ${status || 'error'})`, { crawled, maxPages });
      }
    },
  });
  const pages = crawl.pages;
  const home = pages.find((p) => p.depth === 0) || pages[0];
  log(`${prefix}Rastreo terminado: ${pages.length} páginas.`);

  log(`${prefix}Comprobaciones técnicas (HTTPS, www, SSL, 404)…`);
  const u = new URL(startUrl);
  const [httpRedirect, www, soft404, tls, llms] = await Promise.all([
    isHttps ? tech.checkHttpsRedirect(startUrl, { timeout, userAgent }) : Promise.resolve(null),
    tech.checkWwwConsistency(startUrl, { timeout, userAgent }),
    tech.checkSoft404(origin, { timeout, userAgent }),
    isHttps ? tech.checkTlsCertificate(u.hostname, u.port ? Number(u.port) : 443) : Promise.resolve(null),
    ai.checkLlmsTxt(origin, { timeout, userAgent }),
  ]);
  const technical = {
    isHttps,
    httpRedirect,
    www,
    soft404,
    tls,
    robots: { ...robots, parsed: undefined },
    securityHeaders: tech.securityHeaders(home ? home.headers : {}),
    server: home && home.headers ? home.headers.server || null : null,
  };

  const brand = brandFromHome(home, startUrl);
  log(`${prefix}Extrayendo keywords del contenido…`);
  const keywords = aggregateSiteKeywords(pages, { brand: `${brand} ${bareHost(new URL(startUrl).hostname).split('.')[0]}` });

  let linkCheck = null;
  if (checkExternal && !shouldStop()) {
    log(`${prefix}Verificando enlaces externos…`);
    linkCheck = await checkExternalLinks(pages, { max: maxExternal, timeout: Math.min(timeout, 12000), userAgent });
  }

  log(`${prefix}Evaluando preparación para buscadores IA…`);
  const aiReady = ai.aiReadiness({ pages, robots, llms, homepage: home });

  log(`${prefix}Generando auditoría…`);
  const audit = runAudit({ pages, technical, sitemap, linkCheck, keywords, ai: aiReady });

  // Perfil de enlaces (internos y salientes) a partir del rastreo
  const okHtml = pages.filter((p) => p.analysis && p.status >= 200 && p.status < 300);
  const extDomains = new Map();
  let extTotal = 0;
  let extNofollow = 0;
  const internalAnchors = new Map();
  for (const p of okHtml) {
    for (const l of p.analysis.links) {
      if (l.internal) {
        const a = (l.anchor || '(sin texto)').toLowerCase().slice(0, 80);
        internalAnchors.set(a, (internalAnchors.get(a) || 0) + 1);
        continue;
      }
      extTotal++;
      if (l.nofollow || l.sponsored || l.ugc) extNofollow++;
      const d = displayDomain(l.href);
      const e = extDomains.get(d) || { domain: d, links: 0, nofollow: 0, pages: new Set() };
      e.links++;
      if (l.nofollow || l.sponsored || l.ugc) e.nofollow++;
      e.pages.add(p.url);
      extDomains.set(d, e);
    }
  }
  const outbound = {
    totalLinks: extTotal,
    nofollowLinks: extNofollow,
    domains: [...extDomains.values()]
      .map((e) => ({ domain: e.domain, links: e.links, nofollow: e.nofollow, pages: e.pages.size }))
      .sort((a, b) => b.links - a.links)
      .slice(0, 100),
    uniqueDomains: extDomains.size,
  };
  const topInternal = okHtml
    .map((p) => ({ url: p.url, inlinks: p.inlinks || 0, title: p.analysis.title }))
    .sort((a, b) => b.inlinks - a.inlinks)
    .slice(0, 25);
  const internal = {
    totalLinks: okHtml.reduce((a, p) => a + p.analysis.internalLinks, 0),
    avgPerPage: okHtml.length ? Math.round(okHtml.reduce((a, p) => a + p.analysis.internalLinks, 0) / okHtml.length) : 0,
    topPages: topInternal,
    anchors: [...internalAnchors.entries()].map(([anchor, count]) => ({ anchor, count })).sort((a, b) => b.count - a.count).slice(0, 40),
  };

  // Estadísticas
  const statusDist = {};
  for (const p of pages) {
    const k = p.status === 0 ? 'Error' : `${String(p.status)[0]}xx`;
    statusDist[k] = (statusDist[k] || 0) + 1;
  }
  const depthDist = {};
  for (const p of pages) {
    const k = p.depth === null || p.depth === undefined ? 'sitemap' : String(p.depth);
    depthDist[k] = (depthDist[k] || 0) + 1;
  }
  const wc = okHtml.map((p) => p.analysis.wordCount);
  const ttfb = pages.filter((p) => p.ttfbMs != null).map((p) => p.ttfbMs);
  const stats = {
    pagesCrawled: pages.length,
    htmlPages: okHtml.length,
    blockedByRobots: crawl.blockedByRobots.length,
    blockedByRobotsSample: crawl.blockedByRobots.slice(0, 50),
    discoveredUrls: crawl.discoveredUrls,
    notCrawled: crawl.uncrawled,
    statusDist,
    depthDist,
    wordCountDist: distribution(wc, [
      ['<300', (v) => v < 300],
      ['300-600', (v) => v >= 300 && v < 600],
      ['600-1000', (v) => v >= 600 && v < 1000],
      ['1000-2000', (v) => v >= 1000 && v < 2000],
      ['2000+', (v) => v >= 2000],
    ]),
    avgWords: wc.length ? Math.round(wc.reduce((a, b) => a + b, 0) / wc.length) : 0,
    avgTtfb: ttfb.length ? Math.round(ttfb.reduce((a, b) => a + b, 0) / ttfb.length) : null,
    medianTtfb: ttfb.length ? ttfb.slice().sort((a, b) => a - b)[Math.floor(ttfb.length / 2)] : null,
    ttfbDist: distribution(ttfb, [
      ['<200 ms', (v) => v < 200],
      ['200-500 ms', (v) => v >= 200 && v < 500],
      ['0,5-1 s', (v) => v >= 500 && v < 1000],
      ['1-2 s', (v) => v >= 1000 && v < 2000],
      ['>2 s', (v) => v >= 2000],
    ]),
    avgPageBytes: okHtml.length ? Math.round(okHtml.reduce((a, p) => a + p.analysis.htmlBytes, 0) / okHtml.length) : 0,
    schemaTypes: aiReady.stats.schemaTypes,
    languages: [...new Set(okHtml.map((p) => p.analysis.lang).filter(Boolean))],
    durationMs: Date.now() - started,
  };

  const homeA = home && home.analysis;
  return {
    url: startUrl,
    inputUrl: url,
    domain: displayDomain(startUrl),
    brand,
    analyzedAt: new Date().toISOString(),
    homepage: homeA
      ? {
          title: homeA.title,
          metaDescription: homeA.metaDescription,
          h1: homeA.headings.h1,
          lang: homeA.lang,
          schemaTypes: homeA.jsonLd.types,
          og: homeA.og,
          twitter: homeA.twitter,
          favicon: homeA.favicon,
          hreflang: homeA.hreflang,
          wordCount: homeA.wordCount,
        }
      : null,
    stats,
    technical,
    sitemap: { found: sitemap.found, sitemaps: sitemap.sitemaps, totalUrls: sitemap.totalUrls, lastmodRatio: sitemap.lastmodRatio, sample: sitemap.urls.slice(0, 50) },
    audit,
    keywords: {
      top: keywords.top,
      byLength: keywords.byLength,
      totalUnique: keywords.totalUnique,
      stuffing: keywords.stuffing,
      cannibalization: keywords.cannibalization,
    },
    links: { internal, outbound, external: linkCheck ? { totalExternal: linkCheck.totalExternal, checked: linkCheck.checked, ok: linkCheck.ok, broken: linkCheck.broken, unverified: linkCheck.unverified.slice(0, 50) } : null },
    ai: aiReady,
    pages: pages.map((p) => leanPage(p, audit.pageProblems[p.url])),
    // Interno: no se serializa
    _keywordsFull: keywords,
  };
}

/* ------------------------------------------------------------------------ */

function settled(promise) {
  return promise.then((value) => ({ ok: true, value }), (err) => ({ ok: false, error: err.message || String(err) }));
}

async function dataForSeoBundle(dfs, domain, loc, { withBacklinks = true, withKeywords = true, detailed = true }) {
  const out = { cost: 0 };
  const tasks = {};
  if (withKeywords) {
    tasks.overview = settled(dfs.domainOverview(domain, loc));
    tasks.ranked = settled(dfs.rankedKeywords(domain, loc, detailed ? 300 : 150));
  }
  if (withBacklinks) {
    tasks.backlinks = settled(dfs.backlinksSummary(domain));
    if (detailed) {
      tasks.refDomains = settled(dfs.referringDomains(domain, 50));
      tasks.backlinkList = settled(dfs.backlinks(domain, 50));
      tasks.anchors = settled(dfs.anchors(domain, 30));
    }
  }
  for (const [k, p] of Object.entries(tasks)) {
    const r = await p;
    if (r.ok) {
      out.cost += r.value.cost || 0;
      out[k] = r.value;
    } else {
      out[k] = { error: r.error };
    }
  }
  return out;
}

/**
 * Análisis completo: sitio + competencia + integraciones opcionales.
 */
async function fullAnalysis(params, { log = () => {}, setProgress = () => {}, shouldStop = () => false } = {}) {
  const keys = params.keys || {};
  const locKey = LOCATIONS[params.location] ? params.location : 'es';
  const loc = LOCATIONS[locKey];
  const dfsLoc = { location_code: loc.location_code, language_code: loc.language_code };
  const dfs = keys.dataforseoLogin && keys.dataforseoPassword ? new DataForSeo(keys.dataforseoLogin, keys.dataforseoPassword) : null;
  const userAgent = params.userAgent || undefined;
  const report = { version: 1, params: { ...params, keys: undefined }, location: { key: locKey, label: loc.label }, integrations: {} };

  setProgress(3, 'Analizando sitio principal');
  const target = await analyzeSite(params.url, {
    maxPages: params.maxPages,
    maxDepth: params.maxDepth,
    concurrency: params.concurrency,
    respectRobots: params.respectRobots !== false,
    checkExternal: params.checkExternal !== false,
    userAgent,
    shouldStop,
  }, (msg, extra) => {
    log(msg);
    if (extra && extra.maxPages) setProgress(3 + Math.round((extra.crawled / extra.maxPages) * 37), 'Rastreando sitio principal');
  });
  report.target = target;
  if (shouldStop()) throw new Error('Análisis cancelado');

  // --- Competidores ---
  let competitorInputs = (params.competitors || []).map((c) => String(c).trim()).filter(Boolean);
  const integrations = report.integrations;
  if (!competitorInputs.length && dfs && params.autoCompetitors !== false) {
    setProgress(42, 'Buscando competidores orgánicos');
    log('Buscando competidores orgánicos con DataForSEO…');
    const r = await settled(dfs.competitors(target.domain, dfsLoc, 10));
    if (r.ok) {
      integrations.discoveredCompetitors = r.value.items;
      competitorInputs = r.value.items.filter((c) => !BIG_PLATFORMS.test(c.domain)).slice(0, 3).map((c) => c.domain);
      log(`Competidores detectados: ${competitorInputs.join(', ') || 'ninguno'}`);
    } else {
      integrations.discoveredCompetitors = { error: r.error };
      log(`No se pudieron obtener competidores: ${r.error}`);
    }
  }
  competitorInputs = [...new Set(competitorInputs)].slice(0, 5);

  report.competitors = [];
  for (let i = 0; i < competitorInputs.length; i++) {
    if (shouldStop()) throw new Error('Análisis cancelado');
    const c = competitorInputs[i];
    setProgress(45 + Math.round((i / Math.max(1, competitorInputs.length)) * 25), `Analizando competidor ${i + 1}/${competitorInputs.length}`);
    try {
      if (displayDomain(normalizeInputUrl(c)) === target.domain) {
        log(`Se omite ${c}: es el mismo dominio que el sitio analizado.`);
        continue;
      }
      const comp = await analyzeSite(c, {
        maxPages: params.competitorPages || 20,
        maxDepth: 3,
        concurrency: params.concurrency,
        respectRobots: params.respectRobots !== false,
        checkExternal: false,
        userAgent,
        shouldStop,
        label: displayDomain(normalizeInputUrl(c)),
      }, (msg) => log(msg));
      // Para competidores enviamos menos detalle
      comp.pages = comp.pages.slice(0, 200);
      report.competitors.push(comp);
    } catch (err) {
      log(`Error analizando ${c}: ${err.message}`);
      report.competitors.push({ domain: displayDomain(c), url: c, error: err.message });
    }
  }
  const okComps = report.competitors.filter((c) => !c.error);

  // --- Brecha de keywords (contenido) ---
  if (okComps.length) {
    setProgress(72, 'Calculando brecha de keywords');
    report.keywordGap = keywordGap(target._keywordsFull, okComps.map((c) => ({ keywords: c._keywordsFull })));
    report.keywordGap.competitors = okComps.map((c) => c.domain);
  }

  // --- PageSpeed ---
  if (params.pagespeed !== false && !shouldStop()) {
    setProgress(75, 'Midiendo Core Web Vitals (PageSpeed)');
    log('Consultando Google PageSpeed Insights (puede tardar ~30-60 s)…');
    const [mobile, desktop] = await Promise.all([
      pageSpeed(target.url, { strategy: 'mobile', apiKey: keys.googleApiKey }),
      pageSpeed(target.url, { strategy: 'desktop', apiKey: keys.googleApiKey }),
    ]);
    target.pagespeed = { mobile, desktop };
    if (!mobile.ok) log(`PageSpeed: ${mobile.error}`);
    for (const comp of okComps) {
      if (shouldStop()) break;
      comp.pagespeed = { mobile: await pageSpeed(comp.url, { strategy: 'mobile', apiKey: keys.googleApiKey }) };
    }
  }

  // --- OpenPageRank ---
  if (keys.oprApiKey) {
    setProgress(85, 'Consultando autoridad de dominio');
    const domains = [target.domain, ...okComps.map((c) => c.domain)];
    const r = await openPageRank(domains, keys.oprApiKey);
    integrations.openPageRank = r;
    if (r.ok) {
      for (const s of [target, ...okComps]) s.authority = r.data[s.domain] || null;
    } else {
      log(`OpenPageRank: ${r.error}`);
    }
  }

  // --- DataForSEO: keywords posicionadas y backlinks reales ---
  if (dfs && !shouldStop()) {
    setProgress(88, 'Obteniendo keywords posicionadas y backlinks');
    log('Consultando DataForSEO (keywords posicionadas y backlinks)…');
    target.dataforseo = await dataForSeoBundle(dfs, target.domain, dfsLoc, { detailed: true });
    for (const comp of okComps) {
      if (shouldStop()) break;
      comp.dataforseo = await dataForSeoBundle(dfs, comp.domain, dfsLoc, { detailed: false });
    }
    // Brecha de keywords real (por posiciones)
    const tRanked = target.dataforseo.ranked && target.dataforseo.ranked.items;
    if (tRanked && okComps.some((c) => c.dataforseo && c.dataforseo.ranked && c.dataforseo.ranked.items)) {
      const tMap = new Map(tRanked.map((k) => [k.keyword, k]));
      const rows = new Map();
      okComps.forEach((c, ci) => {
        const items = (c.dataforseo.ranked && c.dataforseo.ranked.items) || [];
        for (const k of items) {
          let r = rows.get(k.keyword);
          if (!r) {
            r = { keyword: k.keyword, volume: k.volume, difficulty: k.difficulty, cpc: k.cpc, intent: k.intent, target: tMap.get(k.keyword) ? tMap.get(k.keyword).position : null, competitors: {} };
            rows.set(k.keyword, r);
          }
          r.competitors[ci] = k.position;
        }
      });
      const all = [...rows.values()];
      report.rankingGap = {
        competitors: okComps.map((c) => c.domain),
        missing: all.filter((r) => r.target === null).sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 150),
        weak: all.filter((r) => r.target !== null && Object.values(r.competitors).some((p) => p !== null && p < r.target)).sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 150),
        strong: all.filter((r) => r.target !== null && Object.values(r.competitors).every((p) => p === null || p > r.target)).sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 150),
      };
    }
    // Volumen para las keywords de contenido principales
    const seeds = target.keywords.top.filter((k) => k.n >= 2).slice(0, 100).map((k) => k.keyword);
    if (seeds.length) {
      const r = await settled(dfs.keywordOverview(seeds, dfsLoc));
      if (r.ok) {
        target.dataforseo.cost += r.value.cost || 0;
        for (const k of target.keywords.top) if (r.value.data[k.keyword]) k.metrics = r.value.data[k.keyword];
      } else {
        target.dataforseo.keywordOverviewError = r.error;
      }
    }
    integrations.dataforseoCost = [target, ...okComps].reduce((a, s) => a + ((s.dataforseo && s.dataforseo.cost) || 0), 0);
  }

  // --- Ideas de keywords (autocompletado de Google) ---
  if (params.suggestions !== false && !shouldStop()) {
    setProgress(94, 'Buscando ideas de keywords');
    const seeds = target.keywords.top.filter((k) => k.n >= 2 && k.intent !== 'navegacional').slice(0, 6).map((k) => k.keyword);
    const ideas = [];
    for (const s of seeds) {
      const r = await googleSuggest(s, { hl: loc.hl, gl: loc.gl });
      ideas.push({ seed: s, ok: r.ok, error: r.error || null, suggestions: r.suggestions });
    }
    report.keywordIdeas = ideas;
  }

  // Prompts sugeridos para la visibilidad en IA
  report.aiPromptSuggestions = ai.suggestAiPrompts(target.keywords.top, { lang: loc.language_code });

  // Resumen comparativo
  report.comparison = [target, ...okComps].map((s, idx) => ({
    domain: s.domain,
    isTarget: idx === 0,
    health: s.audit.health,
    pages: s.stats.pagesCrawled,
    avgWords: s.stats.avgWords,
    avgTtfb: s.stats.avgTtfb,
    errors: s.audit.issueTypes.error,
    warnings: s.audit.issueTypes.warning,
    aiScore: s.ai.score,
    schemaPct: s.ai.stats.withSchemaPct,
    questionsPct: s.ai.stats.withQuestionsPct,
    schemaTypes: s.ai.stats.schemaTypes.slice(0, 10),
    https: s.technical.isHttps,
    llmsTxt: !!(s.ai.llms && s.ai.llms['llms.txt'].exists),
    blockedAiSearch: s.ai.blockedSearch,
    performance: s.pagespeed && s.pagespeed.mobile && s.pagespeed.mobile.ok ? s.pagespeed.mobile.scores.performance : null,
    lcp: s.pagespeed && s.pagespeed.mobile && s.pagespeed.mobile.ok ? s.pagespeed.mobile.lab.find((m) => m.id === 'largest-contentful-paint').value : null,
    authority: s.authority ? s.authority.pageRank : null,
    organicKeywords: s.dataforseo && s.dataforseo.overview && s.dataforseo.overview.organic ? s.dataforseo.overview.organic.keywords : null,
    organicTraffic: s.dataforseo && s.dataforseo.overview && s.dataforseo.overview.organic ? s.dataforseo.overview.organic.traffic : null,
    referringDomains: s.dataforseo && s.dataforseo.backlinks && !s.dataforseo.backlinks.error ? s.dataforseo.backlinks.referringDomains : null,
    backlinks: s.dataforseo && s.dataforseo.backlinks && !s.dataforseo.backlinks.error ? s.dataforseo.backlinks.backlinks : null,
    topKeywords: s.keywords.top.slice(0, 10).map((k) => k.keyword),
  }));

  // Limpiar datos internos antes de serializar
  delete target._keywordsFull;
  for (const c of report.competitors) delete c._keywordsFull;

  report.integrations.used = {
    pagespeed: params.pagespeed !== false,
    googleApiKey: !!keys.googleApiKey,
    openPageRank: !!keys.oprApiKey,
    dataforseo: !!dfs,
    anthropic: !!keys.anthropicApiKey,
  };
  report.finishedAt = new Date().toISOString();
  setProgress(100, 'Completado');
  return report;
}

module.exports = { analyzeSite, fullAnalysis, leanPage, BIG_PLATFORMS };
