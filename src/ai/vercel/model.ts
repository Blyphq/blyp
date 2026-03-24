import { wrapLanguageModel } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { blypMiddleware } from './middleware';
import type { BlypModelOptions } from '../shared/types';

export function blypModel<TModel extends LanguageModelV3>(
  model: TModel,
  options: BlypModelOptions = {}
): LanguageModelV3 {
  return wrapLanguageModel({
    model,
    middleware: blypMiddleware(options),
  });
}
