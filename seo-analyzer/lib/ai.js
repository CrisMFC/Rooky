'use strict';

const { fetchUrl } = require('./http');
const { isAllowed } = require('./robots');

/**
 * Rastreadores de IA conocidos y su función.
 * - entrenamiento: recoge contenido para entrenar modelos.
 * - búsqueda: indexa para mostrar/citar en respuestas de buscadores IA.
 * - usuario: visita la página cuando un usuario lo pide en un chat.
 */
const AI_BOTS = [
  { token: 'gptbot', name: 'GPTBot', vendor: 'OpenAI', purpose: 'entrenamiento' },
  { token: 'oai-searchbot', name: 'OAI-SearchBot', vendor: 'OpenAI', purpose: 'búsqueda' },
  { token: 'chatgpt-user', name: 'ChatGPT-User', vendor: 'OpenAI', purpose: 'usuario' },
  { token: 'claudebot', name: 'ClaudeBot', vendor: 'Anthropic', purpose: 'entrenamiento' },
  { token: 'claude-searchbot', name: 'Claude-SearchBot', vendor: 'Anthropic', purpose: 'búsqueda' },
  { token: 'claude-user', name: 'Claude-User', vendor: 'Anthropic', purpose: 'usuario' },
  { token: 'perplexitybot', name: 'PerplexityBot', vendor: 'Perplexity', purpose: 'búsqueda' },
  { token: 'perplexity-user', name: 'Perplexity-User', vendor: 'Perplexity', purpose: 'usuario' },
  { token: 'google-extended', name: 'Google-Extended', vendor: 'Google', purpose: 'entrenamiento (Gemini)' },
  { token: 'googlebot', name: 'Googlebot', vendor: 'Google', purpose: 'búsqueda (incluye AI Overviews / AI Mode)' },
  { token: 'bingbot', name: 'Bingbot', vendor: 'Microsoft', purpose: 'búsqueda (Bing, Copilot)' },
  { token: 'applebot-extended', name: 'Applebot-Extended', vendor: 'Apple', purpose: 'entrenamiento' },
  { token: 'meta-externalagent', name: 'Meta-ExternalAgent', vendor: 'Meta', purpose: 'entrenamiento' },
  { token: 'amazonbot', name: 'Amazonbot', vendor: 'Amazon', purpose: 'búsqueda / Alexa' },
  { token: 'ccbot', name: 'CCBot', vendor: 'Common Crawl', purpose: 'entrenamiento (dataset abierto)' },
  { token: 'bytespider', name: 'Bytespider', vendor: 'ByteDance', purpose: 'entrenamiento' },
  { token: 'duckassistbot', name: 'DuckAssistBot', vendor: 'DuckDuckGo', purpose: 'búsqueda' },
  { token: 'mistralai-user', name: 'MistralAI-User', vendor: 'Mistral', purpose: 'usuario' },
];

function aiCrawlerAccess(robotsParsed) {
  return AI_BOTS.map((bot) => {
    const r = isAllowed(robotsParsed, bot.token, '/');
    return {
      ...bot,
      allowed: r.allowed,
      matchedGroup: r.matchedAgent,
      rule: r.rule,
    };
  });
}

async function checkLlmsTxt(origin, opts = {}) {
  const out = {};
  for (const file of ['llms.txt', 'llms-full.txt']) {
    const res = await fetchUrl(`${origin}/${file}`, { timeout: opts.timeout, userAgent: opts.userAgent, maxBytes: 2 * 1024 * 1024 });
    const isHtml = /<html|<!doctype/i.test(res.text.slice(0, 300));
    const exists = res.ok && !isHtml && res.text.trim().length > 0;
    out[file] = {
      url: `${origin}/${file}`,
      status: res.status,
      exists,
      bytes: exists ? res.bytes : 0,
      hasH1: exists ? /^#\s+\S/m.test(res.text) : false,
      links: exists ? (res.text.match(/\]\(https?:\/\/[^)]+\)/g) || []).length : 0,
      preview: exists ? res.text.slice(0, 1500) : '',
    };
  }
  return out;
}

/**
 * Evalúa lo preparado que está el sitio para buscadores con IA (GEO / AEO).
 */
