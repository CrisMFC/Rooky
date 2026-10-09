/* Rooky SEO Analyzer — interfaz */
(function () {
  'use strict';

  /* ============================== Utilidades ============================== */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const NF = new Intl.NumberFormat('es-ES');
  const NF1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
  const NF2 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function safeHref(u) {
    return /^https?:\/\//i.test(String(u || '')) ? esc(u) : '#';
  }
  function link(u, text) {
    if (!u) return '';
    return `<a href="${safeHref(u)}" target="_blank" rel="noopener noreferrer">${esc(text || u)}</a>`;
  }
  function num(v) {
    return v === null || v === undefined || Number.isNaN(v) ? '—' : NF.format(v);
  }
  function num1(v) {
    return v === null || v === undefined || Number.isNaN(v) ? '—' : NF1.format(v);
  }
  function ms(v) {
    if (v === null || v === undefined) return '—';
    return v >= 1000 ? `${NF2.format(v / 1000)} s` : `${NF.format(Math.round(v))} ms`;
  }
  function bytes(v) {
    if (!v && v !== 0) return '—';
    if (v < 1024) return `${v} B`;
    if (v < 1048576) return `${NF1.format(v / 1024)} KB`;
    return `${NF1.format(v / 1048576)} MB`;
  }
  function shortUrl(u, base) {
    try {
      const x = new URL(u);
      if (base && x.origin === new URL(base).origin) return (x.pathname + x.search) || '/';
      return x.host + x.pathname + x.search;
    } catch {
      return u;
    }
  }
  function date(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return iso;
    }
  }
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function storageGet(key, def) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  }
  function storageSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* almacenamiento no disponible */
    }
  }
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'content-type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* sin cuerpo JSON */
    }
    if (!res.ok) throw new Error((data && data.error) || `Error HTTP ${res.status}`);
    return data;
  }
  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }
  function toCsv(rows, columns) {
    const q = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return '﻿' + [columns.map((c) => q(c.label)).join(';'), ...rows.map((r) => columns.map((c) => q(c.csv ? c.csv(r) : r[c.key])).join(';'))].join('\n');
  }
  const SEV_LABEL = { error: 'Errores', warning: 'Avisos', notice: 'Notas' };
  const SEV_ONE = { error: 'Error', warning: 'Aviso', notice: 'Nota' };

  // Color de estado para marcas (anillos); scoreText para texto legible
  function scoreColor(v) {
    if (v === null || v === undefined) return cssVar('--axis');
    if (v >= 80) return cssVar('--good');
    if (v >= 50) return cssVar('--warning');
    return cssVar('--critical');
  }
  function scoreText(v) {
    if (v === null || v === undefined) return cssVar('--text-muted');
    if (v >= 80) return cssVar('--good-text');
    if (v >= 50) return cssVar('--warning-text');
    return cssVar('--critical-text');
  }
  function scoreLabel(v) {
    if (v === null || v === undefined) return '';
    if (v >= 80) return 'Bueno';
    if (v >= 50) return 'Mejorable';
    return 'Deficiente';
  }

  function ring(value, label) {
    const r = 52;
    const c = 2 * Math.PI * r;
    const v = Math.max(0, Math.min(100, value || 0));
    return `<div class="ring" role="img" aria-label="${esc(label)}: ${v} de 100">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="${cssVar('--surface-2')}" stroke-width="12"/>
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="${scoreColor(v)}" stroke-width="12" stroke-linecap="round"
          stroke-dasharray="${(c * v) / 100} ${c}"/>
      </svg>
      <div class="ring-value">${v}<small>${esc(scoreLabel(v))}</small></div>
    </div>`;
  }

  function tile(label, value, sub, opts = {}) {
    const na = value === null || value === undefined || value === '—';
    return `<div class="tile ${na ? 'na' : ''}">
      <div class="label">${opts.dot ? `<span class="dot ${opts.dot}"></span>` : ''}${esc(label)}</div>
      <div class="value" ${opts.color ? `style="color:${opts.color}"` : ''}>${na ? esc(opts.naText || 'No disponible') : esc(value)}</div>
      ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
    </div>`;
  }

  /* ============================== Estado ============================== */

  const state = {
    config: null,
    report: null,
    tab: 'overview',
    charts: [],
    job: null,
    settings: storageGet('rookySettings', {}),
  };

  const TABS = [
    { id: 'overview', label: 'Resumen' },
    { id: 'audit', label: 'Auditoría del sitio' },
    { id: 'pages', label: 'Páginas' },
    { id: 'keywords', label: 'Keywords' },
    { id: 'backlinks', label: 'Backlinks y enlaces' },
    { id: 'ai', label: 'Búsqueda IA' },
    { id: 'performance', label: 'Rendimiento' },
    { id: 'technical', label: 'Técnico' },
    { id: 'competitors', label: 'Competencia' },
  ];

  function showView(id) {
    for (const v of ['startView', 'progressView', 'reportView']) $('#' + v).hidden = v !== id;
    window.scrollTo(0, 0);
  }

  /* ============================== Gráficos ============================== */

  function destroyCharts() {
    state.charts.forEach((c) => c.destroy());
    state.charts = [];
  }

  function seriesColors() {
    return ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6'].map(cssVar);
  }

  function makeChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return null;
    const text = cssVar('--text-secondary');
    const grid = cssVar('--grid');
    Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
    Chart.defaults.color = text;
    const base = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false, labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3 } },
        tooltip: { backgroundColor: cssVar('--text-primary'), titleColor: cssVar('--surface-1'), bodyColor: cssVar('--surface-1'), padding: 8, cornerRadius: 6 },
      },
      scales: {
        x: { grid: { display: false }, border: { color: cssVar('--axis') }, ticks: { color: text } },
        y: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: text, precision: 0 } },
      },
    };
    const options = deepMerge(base, config.options || {});
    const chart = new Chart(canvas, { ...config, options });
    state.charts.push(chart);
    return chart;
  }

  function deepMerge(a, b) {
    const out = Array.isArray(a) ? [...a] : { ...a };
    for (const [k, v] of Object.entries(b)) {
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? deepMerge(a[k], v) : v;
    }
    return out;
  }

  function barChart(id, labels, data, opts = {}) {
    return makeChart(id, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: opts.label || '',
          data,
          backgroundColor: opts.colors || cssVar('--series-1'),
          borderRadius: 4,
          borderSkipped: 'start',
          maxBarThickness: 42,
        }],
      },
      options: opts.horizontal
        ? { indexAxis: 'y', scales: { x: { grid: { display: true, color: cssVar('--grid') }, beginAtZero: true, max: opts.max }, y: { grid: { display: false } } } }
        : { scales: { y: { max: opts.max } } },
    });
  }

  /* ============================== Tablas ============================== */

  /**
   * Monta una tabla con búsqueda, orden y paginación incremental.
   * columns: [{ key, label, num, render(row), sort(row), csv(row) }]
   */
  function mountTable(container, { columns, rows, pageSize = 50, search = null, filename = null, onRowClick = null, emptyText = 'Sin datos' }) {
    if (!container) return;
    let sortKey = null;
    let sortDir = -1;
    let query = '';
    let limit = pageSize;

    const tools = document.createElement('div');
    tools.className = 'table-tools';
    if (search) tools.innerHTML += `<input type="search" placeholder="Buscar…" aria-label="Buscar en la tabla">`;
    if (filename) tools.innerHTML += `<button class="btn ghost small" type="button" data-csv>Exportar CSV</button>`;
    const info = document.createElement('span');
    info.className = 'muted small';
    tools.appendChild(info);
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    container.innerHTML = '';
    if (search || filename) container.appendChild(tools);
    container.appendChild(wrap);

    const filtered = () => {
      let r = rows;
      if (query && search) {
        const q = query.toLowerCase();
        r = r.filter((row) => search(row).toLowerCase().includes(q));
      }
      if (sortKey !== null) {
        const col = columns[sortKey];
        const get = col.sort || ((row) => row[col.key]);
        r = [...r].sort((a, b) => {
          const va = get(a);
          const vb = get(b);
          if (va === vb) return 0;
          if (va === null || va === undefined || va === '') return 1;
          if (vb === null || vb === undefined || vb === '') return -1;
          return (va > vb ? 1 : -1) * sortDir;
        });
      }
      return r;
    };

    const render = () => {
      const r = filtered();
      info.textContent = `${NF.format(r.length)} fila(s)`;
      if (!r.length) {
        wrap.innerHTML = `<div class="empty">${esc(emptyText)}</div>`;
        return;
      }
      const head = columns.map((c, i) => `<th class="${c.num ? 'num' : ''} ${c.nosort ? '' : 'sortable'}" data-i="${i}">${esc(c.label)}${sortKey === i ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
      const body = r.slice(0, limit).map((row, idx) => `<tr data-idx="${idx}" class="${onRowClick ? 'clickable' : ''}">${columns.map((c) => `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.render ? c.render(row) : esc(row[c.key])}</td>`).join('')}</tr>`).join('');
      const more = r.length > limit ? `<tr class="more-row"><td colspan="${columns.length}"><button class="btn ghost small" type="button" data-more>Mostrar más (${NF.format(r.length - limit)} restantes)</button></td></tr>` : '';
      wrap.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}${more}</tbody></table>`;
      $$('th.sortable', wrap).forEach((th) => th.addEventListener('click', () => {
        const i = Number(th.dataset.i);
        if (sortKey === i) sortDir = -sortDir;
        else {
          sortKey = i;
          sortDir = columns[i].num ? -1 : 1;
        }
        render();
      }));
      const moreBtn = $('[data-more]', wrap);
      if (moreBtn) moreBtn.addEventListener('click', () => {
        limit += pageSize * 2;
        render();
      });
      if (onRowClick) {
        const current = r.slice(0, limit);
        $$('tbody tr[data-idx]', wrap).forEach((tr) => tr.addEventListener('click', (e) => {
          if (e.target.closest('a')) return;
          onRowClick(current[Number(tr.dataset.idx)]);
        }));
      }
    };

    const input = $('input[type="search"]', tools);
    if (input) input.addEventListener('input', () => {
      query = input.value;
      limit = pageSize;
      render();
    });
    const csvBtn = $('[data-csv]', tools);
    if (csvBtn) csvBtn.addEventListener('click', () => download(filename, toCsv(filtered(), columns), 'text/csv;charset=utf-8'));
    render();
  }

  /* ============================== Inicio ============================== */

  async function loadConfig() {
    try {
      state.config = await api('/api/config');
    } catch {
      state.config = { env: {}, locations: [{ key: 'es', label: 'España' }], aiModels: ['claude-opus-5-5'] };
    }
    const sel = $('#locationSelect');
    sel.innerHTML = state.config.locations.map((l) => `<option value="${esc(l.key)}">${esc(l.label)}</option>`).join('');
    sel.value = state.settings.location || 'es';
    $('#aiModel').innerHTML = state.config.aiModels.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
    renderBadges();
  }

  function keysFromSettings() {
    const s = state.settings;
    return {
      googleApiKey: s.googleApiKey || '',
      oprApiKey: s.oprApiKey || '',
      dataforseoLogin: s.dataforseoLogin || '',
      dataforseoPassword: s.dataforseoPassword || '',
      anthropicApiKey: s.anthropicApiKey || '',
    };
  }

  function integrationStatus() {
    const env = (state.config && state.config.env) || {};
    const s = state.settings;
    return {
      pagespeed: !!(s.googleApiKey || env.googleApiKey),
      opr: !!(s.oprApiKey || env.oprApiKey),
      dataforseo: !!((s.dataforseoLogin && s.dataforseoPassword) || env.dataforseo),
      anthropic: !!(s.anthropicApiKey || env.anthropicApiKey),
    };
  }

  function renderBadges() {
    const st = integrationStatus();
    const items = [
      ['PageSpeed key', st.pagespeed],
      ['OpenPageRank', st.opr],
      ['DataForSEO', st.dataforseo],
      ['Claude (IA)', st.anthropic],
    ];
    $('#integrationBadges').innerHTML = items.map(([l, on]) => `<span class="badge ${on ? 'on' : 'off'}" title="${on ? 'Configurado' : 'Sin configurar (opcional)'}">${esc(l)}</span>`).join('');
  }

  function setupForm() {
    const s = state.settings;
    if (s.lastUrl) $('#urlInput').value = s.lastUrl;
    if (s.lastCompetitors) $('#competitorsInput').value = s.lastCompetitors;
    for (const id of ['maxPages', 'competitorPages', 'maxDepth', 'concurrency']) if (s[id]) $('#' + id).value = s[id];
    for (const id of ['respectRobots', 'checkExternal', 'pagespeed', 'suggestions', 'autoCompetitors']) if (typeof s[id] === 'boolean') $('#' + id).checked = s[id];

    $('#analyzeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#formError');
      err.hidden = true;
      const body = {
        url: $('#urlInput').value.trim(),
        competitors: $('#competitorsInput').value.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean),
        location: $('#locationSelect').value,
        maxPages: Number($('#maxPages').value),
        competitorPages: Number($('#competitorPages').value),
        maxDepth: Number($('#maxDepth').value),
        concurrency: Number($('#concurrency').value),
        respectRobots: $('#respectRobots').checked,
        checkExternal: $('#checkExternal').checked,
        pagespeed: $('#pagespeed').checked,
        suggestions: $('#suggestions').checked,
        autoCompetitors: $('#autoCompetitors').checked,
        keys: keysFromSettings(),
      };
      if (body.competitors.length > 5) {
        err.textContent = 'Máximo 5 competidores.';
        err.hidden = false;
        return;
      }
      Object.assign(state.settings, {
        lastUrl: body.url,
        lastCompetitors: $('#competitorsInput').value,
        location: body.location,
        maxPages: body.maxPages,
        competitorPages: body.competitorPages,
        maxDepth: body.maxDepth,
        concurrency: body.concurrency,
        respectRobots: body.respectRobots,
        checkExternal: body.checkExternal,
        pagespeed: body.pagespeed,
        suggestions: body.suggestions,
        autoCompetitors: body.autoCompetitors,
      });
      storageSet('rookySettings', state.settings);
      $('#analyzeBtn').disabled = true;
      try {
        const { jobId } = await api('/api/analyze', { method: 'POST', body });
        startProgress(jobId, `Analizando ${body.url}`, async (job) => {
          await openReport(job.reportId);
        });
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      } finally {
        $('#analyzeBtn').disabled = false;
      }
    });
  }

  /* ============================== Progreso ============================== */

  function startProgress(jobId, title, onDone, onErrorView = 'startView') {
    showView('progressView');
    $('#progressTitle').textContent = title;
    $('#progressStage').textContent = 'Iniciando';
    $('#progressLog').textContent = '';
    $('#progressFill').style.width = '0%';
    $('#cancelBtn').hidden = false;
    let since = 0;
    state.job = jobId;
    const tick = async () => {
      if (state.job !== jobId) return;
      let job;
      try {
        job = await api(`/api/jobs/${jobId}?since=${since}`);
      } catch (e) {
        $('#progressStage').textContent = `Error consultando el progreso: ${e.message}`;
        setTimeout(tick, 2000);
        return;
      }
      since = job.logCount;
      if (job.logs.length) {
        const logEl = $('#progressLog');
        logEl.textContent += job.logs.map((l) => `${new Date(l.t).toLocaleTimeString('es-ES')}  ${l.msg}`).join('\n') + '\n';
        logEl.scrollTop = logEl.scrollHeight;
      }
      $('#progressStage').textContent = job.stage || '';
      $('#progressFill').style.width = `${job.progress || 0}%`;
      $('.progress-bar').setAttribute('aria-valuenow', String(job.progress || 0));
      if (job.status === 'running') {
        setTimeout(tick, 1000);
        return;
      }
      state.job = null;
      $('#cancelBtn').hidden = true;
      if (job.status === 'done') {
        await onDone(job);
      } else {
        $('#progressStage').innerHTML = `<span class="sev-error">${esc(job.status === 'cancelled' ? 'Cancelado' : 'Error')}: ${esc(job.error || '')}</span> · <a href="#" id="backFromError">Volver</a>`;
        $('#backFromError').addEventListener('click', (e) => {
          e.preventDefault();
          if (onErrorView === 'reportView' && state.report) {
            showView('reportView');
            renderTab();
          } else showView('startView');
        });
      }
    };
    $('#cancelBtn').onclick = async () => {
      try {
        await api(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
        $('#progressStage').textContent = 'Cancelando…';
      } catch {
        /* ignorar */
      }
    };
    tick();
  }

  /* ============================== Informe ============================== */

  async function openReport(id, tab) {
    try {
      state.report = await api(`/api/reports/${encodeURIComponent(id)}`);
    } catch (e) {
      alert(`No se pudo abrir el informe: ${e.message}`);
      showView('startView');
      return;
    }
    state.tab = tab || 'overview';
    history.replaceState(null, '', `#report=${id}`);
    const r = state.report;
    $('#sidebarDomain').textContent = r.target.domain;
    $('#sidebarDate').textContent = `${date(r.target.analyzedAt)} · ${r.location ? r.location.label : ''}`;
    showView('reportView');
    renderTabs();
    renderTab();
  }

  function renderTabs() {
    const r = state.report;
    const counts = {
      audit: r.target.audit.issues.filter((i) => i.severity === 'error').length,
      pages: r.target.pages.length,
      competitors: (r.competitors || []).filter((c) => !c.error).length,
    };
    $('#tabs').innerHTML = TABS.map((t) => `<button class="tab ${t.id === state.tab ? 'active' : ''}" data-tab="${t.id}" type="button">
      <span>${esc(t.label)}</span>${counts[t.id] !== undefined ? `<span class="count">${num(counts[t.id])}</span>` : ''}</button>`).join('');
    $$('#tabs .tab').forEach((b) => b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      renderTabs();
      renderTab();
      window.scrollTo(0, 0);
    }));
  }

  function renderTab() {
    destroyCharts();
    const fn = {
      overview: renderOverview,
      audit: renderAudit,
      pages: renderPages,
      keywords: renderKeywords,
      backlinks: renderBacklinks,
      ai: renderAi,
      performance: renderPerformance,
      technical: renderTechnical,
      competitors: renderCompetitors,
    }[state.tab];
    const c = $('#tabContent');
    try {
      fn(c, state.report);
    } catch (e) {
      console.error(e);
      c.innerHTML = `<div class="callout warn">No se pudo mostrar esta sección: ${esc(e.message)}</div>`;
    }
  }

  function goTab(tab) {
    state.tab = tab;
    renderTabs();
    renderTab();
    window.scrollTo(0, 0);
  }

  function needsKey(what, provider, note = 'Los datos de backlinks, volúmenes y posiciones solo existen en índices de terceros: esta herramienta no los inventa.') {
    return `<div class="callout"><b>${esc(what)}</b> requiere ${esc(provider)}. <a href="#" data-open-settings>Configurar en Ajustes</a>. ${esc(note)}</div>`;
  }

  function bindSettingsLinks(root) {
    $$('[data-open-settings]', root).forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      openSettings();
    }));
    $$('[data-goto]', root).forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      goTab(a.dataset.goto);
    }));
  }

  /* ------------------------------ Resumen ------------------------------ */

  function renderOverview(c, r) {
    const t = r.target;
    const a = t.audit;
    const psi = t.pagespeed && t.pagespeed.mobile && t.pagespeed.mobile.ok ? t.pagespeed.mobile.scores.performance : null;
    const dfs = t.dataforseo || {};
    const org = dfs.overview && dfs.overview.organic;
    const bl = dfs.backlinks && !dfs.backlinks.error ? dfs.backlinks : null;
    const topIssues = a.issues.filter((i) => i.severity !== 'notice').slice(0, 8);

    c.innerHTML = `
      <div class="section-head">
        <div><h2>Resumen de ${esc(t.domain)}</h2><p class="muted">${link(t.url)} · ${num(t.stats.pagesCrawled)} páginas rastreadas en ${num1(t.stats.durationMs / 1000)} s</p></div>
      </div>
      <div class="grid-3">
        <div class="card">
          <h3>Salud del sitio</h3>
          <div class="score-ring">${ring(a.health, 'Salud del sitio')}
            <div>
              <div class="sev-error"><span class="dot error"></span> <b>${num(a.counts.error)}</b> errores</div>
              <div class="sev-warning"><span class="dot warning"></span> <b>${num(a.counts.warning)}</b> avisos</div>
              <div class="sev-notice"><span class="dot notice"></span> <b>${num(a.counts.notice)}</b> notas</div>
              <div class="muted small" style="margin-top:6px">${num(a.healthyPages)} de ${num(t.stats.pagesCrawled)} páginas sin errores</div>
            </div>
          </div>
        </div>
        <div class="card">
          <h3>Preparación para búsqueda IA</h3>
          <div class="score-ring">${ring(t.ai.score, 'Preparación IA')}
            <div class="small">
              <div>${t.ai.checks.filter((x) => x.ok).length} de ${t.ai.checks.length} comprobaciones superadas</div>
              <div class="muted">${t.ai.blockedSearch.length ? `Bloquea: ${esc(t.ai.blockedSearch.join(', '))}` : 'Ningún buscador IA bloqueado'}</div>
              <a href="#" data-goto="ai">Ver detalle →</a>
            </div>
          </div>
        </div>
        <div class="card">
          <h3>Rendimiento móvil</h3>
          ${psi !== null ? `<div class="score-ring">${ring(psi, 'Rendimiento móvil')}<div class="small">${t.pagespeed.mobile.lab.map((m) => `<div>${esc(m.label)}: <b>${esc(m.value || '—')}</b></div>`).join('')}</div></div>`
            : `<p class="muted">${t.pagespeed ? esc(t.pagespeed.mobile.error || 'No disponible') : 'PageSpeed desactivado en este análisis.'}</p><p class="small muted">TTFB medio del servidor: <b>${ms(t.stats.avgTtfb)}</b></p>`}
        </div>
      </div>
      <div class="tiles">
        ${tile('Páginas rastreadas', num(t.stats.pagesCrawled), `${num(a.indexablePages)} indexables`)}
        ${tile('Palabras por página', num(t.stats.avgWords), 'media de páginas HTML')}
        ${tile('TTFB medio', ms(t.stats.avgTtfb), `mediana ${ms(t.stats.medianTtfb)}`)}
        ${tile('Temas / keywords detectados', num(t.keywords.totalUnique), 'en el contenido')}
        ${tile('Autoridad (OpenPageRank)', t.authority && t.authority.pageRank !== null ? num1(t.authority.pageRank) + ' / 10' : null, t.authority && t.authority.rank ? `Ranking global #${num(t.authority.rank)}` : '', { naText: 'Requiere API key' })}
        ${tile('Keywords orgánicas', org ? num(org.keywords) : null, org ? `Tráfico est. ${num(org.traffic)}/mes` : '', { naText: 'Requiere DataForSEO' })}
        ${tile('Dominios de referencia', bl ? num(bl.referringDomains) : null, bl ? `${num(bl.backlinks)} backlinks` : '', { naText: 'Requiere DataForSEO' })}
        ${tile('Enlaces externos rotos', t.links.external ? num(t.links.external.broken.length) : null, t.links.external ? `${num(t.links.external.checked)} verificados` : '', { naText: 'No verificado' })}
      </div>
      <div class="card">
        <div class="section-head"><h3>Principales problemas</h3><a href="#" data-goto="audit">Ver auditoría completa →</a></div>
        ${topIssues.length ? `<div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Problema</th><th>Categoría</th><th class="num">Afectados</th></tr></thead><tbody>
          ${topIssues.map((i) => `<tr><td><span class="dot ${i.severity}"></span> ${SEV_ONE[i.severity]}</td><td>${esc(i.title)}</td><td class="muted">${esc(i.category)}</td><td class="num">${num(i.count)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">No se encontraron errores ni avisos. ¡Buen trabajo!</div>'}
      </div>
      <div class="two-col">
        <div class="card"><h3>Códigos de estado HTTP</h3><div class="chart-box"><canvas id="chStatus" aria-label="Distribución de códigos de estado"></canvas></div></div>
        <div class="card"><h3>Profundidad de rastreo (clics desde portada)</h3><div class="chart-box"><canvas id="chDepth" aria-label="Distribución por profundidad"></canvas></div></div>
        <div class="card"><h3>Palabras por página</h3><div class="chart-box"><canvas id="chWords" aria-label="Distribución de palabras"></canvas></div></div>
        <div class="card"><h3>Portada</h3>
          ${t.homepage ? `<dl class="kv">
            <dt>Título</dt><dd>${esc(t.homepage.title) || '<span class="sev-error">Falta</span>'} <span class="muted small">(${t.homepage.title.length} car.)</span></dd>
            <dt>Meta description</dt><dd>${esc(t.homepage.metaDescription) || '<span class="sev-warning">Falta</span>'}</dd>
            <dt>H1</dt><dd>${t.homepage.h1.length ? t.homepage.h1.map(esc).join('<br>') : '<span class="sev-warning">Falta</span>'}</dd>
            <dt>Idioma</dt><dd>${esc(t.homepage.lang || '—')}</dd>
            <dt>Schema</dt><dd>${esc(t.homepage.schemaTypes.join(', ') || 'Ninguno')}</dd>
            <dt>Open Graph</dt><dd>${t.homepage.og['og:title'] ? 'Sí' : 'No'}</dd>
          </dl>` : '<p class="muted">No se pudo analizar la portada.</p>'}
        </div>
      </div>
      ${(r.comparison || []).length > 1 ? `<div class="card"><div class="section-head"><h3>Tú frente a la competencia</h3><a href="#" data-goto="competitors">Ver comparativa →</a></div>${comparisonMini(r)}</div>` : ''}
    `;
    bindSettingsLinks(c);
    const sd = t.stats.statusDist;
    const order = ['2xx', '3xx', '4xx', '5xx', 'Error'].filter((k) => sd[k]);
    const statusColors = { '2xx': cssVar('--good'), '3xx': cssVar('--warning'), '4xx': cssVar('--critical'), '5xx': cssVar('--critical'), Error: cssVar('--critical') };
    barChart('chStatus', order, order.map((k) => sd[k]), { colors: order.map((k) => statusColors[k]), label: 'Páginas' });
    const dk = Object.keys(t.stats.depthDist).sort((x, y) => (x === 'sitemap' ? 1 : y === 'sitemap' ? -1 : Number(x) - Number(y)));
    barChart('chDepth', dk.map((k) => (k === 'sitemap' ? 'Solo sitemap' : k)), dk.map((k) => t.stats.depthDist[k]), { label: 'Páginas' });
    barChart('chWords', t.stats.wordCountDist.map((d) => d.label), t.stats.wordCountDist.map((d) => d.count), { label: 'Páginas' });
  }

  function comparisonMini(r) {
    const rows = r.comparison;
    return `<div class="table-wrap"><table><thead><tr><th>Dominio</th><th class="num">Salud</th><th class="num">IA</th><th class="num">Rend. móvil</th><th class="num">Palabras/pág.</th><th class="num">Autoridad</th><th class="num">Ref. domains</th></tr></thead><tbody>
      ${rows.map((x) => `<tr><td>${x.isTarget ? '<b>' : ''}${esc(x.domain)}${x.isTarget ? '</b> <span class="pill">tú</span>' : ''}</td>
        <td class="num">${num(x.health)}</td><td class="num">${num(x.aiScore)}</td><td class="num">${num(x.performance)}</td>
        <td class="num">${num(x.avgWords)}</td><td class="num">${num1(x.authority)}</td><td class="num">${num(x.referringDomains)}</td></tr>`).join('')}
    </tbody></table></div>`;
  }

  /* ------------------------------ Auditoría ------------------------------ */

  function renderAudit(c, r) {
    const a = r.target.audit;
    const cats = [...new Set(a.issues.map((i) => i.category))].sort();
    c.innerHTML = `
      <div class="section-head"><div><h2>Auditoría del sitio</h2><p class="muted">${num(a.issues.length)} tipos de incidencias en ${num(r.target.stats.pagesCrawled)} páginas.</p></div>
        <button class="btn ghost small" type="button" id="auditCsv">Exportar CSV</button></div>
      <div class="tiles">
        <div class="tile"><div class="label">Salud del sitio</div><div class="value" style="color:${scoreText(a.health)}">${a.health}<span class="muted" style="font-size:14px"> / 100</span></div><div class="sub">${esc(scoreLabel(a.health))}</div></div>
        ${tile('Errores', num(a.counts.error), `${a.issueTypes.error} tipos`, { dot: 'error' })}
        ${tile('Avisos', num(a.counts.warning), `${a.issueTypes.warning} tipos`, { dot: 'warning' })}
        ${tile('Notas', num(a.counts.notice), `${a.issueTypes.notice} tipos`, { dot: 'notice' })}
      </div>
      <div class="card">
        <div class="table-tools">
          <div class="filter-bar" id="sevFilter">
            <button class="chip active" data-sev="all" type="button">Todas</button>
            <button class="chip" data-sev="error" type="button"><span class="dot error"></span>Errores</button>
            <button class="chip" data-sev="warning" type="button"><span class="dot warning"></span>Avisos</button>
            <button class="chip" data-sev="notice" type="button"><span class="dot notice"></span>Notas</button>
          </div>
          <select id="catFilter" aria-label="Categoría"><option value="">Todas las categorías</option>${cats.map((x) => `<option>${esc(x)}</option>`).join('')}</select>
          <input type="search" id="issueSearch" placeholder="Buscar incidencia o URL…">
        </div>
        <div id="issueList"></div>
      </div>
      <details class="card"><summary><b>¿Cómo se calcula la salud?</b></summary>
        <p class="muted" style="margin-top:8px">Cada página parte de 100 puntos y pierde 12 por cada tipo de error y 4 por cada tipo de aviso que tenga (las notas no penalizan). La salud es la media de todas las páginas, menos 6 puntos por cada error de sitio (p. ej. sin HTTPS) y 2 por cada aviso de sitio (p. ej. sin sitemap).</p>
      </details>`;
    let sev = 'all';
    const draw = () => {
      const cat = $('#catFilter').value;
      const q = $('#issueSearch').value.toLowerCase();
      const list = a.issues.filter((i) => (sev === 'all' || i.severity === sev) && (!cat || i.category === cat) &&
        (!q || i.title.toLowerCase().includes(q) || i.items.some((it) => it.url.toLowerCase().includes(q))));
      $('#issueList').innerHTML = list.length ? list.map((i) => `
        <details class="issue">
          <summary><span class="dot ${i.severity}" title="${SEV_ONE[i.severity]}"></span><span>${esc(i.title)}</span><span class="cat">${esc(i.category)}</span><span class="cnt">${num(i.count)}</span></summary>
          <div class="issue-body">
            <div class="fix"><b>Cómo solucionarlo:</b> ${esc(i.fix)}${i.detail ? `<br><span class="muted">${esc(i.detail)}</span>` : ''}</div>
            ${i.items.length ? `<ul>${i.items.slice(0, 200).map((it) => `<li>${link(it.url, shortUrl(it.url, r.target.url))}${it.detail ? ` <span class="det">— ${esc(it.detail)}</span>` : ''}</li>`).join('')}</ul>
            ${i.items.length > 200 ? `<p class="muted small">… y ${num(i.items.length - 200)} más (exporta el CSV para verlos todos).</p>` : ''}` : '<p class="muted small">Afecta a todo el sitio.</p>'}
          </div>
        </details>`).join('') : '<div class="empty">No hay incidencias con estos filtros.</div>';
    };
    $$('#sevFilter .chip').forEach((b) => b.addEventListener('click', () => {
      sev = b.dataset.sev;
      $$('#sevFilter .chip').forEach((x) => x.classList.toggle('active', x === b));
      draw();
    }));
    $('#catFilter').addEventListener('change', draw);
    $('#issueSearch').addEventListener('input', draw);
    $('#auditCsv').addEventListener('click', () => {
      const rows = a.issues.flatMap((i) => (i.items.length ? i.items : [{ url: r.target.url, detail: i.detail || '' }]).map((it) => ({ sev: SEV_ONE[i.severity], cat: i.category, title: i.title, url: it.url, detail: it.detail, fix: i.fix })));
      download(`auditoria-${r.target.domain}.csv`, toCsv(rows, [
        { key: 'sev', label: 'Gravedad' }, { key: 'cat', label: 'Categoría' }, { key: 'title', label: 'Incidencia' },
        { key: 'url', label: 'URL' }, { key: 'detail', label: 'Detalle' }, { key: 'fix', label: 'Solución' },
      ]), 'text/csv;charset=utf-8');
    });
    draw();
  }

  /* ------------------------------ Páginas ------------------------------ */

  function renderPages(c, r) {
    const t = r.target;
    c.innerHTML = `<div class="section-head"><div><h2>Páginas rastreadas</h2><p class="muted">Haz clic en una fila para ver el detalle de la página.</p></div></div>
      <div class="card" id="pagesTable"></div>`;
    mountTable($('#pagesTable'), {
      rows: t.pages,
      search: (p) => `${p.url} ${p.title || ''}`,
      filename: `paginas-${t.domain}.csv`,
      pageSize: 50,
      onRowClick: (p) => openPageDetail(p),
      columns: [
        { key: 'url', label: 'URL', cls: 'url', render: (p) => `${esc(shortUrl(p.url, t.url))}${p.redirects ? ` <span class="pill warn">→ ${p.redirects}</span>` : ''}`, csv: (p) => p.url },
        { key: 'status', label: 'Estado', num: true, render: (p) => `<span class="status-${String(p.status)[0]}">${p.status || 'Error'}</span>` },
        { key: 'title', label: 'Título', render: (p) => esc(p.title || (p.status >= 200 && p.status < 300 && p.contentType.includes('html') ? '—' : '')) },
        { key: 'wordCount', label: 'Palabras', num: true, render: (p) => num(p.wordCount) },
        { key: 'depth', label: 'Prof.', num: true, render: (p) => (p.depth === null ? 'sitemap' : num(p.depth)) },
        { key: 'inlinks', label: 'Enl. entrantes', num: true, render: (p) => num(p.inlinks) },
        { key: 'ttfbMs', label: 'TTFB', num: true, render: (p) => ms(p.ttfbMs) },
        { key: 'problems', label: 'Errores', num: true, sort: (p) => p.problems.error, render: (p) => (p.problems.error ? `<span class="sev-error">${p.problems.error}</span>` : '0'), csv: (p) => p.problems.error },
        { key: 'warnings', label: 'Avisos', num: true, sort: (p) => p.problems.warning, render: (p) => (p.problems.warning ? `<span class="sev-warning">${p.problems.warning}</span>` : '0'), csv: (p) => p.problems.warning },
      ],
    });
  }

  function openPageDetail(p) {
    const r = state.report;
    const issues = r.target.audit.issues.filter((i) => i.items.some((it) => it.url === p.url));
    const body = $('#pageDialogBody');
    body.innerHTML = `
      <div class="section-head"><h2 style="word-break:break-all">${esc(shortUrl(p.url, r.target.url))}</h2><button class="btn ghost" type="button" id="closePage">Cerrar</button></div>
      <p>${link(p.url)}</p>
      <div class="tiles">
        ${tile('Estado HTTP', p.status || 'Error', p.error || (p.redirects ? `${p.redirects} redirección(es)` : ''))}
        ${tile('Palabras', num(p.wordCount))}
        ${tile('TTFB', ms(p.ttfbMs), `Total ${ms(p.timeMs)}`)}
        ${tile('Enlaces entrantes', num(p.inlinks), 'internos')}
        ${tile('Legibilidad', p.readability ? `${p.readability.score}` : null, p.readability ? `${p.readability.label} (${p.readability.formula})` : '', { naText: 'Texto insuficiente' })}
      </div>
      <div class="two-col" style="margin-top:14px">
        <div>
          <h3>Etiquetas</h3>
          <dl class="kv">
            <dt>Título</dt><dd>${esc(p.title || '—')} <span class="muted small">(${num(p.titleLength)} car.)</span></dd>
            <dt>Meta description</dt><dd>${esc(p.metaDescription || '—')} <span class="muted small">(${num(p.metaDescriptionLength)} car.)</span></dd>
            <dt>H1</dt><dd>${esc(p.h1 || '—')}${p.h1Count > 1 ? ` <span class="pill warn">${p.h1Count} H1</span>` : ''}</dd>
            <dt>Canonical</dt><dd>${p.canonical ? link(p.canonical) : '—'}</dd>
            <dt>Indexable</dt><dd>${p.noindex ? '<span class="sev-warning">No (noindex)</span>' : 'Sí'}</dd>
            <dt>Idioma</dt><dd>${esc(p.lang || '—')}</dd>
            <dt>Schema</dt><dd>${esc((p.schemaTypes || []).join(', ') || 'Ninguno')}</dd>
            <dt>Imágenes</dt><dd>${num(p.imageCount)} (${num(p.imagesMissingAlt)} sin alt)</dd>
            <dt>Enlaces</dt><dd>${num(p.internalLinks)} internos · ${num(p.externalLinks)} externos</dd>
            <dt>Tamaño</dt><dd>${bytes(p.bytes)} · ratio texto ${num1(p.textRatio)}%</dd>
            ${p.redirectChain && p.redirectChain.length ? `<dt>Redirecciones</dt><dd>${p.redirectChain.map((x) => `${x.status}: ${esc(shortUrl(x.url))} → ${esc(shortUrl(x.location))}`).join('<br>')}</dd>` : ''}
          </dl>
        </div>
        <div>
          <h3>Estructura de encabezados</h3>
          ${p.headingOutline && p.headingOutline.length ? `<div class="answer" style="max-height:300px">${p.headingOutline.map((h) => `${'&nbsp;&nbsp;'.repeat(h.level - 1)}<b>H${h.level}</b> ${esc(h.text)}`).join('<br>')}</div>` : '<p class="muted">Sin encabezados.</p>'}
          ${p.inlinkSamples && p.inlinkSamples.length ? `<h3 style="margin-top:12px">Enlazada desde</h3><ul>${p.inlinkSamples.map((s) => `<li>${link(s.from, shortUrl(s.from, r.target.url))} <span class="muted">"${esc(s.anchor || 'sin texto')}"</span></li>`).join('')}</ul>` : ''}
        </div>
      </div>
      <h3 style="margin-top:14px">Incidencias de esta página (${issues.length})</h3>
      ${issues.length ? `<ul>${issues.map((i) => {
        const it = i.items.find((x) => x.url === p.url);
        return `<li><span class="dot ${i.severity}"></span> ${esc(i.title)}${it && it.detail ? ` <span class="muted">— ${esc(it.detail)}</span>` : ''}</li>`;
      }).join('')}</ul>` : '<p class="muted">Sin incidencias.</p>'}`;
    $('#closePage').addEventListener('click', () => $('#pageDialog').close());
    $('#pageDialog').showModal();
  }

  /* ------------------------------ Keywords ------------------------------ */

  const INTENT_LABEL = {
    informacional: 'Informacional', comercial: 'Comercial', transaccional: 'Transaccional', navegacional: 'Navegacional', indeterminada: 'Sin señal',
    informational: 'Informacional', commercial: 'Comercial', transactional: 'Transaccional', navigational: 'Navegacional',
  };

  function renderKeywords(c, r) {
    const t = r.target;
    const kw = t.keywords;
    const dfs = t.dataforseo || {};
    const org = dfs.overview && dfs.overview.organic;
    const ranked = dfs.ranked && !dfs.ranked.error ? dfs.ranked : null;
    const hasMetrics = kw.top.some((k) => k.metrics);
    c.innerHTML = `
      <div class="section-head"><div><h2>Keywords</h2><p class="muted">Temas que trata tu web (extraídos del contenido) y, con DataForSEO, las keywords por las que realmente posicionas en Google.</p></div></div>
      <div class="tiles">
        ${tile('Keywords orgánicas', org ? num(org.keywords) : null, org ? 'en Google (DataForSEO)' : '', { naText: 'Requiere DataForSEO' })}
        ${tile('Tráfico orgánico estimado', org ? num(org.traffic) : null, org ? 'visitas/mes' : '', { naText: 'Requiere DataForSEO' })}
        ${tile('Top 3', org ? num(org.pos1 + org.pos2_3) : null, org ? `${num(org.pos4_10)} en posiciones 4-10` : '', { naText: '—' })}
        ${tile('Temas en el contenido', num(kw.totalUnique), `${num(t.stats.htmlPages)} páginas analizadas`)}
      </div>
      ${ranked ? `<div class="two-col">
        <div class="card"><h3>Distribución de posiciones</h3><div class="chart-box"><canvas id="chPos"></canvas></div></div>
        <div class="card"><h3>Intención de búsqueda (keywords posicionadas)</h3><div class="chart-box"><canvas id="chIntentRanked"></canvas></div></div>
      </div>
      <div class="card"><h3>Keywords posicionadas en Google</h3><p class="muted small">${num(ranked.total)} en total; se muestran las ${num(ranked.items.length)} con más volumen. Ubicación: ${esc(r.location.label)}.</p><div id="rankedTable"></div></div>`
        : (dfs.ranked && dfs.ranked.error ? `<div class="callout warn">DataForSEO devolvió un error: ${esc(dfs.ranked.error)}</div>` : needsKey('Ver las keywords por las que posicionas, su volumen y tu posición', 'DataForSEO'))}
      <div class="card">
        <h3>Temas y keywords del contenido</h3>
        <p class="muted small">Puntuación = ocurrencias ponderadas por ubicación (título ×6, H1 ×4, URL ×3, H2-H3 y meta description ×2, cuerpo ×1) × (1 + ln nº páginas). Intención estimada por patrones.${hasMetrics ? ' Volumen y dificultad: DataForSEO.' : ''}</p>
        <div class="table-tools">
          <div class="filter-bar" id="ngFilter">
            <button class="chip active" data-n="0" type="button">Todas</button>
            <button class="chip" data-n="1" type="button">1 palabra</button>
            <button class="chip" data-n="2" type="button">2 palabras</button>
            <button class="chip" data-n="3" type="button">3 palabras</button>
          </div>
          <select id="intentFilter" aria-label="Intención"><option value="">Todas las intenciones</option>
            <option value="informacional">Informacional</option><option value="comercial">Comercial</option><option value="transaccional">Transaccional</option><option value="navegacional">Navegacional</option><option value="indeterminada">Sin señal</option></select>
        </div>
        <div id="kwTable"></div>
      </div>
      <div class="two-col">
        <div class="card"><h3>Intención de los temas del contenido</h3><div class="chart-box"><canvas id="chIntent"></canvas></div></div>
        <div class="card">
          <h3>Generador de ideas de keywords</h3>
          <p class="muted small">Sugerencias reales del autocompletado de Google${integrationStatus().dataforseo ? ' con volumen y dificultad de DataForSEO' : ''}.</p>
          <form id="ideaForm" class="table-tools"><input type="search" id="ideaSeed" placeholder="p. ej. ${esc((kw.top.find((k) => k.n === 2) || { keyword: 'seo local' }).keyword)}" required><button class="btn primary small" type="submit">Buscar ideas</button></form>
          <div id="ideaResult"></div>
        </div>
      </div>
      ${r.keywordIdeas && r.keywordIdeas.length ? `<div class="card"><h3>Ideas a partir de tus temas principales</h3><div class="grid-3">${r.keywordIdeas.map((i) => `<div><h4>${esc(i.seed)}</h4>${i.ok ? (i.suggestions.length ? `<ul>${i.suggestions.slice(0, 10).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : '<p class="muted small">Sin sugerencias.</p>') : `<p class="muted small">No disponible: ${esc(i.error)}</p>`}</div>`).join('')}</div></div>` : ''}
      <div class="two-col">
        <div class="card"><h3>Posible canibalización</h3><p class="muted small">Keywords que aparecen en el título de varias páginas.</p><div id="cannTable"></div></div>
        <div class="card"><h3>Densidad excesiva</h3><p class="muted small">Términos repetidos en exceso (posible keyword stuffing).</p><div id="stuffTable"></div></div>
      </div>`;
    bindSettingsLinks(c);

    if (ranked) {
      barChart('chPos', ['1', '2-3', '4-10', '11-20', '21-50', '51-100'], [org ? org.pos1 : 0, org ? org.pos2_3 : 0, org ? org.pos4_10 : 0, org ? org.pos11_20 : 0, org ? org.pos21_50 : 0, org ? org.pos51_100 : 0], { label: 'Keywords' });
      const ic = {};
      ranked.items.forEach((k) => {
        const l = INTENT_LABEL[k.intent] || 'Sin señal';
        ic[l] = (ic[l] || 0) + 1;
      });
      barChart('chIntentRanked', Object.keys(ic), Object.values(ic), { label: 'Keywords', horizontal: true });
      mountTable($('#rankedTable'), {
        rows: ranked.items,
        search: (k) => `${k.keyword} ${k.url || ''}`,
        filename: `keywords-posicionadas-${t.domain}.csv`,
        columns: [
          { key: 'keyword', label: 'Keyword' },
          { key: 'position', label: 'Posición', num: true, render: (k) => num(k.position) },
          { key: 'volume', label: 'Volumen', num: true, render: (k) => num(k.volume) },
          { key: 'difficulty', label: 'KD %', num: true, render: (k) => num(k.difficulty) },
          { key: 'cpc', label: 'CPC', num: true, render: (k) => (k.cpc !== null && k.cpc !== undefined ? NF2.format(k.cpc) : '—') },
          { key: 'traffic', label: 'Tráfico', num: true, render: (k) => num1(k.traffic) },
          { key: 'intent', label: 'Intención', render: (k) => esc(INTENT_LABEL[k.intent] || '—') },
          { key: 'url', label: 'URL', cls: 'url', render: (k) => link(k.url, shortUrl(k.url, t.url)) },
        ],
      });
    }

    let ng = 0;
    const drawKw = () => {
      const intent = $('#intentFilter').value;
      const rows = kw.top.filter((k) => (!ng || k.n === ng) && (!intent || k.intent === intent));
      const cols = [
        { key: 'keyword', label: 'Keyword / tema' },
        { key: 'score', label: 'Puntuación', num: true, render: (k) => num1(k.score) },
        { key: 'count', label: 'Ocurrencias', num: true, render: (k) => num(k.count) },
        { key: 'pages', label: 'Páginas', num: true, render: (k) => num(k.pages) },
        { key: 'inTitle', label: 'En títulos', num: true, render: (k) => num(k.inTitle) },
        { key: 'inH1', label: 'En H1', num: true, render: (k) => num(k.inH1) },
        { key: 'intent', label: 'Intención', render: (k) => esc(INTENT_LABEL[k.intent] || k.intent) },
      ];
      if (hasMetrics) {
        cols.push(
          { key: 'volume', label: 'Volumen', num: true, sort: (k) => (k.metrics ? k.metrics.volume : null), render: (k) => num(k.metrics ? k.metrics.volume : null), csv: (k) => (k.metrics ? k.metrics.volume : '') },
          { key: 'kd', label: 'KD %', num: true, sort: (k) => (k.metrics ? k.metrics.difficulty : null), render: (k) => num(k.metrics ? k.metrics.difficulty : null), csv: (k) => (k.metrics ? k.metrics.difficulty : '') },
        );
      }
      cols.push({ key: 'topPage', label: 'Página principal', cls: 'url', render: (k) => link(k.topPage, shortUrl(k.topPage, t.url)) });
      mountTable($('#kwTable'), { rows, columns: cols, search: (k) => k.keyword, filename: `keywords-contenido-${t.domain}.csv`, pageSize: 50 });
    };
    $$('#ngFilter .chip').forEach((b) => b.addEventListener('click', () => {
      ng = Number(b.dataset.n);
      $$('#ngFilter .chip').forEach((x) => x.classList.toggle('active', x === b));
      drawKw();
    }));
    $('#intentFilter').addEventListener('change', drawKw);
    drawKw();

    const ic2 = {};
    kw.top.slice(0, 200).forEach((k) => {
      const l = INTENT_LABEL[k.intent] || 'Sin señal';
      ic2[l] = (ic2[l] || 0) + 1;
    });
    barChart('chIntent', Object.keys(ic2), Object.values(ic2), { label: 'Keywords', horizontal: true });

    mountTable($('#cannTable'), {
      rows: kw.cannibalization,
      emptyText: 'No se detectó canibalización.',
      columns: [
        { key: 'keyword', label: 'Keyword' },
        { key: 'count', label: 'Páginas', num: true },
        { key: 'pages', label: 'URLs', cls: 'url', nosort: true, render: (x) => x.pages.slice(0, 4).map((u) => link(u, shortUrl(u, t.url))).join('<br>') },
      ],
    });
    mountTable($('#stuffTable'), {
      rows: kw.stuffing,
      emptyText: 'Sin densidades excesivas.',
      columns: [
        { key: 'keyword', label: 'Término' },
        { key: 'density', label: 'Densidad %', num: true, render: (x) => num1(x.density) },
        { key: 'count', label: 'Veces', num: true },
        { key: 'url', label: 'URL', cls: 'url', render: (x) => link(x.url, shortUrl(x.url, t.url)) },
      ],
    });

    $('#ideaForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const seed = $('#ideaSeed').value.trim();
      const out = $('#ideaResult');
      out.innerHTML = '<p class="muted">Buscando…</p>';
      try {
        const res = await api('/api/keyword-ideas', { method: 'POST', body: { seed, location: r.location.key, keys: keysFromSettings() } });
        const m = res.metrics || {};
        const rows = res.ideas.map((i) => ({ ...i, ...(m[i.keyword] || {}) }));
        out.innerHTML = `${res.metricsError ? `<p class="sev-warning small">DataForSEO: ${esc(res.metricsError)}</p>` : ''}<div id="ideaTable"></div>`;
        const cols = [{ key: 'keyword', label: 'Idea' }];
        if (res.metrics) {
          cols.push(
            { key: 'volume', label: 'Volumen', num: true, render: (x) => num(x.volume) },
            { key: 'difficulty', label: 'KD %', num: true, render: (x) => num(x.difficulty) },
            { key: 'cpc', label: 'CPC', num: true, render: (x) => (x.cpc != null ? NF2.format(x.cpc) : '—') },
          );
        }
        cols.push({ key: 'intent', label: 'Intención', render: (x) => esc(INTENT_LABEL[x.intent] || '—'), csv: (x) => x.intent || '' });
        mountTable($('#ideaTable'), { rows, columns: cols, filename: `ideas-${seed}.csv`, pageSize: 30, emptyText: 'Sin sugerencias para esa semilla.' });
      } catch (ex) {
        out.innerHTML = `<p class="sev-error">${esc(ex.message)}</p>`;
      }
    });
  }

  /* ------------------------------ Backlinks ------------------------------ */

  function renderBacklinks(c, r) {
    const t = r.target;
    const dfs = t.dataforseo || {};
    const bl = dfs.backlinks && !dfs.backlinks.error ? dfs.backlinks : null;
    const L = t.links;
    c.innerHTML = `
      <div class="section-head"><div><h2>Backlinks y enlaces</h2><p class="muted">Perfil de enlaces entrantes (fuentes externas) y estructura de enlaces del propio sitio.</p></div></div>
      <div class="tiles">
        ${tile('Autoridad (OpenPageRank)', t.authority && t.authority.pageRank !== null ? `${num1(t.authority.pageRank)} / 10` : null, t.authority && t.authority.rank ? `#${num(t.authority.rank)} mundial` : '', { naText: 'Requiere API key' })}
        ${tile('Backlinks', bl ? num(bl.backlinks) : null, '', { naText: 'Requiere DataForSEO' })}
        ${tile('Dominios de referencia', bl ? num(bl.referringDomains) : null, bl ? `${num(bl.nofollowDomains)} solo nofollow` : '', { naText: 'Requiere DataForSEO' })}
        ${tile('Domain Rank (DataForSEO)', bl ? num(bl.rank) : null, bl && bl.spamScore !== null ? `Spam score ${num(bl.spamScore)}` : '', { naText: '—' })}
        ${tile('IPs de referencia', bl ? num(bl.referringIps) : null, bl ? `${num(bl.brokenBacklinks)} backlinks rotos` : '', { naText: '—' })}
      </div>
      ${bl ? `
        <div class="two-col">
          <div class="card"><h3>Dominios de referencia principales</h3><div id="refTable"></div></div>
          <div class="card"><h3>Textos ancla</h3><div id="anchorTable"></div></div>
        </div>
        <div class="card"><h3>Backlinks (uno por dominio, por autoridad)</h3><div id="blTable"></div></div>`
        : (dfs.backlinks && dfs.backlinks.error ? `<div class="callout warn">DataForSEO devolvió un error: ${esc(dfs.backlinks.error)}</div>` : needsKey('El perfil de backlinks (enlaces desde otras webs)', 'DataForSEO'))}
      <h3 style="margin:8px 0 0">Enlazado interno</h3>
      <div class="tiles">
        ${tile('Enlaces internos', num(L.internal.totalLinks), `${num(L.internal.avgPerPage)} por página de media`)}
        ${tile('Páginas huérfanas', num((t.audit.issues.find((i) => i.id === 'orphan') || { count: 0 }).count), 'solo en sitemap')}
        ${tile('Bloqueadas por robots.txt', num(t.stats.blockedByRobots), 'no rastreadas')}
      </div>
      <div class="two-col">
        <div class="card"><h3>Páginas con más enlaces internos</h3><div id="topInternal"></div></div>
        <div class="card"><h3>Textos ancla internos</h3><div id="intAnchors"></div></div>
      </div>
      <h3 style="margin:8px 0 0">Enlaces salientes</h3>
      <div class="tiles">
        ${tile('Enlaces externos', num(L.outbound.totalLinks), `${num(L.outbound.nofollowLinks)} nofollow/sponsored/ugc`)}
        ${tile('Dominios enlazados', num(L.outbound.uniqueDomains))}
        ${tile('Enlaces externos rotos', L.external ? num(L.external.broken.length) : null, L.external ? `de ${num(L.external.checked)} verificados (${num(L.external.totalExternal)} únicos)` : '', { naText: 'No verificado' })}
      </div>
      <div class="two-col">
        <div class="card"><h3>Dominios a los que enlazas</h3><div id="outTable"></div></div>
        <div class="card"><h3>Enlaces externos rotos</h3><div id="brokenTable"></div>
          ${L.external && L.external.unverified.length ? `<p class="muted small" style="margin-top:8px">${num(L.external.unverified.length)} enlaces no se pudieron verificar (el sitio bloquea bots o requiere inicio de sesión).</p>` : ''}</div>
      </div>`;
    bindSettingsLinks(c);
    if (bl) {
      const ref = dfs.refDomains && !dfs.refDomains.error ? dfs.refDomains.items : [];
      mountTable($('#refTable'), {
        rows: ref, filename: `dominios-referencia-${t.domain}.csv`, emptyText: dfs.refDomains && dfs.refDomains.error ? dfs.refDomains.error : 'Sin datos',
        columns: [
          { key: 'domain', label: 'Dominio', render: (x) => link(`https://${x.domain}`, x.domain), csv: (x) => x.domain },
          { key: 'rank', label: 'Rank', num: true, render: (x) => num(x.rank) },
          { key: 'backlinks', label: 'Backlinks', num: true, render: (x) => num(x.backlinks) },
          { key: 'firstSeen', label: 'Visto', render: (x) => esc((x.firstSeen || '').slice(0, 10)) },
        ],
      });
      const anchors = dfs.anchors && !dfs.anchors.error ? dfs.anchors.items : [];
      mountTable($('#anchorTable'), {
        rows: anchors, emptyText: dfs.anchors && dfs.anchors.error ? dfs.anchors.error : 'Sin datos',
        columns: [
          { key: 'anchor', label: 'Ancla' },
          { key: 'referringDomains', label: 'Dominios', num: true, render: (x) => num(x.referringDomains) },
          { key: 'backlinks', label: 'Backlinks', num: true, render: (x) => num(x.backlinks) },
        ],
      });
      const list = dfs.backlinkList && !dfs.backlinkList.error ? dfs.backlinkList.items : [];
      mountTable($('#blTable'), {
        rows: list, filename: `backlinks-${t.domain}.csv`, search: (x) => `${x.from} ${x.anchor}`, emptyText: dfs.backlinkList && dfs.backlinkList.error ? dfs.backlinkList.error : 'Sin datos',
        columns: [
          { key: 'from', label: 'Página de origen', cls: 'url', render: (x) => `${link(x.from, shortUrl(x.from))}${x.title ? `<br><span class="muted small">${esc(x.title)}</span>` : ''}` },
          { key: 'anchor', label: 'Ancla' },
          { key: 'to', label: 'Destino', cls: 'url', render: (x) => link(x.to, shortUrl(x.to, t.url)) },
          { key: 'dofollow', label: 'Tipo', render: (x) => (x.dofollow === null ? '—' : x.dofollow ? '<span class="pill ok">dofollow</span>' : '<span class="pill">nofollow</span>') },
          { key: 'domainRank', label: 'Rank dominio', num: true, render: (x) => num(x.domainRank) },
        ],
      });
    }
    mountTable($('#topInternal'), {
      rows: L.internal.topPages,
      columns: [
        { key: 'url', label: 'Página', cls: 'url', render: (x) => `${link(x.url, shortUrl(x.url, t.url))}<br><span class="muted small">${esc(x.title)}</span>` },
        { key: 'inlinks', label: 'Enlaces entrantes', num: true },
      ],
    });
    mountTable($('#intAnchors'), { rows: L.internal.anchors, columns: [{ key: 'anchor', label: 'Texto ancla' }, { key: 'count', label: 'Veces', num: true }] });
    mountTable($('#outTable'), {
      rows: L.outbound.domains, filename: `enlaces-salientes-${t.domain}.csv`, search: (x) => x.domain, emptyText: 'No hay enlaces externos.',
      columns: [
        { key: 'domain', label: 'Dominio' },
        { key: 'links', label: 'Enlaces', num: true },
        { key: 'nofollow', label: 'Nofollow', num: true },
        { key: 'pages', label: 'Desde páginas', num: true },
      ],
    });
    mountTable($('#brokenTable'), {
      rows: L.external ? L.external.broken : [], emptyText: L.external ? 'No se encontraron enlaces externos rotos.' : 'La verificación de enlaces externos estaba desactivada.',
      columns: [
        { key: 'url', label: 'Enlace roto', cls: 'url', render: (x) => esc(x.url) },
        { key: 'status', label: 'Estado', render: (x) => esc(x.status || x.error) },
        { key: 'sources', label: 'Desde', cls: 'url', nosort: true, render: (x) => x.sources.slice(0, 3).map((s) => link(s, shortUrl(s, t.url))).join('<br>') },
      ],
    });
  }

  /* ------------------------------ Búsqueda IA ------------------------------ */

  function renderAi(c, r) {
    const t = r.target;
    const A = t.ai;
    const vis = r.aiVisibility;
    const st = integrationStatus();
    const prompts = (vis && vis.results ? vis.results.map((x) => x.prompt) : r.aiPromptSuggestions || []).join('\n');
    c.innerHTML = `
      <div class="section-head"><div><h2>Búsqueda IA (GEO / AEO)</h2><p class="muted">Preparación para aparecer y ser citado en ChatGPT, Perplexity, Claude, Gemini, Copilot y AI Overviews de Google.</p></div></div>
      <div class="two-col">
        <div class="card"><h3>Puntuación de preparación</h3><div class="score-ring">${ring(A.score, 'Preparación IA')}<div class="small muted">Media ponderada de las comprobaciones. Los factores más importantes son el acceso de los bots de búsqueda IA, que el contenido esté en el HTML y los datos estructurados.</div></div></div>
        <div class="card"><h3>Indicadores del contenido</h3>
          <dl class="kv">
            <dt>Páginas con schema</dt><dd>${A.stats.withSchemaPct}%</dd>
            <dt>Tipos de schema</dt><dd>${esc(A.stats.schemaTypes.join(', ') || 'Ninguno')}</dd>
            <dt>Encabezados-pregunta</dt><dd>${A.stats.withQuestionsPct}% de páginas</dd>
            <dt>Listas o tablas</dt><dd>${A.stats.withListsPct}% de páginas</dd>
            <dt>Autor declarado</dt><dd>${A.stats.withAuthorPct}% de páginas</dd>
            <dt>Fecha visible</dt><dd>${A.stats.withDatesPct}% de páginas</dd>
            <dt>Palabras medias</dt><dd>${num(A.stats.avgWords)}</dd>
          </dl>
        </div>
      </div>
      <div class="card"><h3>Comprobaciones</h3>
        <ul class="checklist">${A.checks.map((ch) => `<li><span class="icon ${ch.ok ? 'ok' : 'ko'}" aria-label="${ch.ok ? 'Correcto' : 'A mejorar'}">${ch.ok ? '✓' : '✕'}</span><div><b>${esc(ch.label)}</b><div class="muted small">${esc(ch.detail)}</div></div></li>`).join('')}</ul>
      </div>
      <div class="card"><h3>Acceso de rastreadores de IA (robots.txt)</h3>
        <p class="muted small">Bloquear bots de <b>entrenamiento</b> no te quita visibilidad en buscadores IA; bloquear los de <b>búsqueda</b> o <b>usuario</b> sí.</p>
        <div id="botTable"></div>
      </div>
      <div class="card"><h3>llms.txt</h3>
        ${['llms.txt', 'llms-full.txt'].map((f) => {
          const x = A.llms && A.llms[f];
          return x ? `<p>${x.exists ? '<span class="pill ok">Encontrado</span>' : '<span class="pill">No existe</span>'} ${link(x.url, f)} ${x.exists ? `· ${bytes(x.bytes)} · ${x.links} enlaces` : ''}</p>${x.exists && x.preview ? `<pre class="robots-pre">${esc(x.preview)}</pre>` : ''}` : '';
        }).join('')}
      </div>
      <div class="card">
        <h3>Visibilidad real en respuestas de IA</h3>
        <p class="muted small">Pregunta a Claude (con búsqueda web) consultas típicas de tus clientes y mide si tu marca y tus competidores aparecen mencionados o citados como fuente. Cada consulta consume tokens de tu cuenta de Anthropic.</p>
        ${st.anthropic ? '' : needsKey('La medición de visibilidad en IA', 'una API key de Anthropic', '')}
        <label class="field"><span>Consultas (una por línea, máx. 20)</span><textarea id="aiPrompts" rows="6">${esc(prompts)}</textarea></label>
        <div class="table-tools"><button class="btn primary" type="button" id="runAi" ${st.anthropic ? '' : 'disabled'}>Medir visibilidad</button><span class="muted small">Modelo: ${esc(state.settings.aiModel || (state.config && state.config.aiModels[0]) || '')}</span></div>
        <div id="aiResults"></div>
      </div>`;
    bindSettingsLinks(c);
    mountTable($('#botTable'), {
      rows: A.crawlers,
      columns: [
        { key: 'name', label: 'Bot' },
        { key: 'vendor', label: 'Empresa' },
        { key: 'purpose', label: 'Uso' },
        { key: 'allowed', label: 'Acceso', render: (b) => (b.allowed ? '<span class="pill ok">Permitido</span>' : '<span class="pill bad">Bloqueado</span>') },
        { key: 'rule', label: 'Regla aplicada', render: (b) => (b.rule ? `<code>${esc(b.rule)}</code> <span class="muted small">(grupo ${esc(b.matchedGroup)})</span>` : '<span class="muted">Sin reglas</span>') },
      ],
    });
    $('#runAi').addEventListener('click', async () => {
      const list = $('#aiPrompts').value.split('\n').map((x) => x.trim()).filter(Boolean);
      if (!list.length) return;
      try {
        const { jobId } = await api('/api/ai-visibility', { method: 'POST', body: { reportId: r.id, prompts: list, model: state.settings.aiModel, keys: keysFromSettings() } });
        startProgress(jobId, 'Midiendo visibilidad en IA', async () => openReport(r.id, 'ai'), 'reportView');
      } catch (e) {
        $('#aiResults').innerHTML = `<p class="sev-error">${esc(e.message)}</p>`;
      }
    });
    if (vis) renderAiResults($('#aiResults'), vis);
  }

  function renderAiResults(el, vis) {
    const colors = seriesColors();
    el.innerHTML = `
      <p class="muted small">Última medición: ${esc(date(vis.ranAt))} · ${esc(vis.model)} · ${vis.answered}/${vis.prompts} consultas respondidas.</p>
      <div class="two-col">
        <div><div class="table-wrap"><table><thead><tr><th>Dominio</th><th class="num">Menciones</th><th class="num">Citado</th><th class="num">Posición media</th><th class="num">Cuota de voz</th></tr></thead><tbody>
          ${vis.summary.map((s) => `<tr><td>${s.isTarget ? '<b>' : ''}${esc(s.domain)}${s.isTarget ? '</b>' : ''}</td><td class="num">${s.mentions} (${s.mentionRate}%)</td><td class="num">${s.citations} (${s.citationRate}%)</td><td class="num">${num1(s.avgRank)}</td><td class="num">${s.shareOfVoice}%</td></tr>`).join('')}
        </tbody></table></div></div>
        <div><div class="chart-box"><canvas id="chSov" aria-label="Cuota de voz en respuestas IA"></canvas></div></div>
      </div>
      <h4 style="margin-top:14px">Respuestas</h4>
      ${vis.results.map((x) => `<details class="issue"><summary><span>${x.error ? '<span class="dot error"></span>' : x.entities[0] && (x.entities[0].mentioned || x.entities[0].cited) ? '<span class="dot good"></span>' : '<span class="dot warning"></span>'}</span><span>${esc(x.prompt)}</span><span class="cat">${x.error ? 'error' : x.entities.filter((e) => e.mentioned).map((e) => esc(e.domain)).join(', ') || 'ninguna marca'}</span><span></span></summary>
        <div class="issue-body">${x.error ? `<p class="sev-error">${esc(x.error)}</p>` : `
          <div class="answer">${esc(x.answer)}</div>
          <p class="small" style="margin-top:8px">${x.entities.map((e) => `<span class="pill ${e.mentioned || e.cited ? 'ok' : ''}">${esc(e.domain)}: ${e.mentioned ? `mencionado (#${e.rank})` : 'no mencionado'}${e.cited ? ', citado' : ''}</span>`).join(' ')}</p>
          ${x.cited.length ? `<p class="small muted">Fuentes citadas: ${x.cited.slice(0, 10).map((u) => link(u, shortUrl(u))).join(' · ')}</p>` : ''}`}
        </div></details>`).join('')}`;
    // Color por entidad (orden fijo: tú = slot 1)
    makeChart('chSov', {
      type: 'bar',
      data: {
        labels: vis.summary.map((s) => s.domain),
        datasets: [{ label: 'Cuota de voz %', data: vis.summary.map((s) => s.shareOfVoice), backgroundColor: vis.summary.map((_, i) => colors[i % colors.length]), borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28 }],
      },
      options: { indexAxis: 'y', scales: { x: { beginAtZero: true, max: 100, grid: { display: true, color: cssVar('--grid') } }, y: { grid: { display: false } } } },
    });
  }

  /* ------------------------------ Rendimiento ------------------------------ */

  function psiPanel(p, title) {
    if (!p) return `<div class="card"><h3>${esc(title)}</h3><p class="muted">No medido.</p></div>`;
    if (!p.ok) return `<div class="card"><h3>${esc(title)}</h3><p class="sev-warning">${esc(p.error)}</p></div>`;
    const catLabel = { FAST: 'Bueno', AVERAGE: 'Mejorable', SLOW: 'Deficiente' };
    const catPill = { FAST: 'ok', AVERAGE: 'warn', SLOW: 'bad' };
    const fieldRows = Object.entries(p.field || {});
    return `<div class="card"><h3>${esc(title)}</h3>
      <div class="tiles">
        ${['performance', 'seo', 'accessibility', 'bestPractices'].map((k) => `<div class="tile"><div class="label">${{ performance: 'Rendimiento', seo: 'SEO', accessibility: 'Accesibilidad', bestPractices: 'Buenas prácticas' }[k]}</div><div class="value" style="color:${scoreText(p.scores[k])}">${num(p.scores[k])}</div></div>`).join('')}
      </div>
      <h4 style="margin-top:12px">Datos de usuarios reales (Chrome UX Report)</h4>
      ${fieldRows.length ? `<div class="table-wrap"><table><thead><tr><th>Métrica</th><th class="num">Percentil 75</th><th>Valoración</th></tr></thead><tbody>
        ${fieldRows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${k === 'CLS' ? NF2.format(v.percentile) : ms(v.percentile)}</td><td><span class="pill ${catPill[v.category] || ''}">${esc(catLabel[v.category] || v.category || '—')}</span></td></tr>`).join('')}
      </tbody></table></div><p class="small muted">Core Web Vitals global: ${esc(catLabel[p.fieldOverall] || p.fieldOverall || '—')}</p>` : '<p class="muted small">Sin datos de campo: la web no tiene tráfico suficiente en Chrome UX Report.</p>'}
      <h4 style="margin-top:12px">Laboratorio (Lighthouse)</h4>
      <div class="table-wrap"><table><thead><tr><th>Métrica</th><th class="num">Valor</th><th class="num">Puntuación</th></tr></thead><tbody>
        ${p.lab.map((m) => `<tr><td>${esc(m.label)}</td><td class="num">${esc(m.value || '—')}</td><td class="num" style="color:${scoreText(m.score)}">${num(m.score)}</td></tr>`).join('')}
      </tbody></table></div>
      ${p.opportunities.length ? `<h4 style="margin-top:12px">Oportunidades de mejora</h4><ul>${p.opportunities.map((o) => `<li>${esc(o.title)}${o.savings ? ` <span class="muted">— ${esc(o.savings)}</span>` : ''}</li>`).join('')}</ul>` : ''}
    </div>`;
  }

  function renderPerformance(c, r) {
    const t = r.target;
    const slow = t.pages.filter((p) => p.ttfbMs !== null && p.ttfbMs !== undefined).sort((a, b) => b.ttfbMs - a.ttfbMs).slice(0, 15);
    c.innerHTML = `
      <div class="section-head"><div><h2>Rendimiento</h2><p class="muted">Core Web Vitals de la portada (Google PageSpeed Insights) y tiempos de respuesta del servidor medidos durante el rastreo.</p></div></div>
      ${t.pagespeed ? `<div class="two-col">${psiPanel(t.pagespeed.mobile, 'Móvil')}${psiPanel(t.pagespeed.desktop, 'Escritorio')}</div>` : '<div class="callout">PageSpeed estaba desactivado en este análisis.</div>'}
      <div class="tiles">
        ${tile('TTFB medio', ms(t.stats.avgTtfb))}
        ${tile('TTFB mediana', ms(t.stats.medianTtfb))}
        ${tile('Tamaño HTML medio', bytes(t.stats.avgPageBytes))}
      </div>
      <div class="two-col">
        <div class="card"><h3>Distribución del TTFB</h3><div class="chart-box"><canvas id="chTtfb"></canvas></div></div>
        <div class="card"><h3>Páginas más lentas</h3><div id="slowTable"></div></div>
      </div>`;
    barChart('chTtfb', t.stats.ttfbDist.map((d) => d.label), t.stats.ttfbDist.map((d) => d.count), { label: 'Páginas' });
    mountTable($('#slowTable'), {
      rows: slow,
      columns: [
        { key: 'url', label: 'URL', cls: 'url', render: (p) => link(p.url, shortUrl(p.url, t.url)) },
        { key: 'ttfbMs', label: 'TTFB', num: true, render: (p) => ms(p.ttfbMs) },
        { key: 'timeMs', label: 'Total', num: true, render: (p) => ms(p.timeMs) },
        { key: 'bytes', label: 'Tamaño', num: true, render: (p) => bytes(p.bytes) },
      ],
    });
  }

  /* ------------------------------ Técnico ------------------------------ */

  function yesNo(v, good = true) {
    if (v === null || v === undefined) return '<span class="muted">—</span>';
    const ok = good ? v : !v;
    return `<span class="pill ${ok ? 'ok' : 'bad'}">${v ? 'Sí' : 'No'}</span>`;
  }

  function renderTechnical(c, r) {
    const t = r.target;
    const T = t.technical;
    const rb = T.robots;
    c.innerHTML = `
      <div class="section-head"><div><h2>SEO técnico</h2><p class="muted">Seguridad, rastreo e indexación a nivel de sitio.</p></div></div>
      <div class="two-col">
        <div class="card"><h3>HTTPS y dominio</h3><dl class="kv">
          <dt>Usa HTTPS</dt><dd>${yesNo(T.isHttps)}</dd>
          ${T.httpRedirect ? `<dt>HTTP → HTTPS</dt><dd>${T.httpRedirect.status ? yesNo(T.httpRedirect.redirectsToHttps) : `<span class="muted">${esc(T.httpRedirect.error || 'no responde')}</span>`}</dd>` : ''}
          ${T.tls ? `<dt>Certificado SSL</dt><dd>${T.tls.checked ? `${yesNo(T.tls.valid)} ${esc(T.tls.issuer || '')} · caduca ${esc((T.tls.validTo || '').slice(0, 10))} (${num(T.tls.daysLeft)} días)${T.tls.error ? `<br><span class="sev-error">${esc(T.tls.error)}</span>` : ''}` : `<span class="muted">No comprobado: ${esc(T.tls.error)}</span>`}</dd>` : ''}
          ${T.www && T.www.applicable ? `<dt>Versión www/sin www</dt><dd>${T.www.altStatus === 0 ? `<span class="muted">${esc(T.www.altUrl)} no responde</span>` : T.www.redirectsToPrimary ? '<span class="pill ok">Redirige a la principal</span>' : T.www.duplicate ? '<span class="pill bad">Duplicada (200 sin redirección)</span>' : `<span class="muted">HTTP ${esc(T.www.altStatus)}</span>`}</dd>` : ''}
          <dt>404 correctos</dt><dd>${T.soft404 ? (T.soft404.soft404 ? '<span class="pill bad">No (soft 404)</span>' : `<span class="pill ok">Sí (HTTP ${esc(T.soft404.status)})</span>`) : '—'}</dd>
          <dt>Servidor</dt><dd>${esc(T.server || '—')}</dd>
          <dt>Idiomas</dt><dd>${esc(t.stats.languages.join(', ') || '—')}</dd>
          <dt>hreflang (portada)</dt><dd>${t.homepage && t.homepage.hreflang.length ? t.homepage.hreflang.map((h) => esc(h.lang)).join(', ') : 'No'}</dd>
        </dl></div>
        <div class="card"><h3>Cabeceras de seguridad (portada)</h3>
          <div class="table-wrap"><table><tbody>${T.securityHeaders.map((h) => `<tr><td>${esc(h.name)}</td><td>${h.present ? '<span class="pill ok">Presente</span>' : '<span class="pill">Ausente</span>'}</td></tr>`).join('')}</tbody></table></div>
        </div>
      </div>
      <div class="two-col">
        <div class="card"><h3>robots.txt</h3>
          <p>${rb.exists ? '<span class="pill ok">Encontrado</span>' : `<span class="pill bad">No encontrado (HTTP ${esc(rb.status || rb.error)})</span>`} ${link(rb.url)}</p>
          ${rb.exists ? `<p class="small muted">${rb.groups} grupo(s) · ${rb.sitemaps.length} sitemap(s) declarados${rb.invalidLines ? ` · ${rb.invalidLines} línea(s) no válidas` : ''}${rb.blocksGooglebot ? ' · <span class="sev-error">bloquea Googlebot</span>' : ''}</p><pre class="robots-pre">${esc(rb.content)}</pre>` : ''}
        </div>
        <div class="card"><h3>Sitemaps XML</h3>
          ${t.sitemap.found ? `<p class="small muted">${num(t.sitemap.totalUrls)} URLs · ${t.sitemap.lastmodRatio}% con &lt;lastmod&gt;</p>` : '<p class="sev-warning">No se encontró ningún sitemap.</p>'}
          <div class="table-wrap"><table><thead><tr><th>Sitemap</th><th>Tipo</th><th class="num">URLs</th><th>Estado</th></tr></thead><tbody>
            ${t.sitemap.sitemaps.map((s) => `<tr><td class="url">${link(s.url)}</td><td>${esc(s.type || '—')}</td><td class="num">${num(s.urlCount)}</td><td>${s.valid ? '<span class="pill ok">OK</span>' : `<span class="pill bad">${esc(s.error || `HTTP ${s.status}`)}</span>`}</td></tr>`).join('')}
          </tbody></table></div>
        </div>
      </div>
      ${t.stats.blockedByRobots ? `<div class="card"><h3>URLs no rastreadas por robots.txt (${num(t.stats.blockedByRobots)})</h3><ul>${t.stats.blockedByRobotsSample.map((b) => `<li>${link(b.url, shortUrl(b.url, t.url))} <span class="muted small">${esc(b.rule || '')}</span></li>`).join('')}</ul></div>` : ''}
      <div class="callout small">Rastreadas ${num(t.stats.pagesCrawled)} URLs de ${num(t.stats.discoveredUrls)} descubiertas${t.stats.notCrawled ? `; ${num(t.stats.notCrawled)} quedaron en cola por el límite de páginas (auméntalo en Opciones avanzadas para un análisis más completo)` : ''}.</div>`;
  }

  /* ------------------------------ Competencia ------------------------------ */

  function renderCompetitors(c, r) {
    const t = r.target;
    const comps = r.competitors || [];
    const ok = comps.filter((x) => !x.error);
    const failed = comps.filter((x) => x.error);
    const disc = r.integrations && r.integrations.discoveredCompetitors;
    if (!ok.length) {
      c.innerHTML = `<div class="section-head"><h2>Competencia</h2></div>
        <div class="callout">No hay competidores en este análisis. Escribe hasta 5 dominios en el campo "Competidores" y vuelve a analizar${integrationStatus().dataforseo ? '' : ', o configura DataForSEO para detectarlos automáticamente'}.</div>
        ${failed.map((f) => `<p class="sev-error">${esc(f.domain)}: ${esc(f.error)}</p>`).join('')}
        ${disc && disc.error ? `<p class="sev-warning">Detección automática: ${esc(disc.error)}</p>` : ''}`;
      return;
    }
    const rows = r.comparison;
    const colors = seriesColors();
    const metrics = [
      ['health', 'Salud del sitio', true, num],
      ['aiScore', 'Preparación IA', true, num],
      ['performance', 'Rendimiento móvil', true, num],
      ['lcp', 'LCP móvil', null, (v) => esc(v || '—')],
      ['authority', 'Autoridad (OPR)', true, num1],
      ['organicKeywords', 'Keywords orgánicas', true, num],
      ['organicTraffic', 'Tráfico orgánico est.', true, num],
      ['referringDomains', 'Dominios de referencia', true, num],
      ['backlinks', 'Backlinks', true, num],
      ['pages', 'Páginas rastreadas', null, num],
      ['avgWords', 'Palabras por página', true, num],
      ['avgTtfb', 'TTFB medio', false, ms],
      ['errors', 'Tipos de error', false, num],
      ['schemaPct', '% páginas con schema', true, (v) => `${num(v)}%`],
      ['questionsPct', '% páginas con preguntas', true, (v) => `${num(v)}%`],
      ['llmsTxt', 'llms.txt', null, (v) => (v ? 'Sí' : 'No')],
      ['https', 'HTTPS', null, (v) => (v ? 'Sí' : 'No')],
    ];
    const best = (key, higher) => {
      const vals = rows.map((x) => x[key]).filter((v) => typeof v === 'number');
      if (!vals.length || higher === null) return null;
      return higher ? Math.max(...vals) : Math.min(...vals);
    };
    c.innerHTML = `
      <div class="section-head"><div><h2>Competencia</h2><p class="muted">Comparativa con ${ok.length} competidor(es). En verde, el mejor valor de cada fila.</p></div></div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Métrica</th>${rows.map((x) => `<th class="num">${esc(x.domain)}${x.isTarget ? ' (tú)' : ''}</th>`).join('')}</tr></thead>
        <tbody>${metrics.filter(([k]) => rows.some((x) => x[k] !== null && x[k] !== undefined)).map(([k, label, higher, fmt]) => {
          const b = best(k, higher);
          return `<tr><td>${esc(label)}</td>${rows.map((x) => `<td class="num" ${b !== null && x[k] === b && rows.length > 1 ? 'style="color:var(--good-text);font-weight:700"' : ''}>${x[k] === null || x[k] === undefined ? '—' : fmt(x[k])}</td>`).join('')}</tr>`;
        }).join('')}
        <tr><td>Bloquea buscadores IA</td>${rows.map((x) => `<td class="num">${x.blockedAiSearch.length ? esc(x.blockedAiSearch.join(', ')) : 'No'}</td>`).join('')}</tr>
        </tbody></table></div></div>
      <div class="card"><h3>Puntuaciones (0-100)</h3>
        <div class="legend">${rows.map((x, i) => `<span><i style="background:${colors[i % colors.length]}"></i>${esc(x.domain)}</span>`).join('')}</div>
        <div class="chart-box tall"><canvas id="chComp" aria-label="Comparativa de puntuaciones"></canvas></div></div>
      ${r.rankingGap ? `<div class="card"><h3>Brecha de keywords posicionadas (DataForSEO)</h3>
        <div class="filter-bar" id="rgFilter" style="margin-bottom:10px">
          <button class="chip active" data-k="missing" type="button">Ausentes (${r.rankingGap.missing.length})</button>
          <button class="chip" data-k="weak" type="button">Débiles (${r.rankingGap.weak.length})</button>
          <button class="chip" data-k="strong" type="button">Fuertes (${r.rankingGap.strong.length})</button>
        </div><p class="muted small" id="rgHelp"></p><div id="rgTable"></div></div>` : ''}
      ${r.keywordGap ? `<div class="card"><h3>Brecha de temas del contenido</h3>
        <p class="muted small">Compara los temas que tratan tus competidores en sus páginas con los tuyos. Útil para detectar contenido que te falta.</p>
        <div class="filter-bar" id="kgFilter" style="margin-bottom:10px">
          <button class="chip active" data-k="missing" type="button">Te faltan (${r.keywordGap.missing.length})</button>
          <button class="chip" data-k="weak" type="button">Débiles (${r.keywordGap.weak.length})</button>
          <button class="chip" data-k="shared" type="button">Compartidos (${r.keywordGap.shared.length})</button>
          <button class="chip" data-k="strong" type="button">Fuertes (${r.keywordGap.strong.length})</button>
          <button class="chip" data-k="unique" type="button">Solo tú (${r.keywordGap.unique.length})</button>
        </div><div id="kgTable"></div></div>` : ''}
      <div class="grid-3">${ok.map((x) => `<div class="card"><h3>${esc(x.domain)}</h3>
        <p class="small">${link(x.url)}</p>
        <dl class="kv small"><dt>Título portada</dt><dd>${esc(x.homepage ? x.homepage.title : '—')}</dd><dt>Schema</dt><dd>${esc(x.ai.stats.schemaTypes.slice(0, 6).join(', ') || 'Ninguno')}</dd></dl>
        <h4 style="margin-top:8px">Temas principales</h4><p class="small">${x.keywords.top.slice(0, 15).map((k) => esc(k.keyword)).join(' · ')}</p>
        <h4>Principales problemas</h4><ul class="small">${x.audit.issues.filter((i) => i.severity !== 'notice').slice(0, 5).map((i) => `<li><span class="dot ${i.severity}"></span> ${esc(i.title)} (${num(i.count)})</li>`).join('') || '<li>Ninguno</li>'}</ul>
      </div>`).join('')}</div>
      ${failed.length ? `<div class="callout warn">${failed.map((f) => `No se pudo analizar ${esc(f.domain)}: ${esc(f.error)}`).join('<br>')}</div>` : ''}
      ${Array.isArray(disc) && disc.length ? `<div class="card"><h3>Competidores orgánicos detectados (DataForSEO)</h3><div id="discTable"></div></div>` : ''}`;

    const scoreMetrics = [['health', 'Salud'], ['aiScore', 'Preparación IA'], ['performance', 'Rendimiento móvil'], ['schemaPct', '% con schema']]
      .filter(([k]) => rows.some((x) => typeof x[k] === 'number'));
    makeChart('chComp', {
      type: 'bar',
      data: {
        labels: scoreMetrics.map(([, l]) => l),
        datasets: rows.map((x, i) => ({
          label: x.domain,
          data: scoreMetrics.map(([k]) => x[k]),
          backgroundColor: colors[i % colors.length],
          borderColor: cssVar('--surface-1'),
          borderWidth: { left: 1, right: 1 },
          borderRadius: 4,
          borderSkipped: 'start',
          maxBarThickness: 28,
        })),
      },
      options: { scales: { y: { max: 100 } }, plugins: { legend: { display: false } } },
    });

    const compNames = (gap) => gap.competitors;
    if (r.rankingGap) {
      const help = {
        missing: 'Keywords por las que posicionan tus competidores y tú no.',
        weak: 'Keywords donde algún competidor está por delante de ti.',
        strong: 'Keywords donde estás por delante de todos.',
      };
      const drawRg = (k) => {
        $('#rgHelp').textContent = help[k];
        mountTable($('#rgTable'), {
          rows: r.rankingGap[k], filename: `brecha-posiciones-${k}.csv`, search: (x) => x.keyword,
          columns: [
            { key: 'keyword', label: 'Keyword' },
            { key: 'volume', label: 'Volumen', num: true, render: (x) => num(x.volume) },
            { key: 'difficulty', label: 'KD %', num: true, render: (x) => num(x.difficulty) },
            { key: 'target', label: t.domain, num: true, render: (x) => num(x.target) },
            ...compNames(r.rankingGap).map((d, i) => ({ key: `c${i}`, label: d, num: true, sort: (x) => x.competitors[i] ?? null, render: (x) => num(x.competitors[i]), csv: (x) => x.competitors[i] ?? '' })),
          ],
        });
      };
      $$('#rgFilter .chip').forEach((b) => b.addEventListener('click', () => {
        $$('#rgFilter .chip').forEach((x) => x.classList.toggle('active', x === b));
        drawRg(b.dataset.k);
      }));
      drawRg('missing');
    }
    if (r.keywordGap) {
      const drawKg = (k) => mountTable($('#kgTable'), {
        rows: r.keywordGap[k], filename: `brecha-temas-${k}.csv`, search: (x) => x.keyword, emptyText: 'Sin resultados en esta categoría.',
        columns: [
          { key: 'keyword', label: 'Tema / keyword' },
          { key: 'targetScore', label: t.domain, num: true, render: (x) => num1(x.targetScore || null) },
          ...compNames(r.keywordGap).map((d, i) => ({ key: `c${i}`, label: d, num: true, sort: (x) => x.competitors[i] ?? null, render: (x) => num1(x.competitors[i] ?? null), csv: (x) => x.competitors[i] ?? '' })),
          { key: 'competitorCount', label: 'Nº competidores', num: true },
        ],
      });
      $$('#kgFilter .chip').forEach((b) => b.addEventListener('click', () => {
        $$('#kgFilter .chip').forEach((x) => x.classList.toggle('active', x === b));
        drawKg(b.dataset.k);
      }));
      drawKg('missing');
    }
    if (Array.isArray(disc) && disc.length) {
      mountTable($('#discTable'), {
        rows: disc,
        columns: [
          { key: 'domain', label: 'Dominio' },
          { key: 'intersections', label: 'Keywords en común', num: true, render: (x) => num(x.intersections) },
          { key: 'avgPosition', label: 'Posición media', num: true, render: (x) => num1(x.avgPosition) },
          { key: 'keywords', label: 'Keywords', num: true, render: (x) => num(x.keywords) },
          { key: 'traffic', label: 'Tráfico est.', num: true, render: (x) => num(x.traffic) },
        ],
      });
    }
  }

  /* ============================== Ajustes / Historial ============================== */

  const KEY_FIELDS = ['googleApiKey', 'oprApiKey', 'dataforseoLogin', 'dataforseoPassword', 'anthropicApiKey'];

  function openSettings() {
    for (const k of KEY_FIELDS) $('#' + k).value = state.settings[k] || '';
    $('#aiModel').value = state.settings.aiModel || (state.config && state.config.aiModels[0]) || '';
    const env = (state.config && state.config.env) || {};
    const fromEnv = [env.googleApiKey && 'Google', env.oprApiKey && 'OpenPageRank', env.dataforseo && 'DataForSEO', env.anthropicApiKey && 'Anthropic'].filter(Boolean);
    $('#envStatus').textContent = fromEnv.length ? `Claves cargadas desde .env: ${fromEnv.join(', ')} (las de este formulario tienen prioridad).` : 'No hay claves en el archivo .env.';
    $('#settingsDialog').showModal();
  }

  function setupSettings() {
    $('#settingsBtn').addEventListener('click', openSettings);
    $('#settingsCancel').addEventListener('click', () => $('#settingsDialog').close());
    $('#settingsForm').addEventListener('submit', () => {
      for (const k of KEY_FIELDS) state.settings[k] = $('#' + k).value.trim();
      state.settings.aiModel = $('#aiModel').value;
      storageSet('rookySettings', state.settings);
      renderBadges();
      if (state.report && !$('#reportView').hidden) renderTab();
    });
  }

  async function openHistory() {
    const el = $('#historyList');
    el.innerHTML = '<p class="muted">Cargando…</p>';
    $('#historyDialog').showModal();
    try {
      const list = await api('/api/reports');
      el.innerHTML = list.length ? list.map((x) => `<div class="history-item">
        <div><b>${esc(x.domain)}</b> <span class="pill">salud ${num(x.health)}</span><div class="muted small">${esc(date(x.analyzedAt))} · ${num(x.pages)} páginas${x.competitors.length ? ` · vs ${esc(x.competitors.join(', '))}` : ''}</div></div>
        <div style="display:flex;gap:6px"><button class="btn small" data-open="${esc(x.id)}" type="button">Abrir</button><button class="btn ghost small danger" data-del="${esc(x.id)}" type="button">Borrar</button></div>
      </div>`).join('') : '<div class="empty">Aún no hay informes.</div>';
      $$('[data-open]', el).forEach((b) => b.addEventListener('click', () => {
        $('#historyDialog').close();
        openReport(b.dataset.open);
      }));
      $$('[data-del]', el).forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('¿Borrar este informe?')) return;
        try {
          await api(`/api/reports/${b.dataset.del}`, { method: 'DELETE' });
          if (state.report && state.report.id === b.dataset.del) {
            state.report = null;
            history.replaceState(null, '', '#');
            showView('startView');
          }
          openHistory();
        } catch (e) {
          alert(e.message);
        }
      }));
    } catch (e) {
      el.innerHTML = `<p class="sev-error">${esc(e.message)}</p>`;
    }
  }

  /* ============================== Tema ============================== */

  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
  }

  function setupTheme() {
    applyTheme(storageGet('rookyTheme', null));
    $('#themeBtn').addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      storageSet('rookyTheme', next);
      if (state.report && !$('#reportView').hidden) renderTab();
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (state.report && !$('#reportView').hidden) renderTab();
    });
  }

  /* ============================== Arranque ============================== */

  async function init() {
    setupTheme();
    setupSettings();
    setupForm();
    $('#historyBtn').addEventListener('click', openHistory);
    $('#historyClose').addEventListener('click', () => $('#historyDialog').close());
    $('#homeLink').addEventListener('click', (e) => {
      e.preventDefault();
      if (state.job) return;
      history.replaceState(null, '', '#');
      showView('startView');
    });
    $('#reanalyzeBtn').addEventListener('click', () => {
      const r = state.report;
      if (!r) return;
      $('#urlInput').value = r.target.inputUrl || r.target.url;
      $('#competitorsInput').value = (r.params.competitors || []).join(', ');
      if (r.location) $('#locationSelect').value = r.location.key;
      history.replaceState(null, '', '#');
      showView('startView');
    });
    $('#exportJson').addEventListener('click', () => {
      if (state.report) download(`informe-seo-${state.report.target.domain}.json`, JSON.stringify(state.report, null, 2), 'application/json');
    });
    $('#printBtn').addEventListener('click', () => {
      $$('details.issue').forEach((d) => d.setAttribute('open', ''));
      window.print();
    });
    await loadConfig();
    const m = location.hash.match(/report=([a-f0-9-]{36})/);
    if (m) openReport(m[1]);
    else showView('startView');
  }

  init();
})();
