import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  LanguageModelV3,
} from '@ai-sdk/provider';
import { logger as rootLogger } from '../../core/logger';
import type { BlypLogger } from '../../core/logger';
import { getActiveRequestLogger } from '../../frameworks/shared/request-context';
import {
  normalizeFinishReason as normalizeSDKFinishReason,
  normalizeTokenUsage,
  safeErrorSummary as summarizeSDKError,
  toProviderPayload,
  toToolEventData,
} from './normalize';
import { omitPaths, toLoggableValue, truncateValue } from './redaction';
import type {
  AIToolCallRecord,
  BlypAIProvider,
  BlypAISDK,
  BlypLLMTrace,
  BlypProviderOptions,
  BlypSDKContext,
  BlypMiddlewareContext,
  BlypModelOptions,
  BlypResolvedModelOptions,
  BlypTraceEvent,
} from './types';

const DEFAULT_CAPTURE = {
  input: false,
  output: false,
  toolInputs: false,
  toolOutputs: false,
  reasoning: false,
  streamEvents: false,
  streamChunks: false,
  rawProviderPayload: false,
} as const;

const DEFAULT_EXCLUDE = {
  providerOptions: false,
  requestPaths: [],
  responsePaths: [],
  metadataPaths: [],
  toolNames: [],
} as const;

const DEFAULT_LIMITS = {
  maxContentBytes: 16_384,
  maxEvents: 200,
  maxToolCalls: 50,
} as const;

