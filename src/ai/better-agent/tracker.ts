import type {
  Event as BetterAgentEvent,
} from '@better-agent/core/events';
import type { GenerativeModelResponse } from '@better-agent/core/providers';
import type { AIToolCallRecord, BlypAIProvider, BlypProviderOptions } from '../shared/types';
import {
  addSDKChunkEvent,
  addTraceEvent,
  createSDKTraceState,
  emitSDKToolResult,
  emitSDKToolStart,
  finalizeSDKTrace,
  markSDKFirstChunk,
  recordSDKFinishReason,
  recordSDKUsage,
  resolveBlypProviderOptions,
  runHookSafely,
  setSDKInput,
  setSDKOutput,
  setSDKRawProviderPayload,
  setSDKReasoning,
  setSDKResponse,
  setSDKStreamed,
  upsertSDKToolCall,
} from '../shared/trace';
import {
  extractBetterAgentOutput,
  extractBetterAgentProviderPayload,
  isBetterAgentLiveEvent,
  mergeBetterAgentUsage,
  normalizeBetterAgentFinishReason,
  normalizeBetterAgentUsage,
  parseBetterAgentToolArgs,
} from './normalize';

export type BlypBetterAgentRunResolver = (ctx: {
  runId: string;
  agentName: string;
  conversationId?: string;
}) =>
  | {
      provider?: BlypAIProvider;
      model?: string;
      operation?: string;
      method?: string;
      metadata?: Record<string, unknown>;
      streamed?: boolean;
    }
  | Promise<
      | {
          provider?: BlypAIProvider;
          model?: string;
          operation?: string;
          method?: string;
          metadata?: Record<string, unknown>;
          streamed?: boolean;
        }
      | undefined
    >
  | undefined;

export type BlypBetterAgentOptions =
  Omit<BlypProviderOptions, 'provider' | 'operation' | 'metadata'> & {
    provider?: BlypAIProvider;
    operation?: string;
    metadata?: Record<string, unknown>;
    resolveRun?: BlypBetterAgentRunResolver;
  };

export type BlypBetterAgentTracker = {
  onEvent(event: BetterAgentEvent): Promise<void>;
  onAfterModelCall(
    response: GenerativeModelResponse,
    info?: { stepIndex?: number }
  ): Promise<void>;
};

type InternalTraceHandle = ReturnType<typeof createSDKTraceState> & {
  config: ReturnType<typeof resolveBlypProviderOptions>;
};

type BetterAgentToolState = {
  id: string;
  name: string;
  inputText?: string;
  startedAt?: string;
  startedAtMs?: number;
};

function eventTimestampToIso(timestamp?: number): string | undefined {
  return typeof timestamp === 'number' ? new Date(timestamp).toISOString() : undefined;
}

