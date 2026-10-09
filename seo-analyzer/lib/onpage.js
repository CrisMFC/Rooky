'use strict';

const cheerio = require('cheerio');
const { canonicalizeUrl, isSameSite } = require('./urlutil');

const QUESTION_RE = /\?\s*$|^\s*¿|^\s*(how|what|why|when|where|which|who|can|does|do|is|are|should|qué|cómo|cuándo|dónde|por qué|cuál|cuáles|cuánto|cuánta|cuántos|cuántas|quién|quiénes)\s/i;

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/** Recuento de sílabas aproximado (español/inglés) para legibilidad. */
function countSyllables(word) {
  const w = word.toLowerCase().replace(/[^a-záéíóúüñ]/g, '');
  if (!w) return 0;
  const groups = w.match(/[aeiouyáéíóúü]+/g);
  let n = groups ? groups.length : 1;
  if (/[^aeiou]e$/.test(w) && n > 1 && /^[a-z]+$/.test(w)) n--; // "e" muda en inglés
  return Math.max(1, n);
}

/**
 * Legibilidad: Fernández-Huerta para español, Flesch Reading Ease para el resto.
 * Escala 0-100 (más alto = más fácil).
 */
function readability(text, lang) {
  const sentences = String(text).split(/[.!?¡¿…]+\s/).filter((s) => s.trim().split(/\s+/).length >= 3);
  const words = String(text).match(/[\p{L}]+/gu) || [];
  if (words.length < 50 || sentences.length < 3) return null;
  const syllables = words.reduce((a, w) => a + countSyllables(w), 0);
  const wps = words.length / sentences.length;
  const spw = syllables / words.length;
  let score;
  let formula;
  if (String(lang || '').startsWith('es')) {
    score = 206.84 - 60 * spw - 1.02 * wps;
    formula = 'Fernández-Huerta';
  } else {
    score = 206.835 - 84.6 * spw - 1.015 * wps;
    formula = 'Flesch';
  }
  score = Math.max(0, Math.min(100, score));
  let label = 'Muy difícil';
  if (score >= 90) label = 'Muy fácil';
  else if (score >= 80) label = 'Fácil';
  else if (score >= 70) label = 'Bastante fácil';
  else if (score >= 60) label = 'Normal';
  else if (score >= 50) label = 'Algo difícil';
  else if (score >= 30) label = 'Difícil';
  return { score: Math.round(score), label, formula, wordsPerSentence: Math.round(wps * 10) / 10 };
}

function parseJsonLd($) {
  const items = [];
  const errors = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      items.push(data);
    } catch (e) {
      errors.push(`JSON-LD inválido: ${e.message.slice(0, 120)}`);
    }
  });
  const types = new Set();
  const nodes = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node['@type']) {
      const t = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
      t.forEach((x) => types.add(String(x)));
      nodes.push(node);
    }
    if (node['@graph']) visit(node['@graph']);
    for (const [k, v] of Object.entries(node)) {
      if (k !== '@graph' && v && typeof v === 'object') visit(v);
    }
  };
  items.forEach(visit);
  return { count: items.length, types: [...types], nodes, errors };
}

/**
 * Analiza el HTML de una página y extrae todas las señales SEO on-page.
 */
