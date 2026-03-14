# Blyp Logger

> *The silent observer for your applications*

**Blyp** is a high-performance, runtime-adaptive logger for standalone apps and modern TypeScript web frameworks. It combines Bun-friendly runtime detection, structured NDJSON file logging, browser-to-server log ingestion, and framework-specific HTTP logging helpers.

[![Bun](https://img.shields.io/badge/Bun-1.2+-000000?style=flat&logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat&logo=typescript)](https://www.typescriptlang.org)
[![Elysia](https://img.shields.io/badge/Elysia-1.4+-00D8FF?style=flat)](https://elysiajs.com)

## Features

- **Runtime detection** — Automatically optimizes for Bun vs Node.js
- **TypeScript** — Full type safety throughout
- **Framework integrations** — Elysia, Hono, Express, Fastify, NestJS, Next.js App Router, TanStack Start, SvelteKit, Cloudflare Workers
- **Expo integration** — Mobile client logging for Expo apps with structured backend sync
- **PostHog connector** — Automatic or manual PostHog log forwarding for server, browser, and Expo flows
- **OTLP connector** — Automatic or manual OpenTelemetry log forwarding for Grafana, Datadog, Honeycomb, and any OTLP-compatible backend
- **Standalone usage** — Use without any framework
- **Structured file logging** — NDJSON with size-based rotation and gzip archives
- **Client log sync** — Browser logs ingested into your backend stream

## Project structure

```
blyp/
├── exports/
│   ├── client.js              # Public client entry shim
│   ├── connectors/
│   │   └── posthog.js         # Public connector entry shims
│   └── frameworks/
│       └── elysia.js          # Public framework entry shims
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
├── types/
│   ├── index.d.ts             # Public type entry shim
│   ├── connectors/
│   │   └── posthog.d.ts       # Public connector type shims
│   └── frameworks/
│       └── elysia.d.ts        # Public framework type shims
├── tests/
│   ├── frameworks/            # One test file per server integration
│   ├── helpers/               # Shared test utilities
│   ├── *.test.ts              # Focused core tests
│   └── README.md              # Test documentation
└── README.md
```

## Installation

```bash
bun add blyp-js
npx expo install expo-network
```

Also: `npm install blyp-js` | `yarn add blyp-js` | `pnpm add blyp-js`

## Usage

### Basic logger

```typescript
import { logger } from 'blyp-js';

logger.info('Hello world');
logger.success('Operation completed');
logger.error('Something went wrong');
logger.warning('Warning message');
```

### Structured request batches

Standalone usage:

```typescript
import { createStructuredLog } from 'blyp-js';

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
import { createStructuredLog } from 'blyp-js';
import { Elysia } from 'elysia';
import { createLogger } from 'blyp-js/elysia';

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

### Errors

```typescript
import { createError } from 'blyp-js';

throw createError({ status: 404, message: 'Not found' });
```

For the full error API (`HTTP_CODES`, `extend`, `create`), see [Full documentation](docs/README.md#errors).

### Framework integrations

Blyp supports **Elysia**, **Hono**, **Express**, **Fastify**, **NestJS**, **Next.js**, **TanStack Start**, **SvelteKit**, and **Cloudflare Workers**. Example with Elysia:

```typescript
import { Elysia } from 'elysia';
import { createLogger } from 'blyp-js/elysia';

const app = new Elysia()
  .use(createLogger({ level: 'info', autoLogging: true }))
  .get('/', () => 'Hello World')
  .listen(3000);
```

For other frameworks, client logging, advanced configuration, and utilities, see [Full documentation](docs/README.md).

### Expo

```typescript
import { createExpoLogger } from 'blyp-js/expo';

const logger = createExpoLogger({
  endpoint: 'https://api.example.com/inngest',
});

logger.info('app mounted');
```

Expo uses the runtime `fetch` implementation for delivery and `expo-network` for connectivity metadata. Install `expo-network` in your app and use an absolute ingestion URL.

### Better Stack

Use `connectors.betterstack` when you want Blyp logs forwarded into Better Stack through `@logtail/node`:

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

In `auto` mode, the normal Blyp server loggers forward to Better Stack automatically. In `manual` mode, use `blyp-js/betterstack`:

```typescript
import {
  captureBetterStackException,
  createBetterStackErrorTracker,
  createBetterStackLogger,
  createStructuredBetterStackLogger,
} from 'blyp-js/betterstack';

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
import { createClientLogger } from 'blyp-js/client';

const logger = createClientLogger({
  endpoint: '/inngest',
  connector: 'betterstack',
});
```

```typescript
import { createExpoLogger } from 'blyp-js/expo';

const logger = createExpoLogger({
  endpoint: 'https://api.example.com/inngest',
  connector: 'betterstack',
});
```

The browser and Expo connector flow still posts to Blyp first. Blyp forwards to Better Stack only when the server connector is configured. Browser and Expo apps do not use `@logtail/browser` directly. Workers remain out of scope for this connector.

### PostHog

Use `blyp.config.ts` when you want to read the PostHog project key from the environment:

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

In `auto` mode, the normal Blyp server loggers forward to PostHog automatically. In `manual` mode, use `blyp-js/posthog`:

```typescript
import {
  capturePosthogException,
  createPosthogErrorTracker,
  createPosthogLogger,
  createStructuredPosthogLogger,
} from 'blyp-js/posthog';

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
import { createClientLogger } from 'blyp-js/client';

const logger = createClientLogger({
  endpoint: '/inngest',
  connector: 'posthog',
});
```

Client `error` and `critical` logs requested through the PostHog connector are promoted to PostHog exceptions only when server-side PostHog error tracking is enabled in `auto` mode.

The client and Expo connector flow still posts to Blyp first. Blyp forwards to PostHog only when the server connector is configured, and browser or Expo apps do not use `posthog-node` directly. Workers remain out of scope for this connector.

### Sentry

Use `connectors.sentry` when you want Blyp logs forwarded into Sentry Logs:

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

In `auto` mode, normal Blyp server loggers forward to Sentry automatically. In `manual` mode, use `blyp-js/sentry`:

```typescript
import { createSentryLogger, createStructuredSentryLogger } from 'blyp-js/sentry';

createSentryLogger().info('manual sentry log');

const structured = createStructuredSentryLogger('checkout', {
  orderId: 'ord_123',
});
structured.info('manual start');
structured.emit({ status: 200 });
```

Browser and Expo loggers can request server-side forwarding through Blyp's ingestion endpoint:

```typescript
import { createClientLogger } from 'blyp-js/client';

const logger = createClientLogger({
  endpoint: '/inngest',
  connector: 'sentry',
});
```

```typescript
import { createExpoLogger } from 'blyp-js/expo';

const logger = createExpoLogger({
  endpoint: 'https://api.example.com/inngest',
  connector: 'sentry',
});
```

The browser and Expo Sentry flow still posts to Blyp first. Blyp forwards to Sentry only when the server connector is configured. If Sentry was already initialized by the app, Blyp reuses that client instead of replacing it.

### OTLP

Use `connectors.otlp` when you want to send logs to named OTLP-compatible backends such as Grafana Cloud, Datadog, Honeycomb, or a self-hosted OpenTelemetry Collector:

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

In `auto` mode, normal Blyp server loggers forward to every ready OTLP target automatically. In `manual` mode, use `blyp-js/otlp` and select a named target:

```typescript
import { createOtlpLogger, createStructuredOtlpLogger } from 'blyp-js/otlp';

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
import { createClientLogger } from 'blyp-js/client';

const logger = createClientLogger({
  endpoint: '/inngest',
  connector: { type: 'otlp', name: 'grafana' },
});
```

```typescript
import { createExpoLogger } from 'blyp-js/expo';

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

GitHub Actions publishes the package to npm when a GitHub Release is published. Add an `NPM_TOKEN` repository secret before using the workflow.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get set up and submit changes.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

## Acknowledgments

[Winston](https://github.com/winstonjs/winston) · [Elysia](https://elysiajs.com) · [Chalk](https://github.com/chalk/chalk) · [Bun](https://bun.sh)

## Links

- [GitHub Repository](https://github.com/Blyphq/blyp)
- [NPM Package](https://www.npmjs.com/package/blyp-js)
- [Documentation](docs/README.md)
- [Issues](https://github.com/Blyphq/blyp/issues)

---

*Blyp silently watches over your applications, logging everything that happens under its watchful gaze.*
