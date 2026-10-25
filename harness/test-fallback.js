#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  classifyFileNavigationFailure,
  createStaticHandler,
  runFileViewportWithFallback,
  runViewportSequence,
  startHttpServer,
  stopHttpServer,
} = require('./fallback');

let checks = 0;
function equal(actual, expected, message) { checks++; assert.equal(actual, expected, message); }
function deepEqual(actual, expected, message) { checks++; assert.deepEqual(actual, expected, message); }
function rejects(promise, pattern, message) { checks++; return assert.rejects(promise, pattern, message); }

for (const denial of [
  'net::ERR_BLOCKED_BY_ADMINISTRATOR',
  'net::ERR_BLOCKED_BY_CLIENT',
  'net::ERR_ACCESS_DENIED',
  'net::ERR_BLOCKED_BY_RESPONSE',
  'net::ERR_DISALLOWED_URL_SCHEME',
  'net::ERR_CLEARTEXT_NOT_PERMITTED',
  'net::ERR_CERT_AUTHORITY_INVALID',
  'Navigation blocked by security policy',
  'Access to script was blocked by CORS policy',
]) {
  equal(classifyFileNavigationFailure(denial), 'policy-security-denial', `${denial} is fail-closed`);
}
equal(classifyFileNavigationFailure('net::ERR_UNKNOWN_URL_SCHEME'), 'ordinary-unsupported-file',
  'unknown scheme is an explicitly supported ordinary fallback case');
equal(classifyFileNavigationFailure('net::ERR_NOT_IMPLEMENTED'), 'ordinary-unsupported-file',
  'unsupported file navigation remains eligible for fallback');
equal(classifyFileNavigationFailure('net::ERR_FAILED'), 'other',
  'ambiguous navigation failures do not trigger protocol switching');
equal(classifyFileNavigationFailure('net::ERR_FILE_NOT_FOUND'), 'other',
  'missing files do not trigger a retry through another protocol');

const pw = {};
const viewport = { name: 'offline-fixture', width: 1, height: 1 };
const fileUrl = `${pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href}?seed=7`;

async function assertNoFallbackFor(result, label) {
  const navigations = [];
  let serverStarts = 0;
  const output = await runFileViewportWithFallback({
    pw, viewport, fileUrl,
    testViewport: async (_pw, _viewport, url, viaFile) => {
      navigations.push({ url, viaFile });
      return result;
    },
    getHttpServer: async () => { serverStarts++; return { port: 45678 }; },
  });
  deepEqual(navigations, [{ url: fileUrl, viaFile: true }], `${label}: exactly one file navigation`);
  equal(serverStarts, 0, `${label}: server is never started`);
  equal(output.httpFallback, undefined, `${label}: no HTTP route is attempted`);
  equal(output.fallbackAttempted, false, `${label}: fallback is explicitly skipped`);
  return output;
}

