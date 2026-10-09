'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRobots, isAllowed } = require('../lib/robots');

const TXT = `
# comentario
User-agent: *
Disallow: /admin/
Allow: /admin/publico
Disallow: /*.pdf$
Disallow: /buscar?

User-agent: GPTBot
User-agent: CCBot
Disallow: /

User-agent: Googlebot
Disallow:

Sitemap: https://ejemplo.com/sitemap.xml
`;

test('agrupa user-agents consecutivos y lee sitemaps', () => {
  const p = parseRobots(TXT);
  assert.equal(p.groups.length, 3);
  assert.deepEqual(p.groups[1].agents, ['gptbot', 'ccbot']);
  assert.deepEqual(p.sitemaps, ['https://ejemplo.com/sitemap.xml']);
});

test('aplica la regla más larga y allow en empate', () => {
  const p = parseRobots(TXT);
  assert.equal(isAllowed(p, 'rookyseo', '/admin/x').allowed, false);
  assert.equal(isAllowed(p, 'rookyseo', '/admin/publico/a').allowed, true);
  assert.equal(isAllowed(p, 'rookyseo', '/docs/a.pdf').allowed, false);
  assert.equal(isAllowed(p, 'rookyseo', '/docs/a.pdf?x=1').allowed, true);
  assert.equal(isAllowed(p, 'rookyseo', '/buscar?q=1').allowed, false);
  assert.equal(isAllowed(p, 'rookyseo', '/').allowed, true);
});

test('grupos específicos tienen prioridad sobre *', () => {
  const p = parseRobots(TXT);
  assert.equal(isAllowed(p, 'gptbot', '/').allowed, false);
  assert.equal(isAllowed(p, 'ccbot', '/blog').allowed, false);
  // Googlebot tiene grupo propio con Disallow vacío: todo permitido (incluido /admin/)
  assert.equal(isAllowed(p, 'googlebot', '/admin/x').allowed, true);
});

test('robots vacío permite todo', () => {
  const p = parseRobots('');
  assert.equal(isAllowed(p, '*', '/cualquier').allowed, true);
});
