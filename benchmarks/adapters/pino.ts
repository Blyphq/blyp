import fs from 'fs';
import path from 'path';
import pino from 'pino';
import type {
  BenchmarkAdapter,
  FileBenchmarkHandle,
  PlainBenchmarkHandle,
  StructuredBenchmarkHandle,
} from '../types';
import { NoopWritableStream } from '../utils/noop-stream';

function createPlainHandle(): PlainBenchmarkHandle {
  const destination = new NoopWritableStream();
  const logger = pino(
    {
      level: 'info',
      base: null,
      timestamp: false,
    },
    destination
  );

  return {
    log: () => {
      logger.info('benchmark-message');
    },
    close: async () => {
      await logger.flush();
    },
    destinationStats: () => destination.stats(),
  };
}

function createStructuredHandle(): StructuredBenchmarkHandle {
  const destination = new NoopWritableStream();
  const logger = pino(
    {
      level: 'info',
      base: null,
      timestamp: false,
    },
    destination
  );

  return {
    emit: () => {
      logger.info({
        groupId: 'checkout',
        requestId: 'req-benchmark',
        userId: 'user-123',
        cartItems: 3,
        status: 200,
        events: [
          {
            level: 'info',
            message: 'cart-updated',
            data: {
              totalCents: 1099,
            },
          },
        ],
      }, 'structured_log');
    },
    close: async () => {
      await logger.flush();
    },
    destinationStats: () => destination.stats(),
  };
}

function createFileHandle(directory: string): FileBenchmarkHandle {
  const outputPath = path.join(directory, 'pino.ndjson');
  const destination = pino.destination({
    dest: outputPath,
    sync: true,
    mkdir: true,
  });
  const logger = pino(
    {
      level: 'info',
      base: null,
      timestamp: false,
    },
    destination
  );

  return {
    log: () => {
      logger.info({
        requestId: 'req-benchmark',
        route: '/checkout',
        status: 200,
      }, 'benchmark-message');
    },
    flush: async () => {
      destination.flushSync();
    },
    close: async () => {
      destination.flushSync();
      destination.end();
    },
    outputPath,
  };
}

export function readPinoOutputBytes(filePath: string): number {
  return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
}

export const pinoAdapter: BenchmarkAdapter = {
  id: 'pino',
  name: 'Pino',
  createPlainHandle,
  createStructuredHandle,
  createFileHandle,
};