async function testFallbackControlFlow() {
  const adminError = 'page.goto: net::ERR_BLOCKED_BY_ADMINISTRATOR at file:///repo/index.html';
  const denied = await assertNoFallbackFor({
    boot: false, error: `navigation failed: ${adminError}`, navigationError: adminError,
    consoleErrors: 0, consoleErrorText: [], requestFailures: [],
  }, 'administrator denial');
  equal(denied.policyDenied, true, 'administrator denial is marked explicitly');
  equal(denied.policyDenial, adminError, 'original denial text is retained');

  const subresourceDenial = await assertNoFallbackFor({
    boot: false, error: 'boot flag never set: timeout', navigationError: null,
    consoleErrors: 1, consoleErrorText: ['Access blocked by Content Security Policy'], requestFailures: [],
  }, 'subresource policy denial');
  equal(subresourceDenial.policyDenied, true, 'policy denial in page errors also stops fallback');

  const ambiguous = await assertNoFallbackFor({
    boot: false, error: 'navigation failed: net::ERR_FAILED', navigationError: 'net::ERR_FAILED',
  }, 'ambiguous navigation failure');
  equal(ambiguous.policyDenied, undefined, 'ambiguous failures are not mislabeled as policy denials');

  const bootTimeout = await assertNoFallbackFor({
    boot: false, error: 'boot flag never set: timeout', navigationError: null,
  }, 'application boot timeout');
  equal(bootTimeout.policyDenied, undefined, 'application failures are reported without rerouting');

  const calls = [];
  let starts = 0;
  const ordinaryError = 'page.goto: net::ERR_UNKNOWN_URL_SCHEME at file:///repo/index.html';
  const ordinary = await runFileViewportWithFallback({
    pw, viewport, fileUrl,
    testViewport: async (_pw, _viewport, url, viaFile) => {
      calls.push({ url, viaFile });
      return calls.length === 1
        ? { boot: false, navigationError: ordinaryError, error: `navigation failed: ${ordinaryError}` }
        : { boot: true, consoleErrors: 0 };
    },
    getHttpServer: async () => { starts++; return { port: 45678 }; },
  });
  deepEqual(calls, [
    { url: fileUrl, viaFile: true },
    { url: 'http://127.0.0.1:45678/index.html?seed=7', viaFile: false },
  ], 'only recognized ordinary unsupported-file errors use the documented HTTP fallback');
  equal(starts, 1, 'ordinary fallback starts exactly one server');
  equal(ordinary.httpFallback, true, 'ordinary fallback remains recorded');
  equal(ordinary.fallbackReason, ordinaryError, 'ordinary fallback preserves its original reason');

  let successfulStarts = 0;
  const successfulFile = await runFileViewportWithFallback({
    pw, viewport, fileUrl,
    testViewport: async () => ({ boot: true, consoleErrors: 0 }),
    getHttpServer: async () => { successfulStarts++; return { port: 45678 }; },
  });
  equal(successfulFile.boot, true, 'working file navigation is kept');
  equal(successfulStarts, 0, 'working file navigation does not start a server');
}

async function testPolicyDenialStopsAllViewports() {
  const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ];
  const adminDenial = 'net::ERR_BLOCKED_BY_ADMINISTRATOR';

  const bootAndDenialNavigations = [];
  const bootAndDenialViewports = [];
  let bootAndDenialServerStarts = 0;
  const bootAndDenialResults = await runViewportSequence(viewports, async (vp) => {
    bootAndDenialViewports.push(vp.name);
    return runFileViewportWithFallback({
      pw, viewport: vp, fileUrl,
      testViewport: async (_pw, _vp, url, viaFile) => {
        bootAndDenialNavigations.push({ viewport: vp.name, url, viaFile });
        return {
          boot: true,
          consoleErrors: 0,
          requestFailures: [`${url}: ${adminDenial}`],
        };
      },
      getHttpServer: async () => { bootAndDenialServerStarts++; return { port: 45678 }; },
    });
  });
  deepEqual(bootAndDenialViewports, ['desktop'], 'boot plus denial stops before another viewport starts');
  deepEqual(bootAndDenialNavigations, [{ viewport: 'desktop', url: fileUrl, viaFile: true }],
    'contradictory boot plus file denial performs no fallback or second viewport navigation');
  equal(bootAndDenialServerStarts, 0, 'contradictory boot plus denial never starts the fallback server');
  equal(bootAndDenialResults[0].policyDenied, true, 'denial outranks a contradictory successful boot flag');
  equal(bootAndDenialResults[1].skipped, true, 'later viewport is explicitly marked skipped');

  const httpDenialNavigations = [];
  const httpDenialViewports = [];
  let httpDenialServerStarts = 0;
  const httpDenialResults = await runViewportSequence(viewports, async (vp) => {
    httpDenialViewports.push(vp.name);
    return runFileViewportWithFallback({
      pw, viewport: vp, fileUrl,
      testViewport: async (_pw, _vp, url, viaFile) => {
        httpDenialNavigations.push({ viewport: vp.name, url, viaFile });
        return viaFile
          ? { boot: false, navigationError: 'net::ERR_UNKNOWN_URL_SCHEME', error: 'unsupported file transport' }
          : { boot: true, consoleErrors: 0, consoleErrorText: [`resource blocked by security policy: ${adminDenial}`] };
      },
      getHttpServer: async () => { httpDenialServerStarts++; return { port: 45678 }; },
    });
  });
  deepEqual(httpDenialViewports, ['desktop'], 'HTTP policy denial stops before another viewport starts');
  deepEqual(httpDenialNavigations, [
    { viewport: 'desktop', url: fileUrl, viaFile: true },
    { viewport: 'desktop', url: 'http://127.0.0.1:45678/index.html?seed=7', viaFile: false },
  ], 'HTTP denial is classified and no later viewport is navigated');
  equal(httpDenialServerStarts, 1, 'eligible unsupported-file result starts only its one local server');
  equal(httpDenialResults[0].policyDenied, true, 'HTTP policy evidence marks the entire run denied');
  equal(httpDenialResults[0].policyDenial.includes(adminDenial), true,
    'HTTP policy denial retains the original denial text');
  equal(httpDenialResults[0].httpFallback, true, 'the denied HTTP route is identified in the result');
  equal(httpDenialResults[0].fallbackAttempted, true, 'the result records that the ordinary fallback had begun');
  equal(httpDenialResults[0].boot, true, 'contradictory HTTP boot state is retained for diagnosis');
  equal(httpDenialResults[1].skipped, true, 'viewport after HTTP denial is explicitly marked skipped');
}

