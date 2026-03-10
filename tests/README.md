# Blyp Logger Test Suite

The test suite is split by concern instead of using one mixed catch-all file.

## 🧪 Test Layout

- `runtime.test.ts` - Runtime detection checks
- `colors.test.ts` - Color helper coverage
- `path-matching.test.ts` - `ignorePaths` matcher coverage
- `config.test.ts` - config precedence and bootstrapping
- `error.test.ts` - application error registry and metadata coverage
- `parse-error.test.ts` - client-side error hydration and response parsing coverage
- `standalone.test.ts` - standalone logger API coverage
- `client-logger.test.ts` - browser/client logger coverage
- `file-logging.test.ts` - NDJSON persistence, rotation, and log reader coverage
- `frameworks/elysia.test.ts` - Elysia integration coverage
- `frameworks/hono.test.ts` - Hono integration coverage
- `frameworks/express.test.ts` - Express integration coverage
- `frameworks/fastify.test.ts` - Fastify integration coverage
- `frameworks/nextjs.test.ts` - Next.js App Router integration coverage
- `frameworks/tanstack-start.test.ts` - TanStack Start integration coverage
- `frameworks/sveltekit.test.ts` - SvelteKit integration coverage
- `helpers/` - shared fixtures and temp-dir utilities
- `run-tests.ts` - lightweight test runner helper

## 🚀 Running Tests

### Using npm scripts:
```bash
# Run all tests
bun run test

# Run tests in watch mode
bun run test:watch

# Run all test files
bun run test:all
```

### Using Bun directly:
```bash
# Run one framework suite
bun test tests/frameworks/fastify.test.ts

# Run all tests
bun test tests/
```

## 📊 Test Coverage

The test suite covers:

### ✅ Runtime Detection
- Bun vs Node.js detection
- File system operations
- Path operations
- Environment variable access

### ✅ Standalone Logger
- All log levels (info, success, critical, debug, error, warning)
- Table data logging with visual output
- Caller location tracking
- Performance testing (100 logs in ~3ms)

### ✅ Server Frameworks
- Elysia
- Hono
- Express
- Fastify
- Next.js App Router
- TanStack Start
- SvelteKit

### ✅ Core Coverage
- Runtime detection
- Color helpers
- Standalone logger behavior
- Client logger sync behavior
- NDJSON persistence and rotation
- Config bootstrapping
- `ignorePaths` matching
