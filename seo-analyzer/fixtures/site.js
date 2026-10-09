'use strict';

const http = require('http');

const LONG_ES = (topic) =>
  Array.from({ length: 12 }, (_, i) =>
    `<p>El ${topic} es una disciplina clave para cualquier negocio que quiera crecer en internet. ` +
    `En esta sección ${i + 1} explicamos cómo aplicar el ${topic} paso a paso, con ejemplos prácticos, ` +
    `herramientas recomendadas y errores habituales que conviene evitar. Una buena estrategia de ${topic} ` +
    `combina contenido útil, enlaces de calidad y una base técnica sólida.</p>`).join('\n');

function page({ title, desc, h1, body, extraHead = '', lang = 'es' }) {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${title !== null ? `<title>${title}</title>` : ''}
${desc ? `<meta name="description" content="${desc}">` : ''}
<link rel="icon" href="/favicon.ico">
${extraHead}
</head><body>
<nav><a href="/">Inicio</a> <a href="/servicios/seo-local">SEO local</a> <a href="/blog/que-es-el-seo">Blog</a> <a href="/contacto">Contacto</a></nav>
<main>${h1 ? `<h1>${h1}</h1>` : ''}${body}</main>
<footer><a href="https://externo.invalid/pagina">Enlace externo roto</a> <a href="https://partner.example.org/" rel="nofollow">Partner</a></footer>
</body></html>`;
}

const ORG_SCHEMA = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Agencia Rooky","url":"http://localhost","sameAs":["https://www.linkedin.com/company/rooky"]}</script>`;

function routes(base) {
  return {
    '/': () => [200, 'text/html', page({
      title: 'Agencia Rooky | Consultoría de marketing digital y SEO',
      desc: 'Agencia de marketing digital especializada en SEO, SEO local y posicionamiento web para pymes. Pide tu auditoría gratuita.',
      h1: 'Consultoría de marketing digital y SEO',
      extraHead: ORG_SCHEMA + `<meta property="og:title" content="Agencia Rooky"><meta property="og:image" content="${base}/og.png"><meta property="og:site_name" content="Rooky">`,
      body: `<h2>¿Qué es el posicionamiento web?</h2>${LONG_ES('posicionamiento web')}<ul><li>SEO técnico</li><li>SEO local</li></ul>
<a href="/servicios/seo-local">Servicio de SEO local</a> <a href="/pagina-rota">Página rota</a> <a href="/redir-1">Redirección</a>
<a href="/duplicada-a">Dup A</a> <a href="/duplicada-b">Dup B</a> <a href="/privado/secreto">Privado</a> <a href="/noindex">No index</a>
<img src="/img/logo.png"><img src="/img/equipo.png" alt="Equipo de Rooky" width="10" height="10">`,
    })],
    '/servicios/seo-local': () => [200, 'text/html', page({
      title: 'SEO local para negocios | Agencia Rooky',
      desc: 'Servicio de SEO local: Google Business Profile, reseñas y citas locales para aparecer en el mapa.',
      h1: 'SEO local para negocios',
      extraHead: `<link rel="canonical" href="${base}/servicios/seo-local">`,
      body: `<h2>¿Cómo funciona el SEO local?</h2>${LONG_ES('seo local')}<a href="/servicios/seo-local/precios">Precios</a>`,
    })],
    '/servicios/seo-local/precios': () => [200, 'text/html', page({
      title: 'Precios',
      desc: 'Precios del servicio.',
      h1: 'Precios del SEO local',
      body: '<p>Contenido muy corto sobre precios.</p><h4>Salto de nivel</h4>',
    })],
    '/blog/que-es-el-seo': () => [200, 'text/html', page({
      title: 'Qué es el SEO: guía completa para principiantes | Agencia Rooky',
      desc: 'Guía completa sobre qué es el SEO, cómo funciona y por qué es importante para tu negocio en internet.',
      h1: 'Qué es el SEO',
      extraHead: '<meta name="author" content="Ana Pérez"><meta property="article:published_time" content="2026-01-10"><script type="application/ld+json">{ "@type": "Article", invalid json }</script>',
      body: `<h2>¿Por qué es importante el SEO?</h2>${LONG_ES('seo')}<table><tr><td>a</td></tr></table>`,
    })],
    '/contacto': () => [200, 'text/html', page({ title: null, desc: '', h1: '', body: '<p>Escríbenos a hola@rooky.test</p>' })],
    '/duplicada-a': () => [200, 'text/html', page({ title: 'Página duplicada de prueba', desc: 'Descripción duplicada para la prueba de contenido.', h1: 'Duplicada', body: '<p>Texto A.</p>' })],
    '/duplicada-b': () => [200, 'text/html', page({ title: 'Página duplicada de prueba', desc: 'Descripción duplicada para la prueba de contenido.', h1: 'Duplicada', body: '<p>Texto B.</p>' })],
    '/noindex': () => [200, 'text/html', page({ title: 'Página sin indexar de prueba', desc: 'x', h1: 'No index', body: '<p>.</p>', extraHead: '<meta name="robots" content="noindex, follow">' })],
    '/privado/secreto': () => [200, 'text/html', page({ title: 'Privado', desc: '', h1: 'Privado', body: '' })],
    '/redir-1': () => [301, null, null, '/redir-2'],
    '/redir-2': () => [302, null, null, '/servicios/seo-local'],
    '/huerfana': () => [200, 'text/html', page({ title: 'Página huérfana solo en el sitemap', desc: 'Página que solo aparece en el sitemap y no está enlazada.', h1: 'Huérfana', body: LONG_ES('marketing') })],
    '/robots.txt': () => [200, 'text/plain', `User-agent: *\nDisallow: /privado/\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow: /\n\nSitemap: ${base}/sitemap.xml\n`],
    '/sitemap.xml': () => [200, 'application/xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${base}/</loc><lastmod>2026-01-01</lastmod></url>
<url><loc>${base}/servicios/seo-local</loc></url>
<url><loc>${base}/huerfana</loc></url>
<url><loc>${base}/pagina-rota</loc></url>
</urlset>`],
  };
}

function startFixture() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const base = `http://localhost:${server.address().port}`;
      const path = new URL(req.url, base).pathname;
      const r = routes(base)[path];
      if (!r) {
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end('<html><body><h1>No encontrado</h1></body></html>');
        return;
      }
      const [status, type, body, location] = r();
      if (location) {
        res.writeHead(status, { location });
        res.end();
        return;
      }
      res.writeHead(status, { 'content-type': `${type}; charset=utf-8` });
      res.end(req.method === 'HEAD' ? undefined : body);
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://localhost:${server.address().port}` });
    });
  });
}

module.exports = { startFixture };

if (require.main === module) {
  startFixture().then(({ base }) => console.log(`Sitio de prueba en ${base}`));
}