function fakeServer(port, onListen = true) {
  const server = new EventEmitter();
  server.listening = false;
  server.closed = false;
  server.forcedClose = false;
  server.listenArgs = null;
  server.listen = (requestedPort, host) => {
    server.listenArgs = [requestedPort, host];
    if (onListen) setImmediate(() => {
      server.listening = true;
      server.emit('listening');
    });
  };
  server.address = () => ({ address: '127.0.0.1', port, family: 'IPv4' });
  server.close = (callback) => {
    server.closed = true;
    server.listening = false;
    if (callback) setImmediate(callback);
  };
  server.closeAllConnections = () => { server.forcedClose = true; };
  return server;
}

function mockProbe(handler, expectedPort, responseOverride) {
  const observations = [];
  const httpGet = (options, callback) => {
    observations.push(options);
    equal(options.hostname, '127.0.0.1', 'readiness stays on loopback');
    equal(options.port, expectedPort, 'readiness probes the server-owned port');
    equal(options.path, '/index.html', 'readiness requests the expected app entrypoint');

    const request = new EventEmitter();
    request.setTimeout = () => {};
    request.destroy = (error) => setImmediate(() => request.emit('error', error || new Error('destroyed')));

    if (responseOverride) {
      setImmediate(() => {
        const response = new EventEmitter();
        response.statusCode = responseOverride.statusCode;
        response.headers = responseOverride.headers;
        callback(response);
        if (responseOverride.body) response.emit('data', Buffer.from(responseOverride.body));
        response.emit('end');
      });
      return request;
    }

    const response = new EventEmitter();
    response.writeHead = (statusCode, headers) => {
      response.statusCode = statusCode;
      response.headers = headers;
    };
    response.end = (body) => setImmediate(() => {
      callback(response);
      if (body) response.emit('data', Buffer.from(body));
      response.emit('end');
    });
    handler({ method: 'GET', url: options.path }, response);
    return request;
  };
  return { httpGet, observations };
}

async function testOwnedServerReadiness() {
  const expected = Buffer.from('<!doctype html><title>owned checkout</title>');
  let handler;
  const owned = fakeServer(43127);
  const probe = mockProbe((req, res) => handler(req, res), owned.address().port);
  const info = await startHttpServer({
    root: '/mock-checkout',
    expectedIndex: expected,
    createServer: (requestHandler) => { handler = requestHandler; return owned; },
    readFile: (file, callback) => {
      equal(file, path.join('/mock-checkout', 'index.html'), 'static response is rooted in the checkout');
      setImmediate(() => callback(null, expected));
    },
    httpGet: probe.httpGet,
  });
  deepEqual(owned.listenArgs, [0, '127.0.0.1'], 'kernel assigns a port held by the owned server');
  equal(info.server, owned, 'readiness returns the exact server instance');
  equal(info.port, 43127, 'readiness returns the exact bound port');
  equal(probe.observations.length, 1, 'owned server readiness is checked once');
  await stopHttpServer(info);
  equal(owned.closed, true, 'server lifecycle closes the owned listener');

  const wrongBodyServer = fakeServer(43128);
  let wrongHandler;
  const wrongBodyProbe = mockProbe((req, res) => wrongHandler(req, res), 43128);
  await rejects(startHttpServer({
    root: '/mock-checkout',
    expectedIndex: expected,
    createServer: (requestHandler) => { wrongHandler = requestHandler; return wrongBodyServer; },
    readFile: (_file, callback) => setImmediate(() => callback(null, Buffer.from('<html>other content</html>'))),
    httpGet: wrongBodyProbe.httpGet,
  }), /did not match this checkout index\.html/, 'a generic 200 response is not readiness');
  equal(wrongBodyServer.closed, true, 'mismatched content closes the owned server');

  const timeoutServer = fakeServer(43129, false);
  await rejects(startHttpServer({
    root: '/mock-checkout', expectedIndex: expected,
    createServer: () => timeoutServer,
    readFile: (_file, callback) => callback(null, expected),
    listenTimeoutMs: 5, closeTimeoutMs: 5,
    httpGet: () => { throw new Error('probe must not run before listen'); },
  }), /listen timed out/, 'server startup is bounded');
  equal(timeoutServer.closed, true, 'startup timeout closes the listener');

  const timeoutProbeServer = fakeServer(43130);
  const timeoutRequest = new EventEmitter();
  timeoutRequest.setTimeout = () => {};
  timeoutRequest.destroy = (error) => setImmediate(() => timeoutRequest.emit('error', error || new Error('closed')));
  await rejects(startHttpServer({
    root: '/mock-checkout', expectedIndex: expected,
    createServer: () => timeoutProbeServer,
    readFile: (_file, callback) => callback(null, expected),
    probeTimeoutMs: 5, closeTimeoutMs: 5,
    httpGet: () => timeoutRequest,
  }), /readiness probe timed out/, 'content verification is bounded');
  equal(timeoutProbeServer.closed, true, 'probe timeout closes the owned listener');
}

