# Blyp — Full documentation

Back to [README](../README.md)

This document contains detailed usage, all framework integrations, configuration reference, and advanced topics.

## Table of contents

- [Security](#security)
- [Basic logger usage](#basic-logger-usage)
- [Structured request batches](#structured-request-batches)
- [Automatic redaction](#automatic-redaction)
- [Errors](#errors)
- [Client](#client)
- [AI SDK tracing](#ai-sdk-tracing)
- [Framework integrations](#framework-integrations)
- [Database logging](#database-logging)
- [Advanced configuration](#advanced-configuration)
- [Frontend + Backend log sync](#frontend--backend-log-sync)
- [Runtime detection](#runtime-detection)
- [Color utilities](#color-utilities)
- [Configuration reference](#configuration-reference)
- [Log levels](#log-levels)
- [HTTP request logging](#http-request-logging)
- [File logging](#file-logging)
- [Performance](#performance)

---

## Security

For responsible disclosure, scope, and maintainer response commitments, see [SECURITY.md](../SECURITY.md). Suspected vulnerabilities should be reported through GitHub's private advisory flow rather than public issues.

## Basic logger usage

```typescript
import { logger } from '@blyp/core';

// Basic logging
logger.info('Hello world');
logger.success('Operation completed');
logger.critical('Critical error occurred');
logger.debug('Debug information');
logger.error('Something went wrong');
logger.warning('Warning message');

// Table logging with visual output
logger.table('User data', { 
  name: 'John Doe', 
  age: 30, 
  city: 'New York' 
});

// Logging with metadata
logger.info('User login', { 
  userId: 123, 
  timestamp: new Date().toISOString() 
});
```

## Structured request batches

```typescript
import { createStructuredLog } from '@blyp/core';

const structuredLog = createStructuredLog('checkout', {
  service: 'web-api',
  level: 'info',
  timestamp: new Date().toISOString(),
});

structuredLog.set({
  user: { id: 1, plan: 'pro' },
  cart: { items: 3, total: 9999 },
});

structuredLog.info('user logged in');
structuredLog.info('item added to cart');
structuredLog.emit({ status: 200 });
```

Typed usage:

```typescript
import { createStructuredLog } from '@blyp/core';

const structuredLog = createStructuredLog<{
  message: string;
  level: string;
  timestamp: string;
  hostname?: string;
  port?: number;
}>('test', {
  message: 'Hello Elysia',
  level: 'info',
  timestamp: new Date().toISOString(),
  hostname: '127.0.0.1',
  port: 3000,
});
```

Inside framework handlers, the imported `createStructuredLog(...)` binds to the active request-scoped logger automatically, so request metadata and framework `customProps` are merged into the final payload at emit time.

Structured logs are written only when you call `.emit()`. In framework request handlers, a structured emit suppresses the default auto `http_request` / `http_error` record for that request. If you also call the root `logger` in the same request after starting a request-scoped structured log, Blyp warns once and ignores the root logger write.

---

## Automatic redaction

Blyp redacts sensitive values at the source. Redaction runs before console output, file writes, database inserts, connector forwarding, client-log ingestion forwarding, and framework request logging.

Default redacted keys:

`password`, `passwd`, `pwd`, `secret`, `token`, `api_key`, `apikey`, `api_secret`, `authorization`, `auth`, `x-api-key`, `private_key`, `privatekey`, `access_token`, `refresh_token`, `client_secret`, `session`, `cookie`, `set-cookie`, `ssn`, `credit_card`, `card_number`, `cvv`, `cvc`, `otp`, `pin`

Built-in pattern scanning also redacts:

- Bearer tokens as `[REDACTED:bearer]`
- JWTs as `[REDACTED:jwt]`
- common API key formats as `[REDACTED:api_key]`
- 16-digit Luhn-valid card numbers as `[REDACTED:card]`

Configure extra redaction in `blyp.config.*`:

```typescript
export default {
  redact: {
    keys: ['my_custom_secret', 'internal_token'],
    paths: ['user.ssn', 'payment.**.raw'],
    patterns: [/MY_ORG_[A-Z0-9]{32}/],
    disablePatternScanning: false,
  },
};
```

Example:

```typescript
logger.info('Authorization Bearer sk-12345678901234567890', {
  user: { password: 'hunter2' },
  payment: { raw: '4111 1111 1111 1111' },
});
```

This writes redacted output only. Blyp never stores the original secret in its log sinks.

Notes:

- `redact.paths` supports exact dot paths, numeric array indexes, `*`, and `**`
- `patterns` are runtime regexes, so prefer executable config such as `blyp.config.ts`
- set `disablePatternScanning: true` only if you explicitly want key/path-only redaction
- request headers `Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`, and `X-Auth-Token` are redacted by default

---

## Errors

### Application Errors

```typescript
import { createError, HTTP_CODES } from '@blyp/core';

throw createError({
  status: 404,
  message: 'User not found',
});

const PAYMENT_AMOUNT_INVALID = HTTP_CODES.BAD_REQUEST.extend({
  code: 'INVALID_PAYMENT_AMOUNT',
  message: 'Invalid payment amount',
  why: 'The amount must be a positive number',
  fix: 'Pass a positive integer in cents',
});

throw PAYMENT_AMOUNT_INVALID.create({
  link: 'https://docs.example.com/payments/declined',
});
```

`createError` returns a throwable `BlypError` and logs it immediately by default. Pass a request-scoped `logger` to route the log through framework context, or set `skipLogging: true` when you only want the throwable instance.

---

## Client

### Client Error Parsing

```typescript
import { parseError } from '@blyp/core/client';

const response = await fetch('/api/payments', {
  method: 'POST',
});

if (!response.ok) {
  throw await parseError(response);
}
```

`parseError` is browser-safe and returns a `BlypError`. It does not log by default, but you can pass a logger if you want a parsed client-side error to be emitted.

```typescript
const error = parseError({
  error: {
    status: 404,
    message: 'User not found',
    fix: 'Check the user id',
  },
});
```

### Client Logger Sync

```typescript
import { createClientLogger } from '@blyp/core/client';

const logger = createClientLogger({
  endpoint: '/inngest',
  metadata: () => ({
    app: 'dashboard',
  }),
  delivery: {
    maxRetries: 3,
    retryDelayMs: 5000,
  },
});

logger.info('hydrated', { route: window.location.pathname });
logger.error(new Error('Button failed to render'));
logger.child({ feature: 'checkout' }).warn('Client validation failed');
```

The client logger logs to the browser console by default and queues remote events in memory when delivery fails. By default it retries offline, network, `429`, and `5xx` failures up to `3` times with a `5000ms` delay and keeps up to `100` pending events before dropping the oldest queued item. It uses `POST /inngest` by default, but you can override the path and delivery policy.

### Expo Logger Sync

```typescript
import { createExpoLogger } from '@blyp/core/expo';

const logger = createExpoLogger({
  endpoint: 'https://api.example.com/inngest',
  metadata: () => ({
    app: 'mobile',
  }),
  delivery: {
    maxRetries: 3,
    retryDelayMs: 5000,
  },
});

logger.info('mounted', { screen: 'home' });
logger.error(new Error('Failed to load profile'));
```

Install `expo-network` in your Expo app before using the logger:

```bash
npx expo install expo-network
```

The Expo logger uses the runtime `fetch` implementation to send logs and reads connectivity metadata from `expo-network`. The `endpoint` must be an absolute `http://` or `https://` URL because Expo apps do not have a browser origin. Failed deliveries are queued in memory and retried by default `3` times with `5000ms` delay, with a default queue limit of `100`.

---

## AI SDK tracing

Blyp supports two AI tracing modes:

- `@blyp/core/ai/vercel` for Vercel AI SDK middleware
- `@blyp/core/ai/openai` and `@blyp/core/ai/anthropic` for direct provider SDK wrappers

Blyp normalizes telemetry. It does not expose a cross-provider generation API.

Install the AI SDK in apps that use this entrypoint:

```bash
bun add ai
```

### Quick start

```typescript
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { blypModel } from '@blyp/core/ai/vercel';

const model = blypModel(anthropic('claude-sonnet-4-5'), {
  operation: 'support_chat',
  metadata: {
    team: 'support',
  },
});

const result = await generateText({
  model,
  prompt: 'Write a refund reply for this customer',
});
```

### Advanced middleware usage

```typescript
import { wrapLanguageModel } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { blypMiddleware } from '@blyp/core/ai/vercel';

const model = wrapLanguageModel({
  model: anthropic('claude-sonnet-4-5'),
  middleware: blypMiddleware({
    operation: 'support_chat',
  }),
});
```

### Hooks and context

```typescript
const model = blypModel(anthropic('claude-sonnet-4-5'), {
  hooks: {
    onStart(context) {
      context.setMetadata({ route: 'refunds' });
    },
    onFinish(context) {
      console.log(context.usage?.totalTokens);
    },
    onError(context) {
      console.error(context.error);
    },
  },
});
```

`BlypMiddlewareContext` includes the trace id, operation, provider, model, call type, logger, raw params, metadata, usage, finish reason, streamed/output text, tool call records, and helper methods for `setMetadata(...)` and `disableCapture(...)`.

### Defaults and privacy

- `operation` defaults to `ai.generate` for non-streaming calls and `ai.stream` for streaming calls.
- The active request-scoped Blyp logger is used automatically when framework request context is active.
- Outside request context, Blyp falls back to the root logger unless you pass `logger`.
- Input, output, reasoning, tool payloads, and stream chunks are not captured unless you enable them.
- `exclude.metadataPaths`, `exclude.toolNames`, and `exclude.providerOptions` run before Blyp writes the final structured record.
- Content and event limits are capped. When Blyp truncates captured data, it keeps summary metrics and marks the trace as truncated.

### Captured data

Each invocation emits one structured `ai_trace` record through Blyp's normal structured logging pipeline. Successful traces log at `info`. Failed traces log at `error` and include recoverable `ai.errorType` and `ai.errorCode` fields when available.

The normalized payload includes:

- AI SDK provider and model id
- operation name
- `generate` vs `stream` call type
- input/output/total token usage
- finish reason
- time to first chunk for streams
- total duration
- tokens per second when output token count is available
- best-effort tool call events and tool results

### Limitations

- Vercel middleware and provider wrappers are separate surfaces. Blyp does not translate request params across providers.
- OpenRouter support in v1 goes through `wrapOpenAI(..., { provider: 'openrouter' })`.
- Tool call tracing is best-effort and only captures what AI SDK middleware surfaces.
- Blyp does not install a separate AI sink; AI traces flow through the normal Blyp logger, connectors, and file or database destinations.

## Provider SDK tracing

### OpenAI

```typescript
import OpenAI from 'openai';
import { wrapOpenAI } from '@blyp/core/ai/openai';

const client = wrapOpenAI(
  new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  {
    operation: 'draft_blog_intro',
  }
);

const result = await client.responses.create({
  model: 'gpt-5',
  input: 'Write a short intro about edge logging',
});
```

### Anthropic

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { wrapAnthropic } from '@blyp/core/ai/anthropic';

const client = wrapAnthropic(
  new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
  {
    operation: 'summarize_ticket',
  }
);

const result = await client.messages.create({
  model: 'claude-sonnet-4-5',
  max_tokens: 500,
  messages: [{ role: 'user', content: 'Summarize this support thread' }],
});
```

### OpenRouter

```typescript
import OpenAI from 'openai';
import { wrapOpenAI } from '@blyp/core/ai/openai';

const client = wrapOpenAI(
  new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
  }),
  {
    provider: 'openrouter',
    operation: 'route_experiment',
  }
);
```

### Optional fetch tracing

```typescript
import OpenAI from 'openai';
import { blypFetch } from '@blyp/core/ai/fetch';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  fetch: blypFetch(fetch, {
    metadata: { service: 'assistant-api' },
  }),
});
```

### Wrapper vs fetch

- Provider wrappers are the authoritative source for usage, finish reason, tool calls, content capture, and final `ai_trace`.
- `blypFetch` is optional and secondary. Use it for transport latency, status codes, request ids, and low-level debugging.
- Content capture is metadata-only by default for both surfaces. Input, output, tool payloads, reasoning, stream events, and raw provider payload capture stay off until explicitly enabled.

---

## Database logging

Use database logging when your deployment cannot safely write local files, especially in serverless environments. Blyp treats this as the primary persistence destination, not as a connector, so Better Stack, PostHog, Sentry, and OTLP continue to work independently.

Database mode supports:

- Postgres
- MySQL
- Prisma adapters
- Drizzle adapters

Database mode requires an executable config file such as `blyp.config.ts` or runtime config passed directly to `createStandaloneLogger()` or a framework logger factory. `blyp.config.json` is intentionally not enough because Prisma and Drizzle adapters are runtime objects.

### Prisma

```typescript
import { PrismaClient } from '@prisma/client';
import { createPrismaDatabaseAdapter } from '@blyp/core/database';

const prisma = new PrismaClient();

export default {
  destination: 'database',
  database: {
    dialect: 'postgres',
    adapter: createPrismaDatabaseAdapter({
      client: prisma,
      model: 'blypLog',
    }),
  },
};
```

### Drizzle

```typescript
import { createDrizzleDatabaseAdapter } from '@blyp/core/database';
import { db } from './db';
import { blypLogs } from './db/schema/blyp';

export default {
  destination: 'database',
  database: {
    dialect: 'mysql',
    adapter: createDrizzleDatabaseAdapter({
      db,
      table: blypLogs,
    }),
  },
};
```

### Flushing

All Blyp loggers now expose:

```typescript
await logger.flush();
await logger.shutdown();
```

Promise-based and hook-driven framework integrations such as Hono, Elysia, Next.js, React Router, Astro, Nitro, Nuxt, SvelteKit, and TanStack Start flush automatically in database mode so request logs are persisted before the response completes. For callback-style servers like Express, Fastify, and NestJS, call `await logger.flush()` at your own boundary when you need the same guarantee.

### CLI schema setup

Use the Blyp CLI to scaffold and apply the `blyp_logs` schema:

```bash
blyp logs init --adapter prisma --dialect postgres
blyp logs init --adapter prisma --dialect mysql
blyp logs init --adapter drizzle --dialect postgres
blyp logs init --adapter drizzle --dialect mysql
```

The generated schema stores the full canonical record plus extracted query fields like `level`, `type`, `group_id`, `status`, and `duration`.

---

## PostHog connector

Use `blyp.config.ts`, `blyp.config.js`, or `blyp.config.json`. When you need environment variables, prefer `blyp.config.ts`:

```typescript
export default {
  connectors: {
    posthog: {
      enabled: true,
      mode: 'auto',
      projectKey: process.env.POSTHOG_PROJECT_KEY,
      host: 'https://us.i.posthog.com',
      errorTracking: {
        enabled: true,
        mode: 'auto',
        enableExceptionAutocapture: true,
      },
    },
  },
};
```

Static JSON config works too:

```json
{
  "connectors": {
    "posthog": {
      "enabled": true,
      "mode": "manual",
      "projectKey": "phc_xxx"
    }
  }
}
```

`mode: "auto"` forwards normal server-side Blyp logs to PostHog automatically. `mode: "manual"` keeps the regular Blyp logger local-only and lets you opt in with the PostHog subpath:

```typescript
import {
  capturePosthogException,
  createPosthogErrorTracker,
  createPosthogLogger,
  createStructuredPosthogLogger,
} from '@blyp/core/posthog';

const posthogLogger = createPosthogLogger();
posthogLogger.info('manual posthog log');
createPosthogErrorTracker().capture(new Error('manual posthog exception'));
capturePosthogException(new Error('wrapped posthog exception'));

const structured = createStructuredPosthogLogger('checkout', {
  orderId: 'ord_123',
});
structured.info('manual start');
structured.emit({ status: 200 });
```

`connectors.posthog.errorTracking` controls PostHog exception capture:

```typescript
export default {
  connectors: {
    posthog: {
      enabled: true,
      projectKey: process.env.POSTHOG_PROJECT_KEY,
      errorTracking: {
        enabled: true,
        mode: 'auto',
        enableExceptionAutocapture: true,
      },
    },
  },
};
```

With `errorTracking.mode: "auto"`, Blyp captures handled server errors, promotes client `error` and `critical` connector logs into PostHog exceptions, and can enable uncaught exception / unhandled rejection autocapture. With `errorTracking.mode: "manual"`, only the explicit `@blyp/core/posthog` exception APIs run automatically.

Browser and Expo loggers can request PostHog forwarding through the existing Blyp ingestion route:

```typescript
import { createClientLogger } from '@blyp/core/client';

const logger = createClientLogger({
  endpoint: '/inngest',
  connector: 'posthog',
});
```

```typescript
import { createExpoLogger } from '@blyp/core/expo';

const logger = createExpoLogger({
  endpoint: 'https://api.example.com/inngest',
  connector: 'posthog',
});
```

The browser and Expo connectors do not send directly to PostHog. They continue to send to Blyp's ingestion endpoint and Blyp forwards to PostHog when the server connector is configured. Browser and Expo apps do not use `posthog-node` directly. Workers are still out of scope for this connector.

---

## Databuddy connector

Use Databuddy when you want Blyp logs and handled errors forwarded as Databuddy events:

```typescript
export default {
  connectors: {
    databuddy: {
      enabled: true,
      mode: 'auto',
      apiKey: process.env.DATABUDDY_API_KEY,
      websiteId: process.env.DATABUDDY_WEBSITE_ID,
      enableBatching: true,
    },
  },
};
```

Static JSON config works too:

```json
{
  "connectors": {
    "databuddy": {
      "enabled": true,
      "mode": "manual",
      "apiKey": "db_xxx",
      "websiteId": "site_xxx"
    }
  }
}
```

Databuddy requires both `apiKey` and `websiteId`. Blyp marks the connector as missing until both values are present.

`mode: "auto"` forwards normal server-side Blyp logs to Databuddy automatically and captures handled server errors as Databuddy `error` events. `mode: "manual"` keeps the regular Blyp logger local-only and lets you opt in with the Databuddy subpath:

```typescript
import {
  captureDatabuddyException,
  createDatabuddyErrorTracker,
  createDatabuddyLogger,
  createStructuredDatabuddyLogger,
} from '@blyp/core/databuddy';

const databuddyLogger = createDatabuddyLogger();
databuddyLogger.info('manual databuddy log');
createDatabuddyErrorTracker().capture(new Error('manual databuddy exception'));
captureDatabuddyException(new Error('wrapped databuddy exception'));

const structured = createStructuredDatabuddyLogger('checkout', {
  orderId: 'ord_123',
});
structured.info('manual start');
structured.emit({ status: 200 });
```

Browser and Expo loggers can request Databuddy forwarding through the existing Blyp ingestion route:

```typescript
import { createClientLogger } from '@blyp/core/client';

const logger = createClientLogger({
  endpoint: '/inngest',
  connector: 'databuddy',
});
```

```typescript
import { createExpoLogger } from '@blyp/core/expo';

const logger = createExpoLogger({
  endpoint: 'https://api.example.com/inngest',
  connector: 'databuddy',
});
```

The browser and Expo connectors do not send directly to Databuddy. They continue to send to Blyp's ingestion endpoint and Blyp forwards to Databuddy when the server connector is configured. Browser and Expo apps do not use `@databuddy/sdk` directly. Workers are still out of scope for this connector.

---

## Better Stack connector

Use Better Stack when you want Blyp logs forwarded into Better Stack Logs through `@logtail/node`.

Configure `connectors.betterstack`:

```typescript
export default {
  connectors: {
    betterstack: {
      enabled: true,
      mode: 'auto',
      sourceToken: process.env.SOURCE_TOKEN,
      ingestingHost: process.env.INGESTING_HOST,
      errorTracking: {
        dsn: process.env.BETTERSTACK_ERROR_TRACKING_DSN,
        tracesSampleRate: 1.0,
      },
    },
  },
};
```

`INGESTING_HOST` must be a full absolute `http://` or `https://` URL. Blyp does not auto-read `SOURCE_TOKEN` or `INGESTING_HOST`; wire them through your config explicitly.

`mode: "auto"` forwards normal server-side Blyp logs to Better Stack automatically. `mode: "manual"` keeps the regular Blyp logger local-only and lets you opt in with the Better Stack subpath:

```typescript
import {
  captureBetterStackException,
  createBetterStackErrorTracker,
  createBetterStackLogger,
  createStructuredBetterStackLogger,
} from '@blyp/core/betterstack';

const betterStackLogger = createBetterStackLogger();
betterStackLogger.info('manual better stack log');
createBetterStackErrorTracker().capture(new Error('manual better stack exception'));
captureBetterStackException(new Error('wrapped better stack exception'));

const structured = createStructuredBetterStackLogger('checkout', {
  orderId: 'ord_123',
});
structured.info('manual start');
structured.emit({ status: 200 });
```

Configure `connectors.betterstack.errorTracking.dsn` when you want Better Stack error tracking through the Sentry SDK:

```typescript
export default {
  connectors: {
    betterstack: {
      enabled: true,
      sourceToken: process.env.SOURCE_TOKEN,
      ingestingHost: process.env.INGESTING_HOST,
      errorTracking: {
        dsn: process.env.BETTERSTACK_ERROR_TRACKING_DSN,
        tracesSampleRate: 1.0,
      },
    },
  },
};
```

With Better Stack error tracking configured, Blyp captures handled server errors, promotes client `error` and `critical` connector logs into exceptions, and exposes manual exception helpers through `@blyp/core/betterstack`.

Browser and Expo loggers can request Better Stack forwarding through the existing Blyp ingestion route:

```typescript
import { createClientLogger } from '@blyp/core/client';

const logger = createClientLogger({
  endpoint: '/inngest',
  connector: 'betterstack',
});
```

```typescript
import { createExpoLogger } from '@blyp/core/expo';

const logger = createExpoLogger({
  endpoint: 'https://api.example.com/inngest',
  connector: 'betterstack',
});
```

The browser and Expo connector does not send directly to Better Stack. It continues to send to Blyp's ingestion endpoint and Blyp forwards to Better Stack when the server connector is configured and ready. Browser and Expo apps do not use `@logtail/browser` directly. Workers are still out of scope for this connector.

---

## Sentry connector

Use Sentry when you want Blyp logs forwarded into Sentry Logs and, for `error` / `critical` `Error` payloads, into Sentry exceptions as well.

Configure `connectors.sentry`:

```typescript
export default {
  connectors: {
    sentry: {
      enabled: true,
      mode: 'auto',
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT,
      release: process.env.SENTRY_RELEASE,
    },
  },
};
```

Static JSON config works too:

```json
{
  "connectors": {
    "sentry": {
      "enabled": true,
      "mode": "manual",
      "dsn": "https://public@example.ingest.sentry.io/1"
    }
  }
}
```

`mode: "auto"` forwards normal server-side Blyp logs to Sentry automatically. `mode: "manual"` keeps the regular Blyp logger local-only and lets you opt in with the Sentry subpath:

```typescript
import { createSentryLogger, createStructuredSentryLogger } from '@blyp/core/sentry';

const sentryLogger = createSentryLogger();
sentryLogger.info('manual sentry log');

const structured = createStructuredSentryLogger('checkout', {
  orderId: 'ord_123',
});
structured.info('manual start');
structured.emit({ status: 200 });
```

Browser and Expo loggers can request Sentry forwarding through the existing Blyp ingestion route:

```typescript
import { createClientLogger } from '@blyp/core/client';

const logger = createClientLogger({
  endpoint: '/inngest',
  connector: 'sentry',
});
```

```typescript
import { createExpoLogger } from '@blyp/core/expo';

const logger = createExpoLogger({
  endpoint: 'https://api.example.com/inngest',
  connector: 'sentry',
});
```

The browser and Expo Sentry connector does not send directly to Sentry. It continues to send to Blyp's ingestion endpoint and Blyp forwards to Sentry when the server connector is configured and ready. If your app already initialized Sentry, Blyp reuses the existing client instead of replacing it. Workers are still out of scope for this connector.

---

## OTLP connector

Use OTLP when you want to forward Blyp logs to Grafana Cloud, Datadog, Honeycomb, Jaeger, Splunk, New Relic, or any OTLP-compatible backend.

Configure one or more named targets in `connectors.otlp`:

```typescript
export default {
  connectors: {
    otlp: [
      {
        name: 'grafana',
        enabled: true,
        mode: 'auto',
        endpoint: 'http://localhost:4318',
        headers: {
          'x-scope-orgid': process.env.GRAFANA_SCOPE_ID!,
        },
        auth: process.env.GRAFANA_AUTH,
      },
      {
        name: 'datadog',
        enabled: true,
        mode: 'manual',
        endpoint: 'https://http-intake.logs.datadoghq.com',
        headers: {
          'dd-api-key': process.env.DATADOG_API_KEY!,
        },
      },
      {
        name: 'honeycomb',
        enabled: true,
        mode: 'manual',
        endpoint: 'https://api.honeycomb.io',
        headers: {
          'x-honeycomb-team': process.env.HONEYCOMB_API_KEY!,
        },
      },
    ],
  },
};
```

Static JSON config works too:

```json
{
  "connectors": {
    "otlp": [
      {
        "name": "collector",
        "enabled": true,
        "mode": "auto",
        "endpoint": "http://localhost:4318"
      }
    ]
  }
}
```

Notes:

- `enabled: true` is required for each OTLP target.
- `endpoint` must be an absolute `http://` or `https://` URL.
- Blyp passes `endpoint` directly to the OpenTelemetry HTTP exporter. Collector base URLs such as `http://localhost:4318` are valid.
- If `headers.Authorization` is set, it wins over `auth`. Otherwise Blyp maps `auth` to the `Authorization` header.

`mode: "auto"` forwards normal server-side Blyp logs to every ready OTLP target automatically. `mode: "manual"` keeps the regular Blyp logger local-only and lets you opt in with the OTLP subpath:

```typescript
import { createOtlpLogger, createStructuredOtlpLogger } from '@blyp/core/otlp';

const otlpLogger = createOtlpLogger({
  name: 'grafana',
});
otlpLogger.info('manual otlp log');

const structured = createStructuredOtlpLogger('checkout', {
  orderId: 'ord_123',
}, {
  name: 'honeycomb',
});
structured.info('manual start');
structured.emit({ status: 200 });
```

Browser and Expo loggers can request named OTLP forwarding through the existing Blyp ingestion route:

```typescript
import { createClientLogger } from '@blyp/core/client';

const logger = createClientLogger({
  endpoint: '/inngest',
  connector: { type: 'otlp', name: 'grafana' },
});
```

```typescript
import { createExpoLogger } from '@blyp/core/expo';

const logger = createExpoLogger({
  endpoint: 'https://api.example.com/inngest',
  connector: { type: 'otlp', name: 'grafana' },
});
```

The browser and Expo OTLP connectors do not send directly to Grafana, Datadog, or other OTLP backends. They continue to send to Blyp's ingestion endpoint and Blyp forwards to the requested named OTLP target when the server connector is configured and ready. Workers are still out of scope for this connector.

---

## Framework integrations

### Elysia

```typescript
import { Elysia } from 'elysia';
import { createLogger } from '@blyp/core/elysia';

const app = new Elysia()
  .use(createLogger({
    level: 'debug',
    autoLogging: true,
    customProps: (ctx) => ({ 
      userId: ctx.headers['user-id'],
      requestId: crypto.randomUUID()
    })
  }))
  .get('/', () => 'Hello World')
  .get('/users', () => ({ users: [] }))
  .listen(3000);
```

### Hono

```typescript
import { Hono } from 'hono';
import { createLogger } from '@blyp/core/hono';

const app = new Hono();

app.use('*', createLogger({
  level: 'info',
  clientLogging: true,
}));

app.get('/posts', (c) => {
  c.get('blypLog').info('loaded posts');
  return c.json({ ok: true });
});
```

### Express

```typescript
import express from 'express';
import {
  createLogger,
  createExpressErrorLogger,
} from '@blyp/core/express';

const app = express();

app.use(createLogger({
  level: 'info',
  clientLogging: true,
}));

app.get('/posts', (req, res) => {
  req.blypLog.info('loaded posts');
  res.json({ ok: true });
});

app.use(createExpressErrorLogger());
app.use((error, _req, res, _next) => {
  res.status(500).json({ message: error.message });
});
```

### Fastify

```typescript
import Fastify from 'fastify';
import { createLogger } from '@blyp/core/fastify';

const app = Fastify();

await app.register(createLogger({
  level: 'info',
}));

app.get('/posts', async (request) => {
  request.blypLog.info('loaded posts');
  return { ok: true };
});
```

### NestJS

```typescript
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { logger } from '@blyp/core';
import { createLogger, BlypModule } from '@blyp/core/nestjs';

@Module({
  imports: [BlypModule.forRoot()],
})
class AppModule {}

createLogger({
  level: 'info',
  clientLogging: true,
});

const app = await NestFactory.create(AppModule);
await app.listen(3000);

logger.info('nest app booted');
```

Call `createLogger(...)` before `NestFactory.create(...)`. `BlypModule` wires HTTP request/error logging for both Nest Express and Nest Fastify, and regular application logs continue to use the root `logger` export.

### Next.js App Router

```typescript
import { createLogger } from '@blyp/core/nextjs';

const nextLogger = createLogger({
  level: 'info',
});

export const GET = nextLogger.withLogger(async (_request, _context, { log }) => {
  log.info('loaded posts');
  return Response.json({ ok: true });
});

// app/inngest/route.ts
export const POST = nextLogger.clientLogHandler;
```

### React Router

```typescript
import { createLogger } from '@blyp/core/react-router';

const reactRouterLogger = createLogger({
  level: 'info',
});

export const middleware = [reactRouterLogger.middleware];

export async function loader({ context }: { context: Record<string, unknown> }) {
  reactRouterLogger.getLogger(context).info('loaded route');
  return Response.json({ ok: true });
}

// app/routes/inngest.ts
export async function action({ request }: { request: Request }) {
  return reactRouterLogger.clientLogHandler(request);
}
```

### TanStack Start

```typescript
import { createLogger } from '@blyp/core/tanstack-start';

const tanstackLogger = createLogger({
  level: 'info',
});

export const requestMiddleware = tanstackLogger.requestMiddleware;

// In a server route mounted at /inngest
export const POST = tanstackLogger.clientLogHandlers.POST;
```

### Astro

```typescript
import { createLogger } from '@blyp/core/astro';

const astroLogger = createLogger({
  level: 'info',
});

export const onRequest = astroLogger.onRequest;

// src/pages/inngest.ts
export const POST = astroLogger.clientLogHandler;
```

### SvelteKit

```typescript
import { createLogger } from '@blyp/core/sveltekit';

const svelteLogger = createLogger({
  level: 'info',
});

export const handle = svelteLogger.handle;

// src/routes/inngest/+server.ts
export const POST = svelteLogger.clientLogHandler;
```

### Nitro

```typescript
import { createLogger } from '@blyp/core/nitro';

const nitroLogger = createLogger({
  level: 'info',
});

// server/plugins/blyp.ts
const plugin = nitroLogger.plugin;
export default plugin;

// server/api/inngest.post.ts
const clientLogHandler = nitroLogger.clientLogHandler;
export default clientLogHandler;
```

### Nuxt

```typescript
import { createLogger } from '@blyp/core/nuxt';

const nuxtLogger = createLogger({
  level: 'info',
});

// server/plugins/blyp.ts
const serverPlugin = nuxtLogger.serverPlugin;
export default serverPlugin;

// server/api/inngest.post.ts
const clientLogHandler = nuxtLogger.clientLogHandler;
export default clientLogHandler;
```

Nuxt reuses the Nitro request lifecycle internally, so request-scoped `blypLog` behavior matches the Nitro adapter.

### Cloudflare Workers

```typescript
import { initWorkersLogger, createWorkersLogger } from '@blyp/core/workers';

initWorkersLogger({
  env: { service: 'my-worker' },
});

export default {
  async fetch(request: Request): Promise<Response> {
    const log = createWorkersLogger(request);

    log.set({ action: 'handle_request' });

    const response = Response.json({ ok: true });
    log.emit({ response });

    return response;
  },
};
```

Error emission stays manual:

```typescript
const log = createWorkersLogger(request);

try {
  // handler work
} catch (error) {
  log.emit({ error });
  throw error;
}
```

The Workers integration is console-based. It does not use file logging, does not read `blyp.config.json`, and does not include client-log ingestion in this first version. Use the subpath import `@blyp/core/workers`.

---

## Advanced configuration

```typescript
import { createLogger } from '@blyp/core/elysia';

const logger = createLogger({
  level: 'info',
  autoLogging: {
    ignore: (ctx) => ctx.path === '/health'
  },
  clientLogging: {
    path: '/inngest',
    validate: ({ request }) => {
      return request.headers.get('x-blyp-client') === 'web';
    },
    enrich: ({ request }) => ({
      requestId: request.headers.get('x-request-id')
    })
  },
  file: {
    rotation: {
      maxSizeBytes: 10 * 1024 * 1024,
      maxArchives: 5,
      compress: true
    }
  },
  customProps: (ctx) => ({
    userId: ctx.headers['user-id'],
    ip: ctx.request.headers.get('x-forwarded-for'),
    userAgent: ctx.request.headers.get('user-agent')
  }),
  logErrors: true
});
```

---

## Frontend + Backend log sync

```typescript
import { Elysia } from 'elysia';
import { createLogger } from '@blyp/core/elysia';

const app = new Elysia()
  .use(createLogger({
    // clientLogging is enabled by default
  }))
  .listen(3000);
```

Enabling `clientLogging` writes accepted browser events into the same Blyp log stream as your backend logs. Programmatic router integrations auto-register `POST /inngest`; file-based integrations expose an explicit handler helper for the configured path. Client-originated records are tagged with `type: 'client_log'` and `source: 'client'`.

You can change the default client ingestion path globally in `blyp.config.json`:

```json
{
  "clientLogging": {
    "enabled": true,
    "path": "/inngest"
  }
}
```

Set `"enabled": false` to disable the auto-registered ingestion route.

---

## Runtime detection

```typescript
import { runtime } from '@blyp/core';

console.log(`Running on: ${runtime.type}`); // 'bun' or 'node'
console.log(`Is Bun: ${runtime.isBun}`);
console.log(`Is Node: ${runtime.isNode}`);

// Use runtime-specific optimizations
if (runtime.isBun) {
  console.log('Using Bun optimizations');
} else {
  console.log('Using Node.js fallbacks');
}
```

---

## Color utilities

```typescript
import {
  getMethodColor, 
  getStatusColor, 
  getColoredLevel 
} from '@blyp/core';

// Color HTTP methods
console.log(getMethodColor('GET'));    // Green GET
console.log(getMethodColor('POST'));   // Blue POST
console.log(getMethodColor('DELETE')); // Red DELETE

// Color status codes
console.log(getStatusColor(200)); // Green 200
console.log(getStatusColor(404)); // Red 404
console.log(getStatusColor(500)); // Magenta 500

// Color log levels
console.log(getColoredLevel('info'));    // Blue INFO
console.log(getColoredLevel('success')); // Green SUCCESS
console.log(getColoredLevel('error'));   // Red ERROR
```

---

## Configuration reference

### Server Logger Config

```typescript
interface ServerLoggerConfig<Context> {
  level?: 'error' | 'critical' | 'warning' | 'info' | 'success' | 'debug' | 'table';
  pretty?: boolean;
  logDir?: string;
  file?: {
    enabled?: boolean;
    dir?: string;
    archiveDir?: string;
    format?: 'ndjson';
    rotation?: {
      enabled?: boolean;
      maxSizeBytes?: number;
      maxArchives?: number;
      compress?: boolean;
    };
  };
  autoLogging?: boolean | { ignore?: (ctx: Context) => boolean };
  customProps?: (ctx: Context) => Record<string, unknown>;
  logErrors?: boolean;
  clientLogging?: boolean | {
    path?: string;
    validate?: (ctx: Context, payload: ClientLogEvent) => boolean | Promise<boolean>;
    enrich?: (ctx: Context, payload: ClientLogEvent) => Record<string, unknown> | Promise<Record<string, unknown>>;
  };
}

interface ClientLoggerConfig {
  endpoint?: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  localConsole?: boolean;
  remoteSync?: boolean;
  metadata?: Record<string, unknown> | (() => Record<string, unknown>);
  delivery?: RemoteDeliveryConfig;
}

interface RemoteDeliveryConfig {
  maxRetries?: number; // default 3
  retryDelayMs?: number; // default 5000
  maxQueueSize?: number; // default 100
  warnOnFailure?: boolean; // default true
  onSuccess?: (ctx: RemoteDeliverySuccessContext) => void;
  onRetry?: (ctx: RemoteDeliveryRetryContext) => void;
  onFailure?: (ctx: RemoteDeliveryFailureContext) => void;
  onDrop?: (ctx: RemoteDeliveryDropContext) => void;
}
```

---

## Log levels

- `error` (0) - Error messages
- `critical` (1) - Critical system errors
- `warning` (2) - Warning messages
- `info` (3) - General information
- `success` (4) - Success messages
- `debug` (5) - Debug information
- `table` (6) - Table data logging

---

## HTTP request logging

All server integrations automatically log HTTP requests with:
- Colored HTTP methods (GET, POST, PUT, PATCH, DELETE)
- Status codes with appropriate colors
- Response times
- Request paths
- Custom arrows for different methods (→, ←, ×)

Example output:

```
[2025-09-20 16:15:43] INFO PUT ← 200 /api/users
[2025-09-20 16:15:43] ERROR GET → 404 /api/not-found
```

---

## File logging

Logs are automatically written to `logs/`:
- `log.ndjson` - Active combined log stream
- `log.error.ndjson` - Active error and critical log stream
- `archive/*.ndjson.gz` - Rotated gzip archives

Client-ingested events are written into the same `log.ndjson` stream, with the original client payload stored under `data`.

Defaults:
- Rotation is enabled
- Each active file rotates at `10 MB`
- Each stream keeps `5` archives
- Old archives are gzip-compressed by default

Example configuration:

```typescript
import { createStandaloneLogger } from '@blyp/core';

const logger = createStandaloneLogger({
  pretty: true,
  file: {
    rotation: {
      maxSizeBytes: 5 * 1024 * 1024,
      maxArchives: 3,
      compress: true
    }
  }
});
```

### Reading stored logs

```typescript
import { readLogFile } from '@blyp/core';

const pretty = await readLogFile('logs/log.ndjson');
const records = await readLogFile('logs/archive/log.20260309T101530Z.ndjson.gz', {
  format: 'json',
  limit: 100
});
```

### Migration note

- `log.txt` was replaced by `log.ndjson`
- `log.error.txt` was replaced by `log.error.ndjson`
- rotated history now lives under `logs/archive/`

---

## Performance

- **100 log calls**: ~3ms execution time
- **Runtime detection**: Cached for performance
- **Color functions**: Optimized for speed
- **File operations**: Efficient Bun/Node.js adapters
