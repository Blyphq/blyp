import {
  addTraceEvent,
  createSDKTraceState,
  finalizeSDKTrace,
  recordSDKFinishReason,
  recordSDKUsage,
  resolveBlypProviderOptions,
  runHookSafely,
  setSDKInput,
  setSDKOutput,
  setSDKRawProviderPayload,
  setSDKResponse,
  upsertSDKToolCall,
} from '../shared/trace';
import { isAsyncIterable, wrapAsyncIterable } from '../shared/stream';
import { normalizeAnthropicResponse } from './normalize';
import { consumeAnthropicStreamChunk } from './stream';
import type { BlypProviderOptions } from '../shared/types';

type AnthropicMessagesCreateParams = {
  model?: string;
  messages?: unknown;
  stream?: boolean;
};

type WrappedAnthropicClient = {
  messages?: {
    create?: (params: AnthropicMessagesCreateParams, ...rest: unknown[]) => Promise<unknown>;
  };
};

function cloneWithWrappedMethod<TTarget extends object, TKey extends keyof TTarget>(
  target: TTarget,
  key: TKey,
  replacement: TTarget[TKey]
): TTarget {
  return Object.assign(Object.create(Object.getPrototypeOf(target)), target, {
    [key]: replacement,
  });
}

export function wrapAnthropic<TClient extends WrappedAnthropicClient>(
  client: TClient,
  options: BlypProviderOptions = {}
): TClient {
  const wrapped = Object.create(Object.getPrototypeOf(client)) as TClient;
  Object.assign(wrapped, client);

  if (!client.messages?.create) {
    return wrapped;
  }

  const create = async (params: AnthropicMessagesCreateParams, ...rest: unknown[]) => {
    const config = resolveBlypProviderOptions({
      ...options,
      provider: 'anthropic',
    });
    const { state, context } = createSDKTraceState({
      provider: 'anthropic',
      sdk: 'anthropic-sdk',
      operation: options.operation,
      method: 'messages.create',
      model: typeof params?.model === 'string' ? params.model : 'unknown',
      request: params,
      streamed: params?.stream === true,
      config,
    });

    setSDKInput(state, params?.messages ?? params);
    await addTraceEvent(state as never, context as never, { type: 'ai.start' });
    await runHookSafely(config.hooks.onStart, [context]);

    try {
      const result = await client.messages!.create!(params, ...rest);
      if (params?.stream === true && isAsyncIterable(result)) {
        return wrapAsyncIterable(result, {
          onChunk: async (chunk) => {
            await consumeAnthropicStreamChunk(state, context, chunk);
          },
          onReturn: async () => {
            await finalizeSDKTrace(state, context);
          },
          onError: async (error) => {
            await finalizeSDKTrace(state, context, { error });
          },
        }) as unknown;
      }

      const normalized = normalizeAnthropicResponse(result);
      setSDKResponse(state, result);
      setSDKRawProviderPayload(state, result);
      if (normalized.usage) {
        recordSDKUsage(state, normalized.usage);
      }
      if (normalized.finishReason) {
        recordSDKFinishReason(state, normalized.finishReason);
      }
      if (normalized.output !== undefined) {
        setSDKOutput(state, normalized.output);
      }
      for (const toolCall of normalized.toolCalls) {
        upsertSDKToolCall(state, toolCall);
      }

      await finalizeSDKTrace(state, context);
      return result;
    } catch (error) {
      await finalizeSDKTrace(state, context, { error });
      throw error;
    }
  };

  (wrapped as WrappedAnthropicClient).messages = cloneWithWrappedMethod(client.messages, 'create', create as never);
  return wrapped;
}