function analyzeHtml(html, pageUrl, response = {}) {
  const $ = cheerio.load(html || '');
  const headers = response.headers || {};
  const isHttps = pageUrl.startsWith('https:');

  const title = clean($('head title').first().text() || $('title').first().text());
  const titleCount = $('title').length;
  const metaDescription = clean($('meta[name="description" i]').attr('content'));
  const metaDescriptionCount = $('meta[name="description" i]').length;
  const metaRobots = clean($('meta[name="robots" i]').attr('content')).toLowerCase();
  const googlebotMeta = clean($('meta[name="googlebot" i]').attr('content')).toLowerCase();
  const xRobots = String(headers['x-robots-tag'] || '').toLowerCase();
  const robotsDirectives = [metaRobots, googlebotMeta, xRobots].join(',');
  const noindex = /\bnoindex\b|\bnone\b/.test(robotsDirectives);
  const nofollowPage = /\bnofollow\b|\bnone\b/.test(robotsDirectives);
  const nosnippet = /\bnosnippet\b/.test(robotsDirectives);
  const maxSnippetMatch = robotsDirectives.match(/max-snippet\s*:\s*(-?\d+)/);
  const maxSnippet = maxSnippetMatch ? Number(maxSnippetMatch[1]) : null;
  const noai = /\bnoai\b|\bnoimageai\b/.test(robotsDirectives);

  const canonicalEls = $('link[rel~="canonical" i]');
  const canonicalRaw = canonicalEls.first().attr('href');
  const canonical = canonicalRaw ? canonicalizeUrl(canonicalRaw, pageUrl) : null;
  const linkHeader = String(headers.link || '');
  const headerCanonicalMatch = linkHeader.match(/<([^>]+)>\s*;\s*rel="?canonical"?/i);
  const headerCanonical = headerCanonicalMatch ? canonicalizeUrl(headerCanonicalMatch[1], pageUrl) : null;

  const lang = clean($('html').attr('lang')).toLowerCase();
  const charset = $('meta[charset]').attr('charset') || ($('meta[http-equiv="content-type" i]').attr('content') || '').split('charset=')[1] || '';
  const viewport = clean($('meta[name="viewport" i]').attr('content'));
  const metaRefresh = clean($('meta[http-equiv="refresh" i]').attr('content'));
  const favicon = $('link[rel~="icon" i], link[rel="shortcut icon" i], link[rel="apple-touch-icon" i]').first().attr('href') || null;

  const og = {};
  $('meta[property^="og:" i]').each((_, el) => {
    const p = String($(el).attr('property')).toLowerCase();
    if (!og[p]) og[p] = clean($(el).attr('content'));
  });
  const twitter = {};
  $('meta[name^="twitter:" i]').each((_, el) => {
    const p = String($(el).attr('name')).toLowerCase();
    if (!twitter[p]) twitter[p] = clean($(el).attr('content'));
  });

  const hreflang = [];
  $('link[rel="alternate" i][hreflang]').each((_, el) => {
    hreflang.push({ lang: String($(el).attr('hreflang')).toLowerCase(), href: canonicalizeUrl($(el).attr('href'), pageUrl) });
  });

  const headings = { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] };
  const headingOutline = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const tag = el.tagName.toLowerCase();
    const text = clean($(el).text());
    headings[tag].push(text);
    if (headingOutline.length < 80) headingOutline.push({ level: Number(tag[1]), text });
  });
  const questionHeadings = [...headings.h2, ...headings.h3, ...headings.h4].filter((h) => QUESTION_RE.test(h));

  // Saltos de jerarquía (p. ej. H2 -> H4)
  let headingSkips = 0;
  for (let i = 1; i < headingOutline.length; i++) {
    if (headingOutline[i].level - headingOutline[i - 1].level > 1) headingSkips++;
  }

  const jsonLd = parseJsonLd($);
  const microdataTypes = [];
  $('[itemtype]').each((_, el) => {
    const t = String($(el).attr('itemtype')).split('/').pop();
    if (t && !microdataTypes.includes(t)) microdataTypes.push(t);
  });

  // Imágenes
  const images = [];
  $('img').each((_, el) => {
    const $el = $(el);
    const src = $el.attr('src') || $el.attr('data-src') || $el.attr('data-lazy-src') || '';
    const hasAlt = $el.attr('alt') !== undefined;
    images.push({
      src: src ? canonicalizeUrl(src, pageUrl) || src : '',
      alt: hasAlt ? clean($el.attr('alt')) : null,
      missingAlt: !hasAlt,
      emptyAlt: hasAlt && clean($el.attr('alt')) === '',
      hasDimensions: $el.attr('width') !== undefined && $el.attr('height') !== undefined,
      lazy: ($el.attr('loading') || '').toLowerCase() === 'lazy',
    });
  });

  // Enlaces
  const links = [];
  $('a[href]').each((_, el) => {
    const $el = $(el);
    const hrefRaw = String($el.attr('href') || '').trim();
    if (!hrefRaw || hrefRaw.startsWith('#') || /^(javascript|mailto|tel|sms|data|ftp):/i.test(hrefRaw)) return;
    const href = canonicalizeUrl(hrefRaw, pageUrl);
    if (!href) return;
    const rel = String($el.attr('rel') || '').toLowerCase();
    let anchor = clean($el.text());
    if (!anchor) anchor = clean($el.find('img').attr('alt')) || clean($el.attr('aria-label')) || clean($el.attr('title'));
    links.push({
      href,
      anchor: anchor.slice(0, 200),
      internal: isSameSite(href, pageUrl),
      nofollow: /\bnofollow\b/.test(rel),
      sponsored: /\bsponsored\b/.test(rel),
      ugc: /\bugc\b/.test(rel),
      insecure: isHttps && href.startsWith('http:'),
    });
  });

  // Recursos con contenido mixto (http en página https)
  const mixedContent = [];
  if (isHttps) {
    $('img[src], script[src], link[rel="stylesheet"][href], iframe[src], video[src], audio[src], source[src]').each((_, el) => {
      const v = $(el).attr('src') || $(el).attr('href');
      if (v && /^http:\/\//i.test(v.trim())) mixedContent.push(v.trim());
    });
  }

  const scriptsExternal = $('script[src]').length;
  const scriptsInline = $('script:not([src])').filter((_, el) => {
    const t = String($(el).attr('type') || '').toLowerCase();
    return !t || t.includes('javascript') || t === 'module';
  }).length;
  const stylesheets = $('link[rel="stylesheet" i]').length;
  const iframes = $('iframe').length;
  const lists = $('main ul, main ol, article ul, article ol').length || $('ul, ol').length;
  const tables = $('table').length;
  const forms = $('form').length;
  const deprecatedTags = $('font, center, marquee, blink').length;

  // Señales E-E-A-T / IA
  const authorMeta = clean($('meta[name="author" i]').attr('content'));
  const publishedTime = clean($('meta[property="article:published_time" i]').attr('content')) || null;
  const modifiedTime = clean($('meta[property="article:modified_time" i]').attr('content')) || null;
  const hasTimeEl = $('time[datetime]').length > 0;
  const hasAddress = $('address').length > 0;
  const telLinks = $('a[href^="tel:" i]').length;

  // Texto visible
  const $body = cheerio.load($('body').html() || '');
  $body('script, style, noscript, template, svg, iframe, canvas').remove();
  const mainScope = $body('main').length ? $body('main') : $body('article').length ? $body('article') : $body.root();
  const bodyText = clean($body.root().text());
  const mainText = clean(mainScope.text());
  // Texto de contenido sin navegación, cabecera, pie ni barras laterales (para keywords)
  const $content = cheerio.load($body.html() || '');
  $content('nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"]').remove();
  const contentScope = $content('main').length ? $content('main') : $content.root();
  let contentText = clean(contentScope.text());
  if ((contentText.match(/\S+/g) || []).length < 30) contentText = bodyText;
  const paragraphs = [];
  $body('p, li, td, blockquote, dd').each((_, el) => {
    const t = clean($body(el).text());
    if (t.split(' ').length >= 4) paragraphs.push(t);
  });
  const words = bodyText.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || [];
  const wordCount = words.length;
  const htmlBytes = Buffer.byteLength(html || '', 'utf8');
  const textBytes = Buffer.byteLength(bodyText, 'utf8');
  const textRatio = htmlBytes ? Math.round((textBytes / htmlBytes) * 1000) / 10 : 0;

  const imgAlts = images.map((i) => i.alt).filter(Boolean);

  return {
    title,
    titleLength: title.length,
    titleCount,
    metaDescription,
    metaDescriptionLength: metaDescription.length,
    metaDescriptionCount,
    metaRobots,
    xRobotsTag: xRobots,
    noindex,
    nofollowPage,
    nosnippet,
    maxSnippet,
    noai,
    canonical,
    canonicalCount: canonicalEls.length,
    headerCanonical,
    lang,
    charset: clean(charset),
    viewport,
    metaRefresh,
    favicon,
    og,
    twitter,
    hreflang,
    headings,
    headingOutline,
    headingSkips,
    questionHeadings,
    jsonLd: { count: jsonLd.count, types: jsonLd.types, errors: jsonLd.errors },
    jsonLdNodes: jsonLd.nodes,
    microdataTypes,
    images,
    imageCount: images.length,
    imagesMissingAlt: images.filter((i) => i.missingAlt).length,
    imagesWithoutDimensions: images.filter((i) => !i.hasDimensions).length,
    links,
    internalLinks: links.filter((l) => l.internal).length,
    externalLinks: links.filter((l) => !l.internal).length,
    mixedContent,
    scriptsExternal,
    scriptsInline,
    stylesheets,
    iframes,
    lists,
    tables,
    forms,
    deprecatedTags,
    authorMeta,
    publishedTime,
    modifiedTime,
    hasTimeEl,
    hasAddress,
    telLinks,
    wordCount,
    mainWordCount: (mainText.match(/[\p{L}\p{N}]+/gu) || []).length,
    htmlBytes,
    textRatio,
    readability: readability(paragraphs.join('. ') || bodyText, lang),
    // Para el análisis de keywords (no se envía completo al cliente)
    _text: { body: contentText, paragraphs, imgAlts },
  };
}

module.exports = { analyzeHtml, readability, countSyllables, QUESTION_RE };
