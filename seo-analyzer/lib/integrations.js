'use strict';

const { fetchUrl } = require('./http');

/* ----------------------------- PageSpeed Insights ----------------------------- */

const PSI_AUDITS = [
  ['first-contentful-paint', 'FCP'],
  ['largest-contentful-paint', 'LCP'],
  ['total-blocking-time', 'TBT'],
  ['cumulative-layout-shift', 'CLS'],
  ['speed-index', 'Speed Index'],
];

async function pageSpeed(url, { strategy = 'mobile', apiKey = '', timeout = 90000 } = {}) {
  const params = new URLSearchParams({ url, strategy });
  for (const c of ['performance', 'seo', 'accessibility', 'best-practices']) params.append('category', c);
  if (apiKey) params.set('key', apiKey);
  const res = await fetchUrl(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, {
    timeout,
    maxBytes: 30 * 1024 * 1024,
    headers: { accept: 'application/json' },
  });
  if (res.error) return { ok: false, strategy, error: res.error };
  let data;
  try {
    data = JSON.parse(res.text);
  } catch {
    return { ok: false, strategy, error: `Respuesta no válida de PageSpeed (HTTP ${res.status})` };
  }
  if (!res.ok || data.error) {
    const msg = data.error ? data.error.message : `HTTP ${res.status}`;
    return { ok: false, strategy, error: res.status === 429 ? `Cuota de PageSpeed agotada. Añade una API key de Google en Ajustes. (${msg})` : msg };
  }
  const lh = data.lighthouseResult || {};
  const cats = lh.categories || {};
  const audits = lh.audits || {};
  const score = (c) => (cats[c] && typeof cats[c].score === 'number' ? Math.round(cats[c].score * 100) : null);
  const lab = PSI_AUDITS.map(([id, label]) => ({
    id,
    label,
    value: audits[id] ? audits[id].displayValue || null : null,
    numeric: audits[id] ? audits[id].numericValue ?? null : null,
    score: audits[id] && typeof audits[id].score === 'number' ? Math.round(audits[id].score * 100) : null,
  }));
  const fieldMetrics = (data.loadingExperience && data.loadingExperience.metrics) || {};
  const field = {};
  const fieldMap = {
    LARGEST_CONTENTFUL_PAINT_MS: 'LCP',
    INTERACTION_TO_NEXT_PAINT: 'INP',
    CUMULATIVE_LAYOUT_SHIFT_SCORE: 'CLS',
    FIRST_CONTENTFUL_PAINT_MS: 'FCP',
    EXPERIMENTAL_TIME_TO_FIRST_BYTE: 'TTFB',
  };
  for (const [k, label] of Object.entries(fieldMap)) {
    if (fieldMetrics[k]) {
      let p = fieldMetrics[k].percentile;
      if (k === 'CUMULATIVE_LAYOUT_SHIFT_SCORE' && typeof p === 'number') p = p / 100;
      field[label] = { percentile: p, category: fieldMetrics[k].category };
    }
  }
  const opportunities = Object.values(audits)
    .filter((a) => a.details && a.details.type === 'opportunity' && typeof a.score === 'number' && a.score < 0.9)
    .map((a) => ({ id: a.id, title: a.title, savings: a.displayValue || '', score: Math.round(a.score * 100) }))
    .slice(0, 12);
  return {
    ok: true,
    strategy,
    url: lh.finalUrl || url,
    scores: {
      performance: score('performance'),
      seo: score('seo'),
      accessibility: score('accessibility'),
      bestPractices: score('best-practices'),
    },
    lab,
    field,
    fieldOverall: data.loadingExperience ? data.loadingExperience.overall_category || null : null,
    opportunities,
  };
}

/* ------------------------------- OpenPageRank -------------------------------- */

async function openPageRank(domains, apiKey) {
  if (!apiKey) return { ok: false, error: 'Sin API key de OpenPageRank' };
  const params = domains.map((d) => `domains[]=${encodeURIComponent(d)}`).join('&');
  const res = await fetchUrl(`https://openpagerank.com/api/v1.0/getPageRank?${params}`, {
    timeout: 20000,
    headers: { 'API-OPR': apiKey, accept: 'application/json' },
  });
  if (res.error) return { ok: false, error: res.error };
  try {
    const data = JSON.parse(res.text);
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    const out = {};
    for (const r of data.response || []) {
      out[String(r.domain).toLowerCase()] = {
        pageRank: typeof r.page_rank_decimal === 'number' ? r.page_rank_decimal : Number(r.page_rank_decimal) || null,
        rank: r.rank ? Number(r.rank) : null,
        error: r.error || null,
      };
    }
    return { ok: true, data: out };
  } catch {
    return { ok: false, error: `Respuesta no válida de OpenPageRank (HTTP ${res.status})` };
  }
}

/* -------------------------------- DataForSEO --------------------------------- */

class DataForSeo {
  constructor(login, password) {
    this.auth = 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64');
  }