function aiReadiness({ pages, robots, llms, homepage }) {
  const html = pages.filter((p) => p.analysis && p.status >= 200 && p.status < 300);
  const n = html.length || 1;
  const pct = (count) => Math.round((count / n) * 100);
  const access = aiCrawlerAccess(robots.parsed);
  const searchBots = access.filter((b) => /búsqueda|usuario/.test(b.purpose));
  const blockedSearch = searchBots.filter((b) => !b.allowed);
  const blockedTraining = access.filter((b) => /entrenamiento/.test(b.purpose) && !b.allowed);

  const withSchema = html.filter((p) => p.analysis.jsonLd.count > 0 || p.analysis.microdataTypes.length > 0).length;
  const allTypes = new Set(html.flatMap((p) => [...p.analysis.jsonLd.types, ...p.analysis.microdataTypes]));
  const withQuestions = html.filter((p) => p.analysis.questionHeadings.length > 0).length;
  const withLists = html.filter((p) => p.analysis.lists > 0 || p.analysis.tables > 0).length;
  const withAuthor = html.filter((p) => p.analysis.authorMeta || p.analysis.jsonLdNodes.some((nd) => nd.author)).length;
  const withDates = html.filter((p) => p.analysis.publishedTime || p.analysis.modifiedTime || p.analysis.hasTimeEl || p.analysis.jsonLdNodes.some((nd) => nd.datePublished || nd.dateModified)).length;
  const thin = html.filter((p) => p.analysis.wordCount < 300).length;
  const jsDependent = html.filter((p) => p.analysis.wordCount < 80 && p.analysis.scriptsExternal >= 3).length;
  const snippetBlocked = html.filter((p) => p.analysis.nosnippet || (p.analysis.maxSnippet !== null && p.analysis.maxSnippet >= 0 && p.analysis.maxSnippet < 50)).length;
  const noai = html.filter((p) => p.analysis.noai).length;
  const avgWords = Math.round(html.reduce((a, p) => a + p.analysis.wordCount, 0) / n);
  const orgSchema = [...allTypes].some((t) => /^(Organization|LocalBusiness|Corporation|Person|.*Business|Store|Restaurant)$/.test(t));
  const sameAs = html.some((p) => p.analysis.jsonLdNodes.some((nd) => nd.sameAs));

  const checks = [
    {
      id: 'ai-search-bots',
      label: 'Los bots de búsqueda IA pueden rastrear el sitio',
      ok: blockedSearch.length === 0,
      weight: 20,
      detail: blockedSearch.length ? `Bloqueados: ${blockedSearch.map((b) => b.name).join(', ')}` : 'OAI-SearchBot, PerplexityBot, Claude-SearchBot, Googlebot y Bingbot tienen acceso.',
    },
    {
      id: 'ssr-content',
      label: 'El contenido está en el HTML (no depende de JavaScript)',
      ok: jsDependent === 0,
      weight: 15,
      detail: jsDependent ? `${jsDependent} página(s) con casi nada de texto en el HTML y mucho JavaScript. La mayoría de rastreadores IA no ejecutan JS.` : 'El texto principal está disponible sin ejecutar JavaScript.',
    },
    {
      id: 'schema',
      label: 'Datos estructurados (Schema.org)',
      ok: pct(withSchema) >= 60,
      weight: 12,
      detail: `${pct(withSchema)}% de las páginas tienen datos estructurados. Tipos: ${[...allTypes].slice(0, 12).join(', ') || 'ninguno'}.`,
    },
    {
      id: 'entity',
      label: 'Entidad definida (Organization/LocalBusiness + sameAs)',
      ok: orgSchema && sameAs,
      weight: 10,
      detail: orgSchema ? (sameAs ? 'Organización definida y enlazada a perfiles externos (sameAs).' : 'Hay schema de organización pero sin "sameAs" a perfiles oficiales.') : 'No se encontró schema Organization/LocalBusiness/Person.',
    },
    {
      id: 'llms-txt',
      label: 'Archivo llms.txt',
      ok: !!(llms && llms['llms.txt'] && llms['llms.txt'].exists),
      weight: 5,
      detail: llms && llms['llms.txt'] && llms['llms.txt'].exists ? `Encontrado (${llms['llms.txt'].links} enlaces).` : 'No existe /llms.txt (estándar emergente; impacto todavía limitado, pero barato de añadir).',
    },
    {
      id: 'questions',
      label: 'Contenido en formato pregunta-respuesta',
      ok: pct(withQuestions) >= 25,
      weight: 10,
      detail: `${pct(withQuestions)}% de las páginas tienen encabezados en forma de pregunta.`,
    },
    {
      id: 'structure',
      label: 'Contenido estructurado (listas / tablas)',
      ok: pct(withLists) >= 50,
      weight: 6,
      detail: `${pct(withLists)}% de las páginas usan listas o tablas, formatos que los LLM extraen y citan con facilidad.`,
    },
    {
      id: 'eeat-author',
      label: 'Autoría visible (E-E-A-T)',
      ok: pct(withAuthor) >= 30,
      weight: 7,
      detail: `${pct(withAuthor)}% de las páginas declaran autor (meta author o schema).`,
    },
    {
      id: 'freshness',
      label: 'Fechas de publicación/actualización',
      ok: pct(withDates) >= 30,
      weight: 7,
      detail: `${pct(withDates)}% de las páginas muestran fecha. Los buscadores IA priorizan contenido actualizado.`,
    },
    {
      id: 'depth',
      label: 'Profundidad del contenido',
      ok: avgWords >= 500 && pct(thin) <= 30,
      weight: 8,
      detail: `Media de ${avgWords} palabras por página; ${pct(thin)}% de páginas con menos de 300 palabras.`,
    },
    {
      id: 'snippets',
      label: 'Sin restricciones de fragmentos (nosnippet / max-snippet)',
      ok: snippetBlocked === 0 && noai === 0,
      weight: 0,
      detail: snippetBlocked || noai ? `${snippetBlocked} página(s) limitan fragmentos y ${noai} usan "noai". Esto reduce la aparición en AI Overviews y respuestas IA.` : 'No hay directivas que impidan mostrar fragmentos.',
    },
  ];
  const totalWeight = checks.reduce((a, c) => a + c.weight, 0);
  const score = Math.round((checks.reduce((a, c) => a + (c.ok ? c.weight : 0), 0) / totalWeight) * 100);

  return {
    score,
    checks,
    crawlers: access,
    blockedSearch: blockedSearch.map((b) => b.name),
    blockedTraining: blockedTraining.map((b) => b.name),
    llms,
    stats: {
      pages: html.length,
      withSchemaPct: pct(withSchema),
      schemaTypes: [...allTypes],
      withQuestionsPct: pct(withQuestions),
      withListsPct: pct(withLists),
      withAuthorPct: pct(withAuthor),
      withDatesPct: pct(withDates),
      avgWords,
      thinPct: pct(thin),
      jsDependent,
    },
    homepageHasOrgSchema: homepage && homepage.analysis ? homepage.analysis.jsonLd.types.some((t) => /Organization|LocalBusiness|WebSite/.test(t)) : false,
  };
}

