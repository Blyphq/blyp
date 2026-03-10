import 'reflect-metadata';
import fs from 'fs';
import path from 'path';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Module,
  Post,
  Req,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resetConfigCache } from '../../src/core/config';
import { logger } from '../../src/frameworks/standalone';
import { createLogger, BlypModule } from '../../src/frameworks/nestjs';
import {
  getNestLoggerStateOrThrow,
  resetNestLoggerState,
} from '../../src/frameworks/nestjs/logger';
import { createClientPayload } from '../helpers/client-payload';
import { makeTempDir, readJsonLines, waitForFileFlush } from '../helpers/fs';

@Controller()
class NestTestController {
  @Get('/hello')
  hello(@Req() request: { blypLog?: { info(message: string): void } }) {
    request.blypLog?.info('nest-request');
    logger.info('nest-route');

    return {
      ok: true,
      hasLogger: Boolean(request.blypLog),
    };
  }

  @Post('/echo')
  echo(
    @Req() request: { blypLog?: { info(message: string): void } },
    @Body() body: Record<string, unknown>
  ) {
    request.blypLog?.info('nest-post');

    return {
      ok: true,
      hasLogger: Boolean(request.blypLog),
      body,
    };
  }

  @Get('/health')
  health() {
    return { ok: true };
  }

  @Get('/boom')
  boom() {
    throw new Error('nest-fail');
  }

  @Get('/http-error')
  httpError() {
    throw new HttpException('nest-http-fail', HttpStatus.BAD_REQUEST);
  }

  @Get('/manual-error')
  @HttpCode(HttpStatus.I_AM_A_TEAPOT)
  manualError() {
    return { ok: false };
  }
}

@Module({
  imports: [BlypModule.forRoot()],
  controllers: [NestTestController],
})
class NestTestModule {}