  async post(path, payload) {
    const res = await fetchUrl(`https://api.dataforseo.com/v3/${path}`, {
      method: 'POST',
      timeout: 120000,
      maxBytes: 50 * 1024 * 1024,
      headers: { authorization: this.auth, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.error) throw new Error(res.error);
    let data;
    try {
      data = JSON.parse(res.text);
    } catch {
      throw new Error(`Respuesta no válida de DataForSEO (HTTP ${res.status})`);
    }
    if (data.status_code !== 20000) throw new Error(`DataForSEO: ${data.status_message || 'error'} (${data.status_code})`);
    const task = data.tasks && data.tasks[0];
    if (!task) throw new Error('DataForSEO: respuesta sin tareas');
    if (task.status_code !== 20000) throw new Error(`DataForSEO: ${task.status_message} (${task.status_code})`);
    return { result: task.result || [], cost: data.cost || 0 };
  }

  async domainOverview(domain, loc) {
    const { result, cost } = await this.post('dataforseo_labs/google/domain_rank_overview/live', [{ target: domain, ...loc }]);
    const item = result[0] && result[0].items && result[0].items[0];
    const org = item && item.metrics && item.metrics.organic;
    return {
      cost,
      organic: org
        ? {
            keywords: org.count ?? null,
            traffic: org.etv != null ? Math.round(org.etv) : null,
            trafficCost: org.estimated_paid_traffic_cost != null ? Math.round(org.estimated_paid_traffic_cost) : null,
            pos1: org.pos_1 ?? 0,
            pos2_3: org.pos_2_3 ?? 0,
            pos4_10: org.pos_4_10 ?? 0,
            pos11_20: org.pos_11_20 ?? 0,
            pos21_50: (org.pos_21_30 ?? 0) + (org.pos_31_40 ?? 0) + (org.pos_41_50 ?? 0),
            pos51_100: (org.pos_51_60 ?? 0) + (org.pos_61_70 ?? 0) + (org.pos_71_80 ?? 0) + (org.pos_81_90 ?? 0) + (org.pos_91_100 ?? 0),
          }
        : null,
    };
  }

  async rankedKeywords(domain, loc, limit = 200) {
    const { result, cost } = await this.post('dataforseo_labs/google/ranked_keywords/live', [
      { target: domain, ...loc, limit, order_by: ['keyword_data.keyword_info.search_volume,desc'] },
    ]);
    const items = (result[0] && result[0].items) || [];
    return {
      cost,
      total: result[0] ? result[0].total_count ?? items.length : 0,
      items: items.map((it) => {
        const kd = it.keyword_data || {};
        const info = kd.keyword_info || {};
        const serp = (it.ranked_serp_element && it.ranked_serp_element.serp_item) || {};
        return {
          keyword: kd.keyword,
          volume: info.search_volume ?? null,
          cpc: info.cpc ?? null,
          competition: info.competition ?? null,
          difficulty: kd.keyword_properties ? kd.keyword_properties.keyword_difficulty ?? null : null,
          intent: kd.search_intent_info ? kd.search_intent_info.main_intent || null : null,
          position: serp.rank_group ?? null,
          url: serp.url || null,
          type: serp.type || null,
          traffic: serp.etv != null ? Math.round(serp.etv * 10) / 10 : null,
        };
      }),
    };
  }

  async competitors(domain, loc, limit = 10) {
    const { result, cost } = await this.post('dataforseo_labs/google/competitors_domain/live', [
      { target: domain, ...loc, limit: limit + 5 },
    ]);
    const items = (result[0] && result[0].items) || [];
    return {
      cost,
      items: items
        .filter((it) => it.domain && it.domain.replace(/^www\./, '') !== domain.replace(/^www\./, ''))
        .slice(0, limit)
        .map((it) => {
          const org = it.full_domain_metrics && it.full_domain_metrics.organic;
          return {
            domain: it.domain,
            avgPosition: it.avg_position != null ? Math.round(it.avg_position * 10) / 10 : null,
            intersections: it.intersections ?? null,
            keywords: org ? org.count ?? null : null,
            traffic: org && org.etv != null ? Math.round(org.etv) : null,
          };
        }),
    };
  }

  async backlinksSummary(domain) {
    const { result, cost } = await this.post('backlinks/summary/live', [{ target: domain, include_subdomains: true }]);
    const r = result[0] || {};
    return {
      cost,
      rank: r.rank ?? null,
      backlinks: r.backlinks ?? null,
      referringDomains: r.referring_domains ?? null,
      referringMainDomains: r.referring_main_domains ?? null,
      referringIps: r.referring_ips ?? null,
      nofollowDomains: r.referring_domains_nofollow ?? null,
      brokenBacklinks: r.broken_backlinks ?? null,
      spamScore: r.backlinks_spam_score ?? null,
      firstSeen: r.first_seen || null,
      tlds: r.referring_links_tld || null,
      types: r.referring_links_types || null,
      attributes: r.referring_links_attributes || null,
      countries: r.referring_links_countries || null,
    };
  }

  async referringDomains(domain, limit = 50) {
    const { result, cost } = await this.post('backlinks/referring_domains/live', [
      { target: domain, include_subdomains: true, limit, order_by: ['rank,desc'] },
    ]);
    const items = (result[0] && result[0].items) || [];
    return {
      cost,
      items: items.map((it) => ({
        domain: it.domain,
        rank: it.rank ?? null,
        backlinks: it.backlinks ?? null,
        firstSeen: it.first_seen || null,
        spamScore: it.backlinks_spam_score ?? null,
      })),
    };
  }

  async backlinks(domain, limit = 50) {
    const { result, cost } = await this.post('backlinks/backlinks/live', [
      { target: domain, include_subdomains: true, limit, mode: 'one_per_domain', order_by: ['rank,desc'] },
    ]);
    const items = (result[0] && result[0].items) || [];
    return {
      cost,
      items: items.map((it) => ({
        from: it.url_from,
        to: it.url_to,
        anchor: it.anchor || '',
        dofollow: it.dofollow ?? null,
        domainRank: it.domain_from_rank ?? null,
        pageRank: it.rank ?? null,
        firstSeen: it.first_seen || null,
        title: it.page_from_title || '',
        lost: !!it.is_lost,
      })),
    };
  }

  async anchors(domain, limit = 30) {
    const { result, cost } = await this.post('backlinks/anchors/live', [
      { target: domain, include_subdomains: true, limit, order_by: ['backlinks,desc'] },
    ]);
    const items = (result[0] && result[0].items) || [];
    return {
      cost,
      items: items.map((it) => ({
        anchor: it.anchor || '(vacío)',
        backlinks: it.backlinks ?? null,
        referringDomains: it.referring_domains ?? null,
      })),
    };
  }

  async keywordOverview(keywords, loc) {
    const { result, cost } = await this.post('dataforseo_labs/google/keyword_overview/live', [{ keywords: keywords.slice(0, 700), ...loc }]);
    const items = (result[0] && result[0].items) || [];
    const out = {};
    for (const it of items) {
      const info = it.keyword_info || {};
      out[it.keyword] = {
        volume: info.search_volume ?? null,
        cpc: info.cpc ?? null,
        competition: info.competition ?? null,
        difficulty: it.keyword_properties ? it.keyword_properties.keyword_difficulty ?? null : null,
        intent: it.search_intent_info ? it.search_intent_info.main_intent || null : null,
        trend: Array.isArray(info.monthly_searches) ? info.monthly_searches.slice(0, 12).reverse().map((m) => m.search_volume) : null,
      };
    }
    return { cost, data: out };
  }
}

/* --------------------------- Sugerencias de Google ---------------------------- */

/**
 * Sugerencias de autocompletado de Google (endpoint público no oficial).
 * Sirven como ideas de keywords reales que la gente escribe; no dan volumen.
 */
async function googleSuggest(query, { hl = 'es', gl = 'es' } = {}) {
  const params = new URLSearchParams({ client: 'firefox', q: query, hl, gl });
  const res = await fetchUrl(`https://suggestqueries.google.com/complete/search?${params}`, {
    timeout: 10000,
    headers: { accept: 'application/json' },
    maxBytes: 200 * 1024,
  });
  if (!res.ok) return { ok: false, error: res.error || `HTTP ${res.status}`, suggestions: [] };
  try {
    // La respuesta puede venir en ISO-8859-1
    let text = res.text;
    if (/charset=iso-8859-1/i.test(res.headers['content-type'] || '')) text = res.buffer.toString('latin1');
    const data = JSON.parse(text);
    const list = Array.isArray(data[1]) ? data[1].map(String) : [];
    return { ok: true, suggestions: list.filter((s) => s.toLowerCase() !== query.toLowerCase()) };
  } catch {
    return { ok: false, error: 'Respuesta no válida', suggestions: [] };
  }
}

/** Ubicaciones/idiomas habituales para DataForSEO. */
const LOCATIONS = {
  es: { location_code: 2724, language_code: 'es', label: 'España', hl: 'es', gl: 'es' },
  mx: { location_code: 2484, language_code: 'es', label: 'México', hl: 'es', gl: 'mx' },
  ar: { location_code: 2032, language_code: 'es', label: 'Argentina', hl: 'es', gl: 'ar' },
  co: { location_code: 2170, language_code: 'es', label: 'Colombia', hl: 'es', gl: 'co' },
  cl: { location_code: 2152, language_code: 'es', label: 'Chile', hl: 'es', gl: 'cl' },
  pe: { location_code: 2604, language_code: 'es', label: 'Perú', hl: 'es', gl: 'pe' },
  us: { location_code: 2840, language_code: 'en', label: 'Estados Unidos (inglés)', hl: 'en', gl: 'us' },
  us_es: { location_code: 2840, language_code: 'es', label: 'Estados Unidos (español)', hl: 'es', gl: 'us' },
  uk: { location_code: 2826, language_code: 'en', label: 'Reino Unido', hl: 'en', gl: 'gb' },
};

module.exports = { pageSpeed, openPageRank, DataForSeo, googleSuggest, LOCATIONS };
