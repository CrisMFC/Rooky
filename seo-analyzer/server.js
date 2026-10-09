'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(ENV_FILE);
}

const { fullAnalysis } = require('./lib/analyzer');
const { runAiVisibility } = require('./lib/ai');
const { googleSuggest, DataForSeo, LOCATIONS } = require('./lib/integrations');
const { normalizeInputUrl } = require('./lib/urlutil');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const REPORTS_DIR = process.env.REPORTS_DIR ? path.resolve(process.env.REPORTS_DIR) : path.join(__dirname, 'reports');
fs.mkdirSync(REPORTS_DIR, { recursive: true });

const AI_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'];

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const CHART_JS = path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.min.js');
app.get('/vendor/chart.umd.min.js', (req, res) => res.sendFile(CHART_JS));

/* ------------------------------ Utilidades ------------------------------ */

function clampInt(v, min, max, def) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

/** Combina las claves enviadas desde la interfaz con las del archivo .env. */
function resolveKeys(fromClient = {}) {
  const pick = (k, env) => (typeof fromClient[k] === 'string' && fromClient[k].trim()) || process.env[env] || '';
  return {
    googleApiKey: pick('googleApiKey', 'GOOGLE_API_KEY'),
    oprApiKey: pick('oprApiKey', 'OPR_API_KEY'),
    dataforseoLogin: pick('dataforseoLogin', 'DATAFORSEO_LOGIN'),
    dataforseoPassword: pick('dataforseoPassword', 'DATAFORSEO_PASSWORD'),
    anthropicApiKey: pick('anthropicApiKey', 'ANTHROPIC_API_KEY'),
  };
}

function reportPath(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) return null;
  return path.join(REPORTS_DIR, `${id}.json`);
}

function saveReport(id, report) {
  fs.writeFileSync(reportPath(id), JSON.stringify(report));
}

