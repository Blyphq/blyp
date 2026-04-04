import { definePlugin } from '@better-agent/core';
import type { Plugin } from '@better-agent/core';
import { createBetterAgentTracker } from './tracker';
import { isBetterAgentTerminalEvent } from './normalize';
import type { BlypBetterAgentOptions } from './tracker';

export function blypPlugin(options: BlypBetterAgentOptions = {}): Plugin {
  const trackers = new Map<string, ReturnType<typeof createBetterAgentTracker>>();

  return definePlugin({
    id: 'blyp-better-agent',

    onEvent: async (event, ctx) => {
      let tracker = trackers.get(ctx.runId);

      if (!tracker && event.type === 'RUN_STARTED') {
        tracker = createBetterAgentTracker(options);
        trackers.set(ctx.runId, tracker);
      }

      if (!tracker) {
        return;
      }

      await tracker.onEvent(event);

      if (isBetterAgentTerminalEvent(event)) {
        trackers.delete(ctx.runId);
      }
    },

    onAfterModelCall: async (ctx) => {
      const tracker = trackers.get(ctx.runId);
      if (!tracker) {
        return;
      }

      await tracker.onAfterModelCall(ctx.response, {
        stepIndex: ctx.stepIndex,
      });
    },
  });
}
