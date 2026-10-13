# CarsXE migration

Remove the version-checked bundle patch/install hook after installing a Blyp release containing these fixes. Keep native PostHog analytics adapters and application Sentry framework initialization. Install `@blyp/core@0.1.32` for these fixes. The earlier local validation package was `0.1.32-carsxe.1`; published 0.1.31 does not contain these fixes.

```ts
import * as Sentry from '@sentry/node'; // or the application's Sentry Next.js server SDK
import { createStandaloneLogger, createErrorCaptureRegistry } from '@blyp/core/standalone';

const ownership = createErrorCaptureRegistry();
const redactFinal = (payload: Record<string, unknown>) =>
  JSON.parse(JSON.stringify(payload).replace(/YOUR_APPLICATION_SECRET_PATTERN/g, '[REDACTED]'));

// Compose this with the application's existing hook when initializing Sentry.
// Framework initialization owns DSN, integrations, sampling and transport.
const appBeforeSend = existingSentryOptions.beforeSend;
Sentry.init({
  ...existingSentryOptions,
  dsn,
  enableLogs: true,
  // Include the rest of your existing framework initialization here.
  beforeSend(event, hint) {
    const original = hint.originalException;
    if (original && typeof original === 'object' &&
        ownership.shouldSuppress(original, 'sentry', { includePending: true })) return null;
    return appBeforeSend ? appBeforeSend(event, hint) : event;
  },
});

const logger = createStandaloneLogger({
  pretty: false,
  level: 'info',
  file: { enabled: false },
  clientLogging: { enabled: false },
  redact: { patterns: [/YOUR_APPLICATION_SECRET_PATTERN/g] },
  connectors: {
    delivery: { enabled: false },
    posthog: {
      enabled: true, mode: 'auto', projectKey, host,
      serviceName: 'carsxe-public-api',
      errorTracking: {
        enabled: true, mode: 'auto', enableExceptionAutocapture: false,
        requestTimeoutMs: 1500,
        includeSourceContext: false,
        // Compose additional existing operational hooks as an ordered array.
        beforeSend: event => event ? redactFinal(event) : null,
      },
    },
    sentry: {
      enabled: true, mode: 'auto', dsn, environment, release,
      includeSourceContext: false,
      finalPayloadFilter: payload => redactFinal(payload),
    },
  },
});

async function report(original: Error, verifiedFirebaseUid: string) {
  // Only claim enabled/ready destinations. This example assumes both are configured.
  const ph = ownership.claim(original, 'posthog');
  const sentry = ownership.claim(original, 'sentry');
  if (!ph && !sentry) return;
  const sanitized = sanitizeError(original); // retain the original only for ownership
  logger.error('Payment operation failed', {
    userId: verifiedFirebaseUid, distinctId: verifiedFirebaseUid,
    organizationId, requestId, traceId, $session_id: frontendSessionId,
    error: sanitized,
    tags: { component: 'billing' },
    extra: { operation: 'subscription-update' },
    fingerprint: ['subscription-update-failure'],
    contexts: { payment: { lane: 'stripe' } },
  });
  const result = await logger.flush({ timeoutMs: 1500 });
  if (result && 'destinations' in result) {
    ph?.settle(result.destinations.posthog.status);
    sentry?.settle(result.destinations.sentry.status);
  }
}
```

Adapt the Sentry initialization in its existing configuration file, before constructing Blyp. Do not call `Sentry.init` again to install the hook on an already-running application. The initialization above illustrates the combined options, not a runtime reconfiguration step. The replacement-string example is illustrative; use CarsXE's tested sanitizer for nested values and URLs.

This example suppresses pending framework captures. It intentionally favors avoiding duplicates over preserving an independent fallback during delivery failure. To favor fallback capture, omit `includePending: true`, and see the ownership tradeoff in [contracts.md](contracts.md). Destination-wide flush results are not per-event receipts. A partially settled claim does not automatically route a new log only to the failed destination; use direct destination APIs for a deliberate fallback instead of relogging to every destination.

For browser ingestion, verify identity in the server's `clientLogging.validate`/`enrich` boundary. Return trusted identity through `serverContext`; do not copy `metadata.posthogDistinctId` or other browser identity fields without verification. Keep source stacks in the JSON `error` representation. Continue application-owned bounded browser suppression tied to exact observed original objects.

Firebase Functions v2/CommonJS can use `require('@blyp/core/standalone')`. Next.js 16 server entrypoints can use ESM imports; client components keep using `@blyp/core/client` and native `posthog-js`. Keep trace/metric providers in existing instrumentation. Await `flush({ timeoutMs: 1500 })` before ending serverless work and handle incomplete results in application diagnostics without changing response behavior.
