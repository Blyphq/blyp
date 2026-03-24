import type { LanguageModelMiddleware } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { BlypLogger } from '../../core/logger';

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
  streamChunks?: boolean;
};

export type BlypExcludeOptions = {
  providerOptions?: boolean;
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

export type BlypModelOptions = {
  logger?: BlypLogger;
  operation?: string;
  metadata?: Record<string, unknown>;
  capture?: BlypCaptureOptions;
  exclude?: BlypExcludeOptions;
  limits?: BlypLimitOptions;
  hooks?: {
    onStart?: (context: BlypMiddlewareContext) => void | Promise<void>;
    onFinish?: (context: BlypMiddlewareContext) => void | Promise<void>;
    onError?: (context: BlypMiddlewareContext) => void | Promise<void>;
    onEvent?: (event: BlypTraceEvent, context: BlypMiddlewareContext) => void | Promise<void>;
  };
};

export type BlypResolvedModelOptions = {
  logger?: BlypLogger;
  operation?: string;
  metadata: Record<string, unknown>;
  capture: Required<BlypCaptureOptions>;
  exclude: Required<BlypExcludeOptions>;
  limits: Required<BlypLimitOptions>;
  hooks: NonNullable<BlypModelOptions['hooks']>;
};

export type BlypLanguageModel = LanguageModelV3;
export type BlypLanguageModelMiddleware = LanguageModelMiddleware;
