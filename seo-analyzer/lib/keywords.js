'use strict';

const { STOPWORDS } = require('./stopwords');

const NOISE = new Set(['www', 'http', 'https', 'com', 'html', 'php', 'asp', 'aspx', 'jpg', 'png', 'utm', 'amp', 'nbsp']);

const ZONE_WEIGHTS = { body: 1, title: 6, h1: 4, h2: 2, meta: 2, url: 3, alt: 0.5 };

/** Divide el texto en frases y cada frase en tokens normalizados. */
function tokenizeSentences(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[.!?;:|·•\n\r\t,()[\]{}"“”«»/\\]+/)
    .map((s) => s.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || [])
    .filter((t) => t.length);
}

function isValidToken(t) {
  return t.length >= 2 && !NOISE.has(t);
}

function isValidNgram(tokens) {
  const n = tokens.length;
  if (!tokens.every(isValidToken)) return false;
  const first = tokens[0];
  const last = tokens[n - 1];
  if (STOPWORDS.has(first) || STOPWORDS.has(last)) return false;
  if (n === 1) {
    if (first.length < 3) return false;
    if (/^\d+$/.test(first)) return false;
  } else {
    if (/^\d+$/.test(first)) return false;
    // Evitar n-gramas con más de un stopword interno ("de la", etc.)
    const inner = tokens.slice(1, -1).filter((t) => STOPWORDS.has(t)).length;
    if (inner > 1) return false;
  }
  if (tokens.some((t) => t.length > 30)) return false;
  return true;
}

/** Cuenta n-gramas (1..maxN) en un texto. */
function countNgrams(text, maxN = 3, into = new Map()) {
  for (const tokens of tokenizeSentences(text)) {
    for (let n = 1; n <= maxN; n++) {
      for (let i = 0; i + n <= tokens.length; i++) {
        const gram = tokens.slice(i, i + n);
        if (!isValidNgram(gram)) continue;
        const key = gram.join(' ');
        into.set(key, (into.get(key) || 0) + 1);
      }
    }
  }
  return into;
}

function urlSlugText(url) {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname).replace(/[-_/.+]+/g, ' ').replace(/\b(html?|php|aspx?)\b/g, ' ');
  } catch {
    return '';
  }
}

/**
 * Extrae las keywords de una página ponderando por zona (título, H1, cuerpo, etc.).
 */
function extractPageKeywords(page) {
  const a = page.analysis;
  if (!a || !a._text) return new Map();
  const zones = {
    body: countNgrams(a._text.body),
    title: countNgrams(a.title),
    h1: countNgrams(a.headings.h1.join('. ')),
    h2: countNgrams([...a.headings.h2, ...a.headings.h3].join('. ')),
    meta: countNgrams(a.metaDescription),
    url: countNgrams(urlSlugText(page.url)),
    alt: countNgrams(a._text.imgAlts.join('. ')),
  };
  const result = new Map();
  for (const [zone, map] of Object.entries(zones)) {
    for (const [kw, count] of map) {
      let entry = result.get(kw);
      if (!entry) {
        entry = { keyword: kw, n: kw.split(' ').length, count: 0, weight: 0, zones: {} };
        result.set(kw, entry);
      }
      if (zone === 'body') entry.count = count;
      entry.zones[zone] = count;
      entry.weight += count * ZONE_WEIGHTS[zone];
    }
  }
  const wc = Math.max(1, a.wordCount);
  for (const entry of result.values()) {
    entry.density = Math.round(((entry.count * entry.n) / wc) * 10000) / 100;
  }
  return result;
}

function wordsRegex(words) {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
}

