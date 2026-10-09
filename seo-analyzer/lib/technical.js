'use strict';

const tls = require('tls');
const crypto = require('crypto');
const { fetchUrl } = require('./http');
const { parseRobots, isAllowed } = require('./robots');

async function checkRobots(origin, opts = {}) {
  const res = await fetchUrl(`${origin}/robots.txt`, { timeout: opts.timeout, userAgent: opts.userAgent, maxBytes: 1024 * 1024 });
  const ct = String(res.headers['content-type'] || '').toLowerCase();
  const looksHtml = /<html|<!doctype/i.test(res.text.slice(0, 300));
  const exists = res.ok && !looksHtml;
  const parsed = parseRobots(exists ? res.text : '');
  const home = isAllowed(parsed, 'googlebot', '/');
  const homeAll = isAllowed(parsed, '*', '/');
  return {
    url: `${origin}/robots.txt`,
    status: res.status,
    error: res.error,
    exists,
    contentType: ct,
    servedAsHtml: res.ok && looksHtml,
    sizeBytes: res.bytes,
    content: exists ? res.text.slice(0, 20000) : '',
    parsed,
    sitemaps: parsed.sitemaps,
    blocksGooglebot: !home.allowed,
    blocksAll: !homeAll.allowed,
    groups: parsed.groups.length,
    invalidLines: parsed.invalidLines,
  };
}

async function checkHttpsRedirect(startUrl, opts) {
  const u = new URL(startUrl);
  const httpUrl = `http://${u.host}/`;
  const res = await fetchUrl(httpUrl, { timeout: opts.timeout, userAgent: opts.userAgent, maxBytes: 200 * 1024 });
  let finalProtocol = null;
  try { finalProtocol = new URL(res.finalUrl).protocol; } catch { /* nada */ }
  return {
    httpUrl,
    status: res.status,
    finalUrl: res.finalUrl,
    error: res.error,
    redirectsToHttps: finalProtocol === 'https:',
    chain: res.redirects,
  };
}

async function checkWwwConsistency(finalUrl, opts) {
  const u = new URL(finalUrl);
  const isLocal = /^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(u.hostname);
  if (isLocal) return { applicable: false };
  const altHost = u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`;
  const altUrl = `${u.protocol}//${altHost}${u.port ? ':' + u.port : ''}/`;
  const res = await fetchUrl(altUrl, { timeout: opts.timeout, userAgent: opts.userAgent, maxBytes: 200 * 1024 });
  let finalHost = null;
  try { finalHost = new URL(res.finalUrl).hostname; } catch { /* nada */ }
  return {
    applicable: true,
    primaryHost: u.hostname,
    altUrl,
    altStatus: res.status,
    altError: res.error,
    altResolves: res.status > 0,
    redirectsToPrimary: finalHost === u.hostname,
    // Problema: ambas versiones responden 200 sin redirigir (contenido duplicado)
    duplicate: res.ok && res.redirects.length === 0 && finalHost !== u.hostname,
  };
}

async function checkSoft404(origin, opts) {
  const path = `/rooky-seo-404-${crypto.randomBytes(6).toString('hex')}`;
  const res = await fetchUrl(origin + path, { timeout: opts.timeout, userAgent: opts.userAgent, maxBytes: 500 * 1024 });
  return {
    testedUrl: origin + path,
    status: res.status,
    error: res.error,
    soft404: res.status >= 200 && res.status < 300,
  };
}

function checkTlsCertificate(hostname, port = 443, timeout = 10000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    try {
      const socket = tls.connect({ host: hostname, port, servername: hostname, rejectUnauthorized: false, timeout }, () => {
        const cert = socket.getPeerCertificate();
        const authorized = socket.authorized;
        const authError = socket.authorizationError ? String(socket.authorizationError) : null;
        socket.end();
        if (!cert || !cert.valid_to) return finish({ checked: false, error: 'No se obtuvo certificado' });
        const validTo = new Date(cert.valid_to);
        const daysLeft = Math.floor((validTo - Date.now()) / 86400000);
        finish({
          checked: true,
          valid: authorized,
          error: authError,
          issuer: cert.issuer ? cert.issuer.O || cert.issuer.CN : null,
          subject: cert.subject ? cert.subject.CN : null,
          validFrom: new Date(cert.valid_from).toISOString(),
          validTo: validTo.toISOString(),
          daysLeft,
          protocol: socket.getProtocol ? socket.getProtocol() : null,
        });
      });
      socket.on('timeout', () => {
        socket.destroy();
        finish({ checked: false, error: 'Tiempo de espera agotado' });
      });
      socket.on('error', (err) => finish({ checked: false, error: err.message }));
    } catch (err) {
      finish({ checked: false, error: err.message });
    }
  });
}

function securityHeaders(headers = {}) {
  const list = [
    { key: 'strict-transport-security', name: 'HSTS (Strict-Transport-Security)' },
    { key: 'content-security-policy', name: 'Content-Security-Policy' },
    { key: 'x-content-type-options', name: 'X-Content-Type-Options' },
    { key: 'x-frame-options', name: 'X-Frame-Options' },
    { key: 'referrer-policy', name: 'Referrer-Policy' },
    { key: 'permissions-policy', name: 'Permissions-Policy' },
  ];
  return list.map((h) => ({ ...h, present: headers[h.key] !== undefined, value: headers[h.key] || null }));
}

module.exports = {
  checkRobots,
  checkHttpsRedirect,
  checkWwwConsistency,
  checkSoft404,
  checkTlsCertificate,
  securityHeaders,
};
