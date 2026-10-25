'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const POLICY_DENIALS = [
  /\bERR_BLOCKED_BY_ADMINISTRATOR\b/i,
  /\bERR_BLOCKED_BY_CLIENT\b/i,
  /\bERR_ACCESS_DENIED\b/i,
  /\bERR_BLOCKED_BY_RESPONSE\b/i,
  /\bERR_DISALLOWED_URL_SCHEME\b/i,
  /\bERR_CLEARTEXT_NOT_PERMITTED\b/i,
  /\bERR_CERT_[A-Z0-9_]+\b/i,
  /\b(?:blocked|denied|refused)\s+by\s+(?:an?\s+)?(?:administrator|admin|policy|security)\b/i,
  /\b(?:CORS|content security policy)\b.*\b(?:blocked|denied|refused)\b/i,
  /\b(?:blocked|denied|refused)\b.*\b(?:CORS|content security policy)\b/i,
];
const ORDINARY_FILE_UNSUPPORTED = [
  /\bERR_UNKNOWN_URL_SCHEME\b/i,
  /\bERR_NOT_IMPLEMENTED\b/i,
  /\bunsupported\s+(?:file(?: URL)?\s+)?(?:URL\s+)?(?:scheme|protocol|file navigation)\b/i,
  /\bfile(?: URL)?\s+(?:scheme|protocol|navigation)\s+(?:is\s+)?not supported\b/i,
];
const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
});

function asText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.message === 'string') return value.message;
  return value == null ? '' : String(value);
}

function classifyFileNavigationFailure(error) {
  const message = asText(error);
  if (!message) return 'other';
  if (POLICY_DENIALS.some((pattern) => pattern.test(message))) return 'policy-security-denial';
  if (ORDINARY_FILE_UNSUPPORTED.some((pattern) => pattern.test(message))) return 'ordinary-unsupported-file';
  return 'other';
}

function policyDenialEvidence(result) {
  const messages = [
    result && result.navigationError,
    result && result.error,
    ...((result && result.consoleErrorText) || []),
    ...((result && result.requestFailures) || []),
  ];
  return messages.map(asText).find((message) =>
    classifyFileNavigationFailure(message) === 'policy-security-denial') || null;
}

function createStaticHandler(root = ROOT, readFile = fs.readFile) {
  const base = path.resolve(root);
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      res.end();
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname);
    } catch (_) {
      res.writeHead(400);
      res.end();
      return;
    }
    if (pathname === '/') pathname = '/index.html';
    const target = path.resolve(base, `.${pathname}`);
    const relative = path.relative(base, target);
    const parts = relative.split(path.sep);
    if (relative.startsWith('..') || path.isAbsolute(relative) || parts.some((part) => part.startsWith('.'))) {
      res.writeHead(404);
      res.end();
      return;
    }

    readFile(target, (error, content) => {
      if (error) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        'content-type': MIME_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : content);
    });
  };
}

function listenOnOwnedPort(server, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, port) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(port);
    };
    const timer = setTimeout(() => finish(new Error('loopback server listen timed out')), timeoutMs);
    server.once('error', (error) => finish(error));
    server.once('listening', () => {
      const address = server.address();
      if (!address || typeof address === 'string' || !Number.isInteger(address.port)) {
        finish(new Error('loopback server did not report an owned TCP port'));
      } else {
        finish(null, address.port);
      }
    });
    try {
      server.listen(0, '127.0.0.1');
    } catch (error) {
      finish(error);
    }
  });
}

function verifyOwnedIndex(httpGet, port, expectedIndex, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      if (request) request.destroy();
      finish(new Error('loopback index readiness probe timed out'));
    }, timeoutMs);

    try {
      request = httpGet({ hostname: '127.0.0.1', port, path: '/index.html' }, (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > expectedIndex.length) {
            finish(new Error('loopback readiness returned unexpected index content length'));
            if (request) request.destroy();
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        response.on('error', finish);
        response.on('end', () => {
          const contentType = String((response.headers && response.headers['content-type']) || '');
          const body = Buffer.concat(chunks);
          if (response.statusCode !== 200) {
            finish(new Error(`loopback readiness status ${response.statusCode}`));
          } else if (!contentType.toLowerCase().startsWith('text/html')) {
            finish(new Error(`loopback readiness content-type ${contentType || '(missing)'}`));
          } else if (!body.equals(expectedIndex)) {
            finish(new Error('loopback readiness content did not match this checkout index.html'));
          } else {
            finish(null);
          }
        });
      });
      if (request && typeof request.setTimeout === 'function') {
        request.setTimeout(timeoutMs, () => request.destroy(new Error('loopback readiness probe timed out')));
      }
      request.on('error', finish);
    } catch (error) {
      finish(error);
    }
  });
}