function createTraceId(): string {
  return `ai_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function serializeHookError(error: unknown): unknown {
  return toLoggableValue(error);
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function sdkNowIso(): string {
  return new Date().toISOString();
}

function normalizeUsage(usage?: LanguageModelV3Usage) {
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.inputTokens.total;
  const outputTokens = usage.outputTokens.total;
  const totalTokens =
    (inputTokens ?? 0) + (outputTokens ?? 0) || undefined;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens: usage.outputTokens.reasoning,
    cachedInputTokens: usage.inputTokens.cacheRead,
  };
}

function normalizeFinishReason(
  finishReason: unknown
): string | undefined {
  if (typeof finishReason === 'string') {
    return finishReason;
  }

  if (finishReason && typeof finishReason === 'object') {
    const record = finishReason as {
      unified?: unknown;
      raw?: unknown;
    };

    if (typeof record.unified === 'string') {
      return record.unified;
    }

    if (typeof record.raw === 'string') {
      return record.raw;
    }
  }

  return undefined;
}

function collectContentText(content: Array<LanguageModelV3Content>, type: 'text' | 'reasoning') {
  return content
    .filter((part): part is Extract<LanguageModelV3Content, { type: typeof type }> => part.type === type)
    .map((part) => part.text)
    .join('');
}

function extractToolCallsFromContent(content: Array<LanguageModelV3Content>): AIToolCallRecord[] {
  const records = new Map<string, AIToolCallRecord>();

  for (const part of content) {
    if (part.type === 'tool-call') {
      records.set(part.toolCallId, {
        id: part.toolCallId,
        name: part.toolName,
        input: safeParseJson(part.input),
        status: 'started',
      });
      continue;
    }

    if (part.type === 'tool-result') {
      const current = records.get(part.toolCallId);
      records.set(part.toolCallId, {
        id: part.toolCallId,
        name: part.toolName,
        input: current?.input,
        output: part.result,
        status: part.isError ? 'failed' : 'completed',
        error: part.isError ? part.result : undefined,
      });
    }
  }

  return [...records.values()];
}

function safeErrorSummary(error: unknown): {
  errorType?: string;
  errorCode?: string | number;
} {
  if (!error) {
    return {};
  }

  if (error instanceof Error) {
    const errorLike = error as Error & { code?: string | number };
    return {
      errorType: error.name,
      errorCode: errorLike.code,
    };
  }

  if (typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return {
      errorType:
        typeof record.type === 'string'
          ? record.type
          : typeof record.name === 'string'
            ? record.name
            : 'Error',
      errorCode:
        typeof record.code === 'string' || typeof record.code === 'number'
          ? record.code
          : undefined,
    };
  }

  return {
    errorType: typeof error,
  };
}

type MutableTrace = {
  traceId: string;
  provider: string;
  model: string;
  callType: 'generate' | 'stream';
  logger: BlypLogger;
  params: LanguageModelV3CallOptions;
  options: BlypResolvedModelOptions;
  operation: string;
  metadata: Record<string, unknown>;
  startedAt: string;
  startedAtMs: number;
  firstChunkAtMs?: number;
  finishReason?: string;
  usage?: BlypMiddlewareContext['usage'];
  outputText?: string;
  streamedText?: string;
  reasoningText?: string;
  toolCalls: AIToolCallRecord[];
  toolCallMap: Map<string, AIToolCallRecord>;
  events: BlypTraceEvent[];
  streamChunks: unknown[];
  truncated: boolean;
  error?: unknown;
  capture: Required<BlypResolvedModelOptions['capture']>;
  input?: unknown;
  output?: unknown;
  reasoning?: unknown;
};

export function resolveBlypModelOptions(options: BlypModelOptions = {}): BlypResolvedModelOptions {
  return {
    logger: options.logger,
    provider: options.provider,
    operation: options.operation,
    metadata: { ...(options.metadata ?? {}) },
    capture: {
      ...DEFAULT_CAPTURE,
      ...(options.capture ?? {}),
      streamEvents: options.capture?.streamEvents ?? options.capture?.streamChunks ?? DEFAULT_CAPTURE.streamEvents,
      streamChunks: options.capture?.streamChunks ?? options.capture?.streamEvents ?? DEFAULT_CAPTURE.streamChunks,
    },
    exclude: {
      providerOptions: options.exclude?.providerOptions ?? DEFAULT_EXCLUDE.providerOptions,
      requestPaths: [...(options.exclude?.requestPaths ?? DEFAULT_EXCLUDE.requestPaths)],
      responsePaths: [...(options.exclude?.responsePaths ?? DEFAULT_EXCLUDE.responsePaths)],
      metadataPaths: [...(options.exclude?.metadataPaths ?? DEFAULT_EXCLUDE.metadataPaths)],
      toolNames: [...(options.exclude?.toolNames ?? DEFAULT_EXCLUDE.toolNames)],
    },
    limits: {
      maxContentBytes: options.limits?.maxContentBytes ?? DEFAULT_LIMITS.maxContentBytes,
      maxEvents: options.limits?.maxEvents ?? DEFAULT_LIMITS.maxEvents,
      maxToolCalls: options.limits?.maxToolCalls ?? DEFAULT_LIMITS.maxToolCalls,
    },
    hooks: options.hooks ?? {},
  };
}

type MutableSDKTrace = {
  traceId: string;
  provider: BlypAIProvider;
  sdk: Exclude<BlypAISDK, 'ai-sdk'>;
  operation: string;
  method: string;
  model: string;
  logger: BlypLogger;
  metadata: Record<string, unknown>;
  request: unknown;
  response?: unknown;
  usage?: BlypSDKContext['usage'];
  finishReason?: string;
  input?: unknown;
  output?: unknown;
  reasoning?: unknown;
  toolCalls: AIToolCallRecord[];
  events: BlypTraceEvent[];
  error?: unknown;
  startedAt: string;
  endedAt?: string;
  startedAtMs: number;
  firstChunkAt?: string;
  firstChunkAtMs?: number;
  options: BlypResolvedModelOptions;
  capture: Required<BlypResolvedModelOptions['capture']>;
  streamed: boolean;
  rawProviderPayload?: unknown;
  emitted?: boolean;
  truncated: boolean;
};

export function resolveBlypProviderOptions(options: BlypProviderOptions = {}): BlypResolvedModelOptions {
  return resolveBlypModelOptions(options);
}

export function createSDKTraceState(options: {
  provider: BlypAIProvider;
  sdk: Exclude<BlypAISDK, 'ai-sdk'>;
  operation?: string;
  method: string;
  model: string;
  request: unknown;
  streamed: boolean;
  config: BlypResolvedModelOptions;
}): { state: MutableSDKTrace; context: BlypSDKContext } {
  const logger = options.config.logger ?? getActiveRequestLogger() ?? rootLogger;
  const traceId = createTraceId();
  const startedAt = sdkNowIso();
  const state: MutableSDKTrace = {
    traceId,
    provider: options.provider,
    sdk: options.sdk,
    operation: options.operation ?? options.config.operation ?? options.method,
    method: options.method,
    model: options.model,
    logger,
    metadata: { ...options.config.metadata },
    request: options.request,
    toolCalls: [],
    events: [],
    startedAt,
    startedAtMs: performance.now(),
    options: options.config,
    capture: { ...options.config.capture },
    streamed: options.streamed,
    truncated: false,
  };

  const context: BlypSDKContext = {
    traceId,
    provider: state.provider,
    sdk: state.sdk,
    operation: state.operation,
    method: state.method,
    logger,
    metadata: state.metadata,
    request: state.request,
    get response() {
      return state.response;
    },
    get usage() {
      return state.usage;
    },
    get finishReason() {
      return state.finishReason;
    },
    get input() {
      return state.input;
    },
    get output() {
      return state.output;
    },
    get reasoning() {
      return state.reasoning;
    },
    get toolCalls() {
      return state.toolCalls.length > 0 ? state.toolCalls : undefined;
    },
    get startedAt() {
      return state.startedAt;
    },
    get firstChunkAt() {
      return state.firstChunkAt;
    },
    get endedAt() {
      return state.endedAt;
    },
    get error() {
      return state.error;
    },
    setMetadata(extra) {
      Object.assign(state.metadata, extra);
    },
    disableCapture(field) {
      state.capture[field] = false;
    },
  };

  return { state, context };
}

export function recordSDKUsage(
  state: MutableSDKTrace,
  usage?: Partial<NonNullable<BlypSDKContext['usage']>>
): void {
  state.usage = normalizeTokenUsage(usage);
}

export function recordSDKFinishReason(state: MutableSDKTrace, reason: unknown): void {
  state.finishReason = normalizeSDKFinishReason(reason);
}

export function setSDKResponse(state: MutableSDKTrace, response: unknown): void {
  state.response = response;
}

export function setSDKInput(state: MutableSDKTrace, input: unknown): void {
  state.input = input;
}

export function setSDKOutput(state: MutableSDKTrace, output: unknown): void {
  state.output = output;
}

export function setSDKReasoning(state: MutableSDKTrace, reasoning: unknown): void {
  state.reasoning = reasoning;
}

export function setSDKRawProviderPayload(state: MutableSDKTrace, payload: unknown): void {
  state.rawProviderPayload = toProviderPayload(payload);
}

export function setSDKStreamed(state: MutableSDKTrace, streamed: boolean): void {
  state.streamed = streamed;
}

export async function markSDKFirstChunk(
  state: MutableSDKTrace,
  context: BlypSDKContext
): Promise<void> {
  if (state.firstChunkAt) {
    return;
  }

  state.firstChunkAt = sdkNowIso();
  state.firstChunkAtMs = performance.now();
  await addTraceEvent(state as unknown as MutableTrace, context as unknown as BlypMiddlewareContext, {
    type: 'ai.first_chunk',
    timestamp: state.firstChunkAt,
  });
}

export async function addSDKChunkEvent(
  state: MutableSDKTrace,
  context: BlypSDKContext,
  data: Record<string, unknown>
): Promise<void> {
  if (!state.capture.streamEvents) {
    return;
  }

  await addTraceEvent(state as unknown as MutableTrace, context as unknown as BlypMiddlewareContext, {
    type: 'ai.chunk',
    data,
  });
}

export function upsertSDKToolCall(state: MutableSDKTrace, toolCall: AIToolCallRecord): void {
  const toolId = toolCall.id ?? `${toolCall.name}:${state.toolCalls.length}`;
  const currentIndex = state.toolCalls.findIndex((item, index) => {
    return (item.id ?? `${item.name}:${index}`) === toolId;
  });

  if (currentIndex === -1 && state.toolCalls.length >= state.options.limits.maxToolCalls) {
    state.truncated = true;
    return;
  }

  if (currentIndex === -1) {
    state.toolCalls.push(toolCall);
    return;
  }

  state.toolCalls[currentIndex] = {
    ...state.toolCalls[currentIndex],
    ...toolCall,
  };
}

export async function emitSDKToolStart(
  state: MutableSDKTrace,
  context: BlypSDKContext,
  toolCall: AIToolCallRecord
): Promise<void> {
  upsertSDKToolCall(state, toolCall);
  await addTraceEvent(state as unknown as MutableTrace, context as unknown as BlypMiddlewareContext, {
    type: 'ai.tool_call.start',
    data: toToolEventData(toolCall),
  });
}

export async function emitSDKToolResult(
  state: MutableSDKTrace,
  context: BlypSDKContext,
  toolCall: AIToolCallRecord
): Promise<void> {
  upsertSDKToolCall(state, toolCall);
  await addTraceEvent(state as unknown as MutableTrace, context as unknown as BlypMiddlewareContext, {
    type: 'ai.tool_call.result',
    data: toToolEventData(toolCall),
  });
}

function finalizeSDKTools(state: MutableSDKTrace): BlypLLMTrace['tools'] | undefined {
  const tools = state.toolCalls
    .filter((toolCall) => !state.options.exclude.toolNames.includes(toolCall.name))
    .map((toolCall) => {
      const normalized: NonNullable<BlypLLMTrace['tools']>[number] = {
        id: toolCall.id,
        name: toolCall.name,
        status: toolCall.status,
      };

      if (state.capture.toolInputs && toolCall.input !== undefined) {
        const captured = captureValue(toolCall.input, state.options.limits.maxContentBytes);
        normalized.input = captured.value;
        state.truncated ||= captured.truncated;
      }

      if (state.capture.toolOutputs && toolCall.output !== undefined) {
        const captured = captureValue(toolCall.output, state.options.limits.maxContentBytes);
        normalized.output = captured.value;
        state.truncated ||= captured.truncated;
      }

      if (toolCall.providerFormat !== undefined) {
        normalized.providerFormat = toLoggableValue(toolCall.providerFormat);
      }

      return normalized;
    });

  return tools.length > 0 ? tools : undefined;
}

export async function finalizeSDKTrace(
  state: MutableSDKTrace,
  context: BlypSDKContext,
  options?: { error?: unknown }
): Promise<void> {
  if (state.emitted) {
    return;
  }
  state.emitted = true;

  if (options?.error !== undefined) {
    state.error = options.error;
    await addTraceEvent(state as unknown as MutableTrace, context as unknown as BlypMiddlewareContext, {
      type: 'ai.error',
      data: {
        error: toLoggableValue(options.error),
      },
    });
    await runHookSafely(state.options.hooks.onError, [context]);
  }

  state.endedAt = sdkNowIso();
  await addTraceEvent(state as unknown as MutableTrace, context as unknown as BlypMiddlewareContext, {
    type: 'ai.finish',
    timestamp: state.endedAt,
  });

  if (!state.error) {
    await runHookSafely(state.options.hooks.onFinish, [context]);
  }

  const timing: BlypLLMTrace['timing'] = {
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    durationMs: Math.max(0, Math.round(performance.now() - state.startedAtMs)),
  };

  if (state.firstChunkAt && state.firstChunkAtMs !== undefined) {
    timing.firstChunkAt = state.firstChunkAt;
    timing.msToFirstChunk = Math.max(0, Math.round(state.firstChunkAtMs - state.startedAtMs));
  }

  const trace: BlypLLMTrace = {
    provider: state.provider,
    sdk: state.sdk,
    model: state.model,
    operation: state.operation,
    method: state.method,
    streamed: state.streamed,
    timing,
    metadata: omitPaths(state.metadata, state.options.exclude.metadataPaths),
  };

  if (state.usage) {
    trace.usage = state.usage;
  }
  if (state.finishReason) {
    trace.finishReason = state.finishReason;
  }

  if (state.capture.input && state.input !== undefined) {
    const captured = captureValue(
      omitPaths(toLoggableValue(state.input) as Record<string, unknown>, state.options.exclude.requestPaths),
      state.options.limits.maxContentBytes
    );
    trace.input = captured.value;
    state.truncated ||= captured.truncated;
  }

  if (state.capture.output && state.output !== undefined) {
    const outputValue = toLoggableValue(state.output);
    const captured = captureValue(
      typeof outputValue === 'object' && outputValue !== null && !Array.isArray(outputValue)
        ? omitPaths(outputValue as Record<string, unknown>, state.options.exclude.responsePaths)
        : outputValue,
      state.options.limits.maxContentBytes
    );
    trace.output = captured.value;
    state.truncated ||= captured.truncated;
  }

  if (state.capture.reasoning && state.reasoning !== undefined) {
    const reasoningValue = toLoggableValue(state.reasoning);
    const captured = captureValue(reasoningValue, state.options.limits.maxContentBytes);
    trace.reasoning = captured.value;
    state.truncated ||= captured.truncated;
  }

  const tools = finalizeSDKTools(state);
  if (tools) {
    trace.tools = tools;
    trace.toolCalls = tools;
  }

  if (state.capture.rawProviderPayload && state.rawProviderPayload !== undefined) {
    const captured = captureValue(state.rawProviderPayload, state.options.limits.maxContentBytes);
    trace.rawProviderPayload = captured.value;
    state.truncated ||= captured.truncated;
  }

  if (state.truncated && trace.metadata) {
    trace.metadata = { ...trace.metadata, truncated: true };
  }

  const ai: Record<string, unknown> = {
    ...trace,
  };

  if (state.error !== undefined) {
    const { errorType, errorCode } = summarizeSDKError(state.error);
    if (errorType) {
      ai.errorType = errorType;
    }
    if (errorCode !== undefined) {
      ai.errorCode = errorCode;
    }
  }

  try {
    const structured = state.logger.createStructuredLog(state.traceId, {
      type: 'ai_trace',
      ai,
      events: state.events,
    });
    structured.emit({
      message: 'ai_trace',
      level: state.error === undefined ? 'info' : 'error',
      ...(state.error === undefined ? {} : { error: state.error }),
    });
  } catch (error) {
    console.warn('[Blyp] Failed to emit AI trace.', serializeHookError(error));
  }
}

export function createTraceState(options: {
  model: LanguageModelV3;
  params: LanguageModelV3CallOptions;
  callType: 'generate' | 'stream';
  config: BlypResolvedModelOptions;
}): { state: MutableTrace; context: BlypMiddlewareContext } {
  const logger = options.config.logger ?? getActiveRequestLogger() ?? rootLogger;
  const traceId = createTraceId();
  const startedAt = nowIso();
  const state: MutableTrace = {
    traceId,
    provider: options.model.provider,
    model: options.model.modelId,
    callType: options.callType,
    logger,
    params: options.params,
    options: options.config,
    operation:
      options.config.operation ??
      (options.callType === 'stream' ? 'ai.stream' : 'ai.generate'),
    metadata: { ...options.config.metadata },
    startedAt,
    startedAtMs: performance.now(),
    toolCalls: [],
    toolCallMap: new Map<string, AIToolCallRecord>(),
    events: [],
    streamChunks: [],
    truncated: false,
    capture: { ...options.config.capture },
  };

  const context: BlypMiddlewareContext = {
    traceId,
    operation: state.operation,
    provider: state.provider,
    model: state.model,
    callType: state.callType,
    logger,
    params: options.params,
    metadata: state.metadata,
    startedAt,
    get usage() {
      return state.usage;
    },
    get finishReason() {
      return state.finishReason;
    },
    get streamedText() {
      return state.streamedText;
    },
    get outputText() {
      return state.outputText;
    },
    get toolCalls() {
      return state.toolCalls.length > 0 ? state.toolCalls : undefined;
    },
    get error() {
      return state.error;
    },
    setMetadata(extra) {
      Object.assign(state.metadata, extra);
    },
    disableCapture(field) {
      state.capture[field] = false;
    },
  };

  return { state, context };
}

export async function runHookSafely(
  hook: ((...args: any[]) => void | Promise<void>) | undefined,
  args: unknown[]
): Promise<void> {
  if (!hook) {
    return;
  }

  try {
    await hook(...args);
  } catch (error) {
    console.warn('[Blyp] AI middleware hook failed.', serializeHookError(error));
  }
}

export async function addTraceEvent(
  state: MutableTrace,
  context: BlypMiddlewareContext,
  event: Omit<BlypTraceEvent, 'timestamp'> & { timestamp?: string }
): Promise<void> {
  if (state.events.length < state.options.limits.maxEvents) {
    state.events.push({
      ...event,
      timestamp: event.timestamp ?? nowIso(),
    });
  } else {
    state.truncated = true;
  }

  await runHookSafely(state.options.hooks.onEvent, [
    state.events[state.events.length - 1],
    context,
  ]);
}

export function captureValue(
  value: unknown,
  maxContentBytes: number
): { value: unknown; truncated: boolean } {
  return truncateValue(value, maxContentBytes);
}

export function sanitizeInput(
  params: LanguageModelV3CallOptions,
  state: MutableTrace
): unknown {
  const base = toLoggableValue(params) as Record<string, unknown>;

  if (state.options.exclude.providerOptions) {
    delete base.providerOptions;
  }

  return base;
}

export function recordGenerateResult(
  state: MutableTrace,
  result: LanguageModelV3GenerateResult
): void {
  state.usage = normalizeUsage(result.usage);
  state.finishReason = normalizeFinishReason(result.finishReason);
  state.outputText = collectContentText(result.content, 'text') || undefined;

  const reasoningText = collectContentText(result.content, 'reasoning');
  if (reasoningText) {
    state.reasoningText = reasoningText;
  }

  for (const toolCall of extractToolCallsFromContent(result.content)) {
    upsertToolCall(state, toolCall);
  }
}

export function upsertToolCall(state: MutableTrace, toolCall: AIToolCallRecord): void {
  const toolId = toolCall.id ?? `${toolCall.name}:${state.toolCalls.length}`;
  const existing = state.toolCallMap.get(toolId);
  const merged = {
    ...existing,
    ...toolCall,
  } satisfies AIToolCallRecord;

  if (!existing && state.toolCalls.length >= state.options.limits.maxToolCalls) {
    state.truncated = true;
    return;
  }

  if (!existing) {
    state.toolCalls.push(merged);
  } else {
    const index = state.toolCalls.findIndex((item, itemIndex) => {
      return (item.id ?? `${item.name}:${itemIndex}`) === toolId;
    });
    if (index >= 0) {
      state.toolCalls[index] = merged;
    }
  }

  state.toolCallMap.set(toolId, merged);
}

export async function consumeStreamPart(
  state: MutableTrace,
  context: BlypMiddlewareContext,
  part: LanguageModelV3StreamPart
): Promise<void> {
  const timestamp = nowIso();

  if (state.firstChunkAtMs === undefined && part.type !== 'stream-start') {
    state.firstChunkAtMs = performance.now();
    await addTraceEvent(state, context, { type: 'ai.first_chunk', timestamp });
  }

  switch (part.type) {
    case 'text-delta':
      state.streamedText = `${state.streamedText ?? ''}${part.delta}`;
      if (state.capture.streamChunks) {
        state.streamChunks.push(part.delta);
        await addTraceEvent(state, context, {
          type: 'ai.chunk',
          timestamp,
          data: { kind: 'text', delta: part.delta },
        });
      }
      break;

    case 'reasoning-delta':
      state.reasoningText = `${state.reasoningText ?? ''}${part.delta}`;
      if (state.capture.streamChunks) {
        state.streamChunks.push({ reasoning: part.delta });
        await addTraceEvent(state, context, {
          type: 'ai.chunk',
          timestamp,
          data: { kind: 'reasoning', delta: part.delta },
        });
      }
      break;

    case 'tool-input-start': {
      const started = {
        id: part.id,
        name: part.toolName,
        startedAt: timestamp,
        status: 'started',
      } satisfies AIToolCallRecord;
      upsertToolCall(state, started);
      await addTraceEvent(state, context, {
        type: 'ai.tool_call.start',
        timestamp,
        data: {
          toolName: part.toolName,
          toolCallId: part.id,
        },
      });
      break;
    }

    case 'tool-input-delta': {
      const current = state.toolCallMap.get(part.id);
      if (current) {
        const input = `${typeof current.input === 'string' ? current.input : ''}${part.delta}`;
        upsertToolCall(state, {
          ...current,
          input,
        });
      }
      break;
    }

    case 'tool-call': {
      const existing = state.toolCallMap.get(part.toolCallId);
      upsertToolCall(state, {
        id: part.toolCallId,
        name: part.toolName,
        startedAt: existing?.startedAt ?? timestamp,
        input: safeParseJson(part.input),
        status: existing?.status ?? 'started',
      });
      break;
    }

    case 'tool-result': {
      const existing = state.toolCallMap.get(part.toolCallId);
      upsertToolCall(state, {
        id: part.toolCallId,
        name: part.toolName,
        input: existing?.input,
        output: part.result,
        startedAt: existing?.startedAt,
        finishedAt: timestamp,
        durationMs: existing?.startedAt
          ? Math.max(0, Math.round(Date.parse(timestamp) - Date.parse(existing.startedAt)))
          : undefined,
        status: part.isError ? 'failed' : 'completed',
        error: part.isError ? part.result : undefined,
      });
      await addTraceEvent(state, context, {
        type: 'ai.tool_call.result',
        timestamp,
        data: {
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          status: part.isError ? 'failed' : 'completed',
        },
      });
      break;
    }

    case 'finish':
      state.usage = normalizeUsage(part.usage);
      state.finishReason = normalizeFinishReason(part.finishReason);
      break;

    case 'error':
      state.error = part.error;
      await addTraceEvent(state, context, {
        type: 'ai.error',
        timestamp,
        data: {
          error: toLoggableValue(part.error),
        },
      });
      break;

    case 'raw':
      if (state.capture.streamChunks) {
        state.streamChunks.push({ raw: toLoggableValue(part.rawValue) });
      }
      break;

    default:
      break;
  }
}

export async function finalizeTrace(
  state: MutableTrace,
  context: BlypMiddlewareContext,
  options?: { error?: unknown }
): Promise<void> {
  if ((state as MutableTrace & { emitted?: boolean }).emitted) {
    return;
  }
  (state as MutableTrace & { emitted?: boolean }).emitted = true;

  if (options?.error !== undefined) {
    state.error = options.error;
    await addTraceEvent(state, context, {
      type: 'ai.error',
      data: {
        error: toLoggableValue(options.error),
      },
    });
    await runHookSafely(state.options.hooks.onError, [context]);
  }

  await addTraceEvent(state, context, { type: 'ai.finish' });

  if (!state.error) {
    await runHookSafely(state.options.hooks.onFinish, [context]);
  }

  const metadata = omitPaths(state.metadata, state.options.exclude.metadataPaths);
  const ai: Record<string, unknown> = {
    sdk: 'ai-sdk',
    provider: state.provider,
    model: state.model,
    operation: state.operation,
    callType: state.callType,
    streamed: state.callType === 'stream',
    finishReason: state.finishReason,
    toolCallCount: state.toolCalls.length,
    metadata,
    ...(state.usage ?? {}),
  };

  const msToFinish = Math.max(0, Math.round(performance.now() - state.startedAtMs));
  ai.msToFinish = msToFinish;

  if (state.firstChunkAtMs !== undefined) {
    ai.msToFirstChunk = Math.max(0, Math.round(state.firstChunkAtMs - state.startedAtMs));
  }

  if (
    typeof state.usage?.outputTokens === 'number' &&
    state.usage.outputTokens > 0 &&
    msToFinish > 0
  ) {
    ai.tokensPerSecond = Number(((state.usage.outputTokens / msToFinish) * 1000).toFixed(2));
  }

  if (state.capture.input) {
    const captured = captureValue(
      sanitizeInput(state.params, state),
      state.options.limits.maxContentBytes
    );
    ai.input = captured.value;
    state.truncated ||= captured.truncated;
  }

  if (state.capture.output) {
    const outputSource =
      state.callType === 'stream'
        ? state.streamedText ?? state.outputText
        : state.outputText ?? state.output;
    if (outputSource !== undefined) {
      const captured = captureValue(outputSource, state.options.limits.maxContentBytes);
      ai.output = captured.value;
      state.truncated ||= captured.truncated;
    }
  }

  if (state.capture.reasoning && state.reasoningText) {
    const captured = captureValue(state.reasoningText, state.options.limits.maxContentBytes);
    ai.reasoning = captured.value;
    state.truncated ||= captured.truncated;
  }

  if (state.capture.streamChunks && state.streamChunks.length > 0) {
    const captured = captureValue(state.streamChunks, state.options.limits.maxContentBytes);
    ai.streamChunks = captured.value;
    state.truncated ||= captured.truncated;
  }

  const visibleToolCalls = state.toolCalls
    .filter((toolCall) => !state.options.exclude.toolNames.includes(toolCall.name))
    .map((toolCall) => {
      const record: Record<string, unknown> = {
        id: toolCall.id,
        name: toolCall.name,
        startedAt: toolCall.startedAt,
        finishedAt: toolCall.finishedAt,
        durationMs: toolCall.durationMs,
        status: toolCall.status,
      };

      if (toolCall.error !== undefined) {
        record.error = toLoggableValue(toolCall.error);
      }

      if (state.capture.toolInputs && toolCall.input !== undefined) {
        const captured = captureValue(toolCall.input, state.options.limits.maxContentBytes);
        record.input = captured.value;
        state.truncated ||= captured.truncated;
      }

      if (state.capture.toolOutputs && toolCall.output !== undefined) {
        const captured = captureValue(toolCall.output, state.options.limits.maxContentBytes);
        record.output = captured.value;
        state.truncated ||= captured.truncated;
      }

      return record;
    });

  if (visibleToolCalls.length > 0) {
    ai.toolCalls = visibleToolCalls;
  }

  if (state.error !== undefined) {
    const { errorType, errorCode } = safeErrorSummary(state.error);
    if (errorType) {
      ai.errorType = errorType;
    }
    if (errorCode !== undefined) {
      ai.errorCode = errorCode;
    }
  }

  if (state.truncated) {
    ai.truncated = true;
  }

  try {
    const structured = state.logger.createStructuredLog(state.traceId, {
      type: 'ai_trace',
      ai,
      events: state.events,
    });
    structured.emit({
      message: 'ai_trace',
      level: state.error === undefined ? 'info' : 'error',
      ...(state.error === undefined ? {} : { error: state.error }),
    });
  } catch (error) {
    console.warn('[Blyp] Failed to emit AI trace.', serializeHookError(error));
  }
}
