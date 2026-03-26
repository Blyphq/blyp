# Blyp Logger

> **Blyp HQ** (`Blyphq`) is the GitHub org behind the Blyp project.

> *The silent observer for your applications*

**Blyp** is a high-performance, runtime-adaptive logger for standalone apps and modern TypeScript web frameworks. It combines Bun-friendly runtime detection, structured NDJSON file logging, browser-to-server log ingestion, and framework-specific HTTP logging helpers.

[![Bun](https://img.shields.io/badge/Bun-1.2+-000000?style=flat&logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat&logo=typescript)](https://www.typescriptlang.org)
[![Elysia](https://img.shields.io/badge/Elysia-1.4+-00D8FF?style=flat)](https://elysiajs.com)

## Features

- **Runtime detection** — Automatically optimizes for Bun vs Node.js
- **TypeScript** — Full type safety throughout
- **Framework integrations** — Elysia, Hono, Express, Fastify, NestJS, Next.js App Router, React Router, Astro, Nitro, Nuxt, TanStack Start, SvelteKit, Cloudflare Workers
- **Expo integration** — Mobile client logging for Expo apps with structured backend sync
- **PostHog connector** — Automatic or manual PostHog log forwarding for server, browser, and Expo flows
- **Databuddy connector** — Automatic or manual Databuddy log forwarding and handled-error tracking for server, browser, and Expo flows
- **OTLP connector** — Automatic or manual OpenTelemetry log forwarding for Grafana, Datadog, Honeycomb, and any OTLP-compatible backend
- **Connector delivery queue** — Optional server-side memory + SQLite retry queue for connector delivery without Redis
- **Standalone usage** — Use without any framework
- **Structured file logging** — NDJSON with size-based rotation and gzip archives
- **Database logging** — Serverless-friendly persistence with Prisma and Drizzle adapters for Postgres and MySQL
- **Client log sync** — Browser logs ingested into your backend stream
- **AI SDK tracing** — AI SDK middleware-based tracing for `generateText` and `streamText` flows

## Project structure

```
blyp/
├── dist/                      # Published JS and declaration output
│   ├── connectors/
│   │   └── posthog.js         # Public connector build output
│   └── frameworks/
│       └── elysia.js          # Public framework build output
├── index.ts                   # Main source export bridge
├── src/
│   ├── core/                  # Logger runtime and file logging internals
│   ├── connectors/            # Connector implementations
│   ├── frameworks/            # Framework implementations
│   ├── shared/                # Shared runtime/error utilities
│   └── types/
│       ├── framework.types.ts # Shared public contracts
│       ├── connectors/
│       │   └── posthog.ts     # Connector-specific source types
│       └── frameworks/
│           └── elysia.ts      # Framework-specific source types
├── tests/
│   ├── frameworks/            # One test file per server integration
│   ├── helpers/               # Shared test utilities
│   ├── *.test.ts              # Focused core tests
│   └── README.md              # Test documentation
└── README.md
```

## Installation

```bash
bun add @blyp/core
npx expo install expo-network
```

Also: `npm install @blyp/core` | `yarn add @blyp/core` | `pnpm add @blyp/core`

## Usage

### Basic logger

```typescript
import { logger } from '@blyp/core';

logger.info('Hello world');
logger.success('Operation completed');
logger.error('Something went wrong');
logger.warning('Warning message');
```

### Structured request batches

Standalone usage:

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

Framework usage with Elysia:

```typescript
import { createStructuredLog } from '@blyp/core';
import { Elysia } from 'elysia';
import { createLogger } from '@blyp/core/elysia';

const app = new Elysia()
  .use(createLogger({ level: 'info' }))
  .post('/hello', ({ set }) => {
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
      hostname: app.server?.hostname,
      port: app.server?.port,
    });

    structuredLog.info('route started');
    structuredLog.emit({ status: 200 });

    set.status = 200;
    return 'ok';
  });
```

Inside framework handlers, the imported `createStructuredLog(...)` automatically binds to the active request-scoped logger. Structured logs are emitted only when you call `.emit()`. In framework request loggers, a structured emit replaces that request's normal auto request log. If you mix a request-scoped structured logger with the root `logger` in the same request, Blyp warns once and ignores the root logger call.

### Automatic redaction

Blyp redacts sensitive values before they reach the console, files, database adapters, connectors, client ingestion, or framework request logs.

Default redacted keys:

`password`, `passwd`, `pwd`, `secret`, `token`, `api_key`, `apikey`, `api_secret`, `authorization`, `auth`, `x-api-key`, `private_key`, `privatekey`, `access_token`, `refresh_token`, `client_secret`, `session`, `cookie`, `set-cookie`, `ssn`, `credit_card`, `card_number`, `cvv`, `cvc`, `otp`, `pin`

Blyp also scans string values for common secret patterns and replaces matches with typed markers such as `[REDACTED:bearer]`, `[REDACTED:jwt]`, `[REDACTED:api_key]`, and `[REDACTED:card]`.

```ts
export default {
  redact: {
    keys: ['my_custom_secret', 'internal_token'],
    paths: ['user.ssn', 'payment.**.raw'],
    patterns: [/MY_ORG_[A-Z0-9]{32}/],
    disablePatternScanning: false,
  },
};
```

Notes:

- `redact.paths` supports exact paths, `*`, and `**`
- regex `patterns` require executable config such as `blyp.config.ts`
- request headers such as `Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`, and `X-Auth-Token` are redacted by default
- Blyp preserves keys and replaces values with `[REDACTED]` or a typed marker

### Errors

```typescript
import { createError } from '@blyp/core';

throw createError({ status: 404, message: 'Not found' });
```

For the full error API (`HTTP_CODES`, `extend`, `create`), see [Full documentation](docs/README.md#errors).

### Framework integrations

Blyp supports **Elysia**, **Hono**, **Express**, **Fastify**, **NestJS**, **Next.js**, **React Router**, **Astro**, **Nitro**, **Nuxt**, **TanStack Start**, **SvelteKit**, and **Cloudflare Workers**. Example with Elysia:

```typescript
import { Elysia } from 'elysia';
import { createLogger } from '@blyp/core/elysia';

const app = new Elysia()
  .use(createLogger({ level: 'info', autoLogging: true }))
  .get('/', () => 'Hello World')
  .listen(3000);
```

Framework HTTP loggers also support path filtering:

```typescript
import { createLogger } from '@blyp/core/express';

app.use(createLogger({
  includePaths: ['/api/**'],
  ignorePaths: ['/api/internal/**'],
}));
```

`includePaths` works as an allowlist for automatic `http_request` and `http_error` logs. It uses the same wildcard matching as `ignorePaths`. When both are configured, Blyp logs only included paths and then removes any path that also matches `ignorePaths`.

For other frameworks, client logging, advanced configuration, and utilities, see [Full documentation](docs/README.md).

### Expo

```typescript
import { createExpoLogger } from '@blyp/core/expo';

const logger = createExpoLogger({
  endpoint: 'https://api.example.com/inngest',
});

logger.info('app mounted');
```

Expo uses the runtime `fetch` implementation for delivery and `expo-network` for connectivity metadata. Install `expo-network` in your app and use an absolute ingestion URL.

### Durable connector retries

Server-side connector delivery can be queued and retried with an internal Blyp-managed SQLite file. This is opt-in, uses at-least-once delivery semantics, and currently applies to server connector log forwarding only.

```typescript
import { createStandaloneLogger } from '@blyp/core/standalone';

const logger = createStandaloneLogger({
  connectors: {
    betterstack: {
      enabled: true,
      sourceToken: process.env.BETTERSTACK_TOKEN,
      ingestingHost: 'https://in.logs.betterstack.com',
    },
    delivery: {
      enabled: true,
      durableQueuePath: '.blyp/connectors.sqlite',
      retry: {
        maxAttempts: 8,
        initialBackoffMs: 500,
        maxBackoffMs: 30000,
      },
    },
  },
});
```

Notes:

- Blyp stores the durable queue in its own SQLite file, not your app database.
- Blyp uses an in-memory hot buffer first, then persists retryable connector failures to SQLite.
- Older runtimes without built-in SQLite support fall back to memory-only retries with a warning.
- Exception capture remains best-effort direct delivery in this first version.

### AI tracing

Use `@blyp/core/ai/vercel` for Vercel AI SDK middleware, or the provider wrappers when you want direct SDK instrumentation without a universal LLM abstraction.

Common case:

```typescript
import { streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { blypModel } from '@blyp/core/ai/vercel';

const model = blypModel(anthropic('claude-sonnet-4-5'), {
  operation: 'support_chat',
});

const result = streamText({
  model,
  prompt: 'Write a refund reply for this customer',
});
```

Advanced middleware usage:

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

By default Blyp logs one structured `ai_trace` record per AI SDK call with provider, model, operation, token usage, finish reason, timing, and best-effort tool events. Prompt, response, reasoning, tool input, tool output, and stream chunk capture are off by default. When Blyp request context is active, AI traces inherit the active request-scoped logger automatically.

Direct provider wrappers:

```typescript
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { wrapOpenAI } from '@blyp/core/ai/openai';
import { wrapAnthropic } from '@blyp/core/ai/anthropic';

const openai = wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), {
  operation: 'draft_blog_intro',
});

const anthropic = wrapAnthropic(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), {
  operation: 'summarize_ticket',
});
```

OpenRouter is supported through the OpenAI-compatible path:

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

Optional transport tracing:

```typescript
import OpenAI from 'openai';
import { blypFetch } from '@blyp/core/ai/fetch';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  fetch: blypFetch(fetch),
});
```

### Database logging

Use `destination: 'database'` when you cannot rely on filesystem writes, such as serverless deployments. Database mode requires an executable config file like `blyp.config.ts` because Prisma and Drizzle adapters are runtime objects.

Prisma:

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

Drizzle:

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

In database mode, Blyp keeps connectors working as usual and replaces only the primary local persistence backend. Promise-based and hook-driven framework integrations such as Hono, Elysia, Next.js, React Router, Astro, Nitro, Nuxt, SvelteKit, and TanStack Start flush database writes before the request finishes. In callback-style servers, call `await logger.flush()` at your own boundary when you need a hard durability point.

Use the Blyp CLI to scaffold the schema and migrations:

```bash
blyp logs init --adapter prisma --dialect postgres
blyp logs init --adapter drizzle --dialect mysql
```

### Better Stack

Use `connectors.betterstack` when you want Blyp logs forwarded into Better Stack through `@logtail/node`:

Install the optional peer dependencies for this connector when you enable it:

```bash
bun add @logtail/node @sentry/node
```

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

In `auto` mode, the normal Blyp server loggers forward to Better Stack automatically. In `manual` mode, use `@blyp/core/betterstack`:

```typescript
import {
  captureBetterStackException,
  createBetterStackErrorTracker,
  createBetterStackLogger,
  createStructuredBetterStackLogger,
} from '@blyp/core/betterstack';

createBetterStackLogger().info('manual better stack log');
createBetterStackErrorTracker().capture(new Error('manual better stack exception'));
captureBetterStackException(new Error('wrapped better stack exception'));

const structured = createStructuredBetterStackLogger('checkout', {
  orderId: 'ord_123',
});
structured.info('manual start');
structured.emit({ status: 200 });
```

When `connectors.betterstack.errorTracking.dsn` is configured, Blyp captures handled server errors into Better Stack error tracking using the Sentry SDK. Client `error` and `critical` logs requested through the Better Stack connector are promoted to exceptions as well.

Browser and Expo loggers can request server-side Better Stack forwarding through the existing ingestion endpoint:

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

The browser and Expo connector flow still posts to Blyp first. Blyp forwards to Better Stack only when the server connector is configured. Browser and Expo apps do not use `@logtail/browser` directly. Workers remain out of scope for this connector.

### PostHog

Use `blyp.config.ts` when you want to read the PostHog project key from the environment:

Install the optional peer dependencies for this connector when you enable it:

```bash
bun add posthog-node @opentelemetry/api-logs @opentelemetry/exporter-logs-otlp-http @opentelemetry/resources @opentelemetry/sdk-logs
```

```typescript
export default {
  connectors: {
    posthog: {
      enabled: true,
      mode: 'auto',
      projectKey: process.env.POSTHOG_PROJECT_KEY,
      errorTracking: {
        enabled: true,
        mode: 'auto',
      },
    },
  },
};
```

In `auto` mode, the normal Blyp server loggers forward to PostHog automatically. In `manual` mode, use `@blyp/core/posthog`:

```typescript
import {
  capturePosthogException,
  createPosthogErrorTracker,
  createPosthogLogger,
  createStructuredPosthogLogger,
} from '@blyp/core/posthog';

createPosthogLogger().info('manual posthog log');
createPosthogErrorTracker().capture(new Error('manual posthog exception'));
capturePosthogException(new Error('wrapped posthog exception'));

const structured = createStructuredPosthogLogger('checkout', { orderId: 'ord_123' });
structured.info('manual start');
structured.emit({ status: 200 });
```

`connectors.posthog.errorTracking.mode: 'auto'` also captures Blyp handled server errors and can enable uncaught exception / unhandled rejection autocapture through `enableExceptionAutocapture`.

Browser and Expo loggers can request server-side PostHog forwarding through the existing ingestion endpoint:

```typescript
import { createClientLogger } from '@blyp/core/client';

const logger = createClientLogger({
  endpoint: '/inngest',
  connector: 'posthog',
});
```

Client `error` and `critical` logs requested through the PostHog connector are promoted to PostHog exceptions only when server-side PostHog error tracking is enabled in `auto` mode.

The client and Expo connector flow still posts to Blyp first. Blyp forwards to PostHog only when the server connector is configured, and browser or Expo apps do not use `posthog-node` directly. Workers remain out of scope for this connector.

### Databuddy

Use `connectors.databuddy` when you want Blyp logs and handled errors forwarded into Databuddy:

Install the optional peer dependency for this connector when you enable it:

```bash
bun add @databuddy/sdk
```

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

Databuddy requires both `apiKey` and `websiteId`. Blyp treats the connector as unavailable until both are configured.

In `auto` mode, normal Blyp server loggers forward to Databuddy automatically and handled errors are captured as Databuddy `error` events. In `manual` mode, use `@blyp/core/databuddy`:

```typescript
import {
  captureDatabuddyException,
  createDatabuddyErrorTracker,
  createDatabuddyLogger,
  createStructuredDatabuddyLogger,
} from '@blyp/core/databuddy';

createDatabuddyLogger().info('manual databuddy log');
createDatabuddyErrorTracker().capture(new Error('manual databuddy exception'));
captureDatabuddyException(new Error('wrapped databuddy exception'));

const structured = createStructuredDatabuddyLogger('checkout', { orderId: 'ord_123' });
structured.info('manual start');
structured.emit({ status: 200 });
```

Browser and Expo loggers can request server-side Databuddy forwarding through the existing ingestion endpoint:

```typescript
import { createClientLogger } from '@blyp/core/client';

const logger = createClientLogger({
  endpoint: '/inngest',
  connector: 'databuddy',
});
```

Client `error` and `critical` logs requested through the Databuddy connector are promoted to Databuddy `error` events only when server-side Databuddy is enabled in `auto` mode. The client and Expo connector flow still posts to Blyp first. Blyp forwards to Databuddy only when the server connector is configured.

### Sentry

Use `connectors.sentry` when you want Blyp logs forwarded into Sentry Logs:

Install the optional peer dependency for this connector when you enable it:

```bash
bun add @sentry/node
```

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

In `auto` mode, normal Blyp server loggers forward to Sentry automatically. In `manual` mode, use `@blyp/core/sentry`:

```typescript
import { createSentryLogger, createStructuredSentryLogger } from '@blyp/core/sentry';

createSentryLogger().info('manual sentry log');

const structured = createStructuredSentryLogger('checkout', {
  orderId: 'ord_123',
});
structured.info('manual start');
structured.emit({ status: 200 });
```

Browser and Expo loggers can request server-side forwarding through Blyp's ingestion endpoint:

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

The browser and Expo Sentry flow still posts to Blyp first. Blyp forwards to Sentry only when the server connector is configured. If Sentry was already initialized by the app, Blyp reuses that client instead of replacing it.

### OTLP

Use `connectors.otlp` when you want to send logs to named OTLP-compatible backends such as Grafana Cloud, Datadog, Honeycomb, or a self-hosted OpenTelemetry Collector:

Install the optional peer dependencies for this connector when you enable it:

```bash
bun add @opentelemetry/api-logs @opentelemetry/exporter-logs-otlp-http @opentelemetry/resources @opentelemetry/sdk-logs
```

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

In `auto` mode, normal Blyp server loggers forward to every ready OTLP target automatically. In `manual` mode, use `@blyp/core/otlp` and select a named target:

```typescript
import { createOtlpLogger, createStructuredOtlpLogger } from '@blyp/core/otlp';

createOtlpLogger({
  name: 'grafana',
}).info('manual otlp log');

const structured = createStructuredOtlpLogger(
  'checkout',
  { orderId: 'ord_123' },
  { name: 'honeycomb' }
);
structured.info('manual start');
structured.emit({ status: 200 });
```

Browser and Expo loggers can request server-side forwarding to a named OTLP target through the existing ingestion endpoint:

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

The browser and Expo OTLP flows still post to Blyp first. Blyp forwards to the named OTLP target only when that server connector is configured and ready.

Log levels, HTTP request logging, and file logging (rotation, archives, reading stored logs) are documented in [docs](docs/README.md#file-logging).

## Testing

Run tests:

```bash
bun run test
```

The suite covers runtime detection, standalone and client logger, file logging, and all framework integrations. For more commands and previews, see [tests/README.md](tests/README.md).

## Development

**Prerequisites:** [Bun](https://bun.sh) 1.2+ (or [Node.js](https://nodejs.org) 18+), [TypeScript](https://www.typescriptlang.org) 5.0+

```bash
git clone https://github.com/Blyphq/blyp.git
cd blyp
bun install
bun run test
bun run build
bun run type-check
```

## Publishing

GitHub Actions publishes the package to npm when a GitHub Release is published. Add an `NPM_TOKEN` repository secret before using the workflow. The publish workflow uses npm provenance attestation, and maintainers should rotate `NPM_TOKEN` every 90 days.

## Security

Security issues should be reported through GitHub's private advisory flow for this repository. Public issue reports are not the right channel for suspected vulnerabilities. Security details and disclosure expectations are in [SECURITY.md](SECURITY.md).

## Runtime dependencies

Blyp keeps its shipped runtime dependency surface small and documents each direct dependency:

- `pino`: core structured logger engine
- `pino-pretty`: human-readable local and development console output when `pretty` mode is enabled
- `jiti`: runtime loading for `blyp.config.*` files and optional first-party subpath modules
- `fflate`: gzip compression and decompression for archived log files and log reading
- `zod`: runtime validation for shared and client payloads

Optional connectors stay in `peerDependencies` so regular installs do not pull large connector-specific transitive trees by default.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get set up and submit changes.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

## Acknowledgments

[Winston](https://github.com/winstonjs/winston) · [Elysia](https://elysiajs.com) · [Chalk](https://github.com/chalk/chalk) · [Bun](https://bun.sh)

## Links

- [GitHub Repository](https://github.com/Blyphq/blyp)
- [NPM Package](https://www.npmjs.com/package/@blyp/core)
- [Documentation](docs/README.md)
- [Security Policy](SECURITY.md)
- [Issues](https://github.com/Blyphq/blyp/issues)

---

*Blyp silently watches over your applications, logging everything that happens under its watchful gaze.*
