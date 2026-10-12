import type {
  NewRelicConnectorConfig,
  ResolvedNewRelicConnectorConfig,
} from '../../types/core/config';

export const NEW_RELIC_TARGET_NAME = 'newrelic';

/** Isolate-safe so shared configuration also works in Convex. */
export function resolveNewRelicConnector(
  config: NewRelicConnectorConfig,
  defaultServiceName: string
): ResolvedNewRelicConnectorConfig {
  const region = config.region ?? 'us';
  const endpoint = config.endpoint ?? (region === 'eu'
    ? 'https://otlp.eu01.nr-data.net/v1/logs'
    : 'https://otlp.nr-data.net/v1/logs');
  const enabled = config.enabled ?? false;
  const licenseKey = typeof config.licenseKey === 'string' ? config.licenseKey.trim() : undefined;
  let validEndpoint = false;
  try {
    const url = new URL(endpoint);
    validEndpoint = url.protocol === 'https:' || url.protocol === 'http:';
  } catch {}
  const ready = enabled && Boolean(licenseKey) && validEndpoint;

  return {
    name: NEW_RELIC_TARGET_NAME,
    enabled,
    mode: config.mode ?? 'auto',
    licenseKey,
    region,
    endpoint,
    headers: licenseKey ? { 'api-key': licenseKey } : {},
    serviceName: config.serviceName ?? defaultServiceName,
    ready,
    status: ready ? 'enabled' : 'missing',
  };
}
