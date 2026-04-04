import type {
  Event as BetterAgentEvent,
} from '@better-agent/core/events';
import type { GenerativeModelResponse } from '@better-agent/core/providers';
import { normalizeFinishReason, normalizeTokenUsage, safeJsonParse } from '../shared/normalize';

export type BetterAgentNormalizedUsage = ReturnType<typeof normalizeTokenUsage>;

export function mergeBetterAgentUsage(
  current: BetterAgentNormalizedUsage,
  next: BetterAgentNormalizedUsage
): BetterAgentNormalizedUsage {
  return normalizeTokenUsage({
    inputTokens: (current?.inputTokens ?? 0) + (next?.inputTokens ?? 0),
    outputTokens: (current?.outputTokens ?? 0) + (next?.outputTokens ?? 0),
    totalTokens: (current?.totalTokens ?? 0) + (next?.totalTokens ?? 0),
    reasoningTokens: (current?.reasoningTokens ?? 0) + (next?.reasoningTokens ?? 0),
    cachedInputTokens: (current?.cachedInputTokens ?? 0) + (next?.cachedInputTokens ?? 0),
  });
}

export function normalizeBetterAgentUsage(
  response: GenerativeModelResponse
): BetterAgentNormalizedUsage {
  return normalizeTokenUsage(response.usage);
}

export function normalizeBetterAgentFinishReason(
  response: GenerativeModelResponse
): string | undefined {
  return normalizeFinishReason(response.finishReason);
}

export function extractBetterAgentOutput(response: GenerativeModelResponse): {
  output?: string;
  reasoning?: string;
} {
  const textParts: string[] = [];
  const reasoningParts: string[] = [];

  for (const item of response.output ?? []) {
    if (!item || typeof item !== 'object' || item.type !== 'message') {
      continue;
    }

    const content = item.content;
    if (typeof content === 'string') {
      textParts.push(content);
      continue;
    }

    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (!part || typeof part !== 'object' || typeof part.type !== 'string') {
        continue;
      }

      if (part.type === 'text' || part.type === 'transcript') {
        if (typeof part.text === 'string') {
          textParts.push(part.text);
        }
        continue;
      }

      if (part.type === 'reasoning' && typeof part.text === 'string') {
        reasoningParts.push(part.text);
      }
    }
  }

  return {
    output: textParts.length > 0 ? textParts.join('') : undefined,
    reasoning: reasoningParts.length > 0 ? reasoningParts.join('') : undefined,
  };
}

export function extractBetterAgentProviderPayload(
  response: GenerativeModelResponse
): { request?: unknown; response?: unknown } | undefined {
  const payload: { request?: unknown; response?: unknown } = {};

  if (response.request?.body !== undefined) {
    payload.request = response.request.body;
  }

  if (response.response?.body !== undefined) {
    payload.response = response.response.body;
  }

  return payload.request !== undefined || payload.response !== undefined
    ? payload
    : undefined;
}

export function isBetterAgentTerminalEvent(event: BetterAgentEvent): boolean {
  return (
    event.type === 'RUN_FINISHED' ||
    event.type === 'RUN_ERROR' ||
    event.type === 'RUN_ABORTED'
  );
}

export function isBetterAgentLiveEvent(event: BetterAgentEvent): boolean {
  return (
    event.type === 'TEXT_MESSAGE_CONTENT' ||
    event.type === 'REASONING_MESSAGE_CONTENT' ||
    event.type === 'TOOL_CALL_START' ||
    event.type === 'TOOL_CALL_ARGS' ||
    event.type === 'TOOL_CALL_RESULT' ||
    event.type === 'DATA_PART'
  );
}

export function parseBetterAgentToolArgs(value: unknown): unknown {
  return safeJsonParse(value);
}