const NAV_RE = wordsRegex(['login', 'acceder', 'contacto', 'contact', 'sign in', 'iniciar sesión']);
const TRANS_RE = wordsRegex(['comprar', 'compra', 'precio', 'precios', 'barato', 'barata', 'baratos', 'oferta', 'ofertas', 'descuento', 'cupón', 'cupon', 'tienda', 'envío', 'envio', 'contratar', 'presupuesto', 'reservar', 'alquiler', 'buy', 'price', 'prices', 'cheap', 'deal', 'deals', 'discount', 'coupon', 'shop', 'order', 'hire', 'book']);
const COMM_RE = wordsRegex(['mejor', 'mejores', 'top', 'comparativa', 'comparar', 'vs', 'versus', 'opiniones', 'review', 'reviews', 'reseña', 'reseñas', 'alternativas', 'best', 'compare', 'comparison', 'alternatives', 'ranking']);
const INFO_RE = wordsRegex(['qué', 'que es', 'cómo', 'como', 'por qué', 'cuándo', 'dónde', 'guía', 'guia', 'tutorial', 'ejemplos', 'ejemplo', 'consejos', 'ideas', 'significado', 'definición', 'what', 'how', 'why', 'when', 'where', 'guide', 'tips', 'examples', 'meaning', 'definition']);

/** Clasificación heurística de la intención de búsqueda. */
function classifyIntent(keyword, brandTokens = []) {
  const k = String(keyword).toLowerCase();
  const tokens = k.split(/\s+/);
  if (brandTokens.some((b) => b && tokens.includes(b)) || NAV_RE.test(k)) return 'navegacional';
  if (TRANS_RE.test(k)) return 'transaccional';
  if (COMM_RE.test(k)) return 'comercial';
  if (INFO_RE.test(k)) return 'informacional';
  return 'indeterminada';
}

/**
 * Agrega las keywords de todas las páginas del sitio.
 * Devuelve la lista ordenada por relevancia y un mapa completo para comparaciones.
 */
function aggregateSiteKeywords(pages, { brand = '', limit = 300 } = {}) {
  const htmlPages = pages.filter((p) => p.analysis && p.status >= 200 && p.status < 300 && !p.analysis.noindex);
  const site = new Map();
  const perPage = [];
  for (const page of htmlPages) {
    const kws = extractPageKeywords(page);
    perPage.push({ url: page.url, kws });
    for (const [kw, e] of kws) {
      let s = site.get(kw);
      if (!s) {
        s = { keyword: kw, n: e.n, count: 0, weight: 0, pages: 0, inTitle: 0, inH1: 0, inMeta: 0, inUrl: 0, topPage: null, topWeight: 0, maxDensity: 0 };
        site.set(kw, s);
      }
      s.count += e.count;
      s.weight += e.weight;
      s.pages += 1;
      if (e.zones.title) s.inTitle++;
      if (e.zones.h1) s.inH1++;
      if (e.zones.meta) s.inMeta++;
      if (e.zones.url) s.inUrl++;
      if (e.weight > s.topWeight) {
        s.topWeight = e.weight;
        s.topPage = page.url;
      }
      if (e.density > s.maxDensity) s.maxDensity = e.density;
    }
  }

  const brandTokens = String(brand).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3);
  const list = [];
  for (const s of site.values()) {
    const totalOcc = s.count + s.inTitle + s.inH1 + s.inMeta + s.inUrl;
    if (s.n > 1 && totalOcc < 2) continue; // ruido
    s.score = Math.round(s.weight * (1 + Math.log(s.pages)) * 10) / 10;
    s.intent = classifyIntent(s.keyword, brandTokens);
    delete s.topWeight;
    list.push(s);
  }
  list.sort((a, b) => b.score - a.score || b.count - a.count);

  // Densidades sospechosas (keyword stuffing): como máximo 3 términos por página
  const stuffing = [];
  for (const { url, kws } of perPage) {
    const flagged = [];
    for (const e of kws.values()) {
      if (e.n === 1 && e.count >= 10 && e.density > 4) flagged.push({ url, keyword: e.keyword, density: e.density, count: e.count });
      if (e.n === 2 && e.count >= 6 && e.density > 3) flagged.push({ url, keyword: e.keyword, density: e.density, count: e.count });
    }
    flagged.sort((a, b) => b.density - a.density);
    stuffing.push(...flagged.slice(0, 3));
  }
  stuffing.sort((a, b) => b.density - a.density);

  // Canibalización: keyword principal (título + H1) compartida por varias páginas
  // Se excluyen la marca y las plantillas de título (n-gramas presentes en más de la mitad de los títulos)
  const cannibal = [];
  const titleTemplateLimit = Math.max(2, Math.ceil(htmlPages.length * 0.5));
  for (const s of list.slice(0, 400)) {
    const hasBrand = s.keyword.split(' ').some((t) => brandTokens.includes(t));
    if (s.n >= 2 && s.inTitle >= 2 && !hasBrand && (htmlPages.length < 4 || s.inTitle < titleTemplateLimit)) {
      const urls = perPage
        .filter(({ kws }) => kws.get(s.keyword)?.zones.title)
        .map(({ url }) => url);
      cannibal.push({ keyword: s.keyword, pages: urls.slice(0, 10), count: urls.length });
    }
  }
  cannibal.sort((a, b) => b.count - a.count);

  const lookup = new Map(list.slice(0, 3000).map((s) => [s.keyword, s.score]));

  return {
    top: list.slice(0, limit),
    byLength: {
      1: list.filter((k) => k.n === 1).slice(0, 50),
      2: list.filter((k) => k.n === 2).slice(0, 50),
      3: list.filter((k) => k.n === 3).slice(0, 50),
    },
    totalUnique: list.length,
    pagesAnalyzed: htmlPages.length,
    stuffing: stuffing.slice(0, 50),
    cannibalization: cannibal.slice(0, 30),
    lookup,
  };
}

