import { createWarnOnceLogger } from '../../shared/once';
import type {
  BetterStackConnectorConfig,
  BlypUserConfig,
  DatabuddyConnectorConfig,
  HTTPConnectorConfig,
  OTLPConnectorConfig,
  PostHogConnectorConfig,
  SentryConnectorConfig,
} from '../../types/core/config';
import type {
  ConvexAxiomConfig,
  ConvexBetterStackConfig,
  ConvexDatabuddyConfig,
  ConvexHttpConfig,
  ConvexLoggerConfig,
  ConvexOtlpConfig,
  ConvexPostHogConfig,
  ConvexSentryConfig,
  ResolvedConvexOtlpConfig,
  ResolvedConvexOtlpTarget,
} from '../../types/frameworks/convex';

const warnedKeys = new Set<string>();
const warnOnce = createWarnOnceLogger(warnedKeys);

const LEVEL_RANK: Record<string, number> = {
  debug: 0,
  info: 1,
  success: 1,
  table: 1,
  warn: 2,
  warning: 2,
  error: 3,
  critical: 4,
};

export function getEnv(name: string): string | undefined {
  try {
    if (typeof process === 'undefined' || typeof process.env !== 'object' || !process.env) {
      return undefined;
    }

    const value = process.env[name];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function isAbsoluteHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isOtlpDisabled(otlp: ConvexLoggerConfig['otlp']): boolean {
  return typeof otlp === 'boolean' && !otlp;
}

function convexOtlpOptions(otlp: ConvexLoggerConfig['otlp']): ConvexOtlpConfig | undefined {
  if (otlp === undefined || typeof otlp === 'boolean') {
    return undefined;
  }

  return otlp;
}

function withLogsPath(endpoint: string): string {
  if (/\/v1\/logs\/?$/.test(endpoint)) {
    return endpoint;
  }

  return endpoint.endsWith('/') ? `${endpoint}v1/logs` : `${endpoint}/v1/logs`;
}

function isSharedBlypConfig(config: ConvexLoggerConfig): boolean {
  return config.connectors !== undefined
    || config.destination !== undefined
    || config.file !== undefined
    || config.database !== undefined
    || config.clientLogging !== undefined;
}

function otlpHeaders(otlp: ConvexOtlpConfig | undefined): Record<string, string> {
  const headers = {
    ...(otlp?.headers ?? {}),
  };

  if (headers.Authorization === undefined) {
    const auth = otlp?.auth ?? getEnv('BLYP_OTLP_AUTH');
    if (auth) {
      headers.Authorization = auth;
    }
  }

  return headers;
}

function connectorOtlpHeaders(target: OTLPConnectorConfig): Record<string, string> {
  const headers = {
    ...(target.headers ?? {}),
  };

  if (headers.Authorization === undefined && target.auth) {
    headers.Authorization = target.auth;
  }

  return headers;
}

function envOtlpEndpoint(): string | undefined {
  const configured = getEnv('BLYP_OTLP_ENDPOINT')
    ?? getEnv('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT');

  if (configured) {
    return configured;
  }

  const rootEndpoint = getEnv('OTEL_EXPORTER_OTLP_ENDPOINT');
  return rootEndpoint ? withLogsPath(rootEndpoint) : undefined;
}

function isAutoOtlpTarget(target: OTLPConnectorConfig): boolean {
  if (target.enabled === false || target.mode === 'manual') {
    return false;
  }

  return isAbsoluteHttpUrl(target.endpoint);
}

function uniqueTargets(targets: ResolvedConvexOtlpTarget[]): ResolvedConvexOtlpTarget[] {
  const seen = new Set<string>();
  const unique: ResolvedConvexOtlpTarget[] = [];

  for (const target of targets) {
    const key = `${target.endpoint}\0${JSON.stringify(target.headers)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(target);
  }

  return unique;
}

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';
const DEFAULT_AXIOM_ENDPOINT = 'https://api.axiom.co/v1/logs';
const DEFAULT_DATABUDDY_API_URL = 'https://basket.databuddy.cc';

function normalizeHost(host: string): string {
  return host.trim().replace(/\/+$/, '');
}

function withTrackPath(endpoint: string): string {
  if (/\/track\/?$/.test(endpoint)) {
    return endpoint.replace(/\/+$/, '');
  }

  return `${normalizeHost(endpoint)}/track`;
}

function isManualMode(value: object): boolean {
  return 'mode' in value && (value as { mode?: string }).mode === 'manual';
}

function vendorServiceName(vendor: object, fallback: string): string {
  return 'serviceName' in vendor
    && typeof vendor.serviceName === 'string'
    && vendor.serviceName.trim().length > 0
    ? vendor.serviceName
    : fallback;
}

function isVendorDisabled(value: { enabled?: boolean } | false | undefined): boolean {
  return value === false || (typeof value === 'object' && value.enabled === false);
}

function posthogLogsTarget(
  posthog: ConvexPostHogConfig | PostHogConnectorConfig | undefined,
  fallbackServiceName: string
): ResolvedConvexOtlpTarget | undefined {
  if (!posthog || posthog.enabled === false || isManualMode(posthog)) {
    return undefined;
  }

  const projectKey = posthog.projectKey ?? getEnv('POSTHOG_PROJECT_KEY');
  if (!projectKey) {
    return undefined;
  }

  const host = normalizeHost(
    posthog.host
      ?? getEnv('POSTHOG_HOST')
      ?? DEFAULT_POSTHOG_HOST
  );

  return {
    name: 'posthog',
    endpoint: `${host}/i/v1/logs`,
    headers: {
      Authorization: `Bearer ${projectKey}`,
    },
    serviceName: posthog.serviceName ?? fallbackServiceName,
  };
}

function axiomLogsTarget(
  axiom: ConvexAxiomConfig | undefined,
  fallbackServiceName: string
): ResolvedConvexOtlpTarget | undefined {
  if (!axiom || axiom.enabled === false) {
    return undefined;
  }

  const token = axiom.token ?? getEnv('AXIOM_TOKEN') ?? getEnv('AXIOM_API_TOKEN');
  const dataset = axiom.dataset ?? getEnv('AXIOM_DATASET');
  if (!token || !dataset) {
    return undefined;
  }

  const endpoint = withLogsPath(
    axiom.endpoint ?? getEnv('AXIOM_URL') ?? DEFAULT_AXIOM_ENDPOINT
  );
  if (!isAbsoluteHttpUrl(endpoint)) {
    return undefined;
  }

  return {
    name: 'axiom',
    endpoint,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Axiom-Dataset': dataset,
    },
    serviceName: axiom.serviceName ?? fallbackServiceName,
  };
}

function betterstackLogsTarget(
  betterstack: ConvexBetterStackConfig | BetterStackConnectorConfig | undefined,
  fallbackServiceName: string
): ResolvedConvexOtlpTarget | undefined {
  if (!betterstack || betterstack.enabled === false || isManualMode(betterstack)) {
    return undefined;
  }

  const sourceToken = betterstack.sourceToken
    ?? getEnv('SOURCE_TOKEN')
    ?? getEnv('BETTERSTACK_SOURCE_TOKEN');
  const ingestingHost = betterstack.ingestingHost
    ?? getEnv('INGESTING_HOST')
    ?? getEnv('BETTERSTACK_INGESTING_HOST');
  if (!sourceToken || !ingestingHost) {
    return undefined;
  }

  const endpoint = withLogsPath(normalizeHost(ingestingHost));
  if (!isAbsoluteHttpUrl(endpoint)) {
    return undefined;
  }

  return {
    name: 'betterstack',
    endpoint,
    headers: {
      Authorization: `Bearer ${sourceToken}`,
    },
    serviceName: betterstack.serviceName ?? fallbackServiceName,
  };
}

function sentryLogsTarget(
  sentry: ConvexSentryConfig | SentryConnectorConfig | undefined,
  fallbackServiceName: string
): ResolvedConvexOtlpTarget | undefined {
  if (!sentry || sentry.enabled === false || isManualMode(sentry)) {
    return undefined;
  }

  const dsn = sentry.dsn ?? getEnv('SENTRY_DSN');
  if (!dsn) {
    return undefined;
  }

  try {
    const url = new URL(dsn);
    const publicKey = decodeURIComponent(url.username);
    const projectId = url.pathname.split('/').filter(Boolean).pop();
    if (!publicKey || !projectId || !url.host) {
      return undefined;
    }

    return {
      name: 'sentry',
      endpoint: `${url.protocol}//${url.host}/api/${projectId}/integration/otlp/v1/logs`,
      headers: {
        'x-sentry-auth': `sentry sentry_key=${publicKey}`,
      },
      serviceName: vendorServiceName(sentry, fallbackServiceName),
    };
  } catch {
    return undefined;
  }
}

function databuddyLogsTarget(
  databuddy: ConvexDatabuddyConfig | DatabuddyConnectorConfig | undefined,
  fallbackServiceName: string
): ResolvedConvexOtlpTarget | undefined {
  if (!databuddy || databuddy.enabled === false || isManualMode(databuddy)) {
    return undefined;
  }

  const apiKey = databuddy.apiKey ?? getEnv('DATABUDDY_API_KEY');
  const websiteId = databuddy.websiteId ?? getEnv('DATABUDDY_WEBSITE_ID');
  if (!apiKey || !websiteId) {
    return undefined;
  }

  const endpoint = withTrackPath(
    databuddy.apiUrl ?? getEnv('DATABUDDY_API_URL') ?? DEFAULT_DATABUDDY_API_URL
  );
  if (!isAbsoluteHttpUrl(endpoint)) {
    return undefined;
  }

  return {
    name: 'databuddy',
    endpoint,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    serviceName: vendorServiceName(databuddy, fallbackServiceName),
    format: 'databuddy',
    websiteId,
    source: databuddy.source ?? 'convex',
    ...(databuddy.namespace ? { namespace: databuddy.namespace } : {}),
  };
}

function httpLogsTarget(
  target: ConvexHttpConfig | HTTPConnectorConfig | undefined,
  fallbackServiceName: string
): ResolvedConvexOtlpTarget | undefined {
  if (!target || target.enabled === false || isManualMode(target) || !target.name) {
    return undefined;
  }

  if (!isAbsoluteHttpUrl(target.endpoint)) {
    return undefined;
  }

  const headers = {
    ...(target.headers ?? {}),
  };
  if (headers.Authorization === undefined && target.auth) {
    headers.Authorization = target.auth;
  }

  return {
    name: target.name,
    endpoint: target.endpoint,
    headers,
    serviceName: target.serviceName ?? fallbackServiceName,
    format: 'http',
  };
}

function addMappedVendor<T extends { enabled?: boolean }>(
  targets: ResolvedConvexOtlpTarget[],
  options: T | false | undefined,
  shared: T | undefined,
  build: (value: T | undefined) => ResolvedConvexOtlpTarget | undefined,
  warnKey: string,
  warnMessage: string
): void {
  if (isVendorDisabled(options)) {
    return;
  }

  const fromOptions = typeof options === 'object' ? build(options) : undefined;
  if (fromOptions) {
    targets.push(fromOptions);
  }

  const fromShared = build(shared);
  if (fromShared) {
    targets.push(fromShared);
  }

  if (typeof options === 'object' && !fromOptions && !fromShared) {
    warnOnce(warnKey, warnMessage);
  }
}

function warnIgnoredSinks(config: ConvexLoggerConfig): void {
  const fileEnabled = config.destination === 'file'
    || config.file?.enabled === true
    || (config.file !== undefined && config.file.enabled !== false && config.destination !== 'database');

  if (fileEnabled) {
    warnOnce(
      'convex:file',
      '[Blyp] Convex ignores file logging. Action and HTTP-action logs only export over HTTP.'
    );
  }

  if (config.destination === 'database' || config.database !== undefined) {
    warnOnce(
      'convex:database',
      '[Blyp] Convex ignores database logging. Action and HTTP-action logs only export over HTTP.'
    );
  }

  if (config.clientLogging !== undefined && config.clientLogging.enabled !== false) {
    warnOnce(
      'convex:clientLogging',
      '[Blyp] Convex ignores client log ingestion. Mount that on your HTTP API instead.'
    );
  }

  if (config.connectors?.delivery?.enabled) {
    warnOnce(
      'convex:delivery',
      '[Blyp] Convex ignores connector delivery queues. Failed exports warn once and are dropped.'
    );
  }

  const connectors = config.connectors;
  if (!connectors) {
    return;
  }

  if (connectors.posthog && connectors.posthog.enabled !== false && config.posthog !== false) {
    if (!posthogLogsTarget(connectors.posthog, 'convex')) {
      warnOnce(
        'convex:posthog',
        '[Blyp] Convex could not export connectors.posthog. Set projectKey or POSTHOG_PROJECT_KEY.'
      );
    } else if (connectors.posthog.errorTracking?.enabled) {
      warnOnce(
        'convex:posthog-errors',
        '[Blyp] Convex exports PostHog logs over OTLP. Exception autocapture from connectors.posthog.errorTracking is ignored.'
      );
    }
  }

  if (connectors.betterstack && connectors.betterstack.enabled !== false && config.betterstack !== false) {
    if (!betterstackLogsTarget(connectors.betterstack, 'convex')) {
      warnOnce(
        'convex:betterstack',
        '[Blyp] Convex could not export connectors.betterstack. Set sourceToken and ingestingHost.'
      );
    } else if (connectors.betterstack.errorTracking?.enabled) {
      warnOnce(
        'convex:betterstack-errors',
        '[Blyp] Convex exports Better Stack logs over OTLP. Error tracking from connectors.betterstack.errorTracking is ignored.'
      );
    }
  }

  if (connectors.sentry && connectors.sentry.enabled !== false && config.sentry !== false) {
    if (!sentryLogsTarget(connectors.sentry, 'convex')) {
      warnOnce(
        'convex:sentry',
        '[Blyp] Convex could not export connectors.sentry. Set dsn or SENTRY_DSN.'
      );
    }
  }

  if (connectors.databuddy && connectors.databuddy.enabled !== false && config.databuddy !== false) {
    if (!databuddyLogsTarget(connectors.databuddy, 'convex')) {
      warnOnce(
        'convex:databuddy',
        '[Blyp] Convex could not export connectors.databuddy. Set apiKey and websiteId.'
      );
    }
  }

  if (config.http !== false) {
    const httpTargets = [
      ...(Array.isArray(config.http) ? config.http : []),
      ...(connectors.http ?? []),
    ];
    const usable = httpTargets.some((target) => httpLogsTarget(target, 'convex'));
    const attempted = httpTargets.some((target) => target.enabled !== false && !isManualMode(target));
    if (attempted && !usable) {
      warnOnce(
        'convex:http',
        '[Blyp] Convex could not export HTTP targets. Set name and an absolute endpoint.'
      );
    }
  }
}

export function resolveServiceName(
  config: ConvexLoggerConfig,
  targets: ResolvedConvexOtlpTarget[]
): string {
  const otlpName = convexOtlpOptions(config.otlp)?.serviceName;

  return config.serviceName
    ?? otlpName
    ?? targets[0]?.serviceName
    ?? getEnv('BLYP_SERVICE_NAME')
    ?? 'convex';
}

export function resolveConvexOtlpTargets(config: ConvexLoggerConfig): ResolvedConvexOtlpTarget[] {
  if (isOtlpDisabled(config.otlp)) {
    return [];
  }

  const targets: ResolvedConvexOtlpTarget[] = [];
  const explicit = convexOtlpOptions(config.otlp);
  const fallbackServiceName = config.serviceName
    ?? explicit?.serviceName
    ?? getEnv('BLYP_SERVICE_NAME')
    ?? 'convex';

  if (explicit && isAbsoluteHttpUrl(explicit.endpoint)) {
    targets.push({
      endpoint: explicit.endpoint,
      headers: otlpHeaders(explicit),
      serviceName: explicit.serviceName ?? fallbackServiceName,
    });
  }

  for (const target of config.connectors?.otlp ?? []) {
    if (!isAutoOtlpTarget(target) || !target.endpoint) {
      continue;
    }

    targets.push({
      name: target.name,
      endpoint: target.endpoint,
      headers: connectorOtlpHeaders(target),
      serviceName: target.serviceName ?? fallbackServiceName,
    });
  }

  addMappedVendor(
    targets,
    config.posthog,
    config.connectors?.posthog,
    (value) => posthogLogsTarget(value, fallbackServiceName),
    'convex:posthog-options',
    '[Blyp] Convex could not export posthog. Set projectKey or POSTHOG_PROJECT_KEY.'
  );

  if (!isVendorDisabled(config.axiom) && typeof config.axiom === 'object') {
    const fromAxiom = axiomLogsTarget(config.axiom, fallbackServiceName);
    if (fromAxiom) {
      targets.push(fromAxiom);
    } else {
      warnOnce(
        'convex:axiom',
        '[Blyp] Convex could not export axiom. Set token and dataset, or AXIOM_TOKEN and AXIOM_DATASET.'
      );
    }
  }

  addMappedVendor(
    targets,
    config.betterstack,
    config.connectors?.betterstack,
    (value) => betterstackLogsTarget(value, fallbackServiceName),
    'convex:betterstack-options',
    '[Blyp] Convex could not export betterstack. Set sourceToken and ingestingHost.'
  );

  addMappedVendor(
    targets,
    config.sentry,
    config.connectors?.sentry,
    (value) => sentryLogsTarget(value, fallbackServiceName),
    'convex:sentry-options',
    '[Blyp] Convex could not export sentry. Set dsn or SENTRY_DSN.'
  );

  addMappedVendor(
    targets,
    config.databuddy,
    config.connectors?.databuddy,
    (value) => databuddyLogsTarget(value, fallbackServiceName),
    'convex:databuddy-options',
    '[Blyp] Convex could not export databuddy. Set apiKey and websiteId.'
  );

  if (config.http !== false) {
    const httpTargets = [
      ...(Array.isArray(config.http) ? config.http : []),
      ...(config.connectors?.http ?? []),
    ];
    for (const target of httpTargets) {
      const resolved = httpLogsTarget(target, fallbackServiceName);
      if (resolved) {
        targets.push(resolved);
      }
    }

    if (Array.isArray(config.http) && config.http.length > 0
      && !config.http.some((target) => httpLogsTarget(target, fallbackServiceName))
      && !(config.connectors?.http ?? []).some((target) => httpLogsTarget(target, fallbackServiceName))) {
      warnOnce(
        'convex:http-options',
        '[Blyp] Convex could not export http. Set name and an absolute endpoint.'
      );
    }
  }

  if (targets.length === 0) {
    const envEndpoint = envOtlpEndpoint();
    if (isAbsoluteHttpUrl(envEndpoint)) {
      targets.push({
        endpoint: envEndpoint,
        headers: otlpHeaders(explicit),
        serviceName: fallbackServiceName,
      });
    }
  }

  return uniqueTargets(targets);
}

export function resolveConvexOtlpConfig(config: ConvexLoggerConfig): ResolvedConvexOtlpConfig {
  const targets = resolveConvexOtlpTargets(config);
  const serviceName = resolveServiceName(config, targets);
  const first = targets[0];

  return {
    enabled: targets.length > 0,
    endpoint: first?.endpoint,
    headers: first?.headers ?? {},
    serviceName,
    targets,
  };
}

export function shouldEmitConvexLevel(level: string, minLevel: string | undefined): boolean {
  if (!minLevel) {
    return true;
  }

  const minRank = LEVEL_RANK[minLevel] ?? LEVEL_RANK.info ?? 1;
  const rank = LEVEL_RANK[level] ?? LEVEL_RANK.info ?? 1;
  return rank >= minRank;
}

export function applyConvexBlypConfig(config: ConvexLoggerConfig = {}): {
  otlp: ResolvedConvexOtlpConfig;
  redact: BlypUserConfig['redact'];
} {
  warnIgnoredSinks(config);

  const otlp = resolveConvexOtlpConfig(config);

  if (isSharedBlypConfig(config) && !otlp.enabled) {
    warnOnce(
      'convex:no-otlp',
      '[Blyp] Convex has no remote sink configured. Queries, mutations, actions, and HTTP actions will write console only.'
    );
  }

  return {
    otlp,
    redact: config.redact,
  };
}

export function resetConvexConfigWarningsForTests(): void {
  warnedKeys.clear();
}
