'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.REPORTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rooky-reports-'));
const { startFixture } = require('../fixtures/site');
const { fullAnalysis } = require('../lib/analyzer');
const { app } = require('../server');

let site;
let rival;
let server;
let api;

test.before(async () => {
  site = await startFixture();
  rival = await startFixture();
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  api = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  site.server.close();
  rival.server.close();
  server.close();
  fs.rmSync(process.env.REPORTS_DIR, { recursive: true, force: true });
});

test('análisis completo del sitio de prueba con un competidor', async () => {
  const report = await fullAnalysis({
    url: site.base,
    competitors: [rival.base.replace('localhost', '127.0.0.1')],
    maxPages: 50,
    competitorPages: 20,
    pagespeed: false,
    suggestions: false,
    checkExternal: true,
    keys: {},
  });
  const t = report.target;
  const ids = new Set(t.audit.issues.map((i) => i.id));

  // Rastreo
  const urls = t.pages.map((p) => new URL(p.url).pathname);
  assert.ok(urls.includes('/huerfana'), 'descubre URLs del sitemap');
  assert.ok(!urls.includes('/privado/secreto'), 'respeta robots.txt');
  assert.equal(t.stats.blockedByRobots, 1);
  const orphan = t.pages.find((p) => p.url.endsWith('/huerfana'));
  assert.equal(orphan.inlinks, 0);
  const home = t.pages.find((p) => p.depth === 0);
  assert.ok(home.inlinks >= 8, 'la portada recibe enlaces de todas las páginas');
  assert.ok(!home.inlinkSamples.some((s) => s.from === home.url), 'no cuenta autoenlaces');

  // Auditoría: cada problema sembrado en el sitio de prueba se detecta
  for (const id of ['status-4xx', 'title-missing', 'title-duplicate', 'meta-description-duplicate', 'jsonld-invalid',
    'broken-internal-links', 'sitemap-bad-urls', 'no-https', 'redirect-chain', 'img-alt-missing', 'h1-missing',
    'meta-description-missing', 'low-word-count', 'noindex', 'heading-skip', 'orphan', 'robots-blocks-ai-search', 'no-llms-txt', 'broken-external-links']) {
    assert.ok(ids.has(id), `debería detectar ${id}`);
  }
  // Y no hay falsos positivos evidentes
  for (const id of ['status-5xx', 'robots-blocks-all', 'robots-missing', 'sitemap-missing', 'soft-404', 'mixed-content', 'viewport-missing', 'lang-missing']) {
    assert.ok(!ids.has(id), `no debería detectar ${id}`);
  }
  assert.ok(t.audit.health > 0 && t.audit.health < 100);

  // Búsqueda IA
  const bots = Object.fromEntries(t.ai.crawlers.map((b) => [b.name, b.allowed]));
  assert.equal(bots.GPTBot, false);
  assert.equal(bots.PerplexityBot, false);
  assert.equal(bots.ClaudeBot, true);
  assert.equal(bots['OAI-SearchBot'], true);
  assert.deepEqual(t.ai.blockedSearch, ['PerplexityBot']);
  assert.ok(t.ai.score >= 0 && t.ai.score <= 100);

  // Keywords
  assert.ok(t.keywords.top.some((k) => k.keyword === 'seo local'));
  assert.ok(!t.keywords.top.some((k) => k.keyword === 'inicio'), 'la navegación no genera keywords');

  // Competencia
  assert.equal(report.competitors.length, 1);
  assert.equal(report.comparison.length, 2);
  assert.ok(report.keywordGap);
  assert.equal(report.target._keywordsFull, undefined, 'no se serializan datos internos');
  assert.ok(Array.isArray(report.aiPromptSuggestions) && report.aiPromptSuggestions.length > 0);
  JSON.stringify(report); // serializable
});

test('API: valida entrada, ejecuta el análisis y gestiona informes', async () => {
  let res = await fetch(`${api}/api/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'no es una url' }) });
  assert.equal(res.status, 400);

  res = await fetch(`${api}/api/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: site.base, maxPages: 5, pagespeed: false, suggestions: false, checkExternal: false }),
  });
  assert.equal(res.status, 200);
  const { jobId } = await res.json();
  let job;
  for (let i = 0; i < 120; i++) {
    job = await (await fetch(`${api}/api/jobs/${jobId}`)).json();
    if (job.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.equal(job.status, 'done', job.error || '');
  assert.ok(job.logs.length > 0);

  const report = await (await fetch(`${api}/api/reports/${job.reportId}`)).json();
  assert.equal(report.id, job.reportId);
  assert.ok(report.target.pages.length <= 5);

  const list = await (await fetch(`${api}/api/reports`)).json();
  assert.ok(list.some((r) => r.id === job.reportId));

  res = await fetch(`${api}/api/ai-visibility`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reportId: job.reportId, prompts: ['x'] }) });
  if (!process.env.ANTHROPIC_API_KEY) assert.equal(res.status, 400);

  res = await fetch(`${api}/api/reports/../../server.js`);
  assert.equal(res.status, 404);
  res = await fetch(`${api}/api/reports/${job.reportId}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  res = await fetch(`${api}/api/reports/${job.reportId}`);
  assert.equal(res.status, 404);
});
