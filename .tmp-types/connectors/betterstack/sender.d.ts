import type { BetterStackConnectorConfig, BlypConfig, ResolvedBetterStackConnectorConfig } from '../../core/config';
import type { BetterStackSender, BetterStackTestHooks } from '../../types/connectors/betterstack';
export declare function createBetterStackSender(config: BlypConfig | ResolvedBetterStackConnectorConfig | BetterStackConnectorConfig): BetterStackSender;
export declare function setBetterStackTestHooks(hooks: BetterStackTestHooks): void;
export declare function resetBetterStackTestHooks(): void;
