# Blyp Logger

> *The silent observer for your applications*

**Blyp** is a high-performance, runtime-adaptive logger for standalone apps and modern TypeScript web frameworks. It combines Bun-friendly runtime detection, structured NDJSON file logging, browser-to-server log ingestion, and framework-specific HTTP logging helpers.

[![Bun](https://img.shields.io/badge/Bun-1.2+-000000?style=flat&logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat&logo=typescript)](https://www.typescriptlang.org)
[![Elysia](https://img.shields.io/badge/Elysia-1.4+-00D8FF?style=flat)](https://elysiajs.com)
[![Winston](https://img.shields.io/badge/Winston-3.17+-FF6B6B?style=flat)](https://github.com/winstonjs/winston)

## ✨ Features

- **🚀 Runtime Detection**: Automatically detects and optimizes for Bun vs Node.js
- **🏗️ Modular Architecture**: Clean separation of concerns with dedicated utilities
- **🔒 TypeScript Support**: Full type safety throughout
- **🌐 Framework Integrations**: Elysia, Hono, Express, Fastify, NestJS, Next.js App Router, TanStack Start, and SvelteKit
- **📝 Standalone Usage**: Can be used independently without Elysia
- **🎨 Custom Log Levels**: success, critical, table, and standard levels
- **🌈 Color Support**: Beautiful console output with chalk colors
- **📁 Structured File Logging**: NDJSON log files with size-based rotation and gzip archives
- **⚡ Performance**: Optimized for speed with lazy loading and caching
- **🧪 Tested**: Comprehensive test suite with visual demonstrations

## 📁 Project Structure

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

## 🚀 Installation

```bash
# Using Bun (recommended)
bun add blyp

# Using npm
npm install blyp

# Using yarn
yarn add blyp

# Using pnpm
pnpm add blyp
```

## 📖 Usage

### Basic Logger Usage

```typescript
import { logger } from 'blyp';

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

### Application Errors

```typescript
import { createError, HTTP_CODES } from 'blyp';

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

### Client Error Parsing

```typescript
import { parseError } from 'blyp/client';

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
import { createClientLogger } from 'blyp/client';

const logger = createClientLogger({
  endpoint: '/inngest',
  metadata: () => ({
    app: 'dashboard',
  }),
});

logger.info('hydrated', { route: window.location.pathname });
logger.error(new Error('Button failed to render'));
logger.child({ feature: 'checkout' }).warn('Client validation failed');
```

The client logger logs to the browser console by default and best-effort syncs the same structured event to your backend. It uses `POST /inngest` by default, but you can override the path.

### Elysia Integration

```typescript
import { Elysia } from 'elysia';
import { createLogger } from 'blyp/elysia';

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

### Hono Integration

```typescript
import { Hono } from 'hono';
import { createLogger } from 'blyp/hono';

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

### Express Integration

```typescript
import express from 'express';
import {
  createLogger,
  createExpressErrorLogger,
} from 'blyp/express';

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

### Fastify Integration

```typescript
import Fastify from 'fastify';
import { createLogger } from 'blyp/fastify';

const app = Fastify();

await app.register(createLogger({
  level: 'info',
}));

app.get('/posts', async (request) => {
request.blypLog.info('loaded posts');
  return { ok: true };
});
```

### NestJS Integration

```typescript
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { logger } from 'blyp';
import { createLogger, BlypModule } from 'blyp/nestjs';

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

### Next.js App Router Integration

```typescript
import { createLogger } from 'blyp/nextjs';

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

### TanStack Start Integration

```typescript
import { createLogger } from 'blyp/tanstack-start';

const tanstackLogger = createLogger({
  level: 'info',
});

export const requestMiddleware = tanstackLogger.requestMiddleware;

// In a server route mounted at /inngest
export const POST = tanstackLogger.clientLogHandlers.POST;
```

### SvelteKit Integration

```typescript
import { createLogger } from 'blyp/sveltekit';

const svelteLogger = createLogger({
  level: 'info',
});

export const handle = svelteLogger.handle;

// src/routes/inngest/+server.ts
export const POST = svelteLogger.clientLogHandler;
```

### Cloudflare Workers

```typescript
import { initWorkersLogger, createWorkersLogger } from 'blyp/workers';

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

The Workers integration is console-based. It does not use file logging, does not read `blyp.config.json`, and does not include client-log ingestion in this first version. Use the subpath import `blyp/workers`.

### Advanced Configuration

```typescript
import { createLogger } from 'blyp/elysia';

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

### Frontend + Backend Log Sync

```typescript
import { Elysia } from 'elysia';
import { createLogger } from 'blyp/elysia';

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

### Runtime Detection

```typescript
import { runtime } from 'blyp/utils';

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

### Color Utilities

```typescript
import { 
  getMethodColor, 
  getStatusColor, 
  getColoredLevel 
} from 'blyp/utils';

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

## Configuration

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
}
```

## Log Levels

- `error` (0) - Error messages
- `critical` (1) - Critical system errors
- `warning` (2) - Warning messages
- `info` (3) - General information
- `success` (4) - Success messages
- `debug` (5) - Debug information
- `table` (6) - Table data logging

## HTTP Request Logging

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

## File Logging

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
import { createStandaloneLogger } from 'blyp';

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

### Reading Stored Logs

```typescript
import { readLogFile } from 'blyp';

const pretty = await readLogFile('logs/log.ndjson');
const records = await readLogFile('logs/archive/log.20260309T101530Z.ndjson.gz', {
  format: 'json',
  limit: 100
});
```

Migration note:
- `log.txt` was replaced by `log.ndjson`
- `log.error.txt` was replaced by `log.error.ndjson`
- rotated history now lives under `logs/archive/`

## 🧪 Testing

Blyp includes a comprehensive test suite using Bun's built-in testing framework.

### Running Tests

```bash
# Run all tests
bun run test

# Run tests in watch mode
bun run test:watch

# Run all test files
bun run test:all

# Run one framework suite
bun test tests/frameworks/express.test.ts
```

### Preview
#### Integrated logger preview
![Preview of Blyp Logger output](./assets/api-preview.png)


#### Test mode preview with standalone logger 
![Preview of Blyp Logger output](./assets/preview.png)


### Test Coverage

The test suite covers:
- ✅ Runtime detection and color helpers
- ✅ Standalone and client logger behavior
- ✅ File logging, rotation, and config bootstrapping
- ✅ Elysia, Hono, Express, Fastify, Next.js, TanStack Start, and SvelteKit integrations

### Visual Testing

The tests include beautiful visual demonstrations showing:
- Colored log messages with timestamps
- Formatted tables with data
- Consistent styling across all levels
- Performance metrics

## 🛠️ Development

### Prerequisites

- [Bun](https://bun.sh) 1.2+ (recommended)
- [Node.js](https://nodejs.org) 18+ (fallback)
- [TypeScript](https://www.typescriptlang.org) 5.0+

### Setup

```bash
# Clone the repository
git clone https://github.com/mohammedibrahim8887/blyp.git
cd blyp

# Install dependencies
bun install

# Run tests
bun run test

# Run tests in watch mode
bun run test:watch
```

### Project Structure

- `core/` - Core logger implementations
- `types/` - TypeScript type definitions
- `utils/` - Utility functions and helpers
- `tests/` - Test suite and documentation

### Building

```bash
# Build the project
bun run build

# Type check
bun run type-check
```

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

### Getting Started

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Run tests: `bun run test`
5. Commit your changes: `git commit -m 'Add amazing feature'`
6. Push to the branch: `git push origin feature/amazing-feature`
7. Open a Pull Request

### Code Style

- Use TypeScript with strict type checking
- Follow the existing code structure and patterns
- Add tests for new features
- Update documentation as needed
- Use meaningful commit messages

### Pull Request Process

1. Ensure all tests pass
2. Add tests for new functionality
3. Update documentation if needed
4. Request review from maintainers
5. Address any feedback

### Issues

- Use GitHub Issues for bug reports and feature requests
- Provide clear descriptions and reproduction steps
- Use appropriate labels

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Winston](https://github.com/winstonjs/winston) - Logging library
- [Elysia](https://elysiajs.com) - Web framework
- [Chalk](https://github.com/chalk/chalk) - Terminal string styling
- [Bun](https://bun.sh) - JavaScript runtime

## 📊 Performance

- **100 log calls**: ~3ms execution time
- **Runtime detection**: Cached for performance
- **Color functions**: Optimized for speed
- **File operations**: Efficient Bun/Node.js adapters

## 🔗 Links

- [GitHub Repository](https://github.com/mohammedibrahim8887/blyp)
- [NPM Package](https://www.npmjs.com/package/blyp)
- [Documentation](https://github.com/mohammedibrahim8887/blyp#readme)
- [Issues](https://github.com/mohammedibrahim8887/blyp/issues)

---

*Blyp silently watches over your applications, logging everything that happens under its watchful gaze.*
