'use strict';

const zlib = require('zlib');

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 RookySEO/1.0';

const MAX_REDIRECTS = 10;

/**
 * Lee el cuerpo de una respuesta con un límite de bytes para no agotar memoria.
 */
async function readBody(res, maxBytes) {
  if (!res.body) return { buffer: Buffer.alloc(0), truncated: false };
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      truncated = true;
      chunks.push(Buffer.from(value.subarray(0, value.byteLength - (total - maxBytes))));
      try { await reader.cancel(); } catch { /* ignorar */ }
      break;
    }
    chunks.push(Buffer.from(value));
  }
  return { buffer: Buffer.concat(chunks), truncated };
}

function headersToObject(headers) {
  const out = {};
  for (const [k, v] of headers.entries()) out[k.toLowerCase()] = v;
  return out;
}

/**
 * Descarga una URL siguiendo redirecciones manualmente para registrar la cadena.
 * Nunca lanza: los errores de red se devuelven en `error`.
 */
async function fetchUrl(url, opts = {}) {
  const {
    method = 'GET',
    timeout = 20000,
    maxBytes = 5 * 1024 * 1024,
    userAgent = DEFAULT_UA,
    headers = {},
    body,
    followRedirects = true,
    readBodyContent = true,
  } = opts;

  const redirects = [];
  let current = url;
  const started = Date.now();
  let ttfb = null;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let res;
    try {
      res = await fetch(current, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        body,
        headers: {
          'user-agent': userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
          'accept-language': 'es-ES,es;q=0.9,en;q=0.8',
          ...headers,
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const reason = err.name === 'AbortError' ? `Tiempo de espera agotado (${timeout} ms)` : describeNetworkError(err);
      return {
        url,
        finalUrl: current,
        status: 0,
        ok: false,
        headers: {},
        redirects,
        timeMs: Date.now() - started,
        ttfbMs: ttfb,
        error: reason,
        buffer: Buffer.alloc(0),
        text: '',
        bytes: 0,
      };
    }
    if (ttfb === null) ttfb = Date.now() - started;

    const location = res.headers.get('location');
    if (followRedirects && res.status >= 300 && res.status < 400 && location) {
      let next;
      try {
        next = new URL(location, current).toString();
      } catch {
        clearTimeout(timer);
        return errorResult(url, current, res, redirects, started, ttfb, `Cabecera Location inválida: ${location}`);
      }
      redirects.push({ url: current, status: res.status, location: next });
      clearTimeout(timer);
      try { await res.body?.cancel(); } catch { /* ignorar */ }
      if (redirects.some((r, idx) => idx < redirects.length - 1 && r.url === next) || next === current) {
        return errorResult(url, next, res, redirects, started, ttfb, 'Bucle de redirecciones');
      }
      current = next;
      continue;
    }

    let buffer = Buffer.alloc(0);
    let truncated = false;
    try {
      if (readBodyContent && method !== 'HEAD') {
        ({ buffer, truncated } = await readBody(res, maxBytes));
      } else {
        try { await res.body?.cancel(); } catch { /* ignorar */ }
      }
    } catch (err) {
      clearTimeout(timer);
      return errorResult(url, current, res, redirects, started, ttfb,
        err.name === 'AbortError' ? `Tiempo de espera agotado (${timeout} ms)` : `Error leyendo la respuesta: ${err.message}`);
    }
    clearTimeout(timer);

    // Ficheros .gz servidos sin Content-Encoding (p. ej. sitemap.xml.gz)
    if (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
      try { buffer = zlib.gunzipSync(buffer); } catch { /* dejar tal cual */ }
    }

    return {
      url,
      finalUrl: current,
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      headers: headersToObject(res.headers),
      redirects,
      timeMs: Date.now() - started,
      ttfbMs: ttfb,
      error: null,
      buffer,
      text: buffer.toString('utf8'),
      bytes: buffer.length,
      truncated,
    };
  }

  return {
    url,
    finalUrl: current,
    status: 0,
    ok: false,
    headers: {},
    redirects,
    timeMs: Date.now() - started,
    ttfbMs: ttfb,
    error: `Demasiadas redirecciones (>${MAX_REDIRECTS})`,
    buffer: Buffer.alloc(0),
    text: '',
    bytes: 0,
  };
}

function errorResult(url, current, res, redirects, started, ttfb, error) {
  return {
    url,
    finalUrl: current,
    status: res ? res.status : 0,
    ok: false,
    headers: res ? headersToObject(res.headers) : {},
    redirects,
    timeMs: Date.now() - started,
    ttfbMs: ttfb,
    error,
    buffer: Buffer.alloc(0),
    text: '',
    bytes: 0,
  };
}

function describeNetworkError(err) {
  const cause = err && err.cause;
  const code = cause && (cause.code || cause.errno);
  const map = {
    ENOTFOUND: 'Dominio no encontrado (DNS)',
    EAI_AGAIN: 'Fallo temporal de DNS',
    ECONNREFUSED: 'Conexión rechazada',
    ECONNRESET: 'Conexión reiniciada por el servidor',
    ETIMEDOUT: 'Tiempo de conexión agotado',
    CERT_HAS_EXPIRED: 'Certificado SSL caducado',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'Certificado SSL autofirmado',
    ERR_TLS_CERT_ALTNAME_INVALID: 'El certificado SSL no corresponde al dominio',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'No se pudo verificar el certificado SSL',
  };
  if (code && map[code]) return `${map[code]} (${code})`;
  if (code) return `Error de red (${code})`;
  return `Error de red: ${err.message}`;
}

/**
 * Ejecuta tareas asíncronas con un límite de concurrencia, conservando el orden.
 */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

module.exports = { fetchUrl, mapLimit, DEFAULT_UA };
