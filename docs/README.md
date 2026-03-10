# Blyp — Full documentation

Back to [README](../README.md)

This document contains detailed usage, all framework integrations, configuration reference, and advanced topics.

## Table of contents

- [Basic logger usage](#basic-logger-usage)
- [Errors](#errors)
- [Client](#client)
- [Framework integrations](#framework-integrations)
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

## Basic logger usage

```typescript
import { logger } from 'blyp-js';

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

---

## Errors

### Application Errors

```typescript
import { createError, HTTP_CODES } from 'blyp-js';

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
import { parseError } from 'blyp-js/client';

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
import { createClientLogger } from 'blyp-js/client';

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
import { createExpoLogger } from 'blyp-js/expo';

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

## Framework integrations

### Elysia

```typescript
import { Elysia } from 'elysia';
import { createLogger } from 'blyp-js/elysia';

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
import { createLogger } from 'blyp-js/hono';

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
} from 'blyp-js/express';

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
import { createLogger } from 'blyp-js/fastify';

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
import { logger } from 'blyp-js';
import { createLogger, BlypModule } from 'blyp-js/nestjs';

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
import { createLogger } from 'blyp-js/nextjs';

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

### TanStack Start

```typescript
import { createLogger } from 'blyp-js/tanstack-start';

const tanstackLogger = createLogger({
  level: 'info',
});

export const requestMiddleware = tanstackLogger.requestMiddleware;

// In a server route mounted at /inngest
export const POST = tanstackLogger.clientLogHandlers.POST;
```

### SvelteKit

```typescript
import { createLogger } from 'blyp-js/sveltekit';

const svelteLogger = createLogger({
  level: 'info',
});

export const handle = svelteLogger.handle;

// src/routes/inngest/+server.ts
export const POST = svelteLogger.clientLogHandler;
```

### Cloudflare Workers

```typescript
import { initWorkersLogger, createWorkersLogger } from 'blyp-js/workers';

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

The Workers integration is console-based. It does not use file logging, does not read `blyp.config.json`, and does not include client-log ingestion in this first version. Use the subpath import `blyp-js/workers`.

---

## Advanced configuration

```typescript
import { createLogger } from 'blyp-js/elysia';

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
import { createLogger } from 'blyp-js/elysia';

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
import { runtime } from 'blyp-js/utils';

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
} from 'blyp-js/utils';

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
import { createStandaloneLogger } from 'blyp-js';

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
import { readLogFile } from 'blyp-js';

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
