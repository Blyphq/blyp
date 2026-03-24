import {
  addSDKChunkEvent,
  emitSDKToolResult,
  emitSDKToolStart,
  markSDKFirstChunk,
  recordSDKFinishReason,
  recordSDKUsage,
  setSDKOutput,
  upsertSDKToolCall,
} from '../shared/trace';
import { normalizeFinishReason, safeJsonParse } from '../shared/normalize';
import type { BlypSDKContext } from '../shared/types';

export async function consumeOpenAIStreamChunk(
  state: Parameters<typeof markSDKFirstChunk>[0],
  context: BlypSDKContext,
  chunk: unknown
): Promise<void> {
  if (!chunk || typeof chunk !== 'object') {
    return;
  }

  await markSDKFirstChunk(state, context);

  const record = chunk as Record<string, unknown>;
  const type = record.type;

  if (typeof type === 'string') {
    await addSDKChunkEvent(state, context, { type });
  }

  if (type === 'response.output_text.delta' && typeof record.delta === 'string') {
    const next = `${typeof state.output === 'string' ? state.output : ''}${record.delta}`;
    setSDKOutput(state, next);
  }

  if (type === 'response.function_call_arguments.delta') {
    const toolId = typeof record.item_id === 'string' ? record.item_id : undefined;
    const name = typeof record.name === 'string' ? record.name : 'unknown';
    const existing = state.toolCalls.find((tool) => tool.id === toolId);
    const input = `${typeof existing?.input === 'string' ? existing.input : ''}${typeof record.delta === 'string' ? record.delta : ''}`;
    const toolCall = {
      id: toolId,
      name,
      input,
      status: 'started' as const,
    };

    if (!existing) {
      await emitSDKToolStart(state, context, toolCall);
    } else {
      upsertSDKToolCall(state, toolCall);
    }
  }

  if (type === 'response.output_item.done') {
    const item = record.item;
    if (item && typeof item === 'object') {
      const itemRecord = item as Record<string, unknown>;
      if (itemRecord.type === 'function_call') {
        const toolCall = {
          id: typeof itemRecord.call_id === 'string' ? itemRecord.call_id : undefined,
          name: typeof itemRecord.name === 'string' ? itemRecord.name : 'unknown',
          input: safeJsonParse(itemRecord.arguments),
          status: 'started' as const,
        };
        await emitSDKToolStart(state, context, toolCall);
      }

      if (itemRecord.type === 'function_call_output') {
        const toolCall = {
          id: typeof itemRecord.call_id === 'string' ? itemRecord.call_id : undefined,
          name: typeof itemRecord.name === 'string' ? itemRecord.name : 'unknown',
          output: itemRecord.output,
          status: 'completed' as const,
        };
        await emitSDKToolResult(state, context, toolCall);
      }
    }
  }

  if (type === 'response.completed') {
    const response = record.response;
    if (response && typeof response === 'object') {
      const responseRecord = response as Record<string, unknown>;
      recordSDKFinishReason(state, normalizeFinishReason(responseRecord.status));
      if (responseRecord.usage && typeof responseRecord.usage === 'object') {
        const usage = responseRecord.usage as Record<string, unknown>;
        recordSDKUsage(state, {
          inputTokens:
            typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
          outputTokens:
            typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
          totalTokens:
            typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined,
        });
      }
    }
  }
}