export function createBetterAgentTracker(
  options: BlypBetterAgentOptions = {}
): BlypBetterAgentTracker {
  let traceHandle: InternalTraceHandle | undefined;
  let finalized = false;
  let stepCount = 0;
  let lastResponse: GenerativeModelResponse | undefined;
  let aggregatedUsage: ReturnType<typeof normalizeBetterAgentUsage>;
  let sawAfterModelCall = false;
  let liveOutput = '';
  let liveReasoning = '';
  let rawProviderPayloads: unknown[] = [];
  const toolStates = new Map<string, BetterAgentToolState>();

  function updateStepCount(stepIndex?: number): void {
    if (typeof stepIndex === 'number') {
      stepCount = Math.max(stepCount, stepIndex + 1);
    }
  }

  async function initializeFromRunStart(
    event: Extract<BetterAgentEvent, { type: 'RUN_STARTED' }>
  ): Promise<void> {
    if (traceHandle) {
      return;
    }

    const resolved = await options.resolveRun?.({
      runId: event.runId,
      agentName: event.agentName,
      conversationId: event.conversationId,
    });

    const provider = resolved?.provider ?? options.provider ?? 'better-agent';
    const operation = resolved?.operation ?? options.operation ?? event.agentName;
    const model = resolved?.model ?? event.agentName;
    const config = resolveBlypProviderOptions({
      ...options,
      provider,
      operation,
      metadata: {
        ...(options.metadata ?? {}),
        ...(resolved?.metadata ?? {}),
      },
    });

    const created = createSDKTraceState({
      provider,
      sdk: 'better-agent-sdk',
      operation,
      method: resolved?.method ?? 'agent.run',
      model,
      request: event.runInput,
      streamed: resolved?.streamed === true,
      config,
    });

    traceHandle = {
      ...created,
      config,
    };

    setSDKInput(traceHandle.state, event.runInput);
    traceHandle.context.setMetadata({
      agentName: event.agentName,
      runId: event.runId,
      ...(event.conversationId ? { conversationId: event.conversationId } : {}),
    });

    await addTraceEvent(traceHandle.state as never, traceHandle.context as never, {
      type: 'ai.start',
    });
    await runHookSafely(traceHandle.config.hooks.onStart, [traceHandle.context]);
  }

  async function markFirstLiveChunk(event: BetterAgentEvent): Promise<void> {
    if (!traceHandle || !isBetterAgentLiveEvent(event)) {
      return;
    }

    setSDKStreamed(traceHandle.state, true);
    await markSDKFirstChunk(traceHandle.state, traceHandle.context);
  }

  function storeToolState(toolState: BetterAgentToolState): BetterAgentToolState {
    toolStates.set(toolState.id, toolState);
    return toolState;
  }

  function getToolRecord(toolCallId: string, toolName: string): AIToolCallRecord {
    const current = toolStates.get(toolCallId);
    return {
      id: toolCallId,
      name: toolName,
      input: current?.inputText ? parseBetterAgentToolArgs(current.inputText) : undefined,
      startedAt: current?.startedAt,
      status: 'started',
    };
  }

  async function finalizeRun(error?: unknown): Promise<void> {
    if (!traceHandle || finalized) {
      return;
    }
    finalized = true;

    traceHandle.context.setMetadata({
      stepCount,
    });

    if (lastResponse) {
      setSDKResponse(traceHandle.state, lastResponse);

      const normalized = extractBetterAgentOutput(lastResponse);
      const output = normalized.output ?? (liveOutput || undefined);
      const reasoning = normalized.reasoning ?? (liveReasoning || undefined);

      if (output !== undefined) {
        setSDKOutput(traceHandle.state, output);
      }

      if (reasoning !== undefined) {
        setSDKReasoning(traceHandle.state, reasoning);
      }

      if (!sawAfterModelCall) {
        const usage = normalizeBetterAgentUsage(lastResponse);
        if (usage) {
          aggregatedUsage = mergeBetterAgentUsage(aggregatedUsage, usage);
          recordSDKUsage(traceHandle.state, aggregatedUsage);
        }
      }

      if (traceHandle.state.finishReason === undefined) {
        const finishReason = normalizeBetterAgentFinishReason(lastResponse);
        if (finishReason) {
          recordSDKFinishReason(traceHandle.state, finishReason);
        }
      }

      if (rawProviderPayloads.length === 0) {
        const payload = extractBetterAgentProviderPayload(lastResponse);
        if (payload) {
          rawProviderPayloads = [payload];
        }
      }
    } else {
      if (liveOutput) {
        setSDKOutput(traceHandle.state, liveOutput);
      }

      if (liveReasoning) {
        setSDKReasoning(traceHandle.state, liveReasoning);
      }
    }

    if (rawProviderPayloads.length > 0) {
      setSDKRawProviderPayload(traceHandle.state, rawProviderPayloads);
    }

    await finalizeSDKTrace(traceHandle.state, traceHandle.context, {
      ...(error !== undefined ? { error } : {}),
    });
  }

  return {
    async onEvent(event) {
      if (finalized) {
        return;
      }

      if (event.type === 'RUN_STARTED') {
        await initializeFromRunStart(event);
        return;
      }

      if (!traceHandle) {
        return;
      }

      if ('stepIndex' in event && typeof event.stepIndex === 'number') {
        updateStepCount(event.stepIndex);
      }

      if (isBetterAgentLiveEvent(event)) {
        await markFirstLiveChunk(event);
      }

      switch (event.type) {
        case 'TEXT_MESSAGE_CONTENT':
          liveOutput += event.delta;
          await addSDKChunkEvent(traceHandle.state, traceHandle.context, {
            kind: 'text',
            delta: event.delta,
          });
          break;

        case 'REASONING_MESSAGE_CONTENT':
          liveReasoning += event.delta;
          await addSDKChunkEvent(traceHandle.state, traceHandle.context, {
            kind: 'reasoning',
            delta: event.delta,
          });
          break;

        case 'DATA_PART':
          await addSDKChunkEvent(traceHandle.state, traceHandle.context, {
            kind: 'data',
            data: event.data,
            ...(event.id ? { id: event.id } : {}),
          });
          break;

        case 'TOOL_CALL_START': {
          const startedAt = eventTimestampToIso(event.timestamp);
          storeToolState({
            id: event.toolCallId,
            name: event.toolCallName,
            startedAt,
            startedAtMs: typeof event.timestamp === 'number' ? event.timestamp : undefined,
          });
          await emitSDKToolStart(traceHandle.state, traceHandle.context, {
            id: event.toolCallId,
            name: event.toolCallName,
            startedAt,
            status: 'started',
          });
          break;
        }

        case 'TOOL_CALL_ARGS': {
          const current = storeToolState({
            ...(toolStates.get(event.toolCallId) ?? {
              id: event.toolCallId,
              name: event.toolCallName,
            }),
            inputText: `${toolStates.get(event.toolCallId)?.inputText ?? ''}${event.delta}`,
          });

          upsertSDKToolCall(traceHandle.state, {
            id: current.id,
            name: current.name,
            input: parseBetterAgentToolArgs(current.inputText),
            startedAt: current.startedAt,
            status: 'started',
          });
          break;
        }

        case 'TOOL_CALL_RESULT': {
          const current = toolStates.get(event.toolCallId);
          const finishedAt = eventTimestampToIso(event.timestamp);
          const durationMs =
            typeof event.timestamp === 'number' && typeof current?.startedAtMs === 'number'
              ? Math.max(0, Math.round(event.timestamp - current.startedAtMs))
              : undefined;

          await emitSDKToolResult(traceHandle.state, traceHandle.context, {
            ...getToolRecord(event.toolCallId, event.toolCallName),
            output: event.result,
            finishedAt,
            durationMs,
            status: event.isError ? 'failed' : 'completed',
            error: event.isError ? event.result : undefined,
          });
          break;
        }

        case 'RUN_FINISHED':
          lastResponse = event.result.response;
          await finalizeRun();
          break;

        case 'RUN_ERROR':
          await finalizeRun(event.error);
          break;

        case 'RUN_ABORTED':
          recordSDKFinishReason(traceHandle.state, 'abort');
          await finalizeRun();
          break;

        default:
          break;
      }
    },

    async onAfterModelCall(response, info) {
      if (!traceHandle || finalized) {
        return;
      }

      sawAfterModelCall = true;
      lastResponse = response;
      updateStepCount(info?.stepIndex);
      setSDKResponse(traceHandle.state, response);

      const usage = normalizeBetterAgentUsage(response);
      if (usage) {
        aggregatedUsage = mergeBetterAgentUsage(aggregatedUsage, usage);
        recordSDKUsage(traceHandle.state, aggregatedUsage);
      }

      const finishReason = normalizeBetterAgentFinishReason(response);
      if (finishReason) {
        recordSDKFinishReason(traceHandle.state, finishReason);
      }

      const providerPayload = extractBetterAgentProviderPayload(response);
      if (providerPayload) {
        rawProviderPayloads.push({
          ...(typeof info?.stepIndex === 'number' ? { stepIndex: info.stepIndex } : {}),
          ...providerPayload,
        });
      }

      const normalized = extractBetterAgentOutput(response);
      if (normalized.output !== undefined) {
        setSDKOutput(traceHandle.state, normalized.output);
      }

      if (normalized.reasoning !== undefined) {
        setSDKReasoning(traceHandle.state, normalized.reasoning);
      }
    },
  };
}