function closeServer(server, timeoutMs = 1500) {
  if (!server || typeof server.close !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      finish();
    }, timeoutMs);
    try {
      server.close(finish);
    } catch (_) {
      finish();
    }
  });
}

async function startHttpServer(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const indexPath = path.join(root, 'index.html');
  const expectedIndex = options.expectedIndex ? Buffer.from(options.expectedIndex) : fs.readFileSync(indexPath);
  const createServer = options.createServer || http.createServer;
  const httpGet = options.httpGet || http.get;
  const server = createServer(createStaticHandler(root, options.readFile || fs.readFile));
  server.requestTimeout = options.requestTimeoutMs || 3000;
  server.headersTimeout = options.headersTimeoutMs || 4000;
  server.keepAliveTimeout = options.keepAliveTimeoutMs || 500;

  try {
    const port = await listenOnOwnedPort(server, options.listenTimeoutMs || 8000);
    await verifyOwnedIndex(httpGet, port, expectedIndex, options.probeTimeoutMs || 1500);
    return { server, port };
  } catch (error) {
    await closeServer(server, options.closeTimeoutMs || 250);
    throw error;
  }
}

async function stopHttpServer(serverInfo, timeoutMs = 1500) {
  return closeServer(serverInfo && serverInfo.server, timeoutMs);
}

async function runFileViewportWithFallback({ pw, viewport, fileUrl, testViewport, getHttpServer }) {
  const fileResult = await testViewport(pw, viewport, fileUrl, true);
  const policyDenial = policyDenialEvidence(fileResult);
  if (policyDenial) {
    return { ...fileResult, policyDenied: true, policyDenial, fallbackAttempted: false };
  }
  if (fileResult.boot) return fileResult;

  if (classifyFileNavigationFailure(fileResult.navigationError) !== 'ordinary-unsupported-file') {
    return { ...fileResult, fallbackAttempted: false };
  }

  let filePath;
  let fileLocation;
  try {
    fileLocation = new URL(fileUrl);
    if (fileLocation.protocol !== 'file:') throw new Error('fallback is only valid for file URLs');
    filePath = path.relative(ROOT, fileURLToPath(fileLocation));
  } catch (error) {
    return { ...fileResult, fallbackAttempted: false, fallbackSkippedReason: String(error.message || error) };
  }
  if (!filePath || filePath.startsWith('..') || path.isAbsolute(filePath)) {
    return { ...fileResult, fallbackAttempted: false, fallbackSkippedReason: 'file URL is outside the served checkout' };
  }

  const server = await getHttpServer();
  const pathname = filePath.split(path.sep).map(encodeURIComponent).join('/');
  const httpUrl = `http://127.0.0.1:${server.port}/${pathname}${fileLocation.search}${fileLocation.hash}`;
  const result = await testViewport(pw, viewport, httpUrl, false);
  const fallbackPolicyDenial = policyDenialEvidence(result);
  if (fallbackPolicyDenial) {
    return {
      ...result,
      httpFallback: true,
      fallbackReason: fileResult.navigationError,
      fallbackAttempted: true,
      policyDenied: true,
      policyDenial: fallbackPolicyDenial,
    };
  }
  return { ...result, httpFallback: true, fallbackReason: fileResult.navigationError };
}

async function runViewportSequence(viewports, runViewport, onResult = async () => {}) {
  const results = [];
  for (let i = 0; i < viewports.length; i++) {
    const viewport = viewports[i];
    const result = await runViewport(viewport, i);
    results.push(result);
    await onResult(result, viewport, i);
    if (result.policyDenied) {
      for (const skipped of viewports.slice(i + 1)) {
        results.push({
          viewport: skipped.name,
          urlKind: 'not attempted',
          boot: false,
          consoleErrors: 0,
          skipped: true,
          error: `not attempted after policy/security denial on ${viewport.name}`,
        });
      }
      break;
    }
  }
  return results;
}

module.exports = {
  classifyFileNavigationFailure,
  createStaticHandler,
  policyDenialEvidence,
  runFileViewportWithFallback,
  runViewportSequence,
  startHttpServer,
  stopHttpServer,
};
