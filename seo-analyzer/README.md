# Rooky SEO Analyzer

Herramienta **local** de análisis SEO estilo Semrush. Rastrea una web, la audita a fondo, extrae sus keywords, analiza enlaces y backlinks, mide su preparación para los buscadores con IA (ChatGPT, Perplexity, Claude, Gemini, AI Overviews) y la compara con la competencia. Todo se ejecuta en tu ordenador y los informes se guardan en la carpeta `reports/`.

## Puesta en marcha

Requisito: **Node.js 20.18 o superior** ([nodejs.org](https://nodejs.org)).

```bash
cd seo-analyzer
npm install
npm start
```

Abre <http://127.0.0.1:3000>, escribe la URL del sitio y (opcionalmente) hasta 5 competidores, y pulsa **Analizar**.

También puedes hacer doble clic en `iniciar-windows.bat` (Windows) o ejecutar `./iniciar.sh` (macOS/Linux): instalan las dependencias la primera vez y abren el navegador.

## Qué analiza

| Sección | Contenido | Fuente de datos |
|---|---|---|
| **Resumen** | Salud del sitio (0-100), preparación IA, rendimiento, principales problemas, gráficos de estados HTTP, profundidad y longitud del contenido | Rastreo propio |
| **Auditoría del sitio** | Más de 50 comprobaciones clasificadas en errores, avisos y notas, con las URLs afectadas y cómo solucionarlo. Exportable a CSV | Rastreo propio |
| **Páginas** | Todas las URLs rastreadas con su estado, título, palabras, profundidad, enlaces entrantes, TTFB e incidencias. Detalle por página (etiquetas, encabezados, schema, legibilidad, quién la enlaza) | Rastreo propio |
| **Keywords** | Temas y keywords del contenido ponderados por ubicación (título, H1, URL…), intención de búsqueda, canibalización, densidad excesiva, generador de ideas (autocompletado de Google). Con DataForSEO: keywords por las que posicionas, posición, volumen, dificultad, CPC y tráfico estimado | Rastreo propio · Google Suggest · DataForSEO |
| **Backlinks y enlaces** | Enlazado interno (páginas más enlazadas, anclas, huérfanas), enlaces salientes y externos rotos. Con claves: autoridad de dominio, backlinks, dominios de referencia, anclas y lista de backlinks | Rastreo propio · OpenPageRank · DataForSEO |
| **Búsqueda IA** | Acceso de 18 rastreadores de IA según tu robots.txt (distinguiendo entrenamiento, búsqueda y usuario), llms.txt, datos estructurados, entidad (Organization + sameAs), formato pregunta-respuesta, autoría, fechas, contenido dependiente de JavaScript. Con API key de Anthropic: **visibilidad real** de tu marca y tus competidores en respuestas de IA con búsqueda web (menciones, citas, posición y cuota de voz) | Rastreo propio · Claude API |
| **Rendimiento** | Core Web Vitals de usuarios reales (CrUX) y de laboratorio (Lighthouse) en móvil y escritorio, oportunidades de mejora, TTFB de todas las páginas | PageSpeed Insights · Rastreo propio |
| **Técnico** | HTTPS y redirección HTTP→HTTPS, certificado SSL y caducidad, www/sin www, soft 404, cabeceras de seguridad, robots.txt, sitemaps XML, hreflang | Rastreo propio |
| **Competencia** | Tabla comparativa con el mejor valor resaltado, gráfico de puntuaciones, brecha de temas del contenido (te faltan / débiles / compartidos / fuertes / solo tú). Con DataForSEO: brecha de keywords posicionadas y detección automática de competidores orgánicos | Rastreo propio · DataForSEO |

## Claves de API (todas opcionales)

Sin ninguna clave la herramienta funciona con su propio rastreo. Los datos que **solo existen en índices de terceros** (backlinks de otras webs, volúmenes de búsqueda, posiciones en Google) se muestran únicamente si configuras el proveedor correspondiente: la herramienta nunca inventa esas cifras.

| Proveedor | Coste | Para qué | Dónde conseguirla |
|---|---|---|---|
| Google PageSpeed Insights | Gratis | Core Web Vitals (sin clave funciona con cuota muy limitada) | Google Cloud Console → habilitar "PageSpeed Insights API" → Credenciales |
| OpenPageRank | Gratis | Autoridad de dominio (0-10) | openpagerank.com |
| DataForSEO | Pago por uso | Backlinks, dominios de referencia, keywords posicionadas, volúmenes, dificultad, competidores | dataforseo.com (login + password de API) |
| Anthropic | Pago por uso | Visibilidad en respuestas de IA | console.anthropic.com |

Puedes introducirlas en **Ajustes** (se guardan solo en tu navegador y se envían únicamente a tu servidor local) o en un archivo `.env` (copia `.env.example`).

La medición de visibilidad en IA usa por defecto `claude-opus-5-5` con búsqueda web y esfuerzo bajo; en Ajustes puedes elegir `claude-sonnet-5-5`, más económico. Cada consulta se cobra en tu cuenta de Anthropic.

## Opciones avanzadas

- **Páginas máx.**: cuántas URLs rastrear de tu sitio (por defecto 60, hasta 2000) y de cada competidor (por defecto 20).
- **Profundidad máx.** y **peticiones simultáneas**: baja la concurrencia si el servidor es lento o bloquea.
- **Respetar robots.txt**: el rastreador se identifica como `RookySEO` y obedece las reglas de `*`.
- **Mercado**: país e idioma para PageSpeed, sugerencias y DataForSEO.

## Cómo se calculan las puntuaciones

- **Salud del sitio**: cada página parte de 100 y pierde 12 puntos por tipo de error y 4 por tipo de aviso; se promedian todas y se restan 6 puntos por error de sitio (p. ej. sin HTTPS) y 2 por aviso de sitio (p. ej. sin sitemap). Las notas no penalizan.
- **Preparación IA**: media ponderada de las comprobaciones de la pestaña Búsqueda IA (el acceso de los bots de búsqueda IA y el contenido renderizado en HTML pesan más).
- **Puntuación de keyword**: ocurrencias ponderadas por ubicación (título ×6, H1 ×4, URL ×3, H2-H3 y meta description ×2, cuerpo ×1) multiplicadas por (1 + ln nº de páginas donde aparece).

## Desarrollo

```bash
npm test
```

Las pruebas levantan un sitio web de ejemplo local (`fixtures/site.js`) con errores sembrados y comprueban que se detectan todos, además de validar las integraciones externas con respuestas simuladas (no se hace ninguna llamada de pago).

Estructura:

```
server.js            Servidor Express (API + interfaz)
lib/crawler.js       Rastreador BFS con robots.txt y sitemaps
lib/onpage.js        Análisis on-page de cada HTML
lib/keywords.js      Extracción de keywords, intención y brecha
lib/audit.js         Catálogo de comprobaciones y puntuación de salud
lib/technical.js     robots.txt, HTTPS, SSL, www, soft 404, cabeceras
lib/ai.js            Rastreadores IA, llms.txt, preparación y visibilidad en IA
lib/integrations.js  PageSpeed, OpenPageRank, DataForSEO, Google Suggest
lib/analyzer.js      Orquestación del análisis completo y la competencia
public/              Interfaz web (HTML, CSS y JS sin dependencias de build)
```
