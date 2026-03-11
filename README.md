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
- **Standalone usage** — Use without any framework
- **Structured file logging** — NDJSON with size-based rotation and gzip archives
- **Client log sync** — Browser logs ingested into your backend stream

## Project structure

```
blyp/
├── exports/
│   ├── client.js              # Public client entry shim
│   └── frameworks/
│       └── elysia.js          # Public framework entry shims
├── index.ts                   # Main source export bridge
├── src/
│   ├── core/                  # Logger runtime and file logging internals
│   ├── frameworks/            # Framework implementations
│   ├── shared/                # Shared runtime/error utilities
│   └── types/
│       ├── framework.types.ts # Shared public contracts
│       └── frameworks/
│           └── elysia.ts      # Framework-specific source types
├── types/
│   ├── index.d.ts             # Public type entry shim
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
