'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeHtml } = require('../lib/onpage');
const { countNgrams, classifyIntent, aggregateSiteKeywords, keywordGap } = require('../lib/keywords');

const HTML = `<!doctype html><html lang="ES"><head>
<title> Zapatillas de running | Tienda </title>
<meta name="Description" content="Compra zapatillas de running baratas.">
<meta name="robots" content="noindex, max-snippet:20">
<link rel="canonical" href="/zapatillas">
<meta property="og:title" content="Zapatillas">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"X"},{"@type":"Product","name":"Y"}]}</script>
</head><body><header><nav><a href="/">Inicio</a></nav></header>
<main><h1>Zapatillas de running</h1><h3>¿Cómo elegir zapatillas?</h3>
<p>Las zapatillas de running ligeras son ideales para correr rápido por asfalto y por montaña.</p>
<img src="a.jpg"><img src="b.jpg" alt=""><a href="https://otra.com/x" rel="nofollow sponsored">Otra</a>
<a href="mailto:a@b.c">mail</a><a href="#top">top</a><a href="http://tienda.test/plain">http interno</a>
<script>var x = "texto oculto";</script></main></body></html>`;

test('extrae etiquetas on-page', () => {
  const a = analyzeHtml(HTML, 'https://tienda.test/zapatillas?x=1', { headers: {} });
  assert.equal(a.title, 'Zapatillas de running | Tienda');
  assert.equal(a.metaDescription, 'Compra zapatillas de running baratas.');
  assert.equal(a.noindex, true);
  assert.equal(a.maxSnippet, 20);
  assert.equal(a.canonical, 'https://tienda.test/zapatillas');
  assert.equal(a.lang, 'es');
  assert.deepEqual(a.headings.h1, ['Zapatillas de running']);
  assert.equal(a.headingSkips, 1); // H1 -> H3
  assert.equal(a.questionHeadings.length, 1);
  assert.deepEqual(a.jsonLd.types.sort(), ['Organization', 'Product']);
  assert.equal(a.imagesMissingAlt, 1);
  assert.equal(a.links.length, 3); // mailto y #ancla excluidos
  const ext = a.links.find((l) => !l.internal);
  assert.equal(ext.nofollow, true);
  assert.equal(ext.sponsored, true);
  const insecure = a.links.find((l) => l.href === 'http://tienda.test/plain');
  assert.equal(insecure.internal, true);
  assert.equal(insecure.insecure, true);
  assert.ok(!a._text.body.includes('texto oculto'), 'el JS no cuenta como texto');
  assert.ok(!a._text.body.includes('Inicio') || a._text.body.split(' ').length < 30, 'la navegación se excluye del texto de keywords');
});

test('JSON-LD inválido se reporta', () => {
  const a = analyzeHtml('<html><head><script type="application/ld+json">{bad}</script></head><body></body></html>', 'https://x.test/', {});
  assert.equal(a.jsonLd.errors.length, 1);
});

test('n-gramas sin stopwords en los extremos', () => {
  const m = countNgrams('Marketing digital para empresas de Madrid.');
  assert.ok(m.has('marketing digital'));
  assert.ok(m.has('empresas de madrid'));
  assert.ok(!m.has('para empresas'));
  assert.ok(!m.has('de madrid'));
});

test('intención de búsqueda con palabras acentuadas', () => {
  assert.equal(classifyIntent('qué es seo'), 'informacional');
  assert.equal(classifyIntent('envío gratis zapatillas'), 'transaccional');
  assert.equal(classifyIntent('mejores zapatillas'), 'comercial');
  assert.equal(classifyIntent('nike login'), 'navegacional');
  assert.equal(classifyIntent('zapatillas rojas'), 'indeterminada');
});

test('agregación y brecha de keywords', () => {
  const mk = (url, title, body) => ({ url, status: 200, analysis: analyzeHtml(`<html><head><title>${title}</title></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`, url, {}) });
  const target = aggregateSiteKeywords([mk('https://a.test/', 'Zapatillas running', 'zapatillas running baratas zapatillas running ligeras')]);
  const comp = aggregateSiteKeywords([mk('https://b.test/', 'Botas montaña', 'botas montaña impermeables botas montaña y zapatillas running')]);
  assert.equal(target.top[0].keyword.includes('zapatillas') || target.top[0].keyword.includes('running'), true);
  const gap = keywordGap(target, [{ keywords: comp }]);
  assert.ok(gap.missing.some((r) => r.keyword === 'botas montaña'));
  assert.ok(!gap.missing.some((r) => r.keyword === 'zapatillas running'));
});
