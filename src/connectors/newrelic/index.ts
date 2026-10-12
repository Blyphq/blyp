import { createOtlpLogger, createStructuredOtlpLogger } from '../otlp';
import { NEW_RELIC_TARGET_NAME } from './config';
import type { BlypConnectorsConfig } from '../../types/core/config';

export type { NewRelicConnectorConfig } from '../../types/core/config';
export type { OTLPLogger as NewRelicLogger } from '../../types/connectors/otlp';

export interface NewRelicLoggerConfig {
  connectors?: BlypConnectorsConfig;
}

export function createNewRelicLogger(config: NewRelicLoggerConfig = {}) {
  return createOtlpLogger({ ...config, name: NEW_RELIC_TARGET_NAME });
}

export function createStructuredNewRelicLogger<
  TFields extends Record<string, unknown> = Record<string, unknown>,
>(groupId: string, initial?: TFields, config: NewRelicLoggerConfig = {}) {
  return createStructuredOtlpLogger(groupId, initial, {
    ...config,
    name: NEW_RELIC_TARGET_NAME,
  });
}
