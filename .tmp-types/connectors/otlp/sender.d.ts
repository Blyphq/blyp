import type { BlypConfig, OTLPConnectorConfig, ResolvedOTLPConnectorConfig } from '../../core/config';
import type { LogRecord } from '../../core/file-logger';
import type { OTLPLogSource, OTLPNormalizedRecord, OTLPRegistry, OTLPTestHooks } from '../../types/connectors/otlp';
export declare function normalizeOTLPRecord(record: LogRecord, connector: ResolvedOTLPConnectorConfig, source?: OTLPLogSource): OTLPNormalizedRecord;
export declare function createOTLPRegistry(config: BlypConfig | ResolvedOTLPConnectorConfig[] | OTLPConnectorConfig[]): OTLPRegistry;
export declare function setOTLPTestHooks(hooks: OTLPTestHooks): void;
export declare function resetOTLPTestHooks(): void;
