'use strict';

/*
 * Pruebas de las integraciones externas con respuestas simuladas
 * (no se hace ninguna llamada real ni se gasta crédito).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { pageSpeed, openPageRank, DataForSeo, googleSuggest } = require('../lib/integrations');
const { runAiVisibility, parseClaudeResponse } = require('../lib/ai');

const realFetch = globalThis.fetch;
const calls = [];

function mockFetch(routes) {
  calls.length = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const headers = new Headers(init.headers || (input && input.headers) || {});
    let body = init.body;
    if (body === undefined && input && typeof input.text === 'function') body = await input.text();
    calls.push({ url, method: init.method || (input && input.method) || 'GET', headers, body });
    for (const [match, handler] of routes) {
      if (url.includes(match)) {
        const { status = 200, json, text, headers: h = {} } = await handler(url, body);
        return new Response(json !== undefined ? JSON.stringify(json) : text, {
          status,
          headers: { 'content-type': json !== undefined ? 'application/json' : 'text/plain', ...h },
        });
      }
    }
    return new Response('not found', { status: 404 });
  };
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test('PageSpeed: parsea puntuaciones, métricas de laboratorio y de campo', async () => {
  mockFetch([['pagespeedonline', () => ({
    json: {
      lighthouseResult: {
        finalUrl: 'https://x.test/',
        categories: { performance: { score: 0.87 }, seo: { score: 1 }, accessibility: { score: 0.9 }, 'best-practices': { score: 0.75 } },
        audits: {
          'largest-contentful-paint': { id: 'largest-contentful-paint', displayValue: '2,1 s', numericValue: 2100, score: 0.8 },
          'cumulative-layout-shift': { id: 'cumulative-layout-shift', displayValue: '0,02', numericValue: 0.02, score: 1 },
          'render-blocking-resources': { id: 'render-blocking-resources', title: 'Elimina recursos que bloquean', score: 0.4, displayValue: 'Ahorro 300 ms', details: { type: 'opportunity' } },
        },
      },
      loadingExperience: {
        overall_category: 'AVERAGE',
        metrics: {
          LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2600, category: 'AVERAGE' },
          CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5, category: 'FAST' },
          INTERACTION_TO_NEXT_PAINT: { percentile: 180, category: 'FAST' },
        },
      },
    },
  })]]);
  const r = await pageSpeed('https://x.test/', { strategy: 'mobile', apiKey: 'K' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.scores, { performance: 87, seo: 100, accessibility: 90, bestPractices: 75 });
  assert.equal(r.lab.find((m) => m.id === 'largest-contentful-paint').value, '2,1 s');
  assert.equal(r.field.CLS.percentile, 0.05);
  assert.equal(r.field.INP.category, 'FAST');
  assert.equal(r.opportunities.length, 1);
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get('key'), 'K');
  assert.deepEqual(u.searchParams.getAll('category'), ['performance', 'seo', 'accessibility', 'best-practices']);
});

test('PageSpeed: cuota agotada devuelve error legible', async () => {
  mockFetch([['pagespeedonline', () => ({ status: 429, json: { error: { message: 'Quota exceeded' } } })]]);
  const r = await pageSpeed('https://x.test/');
  assert.equal(r.ok, false);
  assert.match(r.error, /Cuota/);
});

test('OpenPageRank: envía la clave y normaliza dominios', async () => {
  mockFetch([['openpagerank.com', () => ({
    json: { status_code: 200, response: [{ status_code: 200, error: '', page_rank_integer: 5, page_rank_decimal: 4.57, rank: '12345', domain: 'X.test' }] },
  })]]);
  const r = await openPageRank(['x.test'], 'OPRKEY');
  assert.equal(r.ok, true);
  assert.equal(r.data['x.test'].pageRank, 4.57);
  assert.equal(r.data['x.test'].rank, 12345);
  assert.equal(calls[0].headers.get('api-opr'), 'OPRKEY');
});

test('DataForSEO: autenticación, overview, keywords posicionadas y backlinks', async () => {
  const ok = (result) => ({ json: { status_code: 20000, status_message: 'Ok.', cost: 0.01, tasks: [{ status_code: 20000, status_message: 'Ok.', result }] } });
  mockFetch([
    ['domain_rank_overview', () => ok([{ items: [{ metrics: { organic: { count: 120, etv: 345.6, pos_1: 3, pos_2_3: 5, pos_4_10: 10, pos_11_20: 20, pos_21_30: 1, pos_31_40: 1, pos_41_50: 1, pos_51_60: 2 } } }] }])],
    ['ranked_keywords', () => ok([{ total_count: 120, items: [{ keyword_data: { keyword: 'seo local', keyword_info: { search_volume: 1000, cpc: 1.2, competition: 0.4 }, keyword_properties: { keyword_difficulty: 35 }, search_intent_info: { main_intent: 'commercial' } }, ranked_serp_element: { serp_item: { rank_group: 4, url: 'https://x.test/seo-local', type: 'organic', etv: 52.3 } } }] }])],
    ['backlinks/summary', () => ok([{ rank: 210, backlinks: 5000, referring_domains: 120, referring_main_domains: 100, referring_ips: 90, referring_domains_nofollow: 10, broken_backlinks: 3, backlinks_spam_score: 4 }])],
    ['competitors_domain', () => ok([{ items: [{ domain: 'x.test', avg_position: 5 }, { domain: 'rival.test', avg_position: 7.25, intersections: 40, full_domain_metrics: { organic: { count: 300, etv: 900.4 } } }] }])],
    ['keyword_overview', () => ok([{ items: [{ keyword: 'seo local', keyword_info: { search_volume: 1000, cpc: 1.2, monthly_searches: [{ search_volume: 3 }, { search_volume: 2 }, { search_volume: 1 }] }, keyword_properties: { keyword_difficulty: 35 } }] }])],
  ]);
  const d = new DataForSeo('login@x.test', 'pw');
  const loc = { location_code: 2724, language_code: 'es' };
  const ov = await d.domainOverview('x.test', loc);
  assert.equal(ov.organic.keywords, 120);
  assert.equal(ov.organic.traffic, 346);
  assert.equal(ov.organic.pos21_50, 3);
  assert.equal(ov.organic.pos51_100, 2);
  assert.equal(calls[0].headers.get('authorization'), 'Basic ' + Buffer.from('login@x.test:pw').toString('base64'));
  assert.equal(JSON.parse(calls[0].body)[0].target, 'x.test');

  const rk = await d.rankedKeywords('x.test', loc);
  assert.deepEqual(rk.items[0], { keyword: 'seo local', volume: 1000, cpc: 1.2, competition: 0.4, difficulty: 35, intent: 'commercial', position: 4, url: 'https://x.test/seo-local', type: 'organic', traffic: 52.3 });

  const bl = await d.backlinksSummary('x.test');
  assert.equal(bl.referringDomains, 120);
  assert.equal(bl.brokenBacklinks, 3);

  const comps = await d.competitors('x.test', loc);
  assert.equal(comps.items.length, 1, 'excluye el propio dominio');
  assert.equal(comps.items[0].domain, 'rival.test');

  const kw = await d.keywordOverview(['seo local'], loc);
  assert.equal(kw.data['seo local'].difficulty, 35);
  assert.deepEqual(kw.data['seo local'].trend, [1, 2, 3]);
});

test('DataForSEO: errores de API y de tarea se propagan', async () => {
  mockFetch([['dataforseo', () => ({ json: { status_code: 40100, status_message: 'You are not authorized' } })]]);
  await assert.rejects(new DataForSeo('a', 'b').backlinksSummary('x.test'), /not authorized/);
  mockFetch([['dataforseo', () => ({ json: { status_code: 20000, tasks: [{ status_code: 40501, status_message: 'Invalid Field' }] } })]]);
  await assert.rejects(new DataForSeo('a', 'b').backlinksSummary('x.test'), /Invalid Field/);
});

test('Google Suggest: parsea la respuesta', async () => {
  mockFetch([['suggestqueries', () => ({ json: ['seo local', ['seo local', 'seo local madrid', 'seo local precio']] })]]);
  const r = await googleSuggest('seo local', { hl: 'es', gl: 'es' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.suggestions, ['seo local madrid', 'seo local precio']);
});

test('Claude: parsea texto, citas y fuentes de la búsqueda web', () => {
  const p = parseClaudeResponse([
    { type: 'server_tool_use', id: 'x', name: 'web_search', input: { query: 'q' } },
    { type: 'web_search_tool_result', tool_use_id: 'x', content: [{ type: 'web_search_result', url: 'https://www.rival.test/a', title: 'A' }] },
    { type: 'text', text: 'Te recomiendo Rooky y también ', citations: [{ type: 'web_search_result_location', url: 'https://rooky.test/blog', title: 'B', cited_text: '...' }] },
    { type: 'text', text: 'Rival. Más en https://otro.test/x.' },
  ]);
  assert.ok(p.text.includes('Rooky'));
  assert.deepEqual(p.searched, ['https://www.rival.test/a']);
  assert.ok(p.cited.includes('https://rooky.test/blog'));
  assert.ok(p.cited.includes('https://otro.test/x'));
});

test('Claude: petición correcta, reanuda pause_turn y calcula la cuota de voz', async () => {
  let n = 0;
  mockFetch([['api.anthropic.com', (url, body) => {
    n++;
    const req = JSON.parse(body);
    if (n === 1) {
      return { json: { id: 'm1', type: 'message', role: 'assistant', model: req.model, stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'mejor agencia seo' } }], usage: { input_tokens: 10, output_tokens: 5 } } };
    }
    if (n === 2) {
      return { json: { id: 'm2', type: 'message', role: 'assistant', model: req.model, stop_reason: 'end_turn', content: [
        { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://rooky.test/', title: 'Rooky' }] },
        { type: 'text', text: 'Las mejores opciones son Rival y Rooky.', citations: [{ type: 'web_search_result_location', url: 'https://rooky.test/', cited_text: 'x' }] },
      ], usage: { input_tokens: 20, output_tokens: 15 } } };
    }
    return { json: { id: 'm3', type: 'message', role: 'assistant', model: req.model, stop_reason: 'refusal', content: [], usage: { input_tokens: 1, output_tokens: 0 } } };
  }]]);

  const res = await runAiVisibility({
    apiKey: 'sk-ant-test',
    model: 'claude-opus-5-5',
    prompts: ['¿Mejor agencia SEO?', 'Otra consulta'],
    target: { domain: 'rooky.test', terms: ['rooky.test', 'rooky'] },
    competitors: [{ domain: 'rival.test', terms: ['rival.test', 'rival'] }],
  });

  const first = JSON.parse(calls[0].body);
  assert.equal(first.model, 'claude-opus-5-5');
  assert.equal(first.fallbacks, 'default');
  assert.equal(first.output_config.effort, 'low');
  assert.deepEqual(first.tools, [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }]);
  assert.equal(first.thinking, undefined);
  assert.equal(calls[0].headers.get('anthropic-beta'), 'server-side-fallback-2026-07-01');
  assert.equal(calls[0].headers.get('x-api-key'), 'sk-ant-test');
  // Reanudación: el turno pausado se reenvía como mensaje del asistente
  const second = JSON.parse(calls[1].body);
  assert.equal(second.messages.length, 2);
  assert.equal(second.messages[1].role, 'assistant');

  assert.equal(res.answered, 1);
  assert.match(res.results[1].error, /rechazó/);
  const [t, c] = res.summary;
  assert.equal(t.mentions, 1);
  assert.equal(t.citations, 1);
  assert.equal(t.avgRank, 2);
  assert.equal(c.mentions, 1);
  assert.equal(c.avgRank, 1);
  assert.equal(t.shareOfVoice + c.shareOfVoice, 100);
});