function loadReport(id) {
  const p = reportPath(id);
  if (!p || !fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/* --------------------------------- Jobs --------------------------------- */

const jobs = new Map();

function createJob(type, meta) {
  const job = {
    id: crypto.randomUUID(),
    type,
    meta,
    status: 'running',
    progress: 0,
    stage: 'Iniciando',
    logs: [],
    error: null,
    reportId: null,
    cancelled: false,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

function jobLogger(job) {
  return (msg) => {
    job.logs.push({ t: Date.now(), msg });
    if (job.logs.length > 400) job.logs.splice(0, job.logs.length - 400);
  };
}

// Limpieza de jobs antiguos (1 h)
setInterval(() => {
  const limit = Date.now() - 3600 * 1000;
  for (const [id, j] of jobs) if (j.status !== 'running' && j.createdAt < limit) jobs.delete(id);
}, 10 * 60 * 1000).unref();

/* --------------------------------- API ---------------------------------- */

app.get('/api/config', (req, res) => {
  const k = resolveKeys();
  res.json({
    env: {
      googleApiKey: !!k.googleApiKey,
      oprApiKey: !!k.oprApiKey,
      dataforseo: !!(k.dataforseoLogin && k.dataforseoPassword),
      anthropicApiKey: !!k.anthropicApiKey,
    },
    locations: Object.entries(LOCATIONS).map(([key, v]) => ({ key, label: v.label })),
    aiModels: AI_MODELS,
  });
});

app.post('/api/analyze', (req, res) => {
  const b = req.body || {};
  let url;
  try {
    url = normalizeInputUrl(b.url);
  } catch (err) {
    return res.status(400).json({ error: `URL no válida: ${err.message}` });
  }
  const competitors = [];
  for (const c of Array.isArray(b.competitors) ? b.competitors : String(b.competitors || '').split(/[\s,;]+/)) {
    if (!c || !String(c).trim()) continue;
    try {
      competitors.push(normalizeInputUrl(String(c)));
    } catch (err) {
      return res.status(400).json({ error: `Competidor no válido (${c}): ${err.message}` });
    }
  }
  const params = {
    url,
    competitors: competitors.slice(0, 5),
    maxPages: clampInt(b.maxPages, 1, 2000, 50),
    maxDepth: clampInt(b.maxDepth, 1, 20, 5),
    competitorPages: clampInt(b.competitorPages, 1, 500, 20),
    concurrency: clampInt(b.concurrency, 1, 16, 4),
    respectRobots: b.respectRobots !== false,
    checkExternal: b.checkExternal !== false,
    pagespeed: b.pagespeed !== false,
    suggestions: b.suggestions !== false,
    autoCompetitors: b.autoCompetitors !== false,
    location: LOCATIONS[b.location] ? b.location : 'es',
    keys: resolveKeys(b.keys),
  };

  const job = createJob('analysis', { url, competitors: params.competitors });
  const log = jobLogger(job);
  log(`Iniciando análisis de ${url}`);
  res.json({ jobId: job.id });

  fullAnalysis(params, {
    log,
    setProgress: (p, stage) => {
      job.progress = Math.max(job.progress, p);
      job.stage = stage;
    },
    shouldStop: () => job.cancelled,
  })
    .then((report) => {
      const id = crypto.randomUUID();
      report.id = id;
      saveReport(id, report);
      job.reportId = id;
      job.status = 'done';
      job.progress = 100;
      log('Análisis completado.');
    })
    .catch((err) => {
      job.status = job.cancelled ? 'cancelled' : 'error';
      job.error = err.message || String(err);
      log(`Error: ${job.error}`);
      console.error(err);
    });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Trabajo no encontrado' });
  const since = clampInt(req.query.since, 0, 1e9, 0);
  res.json({
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    error: job.error,
    reportId: job.reportId,
    logs: job.logs.slice(since),
    logCount: job.logs.length,
  });
});

app.post('/api/jobs/:id/cancel', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Trabajo no encontrado' });
  job.cancelled = true;
  res.json({ ok: true });
});

app.get('/api/reports', (req, res) => {
  const list = [];
  for (const f of fs.readdirSync(REPORTS_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const r = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), 'utf8'));
      list.push({
        id: r.id,
        domain: r.target.domain,
        url: r.target.url,
        analyzedAt: r.target.analyzedAt,
        health: r.target.audit.health,
        pages: r.target.stats.pagesCrawled,
        competitors: (r.competitors || []).map((c) => c.domain),
      });
    } catch {
      /* informe corrupto: se ignora */
    }
  }
  list.sort((a, b) => String(b.analyzedAt).localeCompare(String(a.analyzedAt)));
  res.json(list);
});

app.get('/api/reports/:id', (req, res) => {
  const r = loadReport(req.params.id);
  if (!r) return res.status(404).json({ error: 'Informe no encontrado' });
  res.json(r);
});

app.delete('/api/reports/:id', (req, res) => {
  const p = reportPath(req.params.id);
  if (!p || !fs.existsSync(p)) return res.status(404).json({ error: 'Informe no encontrado' });
  fs.unlinkSync(p);
  res.json({ ok: true });
});

