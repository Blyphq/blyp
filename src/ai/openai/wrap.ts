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
import { normalizeOpenAIResponse } from './normalize';
import { consumeOpenAIStreamChunk } from './stream';
import type { BlypProviderOptions } from '../shared/types';

type OpenAIResponsesCreateParams = {
  model?: string;
  input?: unknown;
  stream?: boolean;
};

type OpenAIChatCreateParams = {
  model?: string;
  messages?: unknown;
  stream?: boolean;
};

type WrappedOpenAIClient = {
  responses?: {
    create?: (params: OpenAIResponsesCreateParams, ...rest: unknown[]) => Promise<unknown>;
  };
  chat?: {
    completions?: {
      create?: (params: OpenAIChatCreateParams, ...rest: unknown[]) => Promise<unknown>;
    };
  };
};

async function instrumentOpenAICall<TResult>(
  invoke: (params: Record<string, unknown>, ...rest: unknown[]) => Promise<TResult>,
  method: string,
  params: Record<string, unknown>,
  rest: unknown[],
  options: BlypProviderOptions
): Promise<TResult> {
  const config = resolveBlypProviderOptions({
    ...options,
    provider: options.provider ?? 'openai',
  });
  const { state, context } = createSDKTraceState({
    provider: (options.provider ?? 'openai') as 'openai' | 'openrouter',
    sdk: 'openai-sdk',
    operation: options.operation,
    method,
    model: typeof params.model === 'string' ? params.model : 'unknown',
    request: params,
    streamed: params.stream === true,
    config,
  });

  setSDKInput(state, method === 'chat.completions.create' ? params.messages : params.input ?? params);

  await addTraceEvent(state as never, context as never, { type: 'ai.start' });
  await runHookSafely(config.hooks.onStart, [context]);

  try {
    const result = await invoke(params, ...rest);
    if (params.stream === true && isAsyncIterable(result)) {
      const wrapped = wrapAsyncIterable(result, {
        onChunk: async (chunk) => {
          await consumeOpenAIStreamChunk(state, context, chunk);
        },
        onReturn: async () => {
          await finalizeSDKTrace(state, context);
        },
        onError: async (error) => {
          await finalizeSDKTrace(state, context, { error });
        },
      }) as TResult;

      return wrapped;
    }

    const normalized = normalizeOpenAIResponse(result, method);
    setSDKResponse(state, result);
    setSDKRawProviderPayload(state, result);

    if (normalized.metadata) {
      context.setMetadata(normalized.metadata);
    }
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
}

function cloneWithWrappedMethod<TTarget extends object, TKey extends keyof TTarget>(
  target: TTarget,
  key: TKey,
  replacement: TTarget[TKey]
): TTarget {
  return Object.assign(Object.create(Object.getPrototypeOf(target)), target, {
    [key]: replacement,
  });
}

export function wrapOpenAI<TClient extends WrappedOpenAIClient>(
  client: TClient,
  options: BlypProviderOptions = {}
): TClient {
  const wrapped = Object.create(Object.getPrototypeOf(client)) as TClient;
  Object.assign(wrapped, client);

  if (client.responses?.create) {
    const responsesTarget = client.responses as NonNullable<WrappedOpenAIClient['responses']>;
    const responses = cloneWithWrappedMethod(
      responsesTarget,
      'create',
      (async (params: OpenAIResponsesCreateParams, ...rest: unknown[]) => {
        return instrumentOpenAICall(
          responsesTarget.create!.bind(responsesTarget),
          'responses.create',
          (params ?? {}) as Record<string, unknown>,
          rest,
          options
        );
      }) as NonNullable<WrappedOpenAIClient['responses']>['create']
    );
    (wrapped as WrappedOpenAIClient).responses = responses;
  }

  if (client.chat?.completions?.create) {
    const chat = client.chat as NonNullable<WrappedOpenAIClient['chat']>;
    const completionsTarget = chat.completions as NonNullable<
      NonNullable<WrappedOpenAIClient['chat']>['completions']
    >;
    const completions = cloneWithWrappedMethod(
      completionsTarget,
      'create',
      (async (params: OpenAIChatCreateParams, ...rest: unknown[]) => {
        return instrumentOpenAICall(
          completionsTarget.create!.bind(completionsTarget),
          'chat.completions.create',
          (params ?? {}) as Record<string, unknown>,
          rest,
          options
        );
      }) as NonNullable<NonNullable<WrappedOpenAIClient['chat']>['completions']>['create']
    );

    (wrapped as WrappedOpenAIClient).chat = cloneWithWrappedMethod(chat, 'completions', completions);
  }

  return wrapped;
}

export function createOpenAITracker(options: BlypProviderOptions = {}): BlypProviderOptions {
  return {
    ...options,
    provider: options.provider ?? 'openai',
  };
}
