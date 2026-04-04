import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Event as BetterAgentEvent } from '@better-agent/core/events';
import type { GenerativeModelResponse } from '@better-agent/core/providers';
import { blypPlugin, createBetterAgentTracker } from '../src/ai/better-agent';
import { createStandaloneLogger } from '../src/frameworks/standalone';
import { runWithRequestContext, setActiveRequestLogger } from '../src/frameworks/shared/request-context';
import { resetConfigCache } from '../src/core/config';
import { makeTempDir, readJsonLines, waitForFileFlush } from './helpers/fs';

function findAiTraces(logDir: string): Array<Record<string, unknown>> {
  return readJsonLines(path.join(logDir, 'log.ndjson')).filter((record) => record.type === 'ai_trace');
}

function findAiTrace(logDir: string): Record<string, unknown> | undefined {
  return findAiTraces(logDir)[0];
}

function createResponse(options: {
  text?: string;
  reasoning?: string;
  finishReason?: GenerativeModelResponse['finishReason'];
  usage?: GenerativeModelResponse['usage'];
  requestBody?: unknown;
  responseBody?: unknown;
} = {}): GenerativeModelResponse {
  const content: any[] = [];

  if (options.text) {
    content.push({ type: 'text', text: options.text });
  }

  if (options.reasoning) {
    content.push({
      type: 'reasoning',
      text: options.reasoning,
      visibility: 'summary',
      provider: 'better-agent-test',
    });
  }

  return {
    output: [
      {
        type: 'message',
        role: 'assistant',
        content,
      },
    ],
    finishReason: options.finishReason ?? 'stop',
    usage: options.usage ?? {
      inputTokens: 2,
      outputTokens: 1,
      totalTokens: 3,
    },
    ...(options.requestBody !== undefined
      ? { request: { body: options.requestBody } }
      : {}),
    ...(options.responseBody !== undefined
      ? { response: { body: options.responseBody } }
      : {}),
  };
}

function createRunStarted(
  overrides: Partial<Extract<BetterAgentEvent, { type: 'RUN_STARTED' }>> = {}
): Extract<BetterAgentEvent, { type: 'RUN_STARTED' }> {
  return {
    type: 'RUN_STARTED',
    timestamp: Date.now(),
    runId: 'run_1',
    agentName: 'support-agent',
    conversationId: 'conv_1',
    runInput: { input: 'hello', customerId: 'cus_1' },
    ...overrides,
  };
}

function createRunFinished(
  response: GenerativeModelResponse,
  overrides: Partial<Extract<BetterAgentEvent, { type: 'RUN_FINISHED' }>> = {}
): Extract<BetterAgentEvent, { type: 'RUN_FINISHED' }> {
  return {
    type: 'RUN_FINISHED',
    timestamp: Date.now(),
    runId: 'run_1',
    agentName: 'support-agent',
    conversationId: 'conv_1',
    result: { response },
    ...overrides,
  };
}

