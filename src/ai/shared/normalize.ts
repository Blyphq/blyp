import { toLoggableValue } from './redaction';
import type { AIToolCallRecord } from './types';

export type BlypNormalizedUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

export function normalizeTokenUsage(usage?: Partial<BlypNormalizedUsage>): BlypNormalizedUsage | undefined {
  if (!usage) {
    return undefined;
  }

  const normalized: BlypNormalizedUsage = {
    inputTokens: typeof usage.inputTokens === 'number' ? usage.inputTokens : undefined,
    outputTokens: typeof usage.outputTokens === 'number' ? usage.outputTokens : undefined,
    totalTokens: typeof usage.totalTokens === 'number' ? usage.totalTokens : undefined,
    reasoningTokens:
      typeof usage.reasoningTokens === 'number' ? usage.reasoningTokens : undefined,
    cachedInputTokens:
      typeof usage.cachedInputTokens === 'number' ? usage.cachedInputTokens : undefined,
  };

  if (
    normalized.totalTokens === undefined &&
    (normalized.inputTokens !== undefined || normalized.outputTokens !== undefined)
  ) {
    normalized.totalTokens = (normalized.inputTokens ?? 0) + (normalized.outputTokens ?? 0);
  }

  if (Object.values(normalized).every((value) => value === undefined)) {
    return undefined;
  }

  return normalized;
}

export function normalizeFinishReason(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['type', 'reason', 'stop_reason', 'finish_reason', 'raw', 'unified']) {
      const entry = record[key];
      if (typeof entry === 'string' && entry.length > 0) {
        return entry;
      }
    }
  }

  return undefined;
}

export function safeJsonParse(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function toToolEventData(toolCall: AIToolCallRecord): Record<string, unknown> {
  return {
    toolName: toolCall.name,
    toolCallId: toolCall.id,
    status: toolCall.status,
  };
}

export function safeErrorSummary(error: unknown): {
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

export function toProviderPayload(value: unknown): unknown {
  return toLoggableValue(value);
}