async function testStaticHandler() {
  const root = path.resolve(__dirname, '..');
  const expected = fs.readFileSync(path.join(root, 'index.html'));
  const handler = createStaticHandler(root);
  const response = {
    status: null, headers: null, body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body || Buffer.alloc(0); },
  };
  await new Promise((resolve) => {
    response.end = function (body) { this.body = body || Buffer.alloc(0); resolve(); };
    handler({ method: 'GET', url: '/index.html' }, response);
  });
  equal(response.status, 200, 'static handler serves the app entrypoint');
  equal(response.headers['content-type'], 'text/html; charset=utf-8', 'entrypoint has HTML MIME type');
  equal(Buffer.compare(response.body, expected), 0, 'served entrypoint matches the current checkout bytes');

  const hidden = { status: null, writeHead(status) { this.status = status; }, end() {} };
  handler({ method: 'GET', url: '/.git/config' }, hidden);
  equal(hidden.status, 404, 'loopback server does not expose hidden repository metadata');
}

function testProductionWiring() {
  const runSource = fs.readFileSync(path.join(__dirname, 'run.js'), 'utf8');
  const fallbackSource = fs.readFileSync(path.join(__dirname, 'fallback.js'), 'utf8');
  equal(/runFileViewportWithFallback/.test(runSource), true,
    'the Phase 1 runner uses the classified fallback controller');
  equal(/page\.on\('requestfailed'/.test(runSource), true,
    'request-level policy evidence is captured for classification');
  equal(/runViewportSequence\(VIEWPORTS/.test(runSource), true,
    'the Phase 1 runner uses the policy-stop viewport controller');
  equal(/if \(result\.policyDenied\) \{[\s\S]*?viewports\.slice\(i \+ 1\)[\s\S]*?break;/.test(fallbackSource), true,
    'an explicit denial stops all later viewport navigations');
  equal(/finally \{\s*await stopHttpServer\(httpServer\);\s*\}/.test(runSource), true,
    'the loopback server is shut down in a bounded-lifecycle cleanup path');
  equal(/buildPhase1ExitReport\(results, gate\)/.test(runSource), true,
    'the runner routes all outcomes through the structured no-probe-safe exit report');
  equal(/policyDenialEvidence\(fileResult\)[\s\S]*?if \(fileResult\.boot\)/.test(fallbackSource), true,
    'file-route policy evidence is checked before the boot-success shortcut');
  equal(/policyDenialEvidence\(result\)/.test(fallbackSource), true,
    'fallback-route policy evidence is classified too');
}

(async () => {
  await testFallbackControlFlow();
  await testPolicyDenialStopsAllViewports();
  await testOwnedServerReadiness();
  await testStaticHandler();
  testProductionWiring();
  console.log(`fallback policy/server offline tests: ${checks} passed`);
})().catch((error) => { console.error(error); process.exit(1); });
