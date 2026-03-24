import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { generateText, streamText, wrapLanguageModel } from 'ai';
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider';
import { createStandaloneLogger } from '../src/frameworks/standalone';
import { blypMiddleware, blypModel } from '../src/ai/vercel';
import { enterRequestContext, setActiveRequestLogger } from '../src/frameworks/shared/request-context';
import { resetConfigCache } from '../src/core/config';
import { makeTempDir, readJsonLines, waitForFileFlush } from './helpers/fs';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createUsage(inputTokens = 3, outputTokens = 2, reasoningTokens = 0) {
  return {
    inputTokens: {
      total: inputTokens,
      noCache: inputTokens,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: {
      total: outputTokens,
      text: outputTokens,
      reasoning: reasoningTokens,
    },
  };
}

function createMockModel(options?: {
  doGenerate?: (params: LanguageModelV3CallOptions) => Promise<LanguageModelV3GenerateResult>;
  doStream?: (params: LanguageModelV3CallOptions) => Promise<LanguageModelV3StreamResult>;
}): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'test-provider',
    modelId: 'test-model',
    supportedUrls: {},
    async doGenerate(params) {
      if (options?.doGenerate) {
        return options.doGenerate(params);
      }

      return {
        content: [{ type: 'text', text: 'hello world' }],
        finishReason: 'stop' as unknown as LanguageModelV3GenerateResult['finishReason'],
        usage: createUsage(),
        warnings: [],
      } as LanguageModelV3GenerateResult;
    },
    async doStream(params) {
      if (options?.doStream) {
        return options.doStream(params);
      }

      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            void (async () => {
              await sleep(20);
              controller.enqueue({ type: 'stream-start', warnings: [] });
              controller.enqueue({ type: 'text-start', id: 'text-1' });
              controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'hello ' });
              controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'stream' });
              controller.enqueue({ type: 'text-end', id: 'text-1' });
              controller.enqueue({
                type: 'finish',
                finishReason: 'stop' as unknown as LanguageModelV3StreamPart extends infer T
                  ? T extends { type: 'finish'; finishReason: infer F }
                    ? F
                    : never
                  : never,
                usage: createUsage(4, 5),
              });
              controller.close();
            })();
          },
        }),
      };
    },
  };
}

function findAiTrace(logDir: string): Record<string, unknown> | undefined {
  return readJsonLines(path.join(logDir, 'log.ndjson')).find((record) => record.type === 'ai_trace');
}

