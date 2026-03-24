import type {
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider';
import type { LanguageModelMiddleware } from 'ai';
import {
  addTraceEvent,
  consumeStreamPart,
  createTraceState,
  finalizeTrace,
  recordGenerateResult,
  resolveBlypModelOptions,
  runHookSafely,
} from '../shared/trace';
import type { BlypModelOptions } from '../shared/types';

export function blypMiddleware(
  options: BlypModelOptions = {}
): LanguageModelMiddleware {
  const config = resolveBlypModelOptions(options);

  return {
    specificationVersion: 'v3',

    async wrapGenerate({
      doGenerate,
      model,
      params,
    }: {
      doGenerate: () => PromiseLike<LanguageModelV3GenerateResult>;
      doStream: () => PromiseLike<LanguageModelV3StreamResult>;
      params: LanguageModelV3CallOptions;
      model: import('@ai-sdk/provider').LanguageModelV3;
    }): Promise<LanguageModelV3GenerateResult> {
      const { state, context } = createTraceState({
        model,
        params,
        callType: 'generate',
        config,
      });

      await addTraceEvent(state, context, { type: 'ai.start' });
      await runHookSafely(config.hooks.onStart, [context]);

      try {
        const result = await doGenerate();
        recordGenerateResult(state, result);
        await finalizeTrace(state, context);
        return result;
      } catch (error) {
        await finalizeTrace(state, context, { error });
        throw error;
      }
    },

    async wrapStream({
      doStream,
      model,
      params,
    }: {
      doGenerate: () => PromiseLike<LanguageModelV3GenerateResult>;
      doStream: () => PromiseLike<LanguageModelV3StreamResult>;
      params: LanguageModelV3CallOptions;
      model: import('@ai-sdk/provider').LanguageModelV3;
    }): Promise<LanguageModelV3StreamResult> {
      const { state, context } = createTraceState({
        model,
        params,
        callType: 'stream',
        config,
      });

      await addTraceEvent(state, context, { type: 'ai.start' });
      await runHookSafely(config.hooks.onStart, [context]);

      try {
        const result = await doStream();
        const stream = result.stream.pipeThrough(
          new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
            async transform(part, controller) {
              await consumeStreamPart(state, context, part);
              controller.enqueue(part);
            },

            async flush() {
              await finalizeTrace(state, context);
            },
          })
        );

        return {
          ...result,
          stream,
        };
      } catch (error) {
        await finalizeTrace(state, context, { error });
        throw error;
      }
    },
  };
}
