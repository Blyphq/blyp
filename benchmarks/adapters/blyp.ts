import fs from 'fs';
import path from 'path';
import type { BlypPrimarySink } from '../../src/core/primary-sink';
import {
  createInternalBaseLogger,
} from '../../src/core/logger';
import { createFilePrimarySink } from '../../src/core/sinks/file-primary-sink';
import type {
  BenchmarkAdapter,
  FileBenchmarkHandle,
  NoopDestinationStats,
  PlainBenchmarkHandle,
  StructuredBenchmarkHandle,
} from '../types';
import { NoopWritableStream } from '../utils/noop-stream';

class NoopPrimarySink implements BlypPrimarySink {
  readonly isAsync = false;
  readonly isReady = true;
  private writes = 0;

  write(): void {
    this.writes += 1;
  }

  async flush(): Promise<void> {}

  async shutdown(): Promise<void> {}

  stats(): NoopDestinationStats {
    return {
      writes: this.writes,
      bytes: 0,
    };
  }
}

function createBenchmarkLogger() {
  const destination = new NoopWritableStream();
  const sink = new NoopPrimarySink();
  const logger = createInternalBaseLogger({
    pretty: false,
    file: {
      enabled: false,
      rotation: {
        enabled: false,
      },
    },
    connectors: {
      delivery: {
        enabled: false,
      },
    },
  }, {
    pinoDestination: destination,
    sink,
  });

  return { logger, destination, sink };
}

function createPlainHandle(): PlainBenchmarkHandle {
  const { logger, destination, sink } = createBenchmarkLogger();

  return {
    log: () => {
      logger.info('benchmark-message');
    },
    close: async () => {
      await logger.shutdown();
    },
    destinationStats: () => {
      const streamStats = destination.stats();
      const sinkStats = sink.stats();
      return {
        writes: streamStats.writes + sinkStats.writes,
        bytes: streamStats.bytes,
      };
    },
  };
}

function createStructuredHandle(): StructuredBenchmarkHandle {
  const { logger, destination, sink } = createBenchmarkLogger();

  return {
    emit: () => {
      logger
        .createStructuredLog('checkout', {
          requestId: 'req-benchmark',
        })
        .set({
          userId: 'user-123',
          cartItems: 3,
        })
        .info('cart-updated', {
          totalCents: 1099,
        })
        .emit({ status: 200 });
    },
    close: async () => {
      await logger.shutdown();
    },
    destinationStats: () => {
      const streamStats = destination.stats();
      const sinkStats = sink.stats();
      return {
        writes: streamStats.writes + sinkStats.writes,
        bytes: streamStats.bytes,
      };
    },
  };
}

function createFileHandle(directory: string): FileBenchmarkHandle {
  const destination = new NoopWritableStream();
  const sink = createFilePrimarySink({
    pretty: false,
    destination: 'file',
    logDir: directory,
    file: {
      enabled: true,
      rotation: {
        enabled: false,
        compress: false,
        maxArchives: 1,
        maxSizeBytes: Number.MAX_SAFE_INTEGER,
      },
    },
    connectors: {
      delivery: {
        enabled: false,
      },
    },
  });
  const logger = createInternalBaseLogger({
    pretty: false,
    destination: 'file',
    logDir: directory,
    file: {
      enabled: true,
      rotation: {
        enabled: false,
        compress: false,
        maxArchives: 1,
        maxSizeBytes: Number.MAX_SAFE_INTEGER,
      },
    },
    connectors: {
      delivery: {
        enabled: false,
      },
    },
  }, {
    pinoDestination: destination,
    sink,
  });
  const outputPath = path.join(directory, 'log.ndjson');

  return {
    log: () => {
      logger.info('benchmark-message', {
        requestId: 'req-benchmark',
        route: '/checkout',
        status: 200,
      });
    },
    flush: async () => {
      await logger.flush();
    },
    close: async () => {
      await logger.shutdown();
    },
    outputPath,
  };
}

export function readOutputBytes(filePath: string): number {
  return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
}

export const blypAdapter: BenchmarkAdapter = {
  id: 'blyp',
  name: '@blyp/core',
  createPlainHandle,
  createStructuredHandle,
  createFileHandle,
};
