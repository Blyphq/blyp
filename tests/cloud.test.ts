import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createStandaloneLogger } from '../src/frameworks/standalone';
import { resetConfigCache } from '../src/core/config';
import {
  resetCloudTestHooks,
  setCloudTestHooks,
} from '../src/connectors/cloud/sender';
import type { CloudIngestBatch } from '../src/types/connectors/cloud';

describe('Cloud destination', () => {
  beforeEach(() => {
    resetConfigCache();
    resetCloudTestHooks();
  });

  afterEach(() => {
    resetConfigCache();
    resetCloudTestHooks();
  });

  it('sends logs to /ingest with required headers and payload', async () => {
    const requests: Array<{
      endpoint: string;
      batch: CloudIngestBatch;
      headers: Record<string, string>;
    }> = [];

    setCloudTestHooks({
      sdkVersion: 'test-version',
      createTransport: () => ({
        async sendBatch(endpoint, batch, headers) {
          requests.push({ endpoint, batch, headers });
          return { ok: true };
        },
      }),
    });

    const logger = createStandaloneLogger({
      pretty: false,
      destination: 'cloud',
      cloud: {
        projectKey: 'blyp_proj_test_project',
        apiKey: 'bly_test_api_key',
        host: 'http://localhost:3003',
        region: 'eu',
      },
    });

    logger.info('cloud event', { traceId: 'trace_123', framework: 'elysia' });
    await logger.flush();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.endpoint).toBe('http://localhost:3003/ingest');
    expect(requests[0]?.headers.Authorization).toBe('Bearer bly_test_api_key');
    expect(requests[0]?.headers['X-Blyp-Project-Id']).toBe('blyp_proj_test_project');
    expect(requests[0]?.headers['X-Blyp-Region']).toBe('eu');

    const sent = requests[0]?.batch;
    expect(sent?.events).toHaveLength(1);
    expect(sent?.events[0]?.message).toBe('cloud event');
    expect(sent?.events[0]?.traceId).toBe('trace_123');
    expect(sent?.meta.sdk).toBe('@blyp/core');
    expect(sent?.meta.sdkVersion).toBe('test-version');
    expect(sent?.meta.git.repositoryFullName).toBeDefined();
  });
});
