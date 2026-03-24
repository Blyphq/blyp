import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { wrapOpenAI } from '../src/ai/openai';
import { wrapAnthropic } from '../src/ai/anthropic';
import { blypFetch } from '../src/ai/shared/fetch';
import { createStandaloneLogger } from '../src/frameworks/standalone';
import { enterRequestContext, setActiveRequestLogger } from '../src/frameworks/shared/request-context';
import { resetConfigCache } from '../src/core/config';
import { makeTempDir, readJsonLines, waitForFileFlush } from './helpers/fs';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findRecords(logDir: string, type: string): Array<Record<string, unknown>> {
  return readJsonLines(path.join(logDir, 'log.ndjson')).filter((record) => record.type === type);
}

function findAiTrace(logDir: string): Record<string, unknown> | undefined {
  return findRecords(logDir, 'ai_trace')[0];
}

describe('AI SDK wrappers', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('blyp-ai-sdk-');
    resetConfigCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
  });

  it('wrapOpenAI emits one normalized ai_trace for responses.create', async () => {
    const logger = createStandaloneLogger({ pretty: false, logDir: tempDir });
    const client = wrapOpenAI(
      {
        responses: {
          async create(params: Record<string, unknown>) {
            expect(params.model).toBe('gpt-5');
            return {
              id: 'resp_1',
              model: 'gpt-5',
              status: 'completed',
              usage: {
                input_tokens: 11,
                output_tokens: 7,
                total_tokens: 18,
                output_tokens_details: { reasoning_tokens: 3 },
                input_tokens_details: { cached_tokens: 2 },
              },
              output: [
                {
                  type: 'message',
                  content: [{ type: 'output_text', text: 'hello from openai' }],
                },
                {
                  type: 'function_call',
                  call_id: 'call_1',
                  name: 'lookupOrder',
                  arguments: '{"orderId":"ord_1"}',
                },
              ],
            };
          },
        },
      },
      {
        logger,
        operation: 'draft_blog_intro',
        capture: {
          input: true,
          output: true,
          toolInputs: true,
        },
      }
    );

    const result = await client.responses.create({
      model: 'gpt-5',
      input: 'Write a short intro about edge logging',
    });

    await waitForFileFlush();

    const trace = findAiTrace(tempDir);
    const ai = trace?.ai as Record<string, unknown>;

    expect((result as Record<string, unknown>).model).toBe('gpt-5');
    expect(ai.provider).toBe('openai');
    expect(ai.sdk).toBe('openai-sdk');
    expect(ai.operation).toBe('draft_blog_intro');
    expect(ai.method).toBe('responses.create');
    expect(ai.streamed).toBe(false);
    expect(ai.input).toBe('Write a short intro about edge logging');
    expect(ai.output).toBe('hello from openai');
    expect(ai.finishReason).toBe('completed');
    expect((ai.usage as Record<string, unknown>).inputTokens).toBe(11);
    expect((ai.usage as Record<string, unknown>).outputTokens).toBe(7);
    expect((ai.usage as Record<string, unknown>).reasoningTokens).toBe(3);
    expect((ai.usage as Record<string, unknown>).cachedInputTokens).toBe(2);
    expect((ai.tools as Array<Record<string, unknown>>)[0]?.name).toBe('lookupOrder');
    expect((trace?.events as Array<Record<string, unknown>>).map((event) => event.type)).toEqual([
      'ai.start',
      'ai.finish',
    ]);
  });

  it('wrapOpenAI preserves provider=openrouter and captures stream timing', async () => {
    const logger = createStandaloneLogger({ pretty: false, logDir: tempDir });
    const streamSource = {
      requestId: 'stream_1',
      async *[Symbol.asyncIterator]() {
        await sleep(10);
        yield { type: 'response.output_text.delta', delta: 'hello ' };
        yield {
          type: 'response.output_item.done',
          item: {
            type: 'function_call',
            call_id: 'call_2',
            name: 'classifyTicket',
            arguments: '{"priority":"high"}',
          },
        };
        yield { type: 'response.output_text.delta', delta: 'router' };
        yield {
          type: 'response.completed',
          response: {
            status: 'completed',
            usage: {
              input_tokens: 4,
              output_tokens: 2,
              total_tokens: 6,
            },
          },
        };
      },
    };

    const client = wrapOpenAI(
      {
        responses: {
          async create(_params: Record<string, unknown>) {
            return streamSource;
          },
        },
      },
      {
        logger,
        provider: 'openrouter',
        operation: 'route_experiment',
        capture: {
          output: true,
          streamEvents: true,
          toolInputs: true,
        },
      }
    );

    const stream = await client.responses.create({
      model: 'openai/gpt-5-mini',
      input: 'Classify this ticket',
      stream: true,
    });

    let chunks = 0;
    for await (const _chunk of stream as AsyncIterable<unknown>) {
      chunks += 1;
    }

    await waitForFileFlush();

    const trace = findAiTrace(tempDir);
    const ai = trace?.ai as Record<string, unknown>;
    const events = trace?.events as Array<Record<string, unknown>>;

    expect(chunks).toBe(4);
    expect(ai.provider).toBe('openrouter');
    expect(ai.streamed).toBe(true);
    expect(ai.output).toBe('hello router');
    expect(typeof (ai.timing as Record<string, unknown>).durationMs).toBe('number');
    expect(typeof (ai.timing as Record<string, unknown>).msToFirstChunk).toBe('number');
    expect(events.some((event) => event.type === 'ai.first_chunk')).toBe(true);
    expect(events.some((event) => event.type === 'ai.chunk')).toBe(true);
  });

  it('wrapAnthropic emits normalized ai_trace and respects request-scoped logger inheritance', async () => {
    const logger = createStandaloneLogger({ pretty: false, logDir: tempDir });
    const requestLogger = logger.child({ requestId: 'req-ai-1' });

    enterRequestContext();
    setActiveRequestLogger(requestLogger);

    const client = wrapAnthropic(
      {
        messages: {
          async create(_params: Record<string, unknown>) {
            return {
              id: 'msg_1',
              model: 'claude-sonnet-4-5',
              stop_reason: 'end_turn',
              usage: {
                input_tokens: 12,
                output_tokens: 8,
                cache_read_input_tokens: 4,
              },
              content: [
                { type: 'text', text: 'summary ready' },
                {
                  type: 'tool_use',
                  id: 'tool_a',
                  name: 'lookupCustomer',
                  input: { customerId: 'cus_1' },
                },
              ],
            };
          },
        },
      },
      {
        operation: 'summarize_ticket',
        capture: {
          output: true,
          toolInputs: true,
        },
      }
    );

    await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 500,
      messages: [{ role: 'user', content: 'Summarize this support thread' }],
    } as Record<string, unknown>);

    await waitForFileFlush();

    const trace = findAiTrace(tempDir);
    const ai = trace?.ai as Record<string, unknown>;

    expect(trace?.requestId).toBe('req-ai-1');
    expect(ai.provider).toBe('anthropic');
    expect(ai.sdk).toBe('anthropic-sdk');
    expect(ai.method).toBe('messages.create');
    expect(ai.finishReason).toBe('end_turn');
    expect(ai.output).toBe('summary ready');
    expect((ai.tools as Array<Record<string, unknown>>)[0]?.input).toEqual({
      customerId: 'cus_1',
    });
  });

  it('wrapAnthropic emits failed traces for stream errors without changing user-visible error semantics', async () => {
    const logger = createStandaloneLogger({ pretty: false, logDir: tempDir });

    const client = wrapAnthropic(
      {
        messages: {
          async create(_params: Record<string, unknown>) {
            return {
              async *[Symbol.asyncIterator]() {
                yield {
                  type: 'content_block_delta',
                  delta: { type: 'text_delta', text: 'partial ' },
                };
                throw Object.assign(new Error('stream exploded'), { code: 'E_STREAM' });
              },
            };
          },
        },
      },
      {
        logger,
        capture: {
          output: true,
        },
      }
    );

    const stream = await client.messages.create({
      model: 'claude-sonnet-4-5',
      stream: true,
      messages: [{ role: 'user', content: 'hello' }],
    });

    await expect(
      (async () => {
        for await (const _chunk of stream as AsyncIterable<unknown>) {
          // consume
        }
      })()
    ).rejects.toThrow('stream exploded');

    await waitForFileFlush();

    const trace = findAiTrace(tempDir);
    const ai = trace?.ai as Record<string, unknown>;

    expect(trace?.level).toBe('error');
    expect(ai.output).toBe('partial ');
    expect(ai.errorCode).toBe('E_STREAM');
    expect((ai.timing as Record<string, unknown>).firstChunkAt).toBeDefined();
  });

  it('blypFetch preserves response usability and emits fetch traces', async () => {
    const logger = createStandaloneLogger({ pretty: false, logDir: tempDir });
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ ok: true, nested: { token: 'secret' } }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'fetch-123',
        },
      })) as unknown as typeof fetch;
    const wrappedFetch = blypFetch(
      fetchImpl,
      {
        logger,
        inspectJsonBody: true,
        metadata: { service: 'assistant-api' },
        exclude: {
          responsePaths: ['nested.token'],
        },
      }
    );

    const response = await wrappedFetch('https://api.example.com/v1/test', {
      method: 'POST',
    });
    const json = await response.json();

    await waitForFileFlush();

    const fetchTrace = findRecords(tempDir, 'fetch_trace')[0];
    const fetchData = fetchTrace?.fetch as Record<string, unknown>;
    const fetchBody = fetchTrace?.fetchBody as Record<string, unknown>;

    expect(json).toEqual({ ok: true, nested: { token: 'secret' } });
    expect(fetchData.status).toBe(200);
    expect(fetchData.requestId).toBe('fetch-123');
    expect((fetchData.metadata as Record<string, unknown>).service).toBe('assistant-api');
    expect(JSON.stringify(fetchBody)).not.toContain('secret');
  });
});
