import type { LanguageModelMiddleware } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { BlypLogger } from '../../core/logger';

export type BlypAIProvider = 'openai' | 'anthropic' | 'openrouter';
export type BlypAISDK = 'ai-sdk' | 'openai-sdk' | 'anthropic-sdk';

export type BlypTraceEvent = {
  type:
    | 'ai.start'
    | 'ai.first_chunk'
    | 'ai.chunk'
    | 'ai.tool_call.start'
    | 'ai.tool_call.result'
    | 'ai.finish'
    | 'ai.error';
  timestamp: string;
  data?: Record<string, unknown>;
};

export type AIToolCallRecord = {
  id?: string;
  name: string;
  input?: unknown;
  output?: unknown;
  providerFormat?: unknown;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  status: 'started' | 'completed' | 'failed';
  error?: unknown;
};

export type BlypCaptureOptions = {
  input?: boolean;
  output?: boolean;
  toolInputs?: boolean;
  toolOutputs?: boolean;
  reasoning?: boolean;
  streamEvents?: boolean;
  streamChunks?: boolean;
  rawProviderPayload?: boolean;
};

export type BlypExcludeOptions = {
  providerOptions?: boolean;
  requestPaths?: string[];
  responsePaths?: string[];
  metadataPaths?: string[];
  toolNames?: string[];
};

export type BlypLimitOptions = {
  maxContentBytes?: number;
  maxEvents?: number;
  maxToolCalls?: number;
};

export type BlypMiddlewareContext = {
  traceId: string;
  operation: string;
  provider: string;
  model: string;
  callType: 'generate' | 'stream';
  logger: BlypLogger;
  params: unknown;
  metadata: Record<string, unknown>;
  startedAt: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
  };
  finishReason?: string;
  streamedText?: string;
  outputText?: string;
  toolCalls?: AIToolCallRecord[];
  error?: unknown;
  setMetadata(extra: Record<string, unknown>): void;
  disableCapture(field: 'input' | 'output' | 'toolInputs' | 'toolOutputs' | 'reasoning'): void;
};

export type BlypProviderOptions = {
  logger?: BlypLogger;
  provider?: BlypAIProvider;
  operation?: string;
  metadata?: Record<string, unknown>;
  capture?: BlypCaptureOptions;
  exclude?: BlypExcludeOptions;
  limits?: BlypLimitOptions;
  hooks?: {
    onStart?: (context: BlypSDKContext) => void | Promise<void>;
    onFinish?: (context: BlypSDKContext) => void | Promise<void>;
    onError?: (context: BlypSDKContext) => void | Promise<void>;
    onEvent?: (event: BlypLLMEventPart, context: BlypSDKContext) => void | Promise<void>;
  };
};

export type BlypSDKContext = {
  traceId: string;
  provider: BlypAIProvider;
  sdk: Exclude<BlypAISDK, 'ai-sdk'>;
  operation: string;
  method: string;
  logger: BlypLogger;
  metadata: Record<string, unknown>;
  request: unknown;
  response?: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
  };
  finishReason?: string;
  input?: unknown;
  output?: unknown;
  toolCalls?: AIToolCallRecord[];
  startedAt: string;
  firstChunkAt?: string;
  endedAt?: string;
  error?: unknown;
  setMetadata(extra: Record<string, unknown>): void;
  disableCapture(
    field:
      | 'input'
      | 'output'
      | 'toolInputs'
      | 'toolOutputs'
      | 'reasoning'
      | 'rawProviderPayload'
  ): void;
};

export type BlypLLMTrace = {
  provider: BlypAIProvider;
  sdk: Exclude<BlypAISDK, 'ai-sdk'>;
  model: string;
  operation: string;
  method: string;
  streamed: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
  };
  finishReason?: string;
  tools?: Array<{
    id?: string;
    name: string;
    input?: unknown;
    output?: unknown;
    providerFormat?: unknown;
    status: 'started' | 'completed' | 'failed';
  }>;
  input?: unknown;
  output?: unknown;
  timing: {
    startedAt: string;
    firstChunkAt?: string;
    endedAt: string;
    durationMs: number;
    msToFirstChunk?: number;
  };
  metadata?: Record<string, unknown>;
  rawProviderPayload?: unknown;
};

export type BlypLLMEventPart = BlypTraceEvent;

export type BlypModelOptions = BlypProviderOptions;

export type BlypResolvedModelOptions = {
  logger?: BlypLogger;
  provider?: BlypAIProvider;
  operation?: string;
  metadata: Record<string, unknown>;
  capture: Required<BlypCaptureOptions>;
  exclude: Required<BlypExcludeOptions>;
  limits: Required<BlypLimitOptions>;
  hooks: NonNullable<BlypModelOptions['hooks']>;
};

export type BlypLanguageModel = LanguageModelV3;
export type BlypLanguageModelMiddleware = LanguageModelMiddleware;
