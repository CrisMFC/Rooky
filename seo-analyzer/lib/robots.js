'use strict';

/**
 * Parser de robots.txt según RFC 9309 (el estándar que sigue Google):
 * - Los grupos se forman con líneas user-agent consecutivas.
 * - Grupos con el mismo user-agent se combinan.
 * - Gana la regla con el patrón más largo; en empate gana "allow".
 * - Soporta comodines "*" y el ancla "$".
 */
function parseRobots(text) {
  const groups = []; // { agents: [], rules: [{type, path}] }
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  const lines = String(text || '').split(/\r?\n/);
  let invalidLines = 0;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) {
      invalidLines++;
      continue;
    }
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'user-agent') {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    if (key === 'allow' || key === 'disallow') {
      if (!current) {
        invalidLines++;
        continue;
      }
      if (value === '') continue; // "Disallow:" vacío = no hay restricción
      current.rules.push({ type: key, path: value });
      continue;
    }
    // crawl-delay, host, etc. se ignoran (no estándar)
  }

  return { groups, sitemaps, invalidLines };
}

function rulesForAgent(parsed, userAgent) {
  const ua = String(userAgent || '*').toLowerCase();
  const specific = parsed.groups.filter((g) => g.agents.includes(ua));
  if (specific.length) {
    return { matchedAgent: ua, rules: specific.flatMap((g) => g.rules) };
  }
  const star = parsed.groups.filter((g) => g.agents.includes('*'));
  if (star.length) return { matchedAgent: '*', rules: star.flatMap((g) => g.rules) };
  return { matchedAgent: null, rules: [] };
}

function patternToRegex(pattern) {
  let anchored = false;
  let p = pattern;
  if (p.endsWith('$')) {
    anchored = true;
    p = p.slice(0, -1);
  }
  const escaped = p
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + escaped + (anchored ? '$' : ''));
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Devuelve si `pathWithQuery` está permitido para `userAgent`.
 */
function isAllowed(parsed, userAgent, pathWithQuery) {
  const { rules, matchedAgent } = rulesForAgent(parsed, userAgent);
  const path = pathWithQuery || '/';
  let best = null;
  for (const rule of rules) {
    const re = patternToRegex(rule.path);
    if (re.test(path) || re.test(safeDecode(path))) {
      const len = rule.path.length;
      if (!best || len > best.len || (len === best.len && rule.type === 'allow')) {
        best = { len, type: rule.type, rule };
      }
    }
  }
  return {
    allowed: !best || best.type === 'allow',
    matchedAgent,
    rule: best ? `${best.rule.type === 'allow' ? 'Allow' : 'Disallow'}: ${best.rule.path}` : null,
  };
}

module.exports = { parseRobots, isAllowed, rulesForAgent };
