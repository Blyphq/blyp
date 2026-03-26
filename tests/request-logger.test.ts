import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createStandaloneLogger } from '../src/frameworks/standalone';
import { createRequestScopedLogger } from '../src/frameworks/shared/request-logger';
import {
  runWithRequestContext,
  setActiveRequestTraceId,
} from '../src/frameworks/shared/request-context';
import { makeTempDir, readJsonLines, waitForFileFlush } from './helpers/fs';

describe('Request Scoped Logger', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('blyp-request-logger-');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('keeps the active request trace id when structured defaults include a conflicting trace', async () => {
    runWithRequestContext(() => {
      setActiveRequestTraceId('trace_real');
      const logger = createStandaloneLogger({
        logDir: tempDir,
        pretty: false,
      });
      const requestLogger = createRequestScopedLogger(logger, {
        resolveStructuredFields: () => ({
          traceId: 'wrong-trace',
          method: 'GET',
        }),
      });
      const structured = requestLogger.createStructuredLog('checkout');
      structured.info('structured event');
      structured.emit({ status: 200 });
    });
    await waitForFileFlush();

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const record = records.find((entry) => entry.groupId === 'checkout');

    expect(record?.traceId).toBe('trace_real');
    expect(record?.method).toBe('GET');
  });
});