describe('Better Agent integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('blyp-better-agent-');
    resetConfigCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
  });

  it('emits one aggregated ai_trace for plugin-based runs with resolver overrides and tool capture', async () => {
    const logger = createStandaloneLogger({ pretty: false, logDir: tempDir });
    const plugin = blypPlugin({
      logger,
      capture: {
        input: true,
        output: true,
        reasoning: true,
        rawProviderPayload: true,
        toolInputs: true,
        toolOutputs: true,
        streamEvents: true,
      },
      exclude: {
        metadataPaths: ['private.token'],
      },
      resolveRun({ agentName }) {
        return {
          provider: 'openai',
          model: 'gpt-5',
          operation: 'support_chat',
          metadata: {
            route: agentName,
            private: { token: 'secret' },
          },
        };
      },
    });

    const responseStep1 = createResponse({
      text: 'hello ',
      finishReason: 'tool-calls',
      usage: {
        inputTokens: 2,
        outputTokens: 1,
        totalTokens: 3,
      },
      requestBody: { step: 1 },
      responseBody: { id: 'resp_1' },
    });
    const responseStep2 = createResponse({
      text: 'hello world',
      reasoning: 'classified',
      usage: {
        inputTokens: 4,
        outputTokens: 3,
        totalTokens: 7,
        reasoningTokens: 1,
      },
      requestBody: { step: 2 },
      responseBody: { id: 'resp_2' },
    });

    const runStarted = createRunStarted();

    await plugin.onEvent?.(runStarted, {
      runId: runStarted.runId,
      agentName: runStarted.agentName,
      conversationId: runStarted.conversationId,
      control: { abortRun: async () => {} },
    });

    await plugin.onAfterModelCall?.({
      runId: runStarted.runId,
      agentName: runStarted.agentName,
      conversationId: runStarted.conversationId,
      stepIndex: 0,
      response: responseStep1,
    });

    await plugin.onEvent?.(
      {
        type: 'STEP_START',
        timestamp: Date.now(),
        runId: runStarted.runId,
        agentName: runStarted.agentName,
        conversationId: runStarted.conversationId,
        stepIndex: 0,
        maxSteps: 4,
      },
      {
        runId: runStarted.runId,
        agentName: runStarted.agentName,
        conversationId: runStarted.conversationId,
        control: { abortRun: async () => {} },
      }
    );

    await plugin.onEvent?.(
      {
        type: 'TEXT_MESSAGE_CONTENT',
        timestamp: Date.now(),
        messageId: 'msg_1',
        delta: 'hello ',
      },
      {
        runId: runStarted.runId,
        agentName: runStarted.agentName,
        conversationId: runStarted.conversationId,
        control: { abortRun: async () => {} },
      }
    );

    await plugin.onEvent?.(
      {
        type: 'TOOL_CALL_START',
        timestamp: Date.now(),
        runId: runStarted.runId,
        agentName: runStarted.agentName,
        parentMessageId: 'msg_1',
        toolCallId: 'tool_1',
        toolCallName: 'lookupOrder',
        toolTarget: 'server',
      },
      {
        runId: runStarted.runId,
        agentName: runStarted.agentName,
        conversationId: runStarted.conversationId,
        control: { abortRun: async () => {} },
      }
    );

    await plugin.onEvent?.(
      {
        type: 'TOOL_CALL_ARGS',
        timestamp: Date.now(),
        runId: runStarted.runId,
        agentName: runStarted.agentName,
        parentMessageId: 'msg_1',
        toolCallId: 'tool_1',
        toolCallName: 'lookupOrder',
        delta: '{"orderId":"ord_1"}',
        toolTarget: 'server',
      },
      {
        runId: runStarted.runId,
        agentName: runStarted.agentName,
        conversationId: runStarted.conversationId,
        control: { abortRun: async () => {} },
      }
    );

    await plugin.onEvent?.(
      {
        type: 'TOOL_CALL_RESULT',
        timestamp: Date.now(),
        runId: runStarted.runId,
        agentName: runStarted.agentName,
        parentMessageId: 'msg_1',
        toolCallId: 'tool_1',
        toolCallName: 'lookupOrder',
        result: { status: 'ok' },
        toolTarget: 'server',
      },
      {
        runId: runStarted.runId,
        agentName: runStarted.agentName,
        conversationId: runStarted.conversationId,
        control: { abortRun: async () => {} },
      }
    );

    await plugin.onAfterModelCall?.({
      runId: runStarted.runId,
      agentName: runStarted.agentName,
      conversationId: runStarted.conversationId,
      stepIndex: 1,
      response: responseStep2,
    });

    await plugin.onEvent?.(
      {
        type: 'REASONING_MESSAGE_CONTENT',
        timestamp: Date.now(),
        messageId: 'msg_1',
        visibility: 'summary',
        delta: 'classified',
      },
      {
        runId: runStarted.runId,
        agentName: runStarted.agentName,
        conversationId: runStarted.conversationId,
        control: { abortRun: async () => {} },
      }
    );

    await plugin.onEvent?.(
      createRunFinished(responseStep2),
      {
        runId: runStarted.runId,
        agentName: runStarted.agentName,
        conversationId: runStarted.conversationId,
        control: { abortRun: async () => {} },
      }
    );

    await waitForFileFlush();

    const trace = findAiTrace(tempDir);
    const ai = trace?.ai as Record<string, unknown>;
    const usage = ai?.usage as Record<string, unknown>;
    const metadata = ai?.metadata as Record<string, unknown>;
    const toolCalls = ai?.toolCalls as Array<Record<string, unknown>>;
    const events = trace?.events as Array<Record<string, unknown>>;
    const rawProviderPayload = ai?.rawProviderPayload as Array<Record<string, unknown>>;

    expect(trace?.level).toBe('info');
    expect(ai?.sdk).toBe('better-agent-sdk');
    expect(ai?.provider).toBe('openai');
    expect(ai?.model).toBe('gpt-5');
    expect(ai?.operation).toBe('support_chat');
    expect(ai?.method).toBe('agent.run');
    expect(ai?.streamed).toBe(true);
    expect(ai?.input).toEqual(runStarted.runInput);
    expect(ai?.output).toBe('hello world');
    expect(ai?.reasoning).toBe('classified');
    expect(ai?.finishReason).toBe('stop');
    expect(usage?.inputTokens).toBe(6);
    expect(usage?.outputTokens).toBe(4);
    expect(usage?.totalTokens).toBe(10);
    expect(usage?.reasoningTokens).toBe(1);
    expect(metadata?.agentName).toBe('support-agent');
    expect(metadata?.runId).toBe('run_1');
    expect(metadata?.conversationId).toBe('conv_1');
    expect(metadata?.stepCount).toBe(2);
    expect(metadata?.route).toBe('support-agent');
    expect((metadata?.private as Record<string, unknown>)?.token).toBeUndefined();
    expect(toolCalls[0]?.name).toBe('lookupOrder');
    expect(toolCalls[0]?.input).toEqual({ orderId: 'ord_1' });
    expect(toolCalls[0]?.output).toEqual({ status: 'ok' });
    expect(rawProviderPayload).toHaveLength(2);
    expect(typeof (ai?.timing as Record<string, unknown>).msToFirstChunk).toBe('number');
    expect(events.some((event) => event.type === 'ai.start')).toBe(true);
    expect(events.some((event) => event.type === 'ai.first_chunk')).toBe(true);
    expect(events.some((event) => event.type === 'ai.tool_call.start')).toBe(true);
    expect(events.some((event) => event.type === 'ai.tool_call.result')).toBe(true);
    expect(events.some((event) => event.type === 'ai.finish')).toBe(true);
  });

  it('matches plugin trace shape with the manual tracker and de-duplicates terminal finalization', async () => {
    const pluginDir = makeTempDir('blyp-better-plugin-');
    const trackerDir = makeTempDir('blyp-better-tracker-');
    const pluginLogger = createStandaloneLogger({ pretty: false, logDir: pluginDir });
    const trackerLogger = createStandaloneLogger({ pretty: false, logDir: trackerDir });

    const plugin = blypPlugin({
      logger: pluginLogger,
      capture: { output: true },
    });
    const tracker = createBetterAgentTracker({
      logger: trackerLogger,
      capture: { output: true },
    });

    const runStarted = createRunStarted({ runId: 'run_manual' });
    const response = createResponse({
      text: 'manual parity',
      usage: {
        inputTokens: 5,
        outputTokens: 2,
        totalTokens: 7,
      },
    });
    const runFinished = createRunFinished(response, { runId: 'run_manual' });

    await plugin.onEvent?.(runStarted, {
      runId: runStarted.runId,
      agentName: runStarted.agentName,
      conversationId: runStarted.conversationId,
      control: { abortRun: async () => {} },
    });
    await plugin.onAfterModelCall?.({
      runId: runStarted.runId,
      agentName: runStarted.agentName,
      conversationId: runStarted.conversationId,
      stepIndex: 0,
      response,
    });
    await plugin.onEvent?.(runFinished, {
      runId: runStarted.runId,
      agentName: runStarted.agentName,
      conversationId: runStarted.conversationId,
      control: { abortRun: async () => {} },
    });

    await tracker.onEvent(runStarted);
    await tracker.onAfterModelCall(response, { stepIndex: 0 });
    await tracker.onEvent(runFinished);
    await tracker.onEvent({
      type: 'RUN_ERROR',
      timestamp: Date.now(),
      runId: 'run_manual',
      agentName: runStarted.agentName,
      conversationId: runStarted.conversationId,
      error: {
        name: 'Error',
        message: 'ignored-after-finish',
      },
    });

    await waitForFileFlush();

    const pluginTrace = findAiTrace(pluginDir);
    const trackerTrace = findAiTrace(trackerDir);
    const pluginAi = pluginTrace?.ai as Record<string, unknown>;
    const trackerAi = trackerTrace?.ai as Record<string, unknown>;

    expect(findAiTraces(trackerDir)).toHaveLength(1);
    expect(trackerAi.sdk).toBe(pluginAi.sdk);
    expect(trackerAi.provider).toBe(pluginAi.provider);
    expect(trackerAi.model).toBe(pluginAi.model);
    expect(trackerAi.operation).toBe(pluginAi.operation);
    expect(trackerAi.method).toBe(pluginAi.method);
    expect(trackerAi.output).toBe(pluginAi.output);
    expect(trackerAi.finishReason).toBe(pluginAi.finishReason);
    expect(trackerAi.usage).toEqual(pluginAi.usage);

    fs.rmSync(pluginDir, { recursive: true, force: true });
    fs.rmSync(trackerDir, { recursive: true, force: true });
  });

  it('emits non-aggregated final-step usage when the manual tracker is used without onAfterModelCall', async () => {
    const logger = createStandaloneLogger({ pretty: false, logDir: tempDir });
    const tracker = createBetterAgentTracker({
      logger,
      capture: { output: true },
    });

    const runStarted = createRunStarted({ runId: 'run_no_model_hook' });
    const finalResponse = createResponse({
      text: 'final only',
      usage: {
        inputTokens: 3,
        outputTokens: 2,
        totalTokens: 5,
      },
    });

    await tracker.onEvent(runStarted);
    await tracker.onEvent(
      createRunFinished(finalResponse, { runId: 'run_no_model_hook' })
    );

    await waitForFileFlush();

    const ai = findAiTrace(tempDir)?.ai as Record<string, unknown>;
    const usage = ai?.usage as Record<string, unknown>;

    expect(usage?.totalTokens).toBe(5);
    expect(ai?.output).toBe('final only');
  });

  it('emits error traces with request-scoped logger inheritance', async () => {
    const logger = createStandaloneLogger({ pretty: false, logDir: tempDir });
    const requestLogger = logger.child({ requestId: 'req-better-1' });

    await runWithRequestContext(async () => {
      setActiveRequestLogger(requestLogger);

      const plugin = blypPlugin({
        capture: { output: true },
      });
      const runStarted = createRunStarted({ runId: 'run_error' });

      await plugin.onEvent?.(runStarted, {
        runId: runStarted.runId,
        agentName: runStarted.agentName,
        conversationId: runStarted.conversationId,
        control: { abortRun: async () => {} },
      });
      await plugin.onEvent?.(
        {
          type: 'TEXT_MESSAGE_CONTENT',
          timestamp: Date.now(),
          messageId: 'msg_err',
          delta: 'partial output',
        },
        {
          runId: runStarted.runId,
          agentName: runStarted.agentName,
          conversationId: runStarted.conversationId,
          control: { abortRun: async () => {} },
        }
      );
      await plugin.onEvent?.(
        {
          type: 'RUN_ERROR',
          timestamp: Date.now(),
          runId: runStarted.runId,
          agentName: runStarted.agentName,
          conversationId: runStarted.conversationId,
          error: {
            name: 'Error',
            message: 'kaboom',
            code: 'E_FAIL',
          },
        },
        {
          runId: runStarted.runId,
          agentName: runStarted.agentName,
          conversationId: runStarted.conversationId,
          control: { abortRun: async () => {} },
        }
      );
    });

    await waitForFileFlush();

    const trace = findAiTrace(tempDir);
    const ai = trace?.ai as Record<string, unknown>;

    expect(trace?.level).toBe('error');
    expect(trace?.requestId).toBe('req-better-1');
    expect(ai?.errorType).toBe('Error');
    expect(ai?.errorCode).toBe('E_FAIL');
    expect(ai?.output).toBe('partial output');
  });

  it('emits abort traces with finishReason=abort', async () => {
    const logger = createStandaloneLogger({ pretty: false, logDir: tempDir });
    const plugin = blypPlugin({ logger });
    const runStarted = createRunStarted({ runId: 'run_abort' });

    await plugin.onEvent?.(runStarted, {
      runId: runStarted.runId,
      agentName: runStarted.agentName,
      conversationId: runStarted.conversationId,
      control: { abortRun: async () => {} },
    });
    await plugin.onEvent?.(
      {
        type: 'RUN_ABORTED',
        timestamp: Date.now(),
        runId: runStarted.runId,
        agentName: runStarted.agentName,
        conversationId: runStarted.conversationId,
      },
      {
        runId: runStarted.runId,
        agentName: runStarted.agentName,
        conversationId: runStarted.conversationId,
        control: { abortRun: async () => {} },
      }
    );

    await waitForFileFlush();

    const trace = findAiTrace(tempDir);
    const ai = trace?.ai as Record<string, unknown>;

    expect(trace?.level).toBe('info');
    expect(ai?.finishReason).toBe('abort');
  });
});
