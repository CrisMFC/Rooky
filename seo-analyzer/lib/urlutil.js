'use strict';

const SKIP_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp', 'tif', 'tiff',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'csv',
  'zip', 'rar', 'gz', 'tgz', '7z', 'tar', 'exe', 'dmg', 'apk', 'msi',
  'mp3', 'mp4', 'wav', 'avi', 'mov', 'webm', 'ogg', 'm4a', 'flv', 'wmv',
  'css', 'js', 'mjs', 'json', 'woff', 'woff2', 'ttf', 'eot', 'otf', 'map', 'txt', 'xml', 'rss',
]);

/** Normaliza la entrada del usuario a una URL absoluta http(s). */
function normalizeInputUrl(input) {
  if (!input || typeof input !== 'string') throw new Error('URL vacía');
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  const u = new URL(s);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Solo se admiten URLs http/https');
  if (!u.hostname.includes('.') && u.hostname !== 'localhost' && !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) {
    throw new Error(`Dominio no válido: ${u.hostname}`);
  }
  u.hash = '';
  if (!u.pathname) u.pathname = '/';
  return u.toString();
}

/** Normaliza una URL para deduplicar (sin hash, host en minúsculas, sin puerto por defecto). */
function canonicalizeUrl(href, base) {
  let u;
  try {
    u = new URL(href, base);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(u.protocol)) return null;
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';
  // Ordenar parámetros no es seguro en general; solo quitamos "?" vacío.
  if (u.search === '?') u.search = '';
  return u.toString();
}

/** Host sin "www." para comparar si dos URLs son del mismo sitio. */
function bareHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

function isSameSite(urlA, urlB) {
  try {
    return bareHost(new URL(urlA).hostname) === bareHost(new URL(urlB).hostname);
  } catch {
    return false;
  }
}

function hasSkippedExtension(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const m = path.match(/\.([a-z0-9]{1,5})$/);
    return !!(m && SKIP_EXTENSIONS.has(m[1]));
  } catch {
    return true;
  }
}

/** Dominio "registrable" aproximado para mostrar (sin www). */
function displayDomain(url) {
  try {
    return bareHost(new URL(url).hostname);
  } catch {
    return String(url);
  }
}

function originOf(url) {
  return new URL(url).origin;
}

module.exports = {
  normalizeInputUrl,
  canonicalizeUrl,
  bareHost,
  isSameSite,
  hasSkippedExtension,
  displayDomain,
  originOf,
};
