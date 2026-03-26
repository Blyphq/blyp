import fs from 'fs';
import path from 'path';
import winston from 'winston';
import type {
  BenchmarkAdapter,
  FileBenchmarkHandle,
  PlainBenchmarkHandle,
  StructuredBenchmarkHandle,
} from '../types';
import { NoopWritableStream } from '../utils/noop-stream';

function createBaseFormat() {
  return winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  );
}

function createPlainHandle(): PlainBenchmarkHandle {
  const destination = new NoopWritableStream();
  const logger = winston.createLogger({
    level: 'info',
    format: createBaseFormat(),
    transports: [
      new winston.transports.Stream({
        stream: destination,
      }),
    ],
  });

  return {
    log: () => {
      logger.info('benchmark-message');
    },
    close: async () => {
      logger.close();
    },
    destinationStats: () => destination.stats(),
  };
}

function createStructuredHandle(): StructuredBenchmarkHandle {
  const destination = new NoopWritableStream();
  const logger = winston.createLogger({
    level: 'info',
    format: createBaseFormat(),
    transports: [
      new winston.transports.Stream({
        stream: destination,
      }),
    ],
  });

  return {
    emit: () => {
      logger.log({
        level: 'info',
        message: 'structured_log',
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
      });
    },
    close: async () => {
      logger.close();
    },
    destinationStats: () => destination.stats(),
  };
}

function createFileHandle(directory: string): FileBenchmarkHandle {
  const outputPath = path.join(directory, 'winston.ndjson');
  const transport = new winston.transports.File({
    filename: outputPath,
    options: { flags: 'w' },
  });
  const logger = winston.createLogger({
    level: 'info',
    format: createBaseFormat(),
    transports: [transport],
  });

  return {
    log: () => {
      logger.log({
        level: 'info',
        message: 'benchmark-message',
        requestId: 'req-benchmark',
        route: '/checkout',
        status: 200,
      });
    },
    flush: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
    close: async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      logger.close();
    },
    outputPath,
  };
}

export function readWinstonOutputBytes(filePath: string): number {
  return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
}

export const winstonAdapter: BenchmarkAdapter = {
  id: 'winston',
  name: 'Winston',
  createPlainHandle,
  createStructuredHandle,
  createFileHandle,
};
