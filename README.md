# Blyp Logger

**Blyp** is a TypeScript logger for standalone apps and modern web frameworks.
It gives you structured logging, framework adapters, client-to-server log ingestion, and optional connectors without turning the root README into a full manual.

[![Bun](https://img.shields.io/badge/Bun-1.2+-000000?style=flat&logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat&logo=typescript)](https://www.typescriptlang.org)
[![Elysia](https://img.shields.io/badge/Elysia-1.4+-00D8FF?style=flat)](https://elysiajs.com)

## Highlights

- Use it in standalone apps or with framework adapters.
- Create structured, request-scoped logs with `createStructuredLog`.
- Redact common secrets before logs reach output or downstream sinks.
- Ingest logs from browser and Expo apps into your backend flow.
- Forward logs to optional connectors such as PostHog, Better Stack, Sentry, Databuddy, and OTLP targets.
- Built for Bun-first setups with support for supported Node runtimes.
- Full TypeScript support across the main package and subpath exports.

## Installation

```bash
bun add @blyp/core
```

`npm install @blyp/core` | `pnpm add @blyp/core` | `yarn add @blyp/core`

If you use the Expo logger, also install `expo-network`.

```bash
npx expo install expo-network
```

## Quick start

```ts
import { logger } from '@blyp/core';

logger.info('Server started', { port: 3000 });
logger.success('Connected to database');
logger.error('Payment failed', { orderId: 'ord_123' });
```

## Structured logs

```ts
import { createStructuredLog } from '@blyp/core';

const log = createStructuredLog('checkout', {
  service: 'web-api',
  level: 'info',
  timestamp: new Date().toISOString(),
});

log.set({
  user: { id: 1, plan: 'pro' },
  cart: { items: 3, total: 9999 },
});

log.info('checkout started');
log.emit({ status: 200 });
```

Inside framework handlers, `createStructuredLog(...)` binds to the active request logger automatically. The final structured record is written when you call `.emit()`.

## Framework example

Blyp supports Elysia, Hono, Express, Fastify, NestJS, Next.js App Router, React Router, Astro, Nitro, Nuxt, TanStack Start, SolidStart, SvelteKit, and Cloudflare Workers.

```ts
import { Elysia } from 'elysia';
import { createLogger } from '@blyp/core/elysia';

const app = new Elysia()
  .use(createLogger({ level: 'info', autoLogging: true }))
  .get('/', () => 'Hello World')
  .listen(3000);
```

See the [framework integration docs](docs/README.md#framework-integrations) for the full adapter matrix and framework-specific examples.

## Better Auth

Better Auth can be attached as a real Better Auth plugin and then reused by Blyp framework adapters for request enrichment.

```ts
import { betterAuth } from 'better-auth';
import { blyp } from '@blyp/core/better-auth';

export const auth = betterAuth({
  plugins: [
    blyp({
      clientLogging: true,
    }),
  ],
});
```

```ts
import { createLogger } from '@blyp/core/nextjs';
import { auth } from './auth';

export const nextLogger = createLogger({
  auth: {
    betterAuth: auth,
  },
});
```

```ts
import { createAuthClient } from 'better-auth/client';
import { blypClient } from '@blyp/core/better-auth';

export const authClient = createAuthClient({
  plugins: [blypClient()],
});

const logger = authClient.blyp.createLogger();
logger.info('mounted');
```

## More features

- [Automatic redaction](docs/README.md#automatic-redaction) for common secrets, headers, and custom patterns.
- [Client and Expo logging](docs/README.md#client) for browser and mobile apps that send logs through your backend.
- [AI tracing](docs/README.md#ai-sdk-tracing) for Vercel AI SDK, Better Agent, OpenAI, Anthropic, and compatible transports.
- [Database logging](docs/README.md#database-logging) when file persistence is not the right fit.
- Connector forwarding for [PostHog](docs/README.md#posthog-connector), [Databuddy](docs/README.md#databuddy-connector), [Better Stack](docs/README.md#better-stack-connector), [Sentry](docs/README.md#sentry-connector), and [OTLP](docs/README.md#otlp-connector).

## Documentation

- [Full documentation](docs/README.md)
- [Framework integrations](docs/README.md#framework-integrations)
- [Client and Expo logging](docs/README.md#client)
- [AI tracing](docs/README.md#ai-sdk-tracing)
- [Database logging](docs/README.md#database-logging)
- [PostHog connector](docs/README.md#posthog-connector)
- [Databuddy connector](docs/README.md#databuddy-connector)
- [Better Stack connector](docs/README.md#better-stack-connector)
- [Sentry connector](docs/README.md#sentry-connector)
- [OTLP connector](docs/README.md#otlp-connector)
- [Stability policy](STABILITY.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Test docs](tests/README.md)

## Development

```bash
bun install
bun run test
bun run build
bun run type-check
```

## License

MIT
