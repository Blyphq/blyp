const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blyp-published-runtime-'));
  process.chdir(dir);
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    let buffer = Buffer.concat(chunks);
    if (req.headers['content-encoding'] === 'gzip') buffer = zlib.gunzipSync(buffer);
    requests.push({ url: req.url, body: buffer.toString() });
    await sleep(150); res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const host = `http://127.0.0.1:${server.address().port}`;
  const Sentry = require('@sentry/node');
  Sentry.init({ dsn: `${host.replace('://', '://local@')}/1`, enableLogs: true, defaultIntegrations: false });
  const standalone = require('@blyp/core/standalone');
  const report = { version: process.env.BLYP_PUBLISHED_VERSION, loaders: [], writesOnImport: fs.readdirSync(dir) };
  for (const mode of ['cjs', 'esm']) {
    const entry = mode === 'cjs' ? standalone : await import('@blyp/core/standalone');
    for (const destination of ['posthog', 'sentry']) {
      try {
        entry.createStandaloneLogger({ pretty: false, file: { enabled: false }, clientLogging: { enabled: false },
          connectors: { delivery: { enabled: false }, [destination]: destination === 'posthog' ? { enabled: true, projectKey: 'local', host, errorTracking: { enableExceptionAutocapture: false } } : { enabled: true } } });
        report.loaders.push({ mode, destination, loaded: true });
      } catch (error) { report.loaders.push({ mode, destination, loaded: false, error: error.message, cause: error.cause?.message }); }
    }
  }
  const connectors = { delivery: { enabled: false }, posthog: { enabled: true, projectKey: 'local', host, errorTracking: { enableExceptionAutocapture: false } }, sentry: { enabled: true } };
  const ph = require('@blyp/core/posthog').createPosthogLogger({ connectors });
  const sn = require('@blyp/core/sentry').createSentryLogger({ connectors });
  for (const logger of [ph, sn]) {
    logger.error(new Error('native'));
    logger.error('nested', { error: new Error('nested native') });
    logger.error('serialized', { error: { name: 'TypeError', message: 'transported', stack: 'TypeError: transported\n    at browser (/tmp/browser.js:8:3)' }, tags: { component: 'billing' }, extra: { operation: 'update' }, fingerprint: ['payment'], contexts: { payment: { lane: 'stripe' } } });
    logger.warning(new Error('recoverable'));
    logger.info('expected', { error: new Error('condition') });
    logger.warning('ordinary');
  }
  const start = Date.now(); await Promise.all([ph.flush(), sn.flush()]);
  report.loggerFlushMs = Date.now() - start;
  await Sentry.flush(1000);
  report.posthogExceptionsFromLogCalls = requests.filter(r => r.url === '/batch/').flatMap(r => JSON.parse(r.body).batch).filter(e => e.event === '$exception').length;
  const sentryEvents = requests.filter(r => r.url.includes('/envelope/')).flatMap(r => {
    const lines = r.body.split('\n'); const events = [];
    for (let i = 1; i + 1 < lines.length; i += 2) if (JSON.parse(lines[i]).type === 'event') events.push(JSON.parse(lines[i + 1]));
    return events;
  });
  report.sentryExceptions = sentryEvents.map(e => ({ level: e.level, user: e.user, tags: e.tags, fingerprint: e.fingerprint, contexts: e.contexts, exception: e.exception }));
  const tracker = require('@blyp/core/posthog').createPosthogErrorTracker({ connectors });
  const error = new Error('already sanitized'); // FAKE_SOURCE_SECRET_123
  tracker.capture(error, { distinctId: 'verified' });
  await sleep(500);
  report.posthogSourceSecretLeaked = requests.some(r => r.body.includes('FAKE_SOURCE_SECRET_123'));
  const { PostHog } = require('posthog-node');
  const sdk = new PostHog('local', { host, enableExceptionAutocapture: false });
  const before = requests.length;
  const immediateStart = Date.now(); await sdk.captureExceptionImmediate(new Error('delayed'));
  report.sdkImmediateReturnMs = Date.now() - immediateStart;
  await sdk.flush(); report.sdkFlushReturnMs = Date.now() - immediateStart;
  report.sdkRequestsObservedAtFlushReturn = requests.length - before;
  await sdk.shutdown(); await Sentry.close(1000);
  report.finalFilesystemWrites = fs.readdirSync(dir);
  console.log(JSON.stringify(report, null, 2));
  server.close(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
