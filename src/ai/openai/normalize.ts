import {
  normalizeFinishReason,
  normalizeTokenUsage,
  safeJsonParse,
} from '../shared/normalize';
import type { AIToolCallRecord } from '../shared/types';

function collectResponsesOutputText(response: Record<string, unknown>): string | undefined {
  const output = response.output;
  if (!Array.isArray(output)) {
    return undefined;
  }

  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    const content = record.content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== 'object') {
        continue;
      }

      const contentRecord = contentItem as Record<string, unknown>;
      const text = contentRecord.text;
      if (typeof text === 'string') {
        parts.push(text);
      }
    }
  }

  return parts.length > 0 ? parts.join('') : undefined;
}

function collectResponsesToolCalls(response: Record<string, unknown>): AIToolCallRecord[] {
  const output = response.output;
  if (!Array.isArray(output)) {
    return [];
  }

  const toolCalls: AIToolCallRecord[] = [];

  for (const item of output) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    const type = record.type;
    if (type === 'function_call') {
      toolCalls.push({
        id: typeof record.call_id === 'string' ? record.call_id : undefined,
        name: typeof record.name === 'string' ? record.name : 'unknown',
        input: safeJsonParse(record.arguments),
        status: 'started',
      });
    }

    if (type === 'function_call_output') {
      toolCalls.push({
        id: typeof record.call_id === 'string' ? record.call_id : undefined,
        name: typeof record.name === 'string' ? record.name : 'unknown',
        output: record.output,
        status: 'completed',
      });
    }
  }

  return toolCalls;
}

function collectChatOutputText(response: Record<string, unknown>): string | undefined {
  const choices = response.choices;
  if (!Array.isArray(choices)) {
    return undefined;
  }

  return choices
    .map((choice) => {
      if (!choice || typeof choice !== 'object') {
        return '';
      }

      const message = (choice as Record<string, unknown>).message;
      if (!message || typeof message !== 'object') {
        return '';
      }

      return typeof (message as Record<string, unknown>).content === 'string'
        ? ((message as Record<string, unknown>).content as string)
        : '';
    })
    .join('');
}

function collectChatToolCalls(response: Record<string, unknown>): AIToolCallRecord[] {
  const choices = response.choices;
  if (!Array.isArray(choices)) {
    return [];
  }

  const toolCalls: AIToolCallRecord[] = [];

  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') {
      continue;
    }

    const message = (choice as Record<string, unknown>).message;
    if (!message || typeof message !== 'object') {
      continue;
    }

    const record = message as Record<string, unknown>;
    const rawToolCalls = record.tool_calls;
    if (!Array.isArray(rawToolCalls)) {
      continue;
    }

    for (const rawToolCall of rawToolCalls) {
      if (!rawToolCall || typeof rawToolCall !== 'object') {
        continue;
      }

      const toolRecord = rawToolCall as Record<string, unknown>;
      const fn = toolRecord.function;
      const functionRecord = fn && typeof fn === 'object' ? (fn as Record<string, unknown>) : {};
      toolCalls.push({
        id: typeof toolRecord.id === 'string' ? toolRecord.id : undefined,
        name: typeof functionRecord.name === 'string' ? functionRecord.name : 'unknown',
        input: safeJsonParse(functionRecord.arguments),
        providerFormat: toolRecord,
        status: 'started',
      } as AIToolCallRecord & { providerFormat?: unknown });
    }
  }

  return toolCalls;
}

export function normalizeOpenAIResponse(response: unknown, method: string): {
  model?: string;
  usage?: ReturnType<typeof normalizeTokenUsage>;
  finishReason?: string;
  output?: unknown;
  toolCalls: AIToolCallRecord[];
  metadata?: Record<string, unknown>;
} {
  if (!response || typeof response !== 'object') {
    return { toolCalls: [] };
  }

  const record = response as Record<string, unknown>;
  const usageRecord =
    record.usage && typeof record.usage === 'object'
      ? (record.usage as Record<string, unknown>)
      : undefined;

  const usage =
    method === 'chat.completions.create'
      ? normalizeTokenUsage({
          inputTokens:
            typeof usageRecord?.prompt_tokens === 'number'
              ? usageRecord.prompt_tokens
              : undefined,
          outputTokens:
            typeof usageRecord?.completion_tokens === 'number'
              ? usageRecord.completion_tokens
              : undefined,
          totalTokens:
            typeof usageRecord?.total_tokens === 'number' ? usageRecord.total_tokens : undefined,
          reasoningTokens:
            usageRecord?.completion_tokens_details &&
            typeof usageRecord.completion_tokens_details === 'object' &&
            typeof (usageRecord.completion_tokens_details as Record<string, unknown>).reasoning_tokens ===
              'number'
              ? ((usageRecord.completion_tokens_details as Record<string, unknown>)
                  .reasoning_tokens as number)
              : undefined,
          cachedInputTokens:
            usageRecord?.prompt_tokens_details &&
            typeof usageRecord.prompt_tokens_details === 'object' &&
            typeof (usageRecord.prompt_tokens_details as Record<string, unknown>).cached_tokens ===
              'number'
              ? ((usageRecord.prompt_tokens_details as Record<string, unknown>).cached_tokens as number)
              : undefined,
        })
      : normalizeTokenUsage({
          inputTokens:
            typeof usageRecord?.input_tokens === 'number' ? usageRecord.input_tokens : undefined,
          outputTokens:
            typeof usageRecord?.output_tokens === 'number' ? usageRecord.output_tokens : undefined,
          totalTokens:
            typeof usageRecord?.total_tokens === 'number' ? usageRecord.total_tokens : undefined,
          reasoningTokens:
            usageRecord?.output_tokens_details &&
            typeof usageRecord.output_tokens_details === 'object' &&
            typeof (usageRecord.output_tokens_details as Record<string, unknown>).reasoning_tokens ===
              'number'
              ? ((usageRecord.output_tokens_details as Record<string, unknown>)
                  .reasoning_tokens as number)
              : undefined,
          cachedInputTokens:
            usageRecord?.input_tokens_details &&
            typeof usageRecord.input_tokens_details === 'object' &&
            typeof (usageRecord.input_tokens_details as Record<string, unknown>).cached_tokens ===
              'number'
              ? ((usageRecord.input_tokens_details as Record<string, unknown>).cached_tokens as number)
              : undefined,
        });

  const finishReason =
    method === 'chat.completions.create'
      ? normalizeFinishReason(
          Array.isArray(record.choices) && record.choices[0] && typeof record.choices[0] === 'object'
            ? (record.choices[0] as Record<string, unknown>).finish_reason
            : undefined
        )
      : normalizeFinishReason(record.status);

  const toolCalls =
    method === 'chat.completions.create'
      ? collectChatToolCalls(record)
      : collectResponsesToolCalls(record);

  const metadata: Record<string, unknown> = {};
  if (typeof record.id === 'string') {
    metadata.responseId = record.id;
  }
  if (typeof record.created_at === 'number') {
    metadata.createdAt = record.created_at;
  }

  if (typeof record.provider === 'string') {
    metadata.upstreamProvider = record.provider;
  }

  return {
    model: typeof record.model === 'string' ? record.model : undefined,
    usage,
    finishReason,
    output:
      method === 'chat.completions.create'
        ? collectChatOutputText(record)
        : collectResponsesOutputText(record),
    toolCalls,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}
