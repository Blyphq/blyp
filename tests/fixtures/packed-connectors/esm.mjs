import * as standalone from '@blyp/core/standalone';
import * as posthog from '@blyp/core/posthog';
import * as sentry from '@blyp/core/sentry';
import * as Sentry from '@sentry/node';
import run from './collector.cjs';
await run({ standalone, posthog, sentry, Sentry, mode: 'esm' });
