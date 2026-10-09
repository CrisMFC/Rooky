'use strict';

/**
 * Catálogo de comprobaciones. severity: error | warning | notice
 * Cada comprobación de página recibe la página y devuelve true si hay problema
 * (o un string con detalle).
 */
const PAGE_CHECKS = [
  // ---------- Errores ----------
  { id: 'status-4xx', severity: 'error', category: 'Rastreo', title: 'Páginas con error 4xx', fix: 'Restaura la página, redirígela (301) a una equivalente o elimina los enlaces que apuntan a ella.', test: (p) => p.status >= 400 && p.status < 500 && `HTTP ${p.status}` },
  { id: 'status-5xx', severity: 'error', category: 'Rastreo', title: 'Páginas con error de servidor 5xx', fix: 'Revisa los logs del servidor; los 5xx impiden la indexación y, si persisten, Google reduce el rastreo.', test: (p) => p.status >= 500 && `HTTP ${p.status}` },
  { id: 'fetch-error', severity: 'error', category: 'Rastreo', title: 'Páginas que no se pudieron cargar', fix: 'Comprueba DNS, certificado SSL, cortafuegos o tiempos de respuesta del servidor.', test: (p) => p.status === 0 && (p.error || 'Error de conexión') },
  { id: 'title-missing', severity: 'error', category: 'Contenido', title: 'Falta la etiqueta <title>', fix: 'Añade un título único y descriptivo de 30-60 caracteres que incluya la keyword principal.', html: true, test: (p) => !p.analysis.title },
  { id: 'title-duplicate', severity: 'error', category: 'Contenido', title: 'Títulos duplicados', fix: 'Cada página indexable debe tener un título único.', html: true, site: true },
  { id: 'jsonld-invalid', severity: 'error', category: 'Datos estructurados', title: 'Datos estructurados JSON-LD con errores de sintaxis', fix: 'Valida el JSON-LD con la Prueba de resultados enriquecidos de Google y corrige la sintaxis.', html: true, test: (p) => p.analysis.jsonLd.errors.length > 0 && p.analysis.jsonLd.errors[0] },
  { id: 'mixed-content', severity: 'error', category: 'HTTPS', title: 'Contenido mixto (recursos HTTP en página HTTPS)', fix: 'Carga todos los recursos (imágenes, scripts, CSS) por HTTPS.', html: true, test: (p) => p.analysis.mixedContent.length > 0 && `${p.analysis.mixedContent.length} recurso(s): ${p.analysis.mixedContent[0]}` },
  { id: 'broken-internal-links', severity: 'error', category: 'Enlaces', title: 'Enlaces internos rotos', fix: 'Corrige o elimina los enlaces que apuntan a páginas con error 4xx/5xx.', html: true, site: true },
  { id: 'canonical-broken', severity: 'error', category: 'Indexación', title: 'Canonical apunta a una URL con error o redirección', fix: 'El canonical debe apuntar a una URL final que devuelva 200.', html: true, site: true },
  { id: 'redirect-loop', severity: 'error', category: 'Rastreo', title: 'Bucles o exceso de redirecciones', fix: 'Elimina el bucle: cada URL debe redirigir directamente a su destino final.', test: (p) => p.error && /bucle|demasiadas redirecciones/i.test(p.error) && p.error },

  // ---------- Avisos ----------
  { id: 'meta-description-missing', severity: 'warning', category: 'Contenido', title: 'Falta la meta description', fix: 'Escribe una meta description única de 70-160 caracteres que invite al clic.', html: true, test: (p) => !p.analysis.metaDescription },
  { id: 'meta-description-duplicate', severity: 'warning', category: 'Contenido', title: 'Meta descriptions duplicadas', fix: 'Cada página debe tener una meta description propia.', html: true, site: true },
  { id: 'h1-missing', severity: 'warning', category: 'Contenido', title: 'Falta el encabezado H1', fix: 'Añade un único H1 que describa el tema principal de la página.', html: true, test: (p) => p.analysis.headings.h1.length === 0 },
  { id: 'title-too-long', severity: 'warning', category: 'Contenido', title: 'Título demasiado largo (>60 caracteres)', fix: 'Google suele cortar los títulos a ~600 px (≈60 caracteres). Pon lo importante al principio.', html: true, test: (p) => p.analysis.titleLength > 60 && `${p.analysis.titleLength} caracteres` },
  { id: 'title-too-short', severity: 'warning', category: 'Contenido', title: 'Título demasiado corto (<30 caracteres)', fix: 'Aprovecha el título para describir mejor la página e incluir keywords.', html: true, test: (p) => p.analysis.title && p.analysis.titleLength < 30 && `${p.analysis.titleLength} caracteres` },
  { id: 'low-word-count', severity: 'warning', category: 'Contenido', title: 'Contenido escaso (<200 palabras)', fix: 'Amplía el contenido con información útil y original, o marca la página como noindex si no aporta valor.', html: true, test: (p) => !p.analysis.noindex && p.analysis.wordCount < 200 && `${p.analysis.wordCount} palabras` },
  { id: 'img-alt-missing', severity: 'warning', category: 'Imágenes', title: 'Imágenes sin atributo alt', fix: 'Añade texto alternativo descriptivo (accesibilidad y SEO de imágenes). Usa alt="" solo en imágenes decorativas.', html: true, test: (p) => p.analysis.imagesMissingAlt > 0 && `${p.analysis.imagesMissingAlt} imagen(es)` },
  { id: 'viewport-missing', severity: 'warning', category: 'Móvil', title: 'Falta la meta viewport (no adaptada a móvil)', fix: 'Añade <meta name="viewport" content="width=device-width, initial-scale=1">.', html: true, test: (p) => !p.analysis.viewport },
  { id: 'lang-missing', severity: 'warning', category: 'Internacional', title: 'Falta el atributo lang en <html>', fix: 'Declara el idioma: <html lang="es">.', html: true, test: (p) => !p.analysis.lang },
  { id: 'slow-response', severity: 'warning', category: 'Rendimiento', title: 'Respuesta del servidor lenta (TTFB > 1,5 s)', fix: 'Activa caché de página, CDN y revisa el rendimiento del servidor/hosting.', test: (p) => p.ttfbMs > 1500 && `${(p.ttfbMs / 1000).toFixed(2)} s` },
  { id: 'large-html', severity: 'warning', category: 'Rendimiento', title: 'HTML demasiado pesado (>2 MB)', fix: 'Reduce HTML inline (SVG, JSON, estilos) y pagina listados largos.', html: true, test: (p) => p.analysis.htmlBytes > 2 * 1024 * 1024 && `${(p.analysis.htmlBytes / 1048576).toFixed(1)} MB` },
  { id: 'redirect-chain', severity: 'warning', category: 'Rastreo', title: 'Cadenas de redirecciones (2 o más saltos)', fix: 'Redirige directamente a la URL final en un solo salto.', test: (p) => p.redirects && p.redirects.length >= 2 && `${p.redirects.length} saltos` },
  { id: 'meta-refresh', severity: 'warning', category: 'Rastreo', title: 'Uso de meta refresh', fix: 'Sustituye la meta refresh por una redirección 301 del servidor.', html: true, test: (p) => !!p.analysis.metaRefresh && p.analysis.metaRefresh },
  { id: 'multiple-title', severity: 'warning', category: 'Contenido', title: 'Varias etiquetas <title>', fix: 'Deja una única etiqueta <title> en el <head>.', html: true, test: (p) => p.analysis.titleCount > 1 && `${p.analysis.titleCount} títulos` },
  { id: 'multiple-canonical', severity: 'warning', category: 'Indexación', title: 'Varias etiquetas canonical', fix: 'Con varias canonical Google puede ignorarlas todas. Deja solo una.', html: true, test: (p) => p.analysis.canonicalCount > 1 && `${p.analysis.canonicalCount} canonical` },
  { id: 'broken-external-links', severity: 'warning', category: 'Enlaces', title: 'Enlaces externos rotos', fix: 'Actualiza o elimina los enlaces a sitios que ya no existen.', html: true, site: true },
  { id: 'internal-http-links', severity: 'warning', category: 'HTTPS', title: 'Enlaces internos a HTTP en un sitio HTTPS', fix: 'Actualiza los enlaces internos para que usen HTTPS directamente.', html: true, test: (p) => {
    const n = p.analysis.links.filter((l) => l.internal && l.insecure).length;
    return n > 0 && `${n} enlace(s)`;
  } },
  { id: 'duplicate-content', severity: 'warning', category: 'Contenido', title: 'Contenido duplicado (mismo título, descripción y H1)', fix: 'Unifica las páginas, diferéncialas o usa canonical hacia la versión principal.', html: true, site: true },
  { id: 'hreflang-invalid', severity: 'warning', category: 'Internacional', title: 'Códigos hreflang no válidos', fix: 'Usa códigos ISO 639-1 (+ ISO 3166-1 opcional), p. ej. "es", "es-MX", o "x-default".', html: true, test: (p) => {
    const bad = p.analysis.hreflang.filter((h) => !/^([a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?|x-default)$/.test(h.lang));
    return bad.length > 0 && bad.map((b) => b.lang).join(', ');
  } },

  // ---------- Notas ----------
  { id: 'noindex', severity: 'notice', category: 'Indexación', title: 'Páginas con noindex', fix: 'Verifica que estas páginas no deban aparecer en Google.', html: true, test: (p) => p.analysis.noindex && (p.analysis.metaRobots || p.analysis.xRobotsTag) },
  { id: 'canonical-missing', severity: 'notice', category: 'Indexación', title: 'Sin etiqueta canonical', fix: 'Añade una canonical autorreferente para evitar duplicados por parámetros.', html: true, test: (p) => !p.analysis.canonical && !p.analysis.headerCanonical },
  { id: 'canonicalized', severity: 'notice', category: 'Indexación', title: 'Páginas canonicalizadas a otra URL', fix: 'Correcto si es intencionado; estas páginas no se indexarán por sí mismas.', html: true, test: (p) => {
    const c = p.analysis.canonical || p.analysis.headerCanonical;
    return c && c !== p.finalUrl && c !== p.url && `→ ${c}`;
  } },
  { id: 'meta-description-long', severity: 'notice', category: 'Contenido', title: 'Meta description larga (>160 caracteres)', fix: 'Google la cortará; resume el mensaje clave al principio.', html: true, test: (p) => p.analysis.metaDescriptionLength > 160 && `${p.analysis.metaDescriptionLength} caracteres` },
  { id: 'meta-description-short', severity: 'notice', category: 'Contenido', title: 'Meta description corta (<70 caracteres)', fix: 'Amplíala para describir el valor de la página.', html: true, test: (p) => p.analysis.metaDescription && p.analysis.metaDescriptionLength < 70 && `${p.analysis.metaDescriptionLength} caracteres` },
  { id: 'multiple-h1', severity: 'notice', category: 'Contenido', title: 'Más de un H1', fix: 'No es un error grave, pero un único H1 aclara el tema principal.', html: true, test: (p) => p.analysis.headings.h1.length > 1 && `${p.analysis.headings.h1.length} H1` },
  { id: 'h1-equals-title', severity: 'notice', category: 'Contenido', title: 'H1 idéntico al título', fix: 'Aprovecha para cubrir variaciones de la keyword en título y H1.', html: true, test: (p) => p.analysis.title && p.analysis.headings.h1[0] && p.analysis.headings.h1[0].toLowerCase() === p.analysis.title.toLowerCase() },
  { id: 'heading-skip', severity: 'notice', category: 'Contenido', title: 'Saltos en la jerarquía de encabezados', fix: 'Respeta el orden H1 → H2 → H3 sin saltar niveles.', html: true, test: (p) => p.analysis.headingSkips > 0 && `${p.analysis.headingSkips} salto(s)` },
  { id: 'low-text-ratio', severity: 'notice', category: 'Contenido', title: 'Ratio texto/HTML bajo (<10%)', fix: 'Reduce código innecesario o añade más contenido textual.', html: true, test: (p) => p.analysis.textRatio < 10 && `${p.analysis.textRatio}%` },
  { id: 'too-many-links', severity: 'notice', category: 'Enlaces', title: 'Demasiados enlaces en la página (>300)', fix: 'Prioriza los enlaces importantes; demasiados diluyen la autoridad interna.', html: true, test: (p) => p.analysis.links.length > 300 && `${p.analysis.links.length} enlaces` },
  { id: 'nofollow-internal', severity: 'notice', category: 'Enlaces', title: 'Enlaces internos con nofollow', fix: 'No uses nofollow en enlaces internos: bloquea el flujo de autoridad.', html: true, test: (p) => {
    const n = p.analysis.links.filter((l) => l.internal && l.nofollow).length;
    return n > 0 && `${n} enlace(s)`;
  } },
  { id: 'orphan', severity: 'notice', category: 'Enlaces', title: 'Páginas huérfanas (solo en sitemap, sin enlaces internos)', fix: 'Enlázalas desde páginas relevantes o elimínalas del sitemap.', test: (p) => p.fromSitemap && p.inlinks === 0 && p.status >= 200 && p.status < 300 },
  { id: 'single-inlink', severity: 'notice', category: 'Enlaces', title: 'Páginas con un solo enlace interno entrante', fix: 'Refuerza el enlazado interno hacia estas páginas si son importantes.', html: true, test: (p) => p.depth !== 0 && p.inlinks === 1 },
  { id: 'deep-page', severity: 'notice', category: 'Rastreo', title: 'Páginas a más de 3 clics de la portada', fix: 'Acerca las páginas importantes a la portada con enlaces internos o menús.', test: (p) => p.depth !== null && p.depth > 3 && `Profundidad ${p.depth}` },
  { id: 'url-format', severity: 'notice', category: 'URLs', title: 'URLs poco amigables (mayúsculas, guiones bajos o >115 caracteres)', fix: 'Usa URLs cortas, en minúsculas y con guiones.', test: (p) => {
    try {
      const u = new URL(p.url);
      const issues = [];
      if (/[A-Z]/.test(u.pathname)) issues.push('mayúsculas');
      if (/_/.test(u.pathname)) issues.push('guiones bajos');
      if (p.url.length > 115) issues.push(`${p.url.length} caracteres`);
      return issues.length > 0 && issues.join(', ');
    } catch {
      return false;
    }
  } },
  { id: 'url-params', severity: 'notice', category: 'URLs', title: 'URLs con parámetros', fix: 'Evita enlazar internamente URLs con parámetros o canonicalízalas.', test: (p) => {
    try { return new URL(p.url).search.length > 1; } catch { return false; }
  } },
  { id: 'og-missing', severity: 'notice', category: 'Redes sociales', title: 'Faltan etiquetas Open Graph', fix: 'Añade og:title, og:description y og:image para que se vea bien al compartir.', html: true, test: (p) => !p.analysis.og['og:title'] || !p.analysis.og['og:image'] },
  { id: 'schema-missing', severity: 'notice', category: 'Datos estructurados', title: 'Sin datos estructurados', fix: 'Añade Schema.org (Organization, Article, Product, FAQPage, BreadcrumbList...) para resultados enriquecidos y buscadores IA.', html: true, test: (p) => p.analysis.jsonLd.count === 0 && p.analysis.microdataTypes.length === 0 },
  { id: 'img-dimensions', severity: 'notice', category: 'Imágenes', title: 'Imágenes sin width/height (riesgo de CLS)', fix: 'Indica width y height para reservar espacio y evitar saltos de diseño.', html: true, test: (p) => p.analysis.imagesWithoutDimensions > 3 && `${p.analysis.imagesWithoutDimensions} imagen(es)` },
  { id: 'no-compression', severity: 'notice', category: 'Rendimiento', title: 'HTML sin compresión (gzip/brotli)', fix: 'Activa la compresión gzip o brotli en el servidor.', html: true, test: (p) => !p.headers['content-encoding'] && p.analysis.htmlBytes > 10240 },
  { id: 'deprecated-tags', severity: 'notice', category: 'Código', title: 'Etiquetas HTML obsoletas (font, center, marquee)', fix: 'Sustitúyelas por CSS.', html: true, test: (p) => p.analysis.deprecatedTags > 0 && `${p.analysis.deprecatedTags} etiqueta(s)` },
  { id: 'keyword-stuffing', severity: 'notice', category: 'Contenido', title: 'Posible sobreoptimización de keywords', fix: 'Reduce repeticiones y usa sinónimos y variaciones naturales.', html: true, site: true },
  { id: 'cannibalization', severity: 'notice', category: 'Contenido', title: 'Posible canibalización (varias páginas con la misma keyword en el título)', fix: 'Define una página principal por keyword y diferencia o fusiona el resto.', html: true, site: true },
];

const SITE_CHECKS_META = {
  'robots-missing': { severity: 'warning', category: 'Rastreo', title: 'No existe robots.txt', fix: 'Crea /robots.txt (aunque sea permisivo) e incluye la URL del sitemap.' },
  'robots-blocks-all': { severity: 'error', category: 'Rastreo', title: 'robots.txt bloquea todo el sitio', fix: 'Elimina "Disallow: /" para los buscadores, salvo que sea intencionado.' },
  'robots-html': { severity: 'warning', category: 'Rastreo', title: 'robots.txt devuelve HTML', fix: 'robots.txt debe servirse como texto plano.' },
  'sitemap-missing': { severity: 'warning', category: 'Rastreo', title: 'No se encontró sitemap XML', fix: 'Genera un sitemap.xml con las URLs indexables y envíalo a Google Search Console.' },
  'sitemap-not-in-robots': { severity: 'notice', category: 'Rastreo', title: 'El sitemap no está declarado en robots.txt', fix: 'Añade "Sitemap: https://tudominio/sitemap.xml" a robots.txt.' },
  'sitemap-bad-urls': { severity: 'error', category: 'Rastreo', title: 'URLs del sitemap con errores, redirecciones o noindex', fix: 'El sitemap solo debe contener URLs finales, indexables y con estado 200.' },
  'no-https': { severity: 'error', category: 'HTTPS', title: 'El sitio no usa HTTPS', fix: 'Instala un certificado SSL y redirige todo el tráfico a HTTPS.' },
  'http-no-redirect': { severity: 'error', category: 'HTTPS', title: 'La versión HTTP no redirige a HTTPS', fix: 'Configura una redirección 301 de http:// a https://.' },
  'ssl-invalid': { severity: 'error', category: 'HTTPS', title: 'Certificado SSL no válido', fix: 'Renueva o corrige el certificado SSL.' },
  'ssl-expiring': { severity: 'warning', category: 'HTTPS', title: 'El certificado SSL caduca en menos de 30 días', fix: 'Renueva el certificado o activa la renovación automática.' },
  'www-duplicate': { severity: 'warning', category: 'Indexación', title: 'Las versiones con y sin www responden sin redirigir', fix: 'Elige una versión y redirige la otra con 301.' },
  'soft-404': { severity: 'warning', category: 'Rastreo', title: 'Las páginas inexistentes devuelven 200 (soft 404)', fix: 'Las URLs que no existen deben devolver 404 o 410.' },
  'no-hsts': { severity: 'notice', category: 'HTTPS', title: 'Falta la cabecera HSTS', fix: 'Añade Strict-Transport-Security para forzar HTTPS.' },
  'no-favicon': { severity: 'notice', category: 'Marca', title: 'No se detectó favicon', fix: 'Añade un favicon: aparece junto a tu web en los resultados de Google.' },
  'robots-blocks-ai-search': { severity: 'warning', category: 'Búsqueda IA', title: 'robots.txt bloquea buscadores con IA', fix: 'Permite OAI-SearchBot, PerplexityBot, Claude-SearchBot, etc. si quieres aparecer en sus respuestas.' },
  'no-llms-txt': { severity: 'notice', category: 'Búsqueda IA', title: 'No existe llms.txt', fix: 'Opcional: crea /llms.txt con un resumen del sitio y enlaces a las páginas clave.' },
};

function addSiteIssue(issues, id, items = [], detail = '') {
  const meta = SITE_CHECKS_META[id] || PAGE_CHECKS.find((c) => c.id === id);
  if (!meta) return;
  issues.push({
    id,
    severity: meta.severity,
    category: meta.category,
    title: meta.title,
    fix: meta.fix,
    scope: items.length ? 'páginas' : 'sitio',
    detail,
    count: items.length || 1,
    items: items.slice(0, 500),
  });
}

/**
 * Ejecuta todas las comprobaciones y calcula la puntuación de salud.
 */
function runAudit({ pages, technical, sitemap, linkCheck, keywords, ai }) {
  const issues = [];
  const htmlPages = pages.filter((p) => p.analysis);
  const okHtml = htmlPages.filter((p) => p.status >= 200 && p.status < 300);
  const indexable = okHtml.filter((p) => !p.analysis.noindex && !(p.analysis.canonical && p.analysis.canonical !== p.finalUrl && p.analysis.canonical !== p.url));
  const pageProblems = new Map(); // url -> {error, warning, notice}
  const mark = (url, sev) => {
    let m = pageProblems.get(url);
    if (!m) {
      m = { error: 0, warning: 0, notice: 0 };
      pageProblems.set(url, m);
    }
    m[sev]++;
  };

  // Comprobaciones por página
  for (const check of PAGE_CHECKS) {
    if (!check.test) continue;
    const items = [];
    for (const p of check.html ? okHtml : pages) {
      let r;
      try {
        r = check.test(p);
      } catch {
        r = false;
      }
      if (r) {
        items.push({ url: p.url, detail: typeof r === 'string' ? r : '' });
        mark(p.url, check.severity);
      }
    }
    if (items.length) {
      issues.push({ id: check.id, severity: check.severity, category: check.category, title: check.title, fix: check.fix, scope: 'páginas', count: items.length, items: items.slice(0, 500) });
    }
  }

  // Duplicados (solo entre páginas indexables)
  const dupBy = (fn, id) => {
    const groups = new Map();
    for (const p of indexable) {
      const v = fn(p);
      if (!v) continue;
      const k = v.toLowerCase();
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p.url);
    }
    const items = [];
    for (const [value, urls] of groups) {
      if (urls.length > 1) for (const u of urls) items.push({ url: u, detail: `"${value.slice(0, 90)}" (${urls.length} páginas)` });
    }
    if (items.length) {
      const meta = PAGE_CHECKS.find((c) => c.id === id);
      items.forEach((i) => mark(i.url, meta.severity));
      issues.push({ id, severity: meta.severity, category: meta.category, title: meta.title, fix: meta.fix, scope: 'páginas', count: items.length, items: items.slice(0, 500) });
    }
  };
  dupBy((p) => p.analysis.title, 'title-duplicate');
  dupBy((p) => p.analysis.metaDescription, 'meta-description-duplicate');
  dupBy((p) => (p.analysis.title && p.analysis.metaDescription && p.analysis.headings.h1[0] ? `${p.analysis.title}|${p.analysis.metaDescription}|${p.analysis.headings.h1[0]}` : ''), 'duplicate-content');

  // Enlaces internos rotos y canonical rotos
  const statusByUrl = new Map();
  for (const p of pages) {
    statusByUrl.set(p.url, p);
    if (p.finalUrl) statusByUrl.set(p.finalUrl, p);
  }
  const brokenInternal = [];
  const canonicalBroken = [];
  for (const p of okHtml) {
    const seenTargets = new Set();
    for (const l of p.analysis.links) {
      if (!l.internal || seenTargets.has(l.href)) continue;
      seenTargets.add(l.href);
      const t = statusByUrl.get(l.href);
      if (t && (t.status >= 400 || t.status === 0)) {
        brokenInternal.push({ url: p.url, detail: `${l.href} (${t.status || t.error})` });
      }
    }
    const c = p.analysis.canonical;
    if (c && c !== p.url && c !== p.finalUrl) {
      const t = statusByUrl.get(c);
      if (t && t.url === c && (t.status >= 300 || t.status === 0 || (t.redirects && t.redirects.length))) {
        canonicalBroken.push({ url: p.url, detail: `${c} → ${t.status || t.error}${t.redirects && t.redirects.length ? ' (redirige)' : ''}` });
      }
    }
  }
  if (brokenInternal.length) {
    brokenInternal.forEach((i) => mark(i.url, 'error'));
    addSiteIssue(issues, 'broken-internal-links', brokenInternal);
  }
  if (canonicalBroken.length) {
    canonicalBroken.forEach((i) => mark(i.url, 'error'));
    addSiteIssue(issues, 'canonical-broken', canonicalBroken);
  }

  // Enlaces externos rotos (resultado de la verificación de enlaces)
  if (linkCheck && linkCheck.broken.length) {
    const items = [];
    for (const b of linkCheck.broken) for (const src of b.sources.slice(0, 5)) items.push({ url: src, detail: `${b.url} (${b.status || b.error})` });
    items.forEach((i) => mark(i.url, 'warning'));
    addSiteIssue(issues, 'broken-external-links', items);
  }

  // Keywords: stuffing y canibalización
  if (keywords && keywords.stuffing.length) {
    addSiteIssue(issues, 'keyword-stuffing', keywords.stuffing.map((s) => ({ url: s.url, detail: `"${s.keyword}" ${s.density}% (${s.count} veces)` })));
  }
  if (keywords && keywords.cannibalization.length) {
    addSiteIssue(issues, 'cannibalization', keywords.cannibalization.flatMap((c) => c.pages.map((u) => ({ url: u, detail: `"${c.keyword}" en ${c.count} títulos` }))));
  }

  // Comprobaciones a nivel de sitio
  const t = technical;
  if (t.robots) {
    if (!t.robots.exists && !t.robots.servedAsHtml) addSiteIssue(issues, 'robots-missing', [], `HTTP ${t.robots.status || t.robots.error}`);
    if (t.robots.servedAsHtml) addSiteIssue(issues, 'robots-html');
    if (t.robots.blocksGooglebot || t.robots.blocksAll) addSiteIssue(issues, 'robots-blocks-all');
  }
  if (sitemap) {
    if (!sitemap.found) addSiteIssue(issues, 'sitemap-missing');
    else if (t.robots && t.robots.exists && !t.robots.sitemaps.length) addSiteIssue(issues, 'sitemap-not-in-robots');
    if (sitemap.found) {
      const sm = new Set(sitemap.urls);
      const bad = pages
        .filter((p) => sm.has(p.url))
        .filter((p) => p.status !== 200 || (p.redirects && p.redirects.length) || (p.analysis && p.analysis.noindex))
        .map((p) => ({ url: p.url, detail: p.status !== 200 ? `HTTP ${p.status || p.error}` : p.redirects && p.redirects.length ? `Redirige a ${p.finalUrl}` : 'noindex' }));
      if (bad.length) addSiteIssue(issues, 'sitemap-bad-urls', bad);
    }
  }
  if (t.isHttps === false) addSiteIssue(issues, 'no-https');
  else if (t.httpRedirect && t.httpRedirect.status > 0 && !t.httpRedirect.redirectsToHttps) addSiteIssue(issues, 'http-no-redirect', [], t.httpRedirect.httpUrl);
  if (t.tls && t.tls.checked) {
    if (!t.tls.valid) addSiteIssue(issues, 'ssl-invalid', [], t.tls.error || '');
    else if (t.tls.daysLeft < 30) addSiteIssue(issues, 'ssl-expiring', [], `Caduca en ${t.tls.daysLeft} días`);
  }
  if (t.www && t.www.duplicate) addSiteIssue(issues, 'www-duplicate', [], `${t.www.altUrl} responde 200 sin redirigir`);
  if (t.soft404 && t.soft404.soft404) addSiteIssue(issues, 'soft-404', [], t.soft404.testedUrl);
  if (t.isHttps && t.securityHeaders && !t.securityHeaders.find((h) => h.key === 'strict-transport-security').present) addSiteIssue(issues, 'no-hsts');
  const home = pages.find((p) => p.depth === 0);
  if (home && home.analysis && !home.analysis.favicon) addSiteIssue(issues, 'no-favicon');
  if (ai && ai.blockedSearch.length) addSiteIssue(issues, 'robots-blocks-ai-search', [], ai.blockedSearch.join(', '));
  if (ai && ai.llms && !ai.llms['llms.txt'].exists) addSiteIssue(issues, 'no-llms-txt');

  // Puntuación de salud (0-100):
  // 1) Calidad media de las páginas: cada página empieza en 100 y pierde 12 puntos
  //    por tipo de error y 4 por tipo de aviso (las notas no penalizan).
  // 2) Problemas de sitio: -6 por error y -2 por aviso.
  const scoredPages = pages.length || 1;
  let sum = 0;
  for (const p of pages) {
    const m = pageProblems.get(p.url) || { error: 0, warning: 0 };
    sum += Math.max(0, 100 - m.error * 12 - m.warning * 4);
  }
  const pageScore = pages.length ? sum / scoredPages : 0;
  const siteLevel = issues.filter((i) => i.scope === 'sitio');
  const sitePenalty = siteLevel.reduce((a, i) => a + (i.severity === 'error' ? 6 : i.severity === 'warning' ? 2 : 0), 0);
  const health = Math.max(0, Math.min(100, Math.round(pageScore - sitePenalty)));

  const severityOrder = { error: 0, warning: 1, notice: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.count - a.count);

  const counts = { error: 0, warning: 0, notice: 0 };
  for (const i of issues) counts[i.severity] += i.count;
  const pagesWithErrors = [...pageProblems.values()].filter((m) => m.error > 0).length;

  return {
    health,
    issues,
    counts,
    issueTypes: { error: issues.filter((i) => i.severity === 'error').length, warning: issues.filter((i) => i.severity === 'warning').length, notice: issues.filter((i) => i.severity === 'notice').length },
    pagesWithErrors,
    healthyPages: pages.filter((p) => !(pageProblems.get(p.url) && pageProblems.get(p.url).error)).length,
    indexablePages: indexable.length,
    pageProblems: Object.fromEntries(pageProblems),
  };
}

module.exports = { runAudit, PAGE_CHECKS, SITE_CHECKS_META };
