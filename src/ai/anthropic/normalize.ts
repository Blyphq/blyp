import { normalizeFinishReason, normalizeTokenUsage } from '../shared/normalize';
import type { AIToolCallRecord } from '../shared/types';

export function normalizeAnthropicResponse(response: unknown): {
  model?: string;
  usage?: ReturnType<typeof normalizeTokenUsage>;
  finishReason?: string;
  output?: unknown;
  toolCalls: AIToolCallRecord[];
} {
  if (!response || typeof response !== 'object') {
    return { toolCalls: [] };
  }

  const record = response as Record<string, unknown>;
  const usage = record.usage && typeof record.usage === 'object'
    ? normalizeTokenUsage({
        inputTokens:
          typeof (record.usage as Record<string, unknown>).input_tokens === 'number'
            ? ((record.usage as Record<string, unknown>).input_tokens as number)
            : undefined,
        outputTokens:
          typeof (record.usage as Record<string, unknown>).output_tokens === 'number'
            ? ((record.usage as Record<string, unknown>).output_tokens as number)
            : undefined,
        cachedInputTokens:
          typeof (record.usage as Record<string, unknown>).cache_read_input_tokens === 'number'
            ? ((record.usage as Record<string, unknown>).cache_read_input_tokens as number)
            : undefined,
      })
    : undefined;

  const content = Array.isArray(record.content) ? record.content : [];
  const output = content
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('');

  const toolCalls = content
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .filter((item) => item.type === 'tool_use')
    .map(
      (item) =>
        ({
          id: typeof item.id === 'string' ? item.id : undefined,
          name: typeof item.name === 'string' ? item.name : 'unknown',
          input: item.input,
          status: 'started',
        }) satisfies AIToolCallRecord
    );

  return {
    model: typeof record.model === 'string' ? record.model : undefined,
    usage,
    finishReason: normalizeFinishReason(record.stop_reason),
    output: output || undefined,
    toolCalls,
  };
}