/* ---------------------------------------------------------------------------
 * Visibilidad real en respuestas de IA (opcional, requiere API key de Anthropic)
 * Se pregunta a Claude con búsqueda web activada y se mide si la marca/dominio
 * aparece mencionada o citada en la respuesta, frente a los competidores.
 * ------------------------------------------------------------------------- */

function domainMatches(url, domain) {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const d = domain.toLowerCase().replace(/^www\./, '');
    return h === d || h.endsWith('.' + d);
  } catch {
    return false;
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentionIndex(text, terms) {
  const lower = text.toLowerCase();
  let best = -1;
  for (const t of terms) {
    if (!t || t.length < 3) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t.toLowerCase())}(?![\\p{L}\\p{N}])`, 'u');
    const m = lower.match(re);
    if (m && (best === -1 || m.index < best)) best = m.index;
  }
  return best;
}

/** Extrae texto y URLs citadas/consultadas de la respuesta de la API. */
function parseClaudeResponse(content) {
  let text = '';
  const cited = new Set();
  const searched = new Set();
  for (const block of content || []) {
    if (block.type === 'text') {
      text += block.text;
      for (const c of block.citations || []) if (c.url) cited.add(c.url);
    } else if (block.type === 'web_search_tool_result') {
      // Éxito: content es una lista; error: es un objeto
      if (Array.isArray(block.content)) {
        for (const r of block.content) if (r.url) searched.add(r.url);
      }
    }
  }
  // URLs escritas en el texto
  for (const m of text.matchAll(/https?:\/\/[^\s)\]>"']+/g)) cited.add(m[0].replace(/[.,;]+$/, ''));
  return { text, cited: [...cited], searched: [...searched] };
}

function scoreEntity(parsed, entity) {
  const idx = mentionIndex(parsed.text, entity.terms);
  const citedUrls = parsed.cited.filter((u) => domainMatches(u, entity.domain));
  const searchedUrls = parsed.searched.filter((u) => domainMatches(u, entity.domain));
  return {
    domain: entity.domain,
    mentioned: idx >= 0,
    mentionPosition: idx,
    cited: citedUrls.length > 0,
    citedUrls: citedUrls.slice(0, 5),
    inSources: searchedUrls.length > 0,
  };
}

async function runAiVisibility({ apiKey, model = 'claude-opus-5-5', prompts, target, competitors = [], country = '', onProgress = () => {} }) {
  if (!apiKey) throw new Error('Falta la API key de Anthropic');
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, timeout: 180000, maxRetries: 2 });
  const entities = [target, ...competitors];
  const results = [];

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    onProgress({ index: i, total: prompts.length, prompt });
    const messages = [{ role: 'user', content: prompt }];
    let response;
    let error = null;
    try {
      // Bucle para reanudar si el servidor pausa la búsqueda (pause_turn)
      for (let turn = 0; turn < 4; turn++) {
        response = await client.beta.messages.create({
          model,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low' },
          system: `Eres un asistente de búsqueda. Responde como lo haría un buscador con IA: usa la búsqueda web, recomienda opciones concretas (marcas, sitios o empresas) y cita las fuentes.${country ? ` El usuario está en ${country}.` : ''}`,
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
          messages,
        });
        if (response.stop_reason === 'pause_turn') {
          messages.push({ role: 'assistant', content: response.content });
          continue;
        }
        break;
      }
      if (response && response.stop_reason === 'refusal') {
        error = 'El modelo rechazó responder a esta consulta.';
      }
    } catch (err) {
      error = err && err.status ? `Error de la API (${err.status}): ${err.message}` : `Error: ${err.message}`;
    }

    if (error || !response) {
      results.push({ prompt, error: error || 'Sin respuesta', entities: [] });
      continue;
    }
    const parsed = parseClaudeResponse(response.content);
    const scored = entities.map((e) => scoreEntity(parsed, e));
    // Orden de aparición entre las entidades mencionadas
    const order = scored.filter((s) => s.mentioned).sort((a, b) => a.mentionPosition - b.mentionPosition);
    scored.forEach((s) => {
      s.rank = s.mentioned ? order.indexOf(s) + 1 : null;
    });
    results.push({
      prompt,
      answer: parsed.text.slice(0, 6000),
      cited: parsed.cited.slice(0, 30),
      sources: parsed.searched.slice(0, 30),
      entities: scored,
      usage: response.usage ? { input: response.usage.input_tokens, output: response.usage.output_tokens } : null,
    });
  }

  const ok = results.filter((r) => !r.error);
  const summary = entities.map((e, idx) => {
    const rows = ok.map((r) => r.entities[idx]);
    const mentions = rows.filter((r) => r.mentioned).length;
    const cites = rows.filter((r) => r.cited).length;
    const ranks = rows.filter((r) => r.rank).map((r) => r.rank);
    return {
      domain: e.domain,
      isTarget: idx === 0,
      mentions,
      citations: cites,
      inSources: rows.filter((r) => r.inSources).length,
      mentionRate: ok.length ? Math.round((mentions / ok.length) * 100) : 0,
      citationRate: ok.length ? Math.round((cites / ok.length) * 100) : 0,
      avgRank: ranks.length ? Math.round((ranks.reduce((a, b) => a + b, 0) / ranks.length) * 10) / 10 : null,
    };
  });
  const totalMentions = summary.reduce((a, s) => a + s.mentions, 0);
  summary.forEach((s) => {
    s.shareOfVoice = totalMentions ? Math.round((s.mentions / totalMentions) * 100) : 0;
  });

  return { model, prompts: prompts.length, answered: ok.length, results, summary };
}

/** Genera consultas de ejemplo a partir de las keywords principales. */
function suggestAiPrompts(keywords, { lang = 'es', max = 6 } = {}) {
  // Priorizar los temas que el sitio trabaja en títulos, H1 y meta descriptions
  const prominence = (k) => (k.inTitle || 0) * 3 + (k.inH1 || 0) * 2 + (k.inMeta || 0);
  const top = keywords
    .filter((k) => k.n >= 2 && k.intent !== 'navegacional')
    .slice(0, 150)
    .sort((a, b) => prominence(b) - prominence(a) || b.score - a.score)
    .slice(0, max);
  const base = top.length ? top : keywords.slice(0, max);
  return base.map((k, i) => {
    const kw = k.keyword;
    if (lang.startsWith('en')) {
      return i % 2 === 0 ? `What are the best options for ${kw}? Recommend specific companies or websites.` : `Where can I find reliable information about ${kw}?`;
    }
    return i % 2 === 0 ? `¿Cuáles son las mejores opciones de ${kw}? Recomiéndame empresas o webs concretas.` : `¿Dónde puedo encontrar información fiable sobre ${kw}?`;
  });
}

module.exports = {
  AI_BOTS,
  aiCrawlerAccess,
  checkLlmsTxt,
  aiReadiness,
  runAiVisibility,
  parseClaudeResponse,
  scoreEntity,
  suggestAiPrompts,
  domainMatches,
  mentionIndex,
};