/**
 * Análisis de brecha de keywords (content gap) entre el sitio y sus competidores.
 * Trabaja sobre las keywords extraídas del contenido (temas), no sobre rankings.
 */
function keywordGap(target, competitors, { topN = 150 } = {}) {
  const tTop = target.top.slice(0, topN);
  const tTopSet = new Set(tTop.map((k) => k.keyword));
  const rows = new Map();

  competitors.forEach((comp, ci) => {
    comp.keywords.top.slice(0, topN).forEach((k) => {
      let r = rows.get(k.keyword);
      if (!r) {
        r = { keyword: k.keyword, n: k.n, targetScore: target.lookup.get(k.keyword) || 0, competitors: {} };
        rows.set(k.keyword, r);
      }
      r.competitors[ci] = k.score;
    });
  });
  for (const k of tTop) {
    if (!rows.has(k.keyword)) {
      rows.set(k.keyword, { keyword: k.keyword, n: k.n, targetScore: k.score, competitors: {} });
    }
  }

  const out = { missing: [], weak: [], shared: [], unique: [], strong: [] };
  for (const r of rows.values()) {
    competitors.forEach((comp, ci) => {
      if (r.competitors[ci] === undefined) {
        const s = comp.keywords.lookup.get(r.keyword);
        if (s) r.competitors[ci] = s;
      }
    });
    const compScores = Object.values(r.competitors);
    r.competitorCount = compScores.length;
    r.maxCompetitor = compScores.length ? Math.max(...compScores) : 0;
    if (!compScores.length) {
      if (tTopSet.has(r.keyword)) out.unique.push(r);
    } else if (!r.targetScore) {
      out.missing.push(r);
    } else if (r.targetScore < r.maxCompetitor * 0.5) {
      out.weak.push(r);
    } else if (r.targetScore > r.maxCompetitor * 1.5) {
      out.strong.push(r);
    } else {
      out.shared.push(r);
    }
  }
  const byOpportunity = (a, b) => b.competitorCount - a.competitorCount || b.maxCompetitor - a.maxCompetitor;
  out.missing.sort(byOpportunity);
  out.weak.sort(byOpportunity);
  out.shared.sort((a, b) => b.targetScore - a.targetScore);
  out.strong.sort((a, b) => b.targetScore - a.targetScore);
  out.unique.sort((a, b) => b.targetScore - a.targetScore);
  for (const k of Object.keys(out)) out[k] = out[k].slice(0, 100);
  return out;
}

module.exports = {
  tokenizeSentences,
  countNgrams,
  isValidNgram,
  extractPageKeywords,
  aggregateSiteKeywords,
  keywordGap,
  classifyIntent,
};
