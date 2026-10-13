const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const SECRET = 'FAKE_SECRET_123';
const redact = value => JSON.parse(JSON.stringify(value).replaceAll(SECRET, '[REDACTED]'));

async function run({ standalone, posthog, sentry, Sentry, mode }) {
  assert.equal(globalThis.Bun, undefined, 'fixture must run in Node');
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blyp-runtime-'));
  const previousCwd = process.cwd();
  process.chdir(runtimeDir);
  const payloads = [];
  let delay = 100;
  let status = 200;
  let hang = false;
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    let chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let buffer = Buffer.concat(chunks);
    if (req.headers['content-encoding'] === 'gzip') buffer = zlib.gunzipSync(buffer);
    let body = buffer.toString();
    if (body.startsWith('data=')) body = Buffer.from(new URLSearchParams(body).get('data'), 'base64').toString();
    payloads.push({ url: req.url, body });
    if (hang) return;
    const responseStatus = status;
    await sleep(delay);
    res.statusCode = responseStatus;
    res.end('{}');
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const host = `http://127.0.0.1:${server.address().port}`;
  const registry = standalone.createErrorCaptureRegistry();
  let frameworkHookCalls = 0;
  let frameworkPrivacy = false;
  Sentry.init({ dsn: `${host.replace('://', '://local@')}/1`, enableLogs: true, defaultIntegrations: false,
    beforeSend(event, hint) {
      frameworkHookCalls++;
      if (hint.originalException && registry.shouldSuppress(hint.originalException, 'sentry', { includePending: true })) return null;
      event.extra = { ...event.extra, app_hook: true, enriched_url: `https://test/${SECRET}` };
      for (const exception of event.exception?.values ?? []) for (const frame of exception.stacktrace?.frames ?? []) Object.assign(frame, { pre_context: [SECRET], post_context: [SECRET], context_line: SECRET });
      return frameworkPrivacy ? redact(event) : event;
    },
    beforeSendLog(log) { log.attributes = { ...log.attributes, app_hook: true, enriched_url: `https://test/${SECRET}` }; return log; },
  });
  const initialized = Sentry.getClient();
  const missing = standalone.createStandaloneLogger({ pretty: false, file: { enabled: false }, clientLogging: { enabled: false }, connectors: { delivery: { enabled: false }, posthog: { enabled: true }, sentry: { enabled: false } } });
  missing.info('missing optional credentials');
  assert.equal((await missing.shutdown()).status, 'delivered');
  const api = require('@opentelemetry/api');
  const storage = new AsyncLocalStorage();
  api.context.setGlobalContextManager({ active: () => storage.getStore() || api.ROOT_CONTEXT,
    with: (ctx, fn, self, ...args) => storage.run(ctx, () => fn.apply(self, args)),
    bind: (_ctx, target) => target, enable() { return this; }, disable() { return this; } });
  const provider = { getTracer: () => ({}) };
  api.trace.setGlobalTracerProvider(provider);
  const traceProvider = api.trace.getTracerProvider();
  const traceId = '1234567890abcdef1234567890abcdef';
  const active = api.trace.setSpan(api.ROOT_CONTEXT, api.trace.wrapSpanContext({ traceId, spanId: '1234567890abcdef', traceFlags: 1 }));
  const connectors = {
    delivery: { enabled: false },
    posthog: { enabled: true, mode: 'auto', projectKey: 'local-test', host, serviceName: 'carsxe-public-api',
      errorTracking: { enabled: true, mode: 'auto', enableExceptionAutocapture: false, requestTimeoutMs: 300,
        beforeSend: event => event ? redact({ ...event, properties: { ...event.properties, app_hook: true, enriched_url: `https://test/${SECRET}` } }) : null } },
    sentry: { enabled: true, mode: 'auto', dsn: 'https://different@example.test/9',
      finalPayloadFilter: payload => redact(payload) },
  };
  const logger = standalone.createStandaloneLogger({ pretty: false, level: 'debug', file: { enabled: false }, clientLogging: { enabled: false },
    redact: { patterns: [/FAKE_SECRET_123/g] }, connectors });
  assert.equal(Sentry.getClient(), initialized, 'must preserve initialized framework client');
  assert.equal(api.trace.getTracerProvider(), traceProvider, 'must not replace trace provider');
  const original = new Error(`Payment ${SECRET}`); // FAKE_SECRET_123 in SDK source context
  const receipts = [];
  function boundary(error) {
    const ph = registry.claim(error, 'posthog');
    const sn = registry.claim(error, 'sentry');
    if (!ph && !sn) return;
    receipts.push({ ph, sn });
    logger.error(`Payment ${SECRET}`, { userId: 'verified-uid', distinctId: 'verified-person', requestId: 'req-1', traceId,
      $session_id: 'frontend-session', organizationId: 'org-1',
      error: { name: error.name, message: error.message, stack: error.stack, cause: { name: 'Error', message: `cause ${SECRET}`, stack: `Error: cause ${SECRET}\n    at cause (/tmp/cause.js:2:1)` } },
      tags: { component: 'billing' }, extra: { operation: 'subscription-update', nested: { url: `https://test/${SECRET}` } },
      fingerprint: ['subscription-update-failure'], contexts: { payment: { lane: 'stripe' } } });
  }
  api.context.with(active, () => { boundary(original); boundary(original); });
  Sentry.captureException(original);
  const started = Date.now();
  const [flushed, simultaneous] = await Promise.all([logger.flush({ timeoutMs: 2000 }), logger.flush({ timeoutMs: 2000 })]);
  assert.equal(flushed.status, 'delivered');
  assert.equal(simultaneous.status, 'delivered');
  assert.ok(Date.now() - started >= delay - 10, 'flush must await delayed exceptions');
  for (const receipt of receipts) { receipt.ph?.settle(flushed.destinations.posthog.status); receipt.sn?.settle(flushed.destinations.sentry.status); }
  function events() {
    const ph = payloads.filter(p => p.url.startsWith('/batch/')).flatMap(p => JSON.parse(p.body).batch).filter(e => e.event === '$exception');
    const sn = payloads.filter(p => p.url.includes('/envelope/')).flatMap(p => {
      const lines = p.body.split('\n'); const items = [];
      for (let i = 1; i + 1 < lines.length; i += 2) { const header = JSON.parse(lines[i]); if (header.type === 'event') items.push(JSON.parse(lines[i + 1])); }
      return items;
    });
    const logs = payloads.filter(p => p.url === '/i/v1/logs').flatMap(p => JSON.parse(p.body).resourceLogs).flatMap(r => r.scopeLogs).flatMap(s => s.logRecords);
    return { ph, sn, logs };
  }
  let counts = events();
  assert.equal(counts.ph.length, 1); assert.equal(counts.sn.length, 1); assert.equal(counts.logs.length, 1);
  assert.equal(counts.ph[0].distinct_id, 'verified-person');
  assert.equal(counts.ph[0].properties.$session_id, 'frontend-session');
  assert.equal(counts.ph[0].properties['blyp.level'], 'error');
  assert.equal(counts.ph[0].properties.requestId, 'req-1'); assert.equal(counts.ph[0].properties.traceId, traceId);
  assert.equal(counts.ph[0].properties.organizationId, 'org-1');
  const attrs = Object.fromEntries(counts.logs[0].attributes.map(a => [a.key, a.value.stringValue]));
  assert.equal(attrs.userId, 'verified-uid'); assert.equal(attrs.distinctId, 'verified-person');
  assert.equal(attrs.requestId, 'req-1'); assert.equal(attrs['blyp.trace_id'], traceId); assert.equal(attrs.$session_id, 'frontend-session');
  const event = counts.sn[0];
  assert.equal(event.tags.component, 'billing'); assert.equal(event.extra.operation, 'subscription-update');
  assert.deepEqual(event.fingerprint, ['subscription-update-failure']);
  assert.equal(event.contexts.payment.lane, 'stripe'); assert.equal(event.user.id, 'verified-uid');
  assert.equal(event.contexts.blyp['blyp.trace_id'], traceId);
  for (const frame of event.exception.values.flatMap(e => e.stacktrace?.frames ?? [])) assert.ok(!('pre_context' in frame) && !('post_context' in frame) && !('context_line' in frame));
  for (const frame of counts.ph[0].properties.$exception_list.flatMap(e => e.stacktrace?.frames ?? [])) assert.ok(!('pre_context' in frame) && !('post_context' in frame) && !('context_line' in frame));
  assert.ok(event.extra.app_hook); assert.ok(counts.ph[0].properties.app_hook);
  assert.ok(event.exception.values.some(e => e.stacktrace?.frames?.some(f => f.filename === __filename)), 'keep original filename');
  assert.ok(payloads.every(p => !p.body.includes(SECRET)), 'final payloads must not contain fake secrets');
  // All supported overloads, ordinary messages, same-text distinct objects, child overrides, concurrent requests.
  const a = logger.child({ userId: 'parent', organizationId: 'parent-org', requestId: 'parent-request' }).child({ userId: 'child', organizationId: 'child-org' });
  a.error(new Error('Failed'));
  a.error('Operation failed', { error: new Error('Failed'), userId: 'record-user' });
  a.error('Operation failed', { error: { name: 'TypeError', message: 'Failed', stack: 'TypeError: Failed\n    at transported (/tmp/browser.js:11:4)' } });
  a.warning(new Error('Recoverable failure'));
  a.info('Expected condition', { error: new Error('Condition') });
  a.warning('ordinary warning'); a.info('ordinary info', { message: 'metadata message' });
  await Promise.all(['request-a', 'request-b'].map(async userId => { await sleep(1); logger.child({ userId }).info('concurrent', { error: new Error('same text') }); }));
  assert.equal((await logger.flush({ timeoutMs: 2000 })).status, 'delivered');
  counts = events();
  assert.equal(counts.ph.length, 8); assert.equal(counts.sn.length, 8); assert.equal(counts.logs.length, 10);
  assert.ok(counts.sn.some(e => e.user?.id === 'record-user'));
  assert.equal(counts.sn.find(e => e.exception.values.some(v => v.value === 'Condition')).level, 'info');
  assert.equal(counts.sn.find(e => e.exception.values.some(v => v.value === 'Recoverable failure')).level, 'warning');
  assert.equal(counts.sn.find(e => e.exception.values.some(v => v.value === 'Recoverable failure')).user.id, 'child');
  const concurrent = counts.sn.filter(e => e.exception.values.some(v => v.value === 'same text'));
  assert.deepEqual(concurrent.map(e => e.user.id).sort(), ['request-a', 'request-b']);
  assert.ok(counts.ph.some(e => e.properties.$exception_list.some(ex => ex.stacktrace?.frames?.some(f => f.filename === '/tmp/browser.js' && f.lineno === 11))));
  const equivalent = new TypeError('equivalent', { cause: new Error('equivalent cause') });
  logger.info('equivalent native', { error: equivalent });
  logger.info('equivalent JSON', { error: { name: equivalent.name, message: equivalent.message, stack: equivalent.stack, cause: { name: equivalent.cause.name, message: equivalent.cause.message, stack: equivalent.cause.stack } } });
  assert.equal((await logger.flush({ timeoutMs: 2000 })).status, 'delivered');
  const equivalentEvents = events();
  const phEquivalent = equivalentEvents.ph.filter(e => e.properties.$exception_list.some(ex => ex.value === 'equivalent'));
  const snEquivalent = equivalentEvents.sn.filter(e => e.exception.values.some(ex => ex.value === 'equivalent'));
  assert.equal(phEquivalent.length, 2); assert.equal(snEquivalent.length, 2);
  assert.deepEqual(phEquivalent[0].properties.$exception_list.map(({ type, value, stacktrace }) => ({ type, value, stacktrace })), phEquivalent[1].properties.$exception_list.map(({ type, value, stacktrace }) => ({ type, value, stacktrace })));
  assert.deepEqual(snEquivalent[0].exception.values.map(({ type, value, stacktrace }) => ({ type, value, stacktrace })), snEquivalent[1].exception.values.map(({ type, value, stacktrace }) => ({ type, value, stacktrace })));
  assert.ok(payloads.every(p => !p.body.includes(SECRET)));
  // Automatic exception switches; no warning/info message should create an issue.
  for (const errorTracking of [{ enabled: false }, { mode: 'manual' }]) {
    const sender = posthog.createPostHogSender({ ...connectors.posthog, errorTracking: { ...connectors.posthog.errorTracking, ...errorTracking } });
    sender.send({ timestamp: new Date().toISOString(), level: 'info', message: 'disabled', data: { error: { name: 'Error', message: 'must not capture' } } });
    assert.equal((await sender.flush()).status, 'delivered');
    await sender.shutdown();
  }
  assert.equal(events().ph.length, 10);
  // Failed immediate delivery is retained in the flush result, including after settlement.
  status = 503; delay = 0;
  const failedSentry = sentry.createSentrySender(connectors.sentry);
  failedSentry.send({ timestamp: new Date().toISOString(), level: 'warning', message: 'Sentry failure', data: { error: { name: 'Error', message: 'Sentry failed transport' } } });
  assert.equal((await failedSentry.flush({ timeoutMs: 1000 })).status, 'failed');
  const failed = posthog.createPostHogSender(connectors.posthog);
  failed.captureException(new Error('failed transport'));
  const failure = await failed.flush({ timeoutMs: 1000 });
  assert.equal(failure.status, 'failed');
  const ownership = registry.claim(new Error('delivery failure'), 'sentry'); ownership.settle('failed');
  // Concurrent capture while a barrier is running; subsequent flush covers it.
  status = 200; delay = 75;
  const sender = posthog.createPostHogSender(connectors.posthog);
  sender.captureException(new Error('before barrier'));
  const barrier = sender.flush({ timeoutMs: 1000 });
  await sleep(10); sender.captureException(new Error('after barrier'));
  assert.equal((await barrier).status, 'delivered');
  assert.equal((await sender.flush()).status, 'delivered');
  assert.equal((await sender.shutdown()).status, 'delivered');
  // Hung destination: bounded wait, attached rejection handlers, eventual SDK cancellation.
  hang = true;
  const hung = posthog.createPostHogSender(connectors.posthog);
  hung.captureException(new Error('never responds'));
  const timeout = await hung.flush({ timeoutMs: 25 });
  assert.equal(timeout.status, 'timed_out'); assert.ok(timeout.pending > 0);
  assert.equal((await hung.shutdown({ timeoutMs: 25 })).status, 'timed_out');
  await sleep(400);
  assert.equal((await hung.flush({ timeoutMs: 1000 })).status, 'failed');
  hang = false;
  // Real Next.js 16 peer + server entrypoint; browser bundle contains no Node connector dependencies.
  assert.equal(require('next/package.json').version.split('.')[0], '16');
  const next = require('@blyp/core/nextjs').createNextJsLogger({ pretty: false, file: { enabled: false }, clientLogging: { enabled: false }, connectors: { delivery: { enabled: false } } });
  const route = next.withLogger(async () => new Response('OK'));
  const response = await api.context.with(active, () => route(new Request('http://localhost/test'), {}));
  assert.equal(response.status, 200); assert.equal(response.headers.get('x-blyp-trace-id'), traceId);
  await next.logger.shutdown();
  const bundle = await require('esbuild').build({ stdin: { contents: 'export * from "@blyp/core/client"', resolveDir: previousCwd }, bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true });
  assert.ok(Object.keys(bundle.metafile.inputs).every(p => !/posthog-node|@sentry\/node|sdk-logs|node:/.test(p)));
  assert.equal((await logger.shutdown({ timeoutMs: 2000 })).status, 'delivered');
  assert.ok(frameworkHookCalls >= 9);
  const afterClose = { ph: events().ph.length, sn: events().sn.length };
  logger.error('after Blyp shutdown', { error: new Error('must not bypass privacy hooks') });
  await Sentry.flush(1000);
  assert.equal(events().ph.length, afterClose.ph); assert.equal(events().sn.length, afterClose.sn);
  // Existing Sentry remains usable after Blyp shutdown.
  frameworkPrivacy = true;
  Sentry.captureException(new Error('framework still active')); await Sentry.flush(1000);
  assert.ok(payloads.every(p => !p.body.includes(SECRET)), 'application keeps framework privacy after Blyp shutdown');
  assert.deepEqual(fs.readdirSync(runtimeDir), [], 'no filesystem writes in no-persistence mode');
  await Sentry.close(1000);
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
  api.context.disable(); api.trace.disable();
  process.chdir(previousCwd); fs.rmSync(runtimeDir, { recursive: true, force: true });
  console.log(`Packed ${mode}: collector, privacy, flush, identity, context, Next 16, browser isolation and no-persistence passed`);
}
module.exports = run;
if (require.main === module) run({ standalone: require('@blyp/core/standalone'), posthog: require('@blyp/core/posthog'), sentry: require('@blyp/core/sentry'), Sentry: require('@sentry/node'), mode: 'cjs' }).catch(error => { console.error(error); process.exit(1); });
