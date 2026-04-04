import type { Plugin } from '@better-agent/core';
import type { Event } from '@better-agent/core/events';
import type { GenerativeModelResponse } from '@better-agent/core/providers';
import { blypPlugin, createBetterAgentTracker } from '../src/ai/better-agent';
import type { BlypAIProvider } from '../src/ai/shared/types';

const plugin: Plugin = blypPlugin();
const tracker = createBetterAgentTracker();

declare const event: Event;
declare const response: GenerativeModelResponse;

tracker.onEvent(event);
tracker.onAfterModelCall(response, { stepIndex: 0 });

const providerA: BlypAIProvider = 'openai';
const providerB: BlypAIProvider = 'better-agent';
const providerC: BlypAIProvider = 'custom-provider';

void plugin;
void providerA;
void providerB;
void providerC;

export {};