describe('AI SDK Vercel Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('blyp-ai-');
    resetConfigCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
  });

  it('wraps models for generateText and exposes valid middleware', async () => {
    const logger = createStandaloneLogger({ pretty: false, logDir: tempDir });
    const model = createMockModel();
    const middleware = blypMiddleware({ logger, operation: 'support_chat' });
    const wrapped = wrapLanguageModel({ model, middleware });

    expect(middleware.specificationVersion).toBe('v3');

    const result = await generateText({
      model: blypModel(wrapped, { logger, operation: 'support_chat_2' }),
      prompt: 'hello',
    });

    await waitForFileFlush();

    expect(result.text).toBe('hello world');
    expect(findAiTrace(tempDir)?.message).toBe('ai_trace');
  });

  it('emits one ai_trace for generateText with usage, finish reason, and optional output capture', async () => {
    const logger = createStandaloneLogger({ pretty: false, logDir: tempDir });

    await generateText({
      model: blypModel(createMockModel(), {
        logger,
        operation: 'support_chat',
        capture: { output: true },
      }),
      prompt: 'hello',
    });

    await waitForFileFlush();

    const trace = findAiTrace(tempDir);
    const ai = trace?.ai as Record<string, unknown>;

    expect(trace?.level).toBe('info');
    expect(trace?.message).toBe('ai_trace');
    expect(trace?.groupId).toMatch(/^ai_/);
    expect(ai?.sdk).toBe('ai-sdk');
    expect(ai?.provider).toBe('test-provider');
    expect(ai?.model).toBe('test-model');
    expect(ai?.operation).toBe('support_chat');
    expect(ai?.callType).toBe('generate');
    expect(ai?.inputTokens).toBe(3);
    expect(ai?.outputTokens).toBe(2);
    expect(ai?.totalTokens).toBe(5);
    expect(ai?.finishReason).toBe('stop');
    expect(ai?.output).toBe('hello world');
    expect((trace?.events as Array<Record<string, unknown>>).map((event) => event.type)).toEqual([
      'ai.start',
      'ai.finish',
    ]);
  });

  it('emits one ai_trace for streamText with timing, chunk capture, and tool events', async () => {
    const logger = createStandaloneLogger({ pretty: false, logDir: tempDir });
    const model = createMockModel({
      async doStream() {
        return {
          stream: new ReadableStream<LanguageModelV3StreamPart>({
            start(controller) {
              void (async () => {
                await sleep(25);
                controller.enqueue({ type: 'stream-start', warnings: [] });
                controller.enqueue({ type: 'text-start', id: 'text-1' });
                controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'hello ' });
                controller.enqueue({
                  type: 'tool-input-start',
                  id: 'tool-1',
                  toolName: 'lookupOrder',
                });
                controller.enqueue({
                  type: 'tool-input-delta',
                  id: 'tool-1',
                  delta: '{"orderId":"ord_1"}',
                });
                controller.enqueue({
                  type: 'tool-call',
                  toolCallId: 'tool-1',
                  toolName: 'lookupOrder',
                  input: '{"orderId":"ord_1"}',
                });
                controller.enqueue({
                  type: 'tool-result',
                  toolCallId: 'tool-1',
                  toolName: 'lookupOrder',
                  result: { status: 'ok' },
                });
                controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'world' });
                controller.enqueue({ type: 'text-end', id: 'text-1' });
                controller.enqueue({
                  type: 'finish',
                  finishReason: 'stop' as unknown as LanguageModelV3StreamPart extends infer T
                    ? T extends { type: 'finish'; finishReason: infer F }
                      ? F
                      : never
                    : never,
                  usage: createUsage(4, 5),
                });
                controller.close();
              })();
            },
          }),
        };
      },
    });

    const stream = streamText({
      model: blypModel(model, {
        logger,
        capture: {
          streamChunks: true,
          toolInputs: true,
          toolOutputs: true,
        },
      }),
      prompt: 'hello',
    });

    let text = '';
    for await (const chunk of stream.textStream) {
      text += chunk;
    }

    await waitForFileFlush();

    const trace = findAiTrace(tempDir);
    const ai = trace?.ai as Record<string, unknown>;
    const events = trace?.events as Array<Record<string, unknown>>;
    const toolCalls = ai?.toolCalls as Array<Record<string, unknown>>;

    expect(text).toBe('hello world');
    expect(ai?.callType).toBe('stream');
    expect(ai?.streamed).toBe(true);
    expect(typeof ai?.msToFirstChunk).toBe('number');
    expect((ai?.msToFirstChunk as number) >= 0).toBe(true);
    expect(typeof ai?.msToFinish).toBe('number');
    expect(typeof ai?.tokensPerSecond).toBe('number');
    expect(Array.isArray(ai?.streamChunks)).toBe(true);
    expect(toolCalls[0]?.name).toBe('lookupOrder');
    expect(toolCalls[0]?.input).toEqual({ orderId: 'ord_1' });
    expect(toolCalls[0]?.output).toEqual({ status: 'ok' });
    expect(events.some((event) => event.type === 'ai.first_chunk')).toBe(true);
    expect(events.some((event) => event.type === 'ai.tool_call.start')).toBe(true);
    expect(events.some((event) => event.type === 'ai.tool_call.result')).toBe(true);
  });

  it('supports hooks, request-context logger inheritance, capture disabling, and error traces', async () => {
    const logger = createStandaloneLogger({ pretty: false, logDir: tempDir });
    const requestLogger = logger.child({ requestId: 'req-123' });
    const calls: Array<string> = [];

    enterRequestContext();
    setActiveRequestLogger(requestLogger);

    const model = createMockModel({
      async doGenerate() {
        throw Object.assign(new Error('kaboom'), { code: 'E_FAIL' });
      },
    });

    await expect(
      generateText({
        model: blypModel(model, {
          operation: 'error_case',
          capture: {
            input: true,
            output: true,
          },
          hooks: {
            onStart(context) {
              calls.push(`start:${context.operation}`);
              context.setMetadata({
                team: 'support',
                private: { token: 'secret' },
              });
              context.disableCapture('input');
            },
            onError(context) {
              calls.push(`error:${String((context.error as Error)?.message ?? context.error)}`);
            },
            onFinish() {
              calls.push('finish');
            },
            onEvent(event) {
              calls.push(`event:${event.type}`);
              if (event.type === 'ai.start') {
                throw new Error('hook-failure');
              }
            },
          },
          exclude: {
            metadataPaths: ['private.token'],
          },
        }),
        prompt: 'hello',
      })
    ).rejects.toThrow('kaboom');

    await waitForFileFlush();

    const trace = findAiTrace(tempDir);
    const ai = trace?.ai as Record<string, unknown>;
    const metadata = ai?.metadata as Record<string, unknown>;

    expect(trace?.level).toBe('error');
    expect(trace?.requestId).toBe('req-123');
    expect(ai?.operation).toBe('error_case');
    expect(ai?.errorType).toBe('Error');
    expect(ai?.errorCode).toBe('E_FAIL');
    expect(ai?.input).toBeUndefined();
    expect(metadata?.team).toBe('support');
    expect((metadata?.private as Record<string, unknown>)?.token).toBeUndefined();
    expect(calls).toContain('start:error_case');
    expect(calls.some((entry) => entry.startsWith('error:kaboom'))).toBe(true);
    expect(calls).not.toContain('finish');
  });
});