describe('NestJS Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('blyp-nest-');
    resetConfigCache();
    resetNestLoggerState();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
    resetNestLoggerState();
  });

  it('logs successful requests and attaches blypLog for Nest Express', async () => {
    const app = await startNestApp('express', {
      logDir: tempDir,
      pretty: false,
      customProps: (ctx) => ({
        adapter: ctx.adapterType,
        controllerName: ctx.controllerName,
        handlerName: ctx.handlerName,
      }),
    });

    try {
      const helloResponse = await fetch(`${app.baseUrl}/hello`);
      const helloBody = await helloResponse.json();
      const postResponse = await fetch(`${app.baseUrl}/echo`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ nested: true }),
      });
      const postBody = await postResponse.json();
      await waitForFileFlush();

      expect(helloResponse.status).toBe(200);
      expect(helloBody).toEqual({ ok: true, hasLogger: true });
      expect(postResponse.status).toBe(201);
      expect(postBody).toEqual({
        ok: true,
        hasLogger: true,
        body: { nested: true },
      });

      const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
      const helloRecord = records.find((record) => {
        const data = record.data as Record<string, unknown> | undefined;
        return data?.type === 'http_request' && data?.url === '/hello';
      });
      const postRecord = records.find((record) => {
        const data = record.data as Record<string, unknown> | undefined;
        return data?.type === 'http_request' && data?.url === '/echo';
      });

      expect(records.some((record) => record.message === 'nest-route')).toBe(true);
      expect(records.some((record) => record.message === 'nest-request')).toBe(true);
      expect(records.some((record) => record.message === 'nest-post')).toBe(true);
      expect((helloRecord?.data as Record<string, unknown>)?.adapter).toBe('express');
      expect((helloRecord?.data as Record<string, unknown>)?.controllerName).toBe('NestTestController');
      expect((helloRecord?.data as Record<string, unknown>)?.handlerName).toBe('hello');
      expect((postRecord?.data as Record<string, unknown>)?.method).toBe('POST');
    } finally {
      await app.close();
    }
  });

  it('logs successful requests and client ingestion for Nest Fastify', async () => {
    const app = await startNestApp('fastify', {
      logDir: tempDir,
      pretty: false,
    });

    try {
      const helloResponse = await fetch(`${app.baseUrl}/hello`);
      const helloBody = await helloResponse.json();
      const ingestionResponse = await fetch(`${app.baseUrl}/inngest`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(createClientPayload()),
      });
      await waitForFileFlush();

      expect(helloResponse.status).toBe(200);
      expect(helloBody).toEqual({ ok: true, hasLogger: true });
      expect(ingestionResponse.status).toBe(204);

      const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
      const helloRecord = records.find((record) => {
        const data = record.data as Record<string, unknown> | undefined;
        return data?.type === 'http_request' && data?.url === '/hello';
      });
      const duplicateIngestionRecord = records.find((record) => {
        const data = record.data as Record<string, unknown> | undefined;
        return data?.type === 'http_request' && data?.url === '/inngest';
      });

      expect((helloRecord?.data as Record<string, unknown>)?.method).toBe('GET');
      expect(records.some((record) => record.message === '[client] frontend rendered')).toBe(true);
      expect(duplicateIngestionRecord).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('logs thrown and manual error statuses, and respects ignorePaths', async () => {
    const app = await startNestApp('express', {
      logDir: tempDir,
      pretty: false,
      ignorePaths: ['/health'],
    });

    try {
      await fetch(`${app.baseUrl}/health`);
      const errorResponse = await fetch(`${app.baseUrl}/boom`);
      const httpErrorResponse = await fetch(`${app.baseUrl}/http-error`);
      const manualErrorResponse = await fetch(`${app.baseUrl}/manual-error`);
      await waitForFileFlush();

      expect(errorResponse.status).toBe(500);
      expect(httpErrorResponse.status).toBe(400);
      expect(manualErrorResponse.status).toBe(418);

      const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
      const healthRecord = records.find((record) => {
        const data = record.data as Record<string, unknown> | undefined;
        return data?.url === '/health';
      });
      const errorRecord = records.find((record) => {
        const data = record.data as Record<string, unknown> | undefined;
        return data?.type === 'http_error' && data?.url === '/boom';
      });
      const httpErrorRecord = records.find((record) => {
        const data = record.data as Record<string, unknown> | undefined;
        return data?.type === 'http_error' && data?.url === '/http-error';
      });
      const manualErrorRecord = records.find((record) => {
        const data = record.data as Record<string, unknown> | undefined;
        return data?.type === 'http_error' && data?.url === '/manual-error';
      });

      expect(healthRecord).toBeUndefined();
      expect((errorRecord?.data as Record<string, unknown>)?.statusCode).toBe(500);
      expect((httpErrorRecord?.data as Record<string, unknown>)?.statusCode).toBe(400);
      expect((manualErrorRecord?.data as Record<string, unknown>)?.statusCode).toBe(418);
    } finally {
      await app.close();
    }
  });

  it('rejects malformed or unauthorized client logs', async () => {
    const app = await startNestApp('express', {
      logDir: tempDir,
      pretty: false,
      clientLogging: {
        validate: async (_ctx, payload) => payload.id !== 'blocked',
      },
    });

    try {
      const ok = await fetch(`${app.baseUrl}/inngest`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(createClientPayload()),
      });
      const bad = await fetch(`${app.baseUrl}/inngest`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ nope: true }),
      });
      const blocked = await fetch(`${app.baseUrl}/inngest`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(createClientPayload({ id: 'blocked' })),
      });
      await waitForFileFlush();

      expect(ok.status).toBe(204);
      expect(bad.status).toBe(400);
      expect(blocked.status).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('fails fast when BlypModule is used before createLogger', async () => {
    const processHandle = Bun.spawn(
      ['bun', 'run', 'tests/helpers/nest-bootstrap-missing.ts'],
      {
        cwd: process.cwd(),
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );
    const stdout = processHandle.stdout
      ? await new Response(processHandle.stdout).text()
      : '';
    const stderr = processHandle.stderr
      ? await new Response(processHandle.stderr).text()
      : '';

    expect(await processHandle.exited).toBe(1);
    expect(`${stdout}\n${stderr}`).not.toContain('Unexpected bootstrap success');
    expect(() => getNestLoggerStateOrThrow()).toThrow(
      'BlypModule.forRoot() requires createLogger(...) to run before NestFactory.create(AppModule).'
    );
  });

  it('reconfigures the shared root logger through createLogger', async () => {
    createLogger({
      level: 'debug',
      logDir: tempDir,
      pretty: false,
    });

    logger.debug('root-debug');
    await waitForFileFlush();

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === 'root-debug')).toBe(true);
  });
});

async function startNestApp(
  adapter: 'express' | 'fastify',
  config: Parameters<typeof createLogger>[0]
): Promise<{
  app: INestApplication | NestFastifyApplication;
  baseUrl: string;
  close: () => Promise<void>;
}> {
  createLogger(config);

  if (adapter === 'fastify') {
    const app = await NestFactory.create<NestFastifyApplication>(
      NestTestModule,
      new FastifyAdapter(),
      { logger: false }
    );
    await app.listen(0, '127.0.0.1');

    return {
      app,
      baseUrl: await app.getUrl(),
      close: () => app.close(),
    };
  }

  const app = await NestFactory.create(NestTestModule, {
    logger: false,
  });
  await app.listen(0, '127.0.0.1');

  return {
    app,
    baseUrl: await app.getUrl(),
    close: () => app.close(),
  };
}
