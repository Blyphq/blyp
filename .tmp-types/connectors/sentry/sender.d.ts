import type { BlypConfig, ResolvedSentryConnectorConfig, SentryConnectorConfig } from '../../core/config';
import type { SentrySender, SentryTestHooks } from '../../types/connectors/sentry';
export declare function createSentrySender(config: BlypConfig | ResolvedSentryConnectorConfig | SentryConnectorConfig): SentrySender;
export declare function setSentryTestHooks(hooks: SentryTestHooks): void;
export declare function resetSentryTestHooks(): void;
