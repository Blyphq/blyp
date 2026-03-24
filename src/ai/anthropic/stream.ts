import {
  addSDKChunkEvent,
  emitSDKToolStart,
  markSDKFirstChunk,
  recordSDKFinishReason,
  recordSDKUsage,
  setSDKOutput,
  upsertSDKToolCall,
} from '../shared/trace';
import type { BlypSDKContext } from '../shared/types';

export async function consumeAnthropicStreamChunk(
  state: Parameters<typeof markSDKFirstChunk>[0],
  context: BlypSDKContext,
  chunk: unknown
): Promise<void> {
  if (!chunk || typeof chunk !== 'object') {
    return;
  }

  const record = chunk as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== 'string') {
    return;
  }

  await markSDKFirstChunk(state, context);
  await addSDKChunkEvent(state, context, { type });

  if (type === 'content_block_delta') {
    const delta = record.delta;
    if (delta && typeof delta === 'object') {
      const deltaRecord = delta as Record<string, unknown>;
      if (deltaRecord.type === 'text_delta' && typeof deltaRecord.text === 'string') {
        setSDKOutput(state, `${typeof state.output === 'string' ? state.output : ''}${deltaRecord.text}`);
      }

      if (deltaRecord.type === 'input_json_delta' && typeof deltaRecord.partial_json === 'string') {
        const index = typeof record.index === 'number' ? record.index : 0;
        const current = state.toolCalls[index];
        upsertSDKToolCall(state, {
          id: current?.id,
          name: current?.name ?? 'unknown',
          input: `${typeof current?.input === 'string' ? current.input : ''}${deltaRecord.partial_json}`,
          status: current?.status ?? 'started',
        });
      }
    }
  }

  if (type === 'content_block_start') {
    const contentBlock = record.content_block;
    if (contentBlock && typeof contentBlock === 'object') {
      const block = contentBlock as Record<string, unknown>;
      if (block.type === 'tool_use') {
        await emitSDKToolStart(state, context, {
          id: typeof block.id === 'string' ? block.id : undefined,
          name: typeof block.name === 'string' ? block.name : 'unknown',
          input: block.input,
          status: 'started',
        });
      }
    }
  }

  if (type === 'message_delta') {
    recordSDKFinishReason(state, record.stop_reason);
    if (record.usage && typeof record.usage === 'object') {
      const usage = record.usage as Record<string, unknown>;
      recordSDKUsage(state, {
        outputTokens:
          typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
      });
    }
  }

  if (type === 'message_stop' && record.usage && typeof record.usage === 'object') {
    const usage = record.usage as Record<string, unknown>;
    recordSDKUsage(state, {
      inputTokens:
        typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
      outputTokens:
        typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
    });
  }
}