/** Visibilidad en respuestas de IA (Claude + búsqueda web). */
app.post('/api/ai-visibility', (req, res) => {
  const b = req.body || {};
  const report = loadReport(String(b.reportId || ''));
  if (!report) return res.status(404).json({ error: 'Informe no encontrado' });
  const keys = resolveKeys(b.keys);
  if (!keys.anthropicApiKey) return res.status(400).json({ error: 'Configura tu API key de Anthropic en Ajustes o en el archivo .env' });
  const prompts = (Array.isArray(b.prompts) ? b.prompts : []).map((p) => String(p).trim()).filter(Boolean).slice(0, 20);
  if (!prompts.length) return res.status(400).json({ error: 'Añade al menos una consulta' });
  const model = AI_MODELS.includes(b.model) ? b.model : AI_MODELS[0];

  // Términos para detectar menciones: dominio, nombre del dominio (si no es demasiado corto) y nombre de marca
  const brandTerms = (d, brand) => [...new Set([d, d.split('.')[0].length >= 4 ? d.split('.')[0] : '', brand].filter((x) => x && x.length >= 3))];
  const target = { domain: report.target.domain, terms: brandTerms(report.target.domain, report.target.brand) };
  const competitors = (report.competitors || [])
    .filter((c) => !c.error)
    .map((c) => ({ domain: c.domain, terms: brandTerms(c.domain, c.brand) }));

  const job = createJob('ai-visibility', { reportId: report.id });
  const log = jobLogger(job);
  res.json({ jobId: job.id });

  runAiVisibility({
    apiKey: keys.anthropicApiKey,
    model,
    prompts,
    target,
    competitors,
    country: report.location ? report.location.label : '',
    onProgress: ({ index, total, prompt }) => {
      job.progress = Math.round((index / total) * 100);
      job.stage = `Consulta ${index + 1}/${total}`;
      log(`Preguntando a ${model}: "${prompt}"`);
    },
  })
    .then((result) => {
      const fresh = loadReport(report.id) || report;
      fresh.aiVisibility = { ...result, ranAt: new Date().toISOString() };
      saveReport(report.id, fresh);
      job.reportId = report.id;
      job.status = 'done';
      job.progress = 100;
      log(`Completado: ${result.answered}/${result.prompts} consultas respondidas.`);
    })
    .catch((err) => {
      job.status = 'error';
      job.error = err.message || String(err);
      log(`Error: ${job.error}`);
    });
});

/** Ideas de keywords a partir de una semilla (autocompletado + DataForSEO opcional). */
app.post('/api/keyword-ideas', async (req, res) => {
  const b = req.body || {};
  const seed = String(b.seed || '').trim().toLowerCase();
  if (!seed || seed.length > 80) return res.status(400).json({ error: 'Escribe una keyword semilla (máx. 80 caracteres)' });
  const loc = LOCATIONS[b.location] || LOCATIONS.es;
  const es = loc.language_code === 'es';
  const modifiers = es
    ? ['', 'qué es', 'cómo', 'mejor', 'precio', 'para', 'vs', 'cerca de mí', 'gratis', 'opiniones']
    : ['', 'what is', 'how to', 'best', 'price', 'for', 'vs', 'near me', 'free', 'reviews'];
  const queries = modifiers.map((m) => (m ? (/^(qué es|cómo|mejor|what is|how to|best)$/.test(m) ? `${m} ${seed}` : `${seed} ${m}`) : seed));
  const results = [];
  const set = new Set();
  let failures = 0;
  for (const q of queries) {
    const r = await googleSuggest(q, { hl: loc.hl, gl: loc.gl });
    if (!r.ok) failures++;
    for (const s of r.suggestions) {
      const k = s.toLowerCase().trim();
      if (!set.has(k)) {
        set.add(k);
        results.push({ keyword: k, source: q });
      }
    }
  }
  const out = { seed, location: loc.label, ideas: results, failures, metrics: null, metricsError: null };
  const keys = resolveKeys(b.keys);
  if (keys.dataforseoLogin && keys.dataforseoPassword && results.length) {
    try {
      const dfs = new DataForSeo(keys.dataforseoLogin, keys.dataforseoPassword);
      const r = await dfs.keywordOverview([seed, ...results.map((x) => x.keyword)], { location_code: loc.location_code, language_code: loc.language_code });
      out.metrics = r.data;
    } catch (err) {
      out.metricsError = err.message;
    }
  }
  if (!results.length && failures === queries.length) {
    return res.status(502).json({ error: 'No se pudo contactar con el servicio de sugerencias de Google. Comprueba tu conexión.' });
  }
  res.json(out);
});

// Errores no controlados de la API
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Error interno' });
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`\n  Rooky SEO Analyzer listo en http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}\n`);
  });
}

module.exports = { app };
