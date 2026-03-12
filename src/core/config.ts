import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { createJiti } from 'jiti';
import { dirname, resolve } from 'path';
import { DEFAULT_CLIENT_LOG_ENDPOINT } from '../shared/client-log';
import { createWarnOnceLogger } from '../shared/once';
import { hasNonEmptyString, isAbsoluteHttpUrl } from '../shared/validation';
import type {
  BlypConfig,
  BlypConnectorsConfig,
  ClientLoggingConfig,
  ConfigFileMatch,
  LogFileConfig,
  LogRotationConfig,
  OTLPConnectorConfig,
  PostHogConnectorConfig,
  ResolvedOTLPConnectorConfig,
  ResolvedPostHogConnectorConfig,
  ResolvedSentryConnectorConfig,
  SentryConnectorConfig
} from '../types/core/config';

export type { ConnectorMode } from '../types/connectors/mode';
export type {
  BlypConfig,
  BlypConnectorsConfig,
  ClientLoggingConfig,
  LogFileConfig,
  LogRotationConfig,
  OTLPConnectorConfig,
  PostHogConnectorConfig,
  PostHogErrorTrackingConfig,
  ResolvedOTLPConnectorConfig,
  ResolvedPostHogConnectorConfig,
  ResolvedPostHogErrorTrackingConfig,
  ResolvedSentryConnectorConfig,
  SentryConnectorConfig
} from '../types/core/config';

const PACKAGE_NAME = 'blyp-js';
const GITIGNORE_FILE_NAME = '.gitignore';
const CONFIG_FILE_NAMES = [
  'blyp.config.ts',
  'blyp.config.mts',
  'blyp.config.cts',
  'blyp.config.js',
  'blyp.config.mjs',
  'blyp.config.cjs',
  'blyp.config.json',
] as const;
const CONFIG_FILE_NAME = 'blyp.config.json';
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';
const DEFAULT_CONNECTOR_SERVICE_NAME = 'blyp-app';
const DEFAULT_POSTHOG_SERVICE_NAME = DEFAULT_CONNECTOR_SERVICE_NAME;
const warnedKeys = new Set<string>();
const warnOnce = createWarnOnceLogger(warnedKeys);

export const DEFAULT_ROTATION_CONFIG: Required<LogRotationConfig> = {
  enabled: true,
  maxSizeBytes: 10 * 1024 * 1024,
  maxArchives: 5,
  compress: true,
};

export const DEFAULT_FILE_CONFIG: Required<LogFileConfig> = {
  enabled: true,
  dir: '',
  archiveDir: '',
  format: 'ndjson',
  rotation: DEFAULT_ROTATION_CONFIG,
};

export const DEFAULT_CLIENT_LOGGING_CONFIG: Required<ClientLoggingConfig> = {
  enabled: true,
  path: DEFAULT_CLIENT_LOG_ENDPOINT,
};

export const DEFAULT_CONFIG: BlypConfig = {
  pretty: true,
  level: 'info',
  file: DEFAULT_FILE_CONFIG,
  clientLogging: DEFAULT_CLIENT_LOGGING_CONFIG,
  connectors: {},
};

let cachedConfig: BlypConfig | null = null;

function findNearestPackageName(startDir: string): string | undefined {
  let currentDir = startDir;

  while (true) {
    const packageJsonPath = resolve(currentDir, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
          name?: unknown;
        };
        if (hasNonEmptyString(packageJson.name)) {
          return packageJson.name;
        }
      } catch {}
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }

    currentDir = parentDir;
  }
}

function resolveDefaultConnectorServiceName(cwd: string = process.cwd()): string {
  return findNearestPackageName(cwd) ?? DEFAULT_POSTHOG_SERVICE_NAME;
}

function getBootstrapConfig(): BlypConfig {
  return {
    pretty: true,
    level: 'info',
    file: {
      enabled: true,
      format: 'ndjson',
      rotation: {
        enabled: true,
        maxSizeBytes: 10 * 1024 * 1024,
        maxArchives: 5,
        compress: true,
      },
    },
    clientLogging: {
      enabled: true,
      path: DEFAULT_CLIENT_LOG_ENDPOINT,
    },
    connectors: {},
  };
}

function shouldBootstrapProjectFiles(cwd: string): boolean {
  const packageJsonPath = resolve(cwd, 'package.json');

  if (!existsSync(packageJsonPath)) {
    return true;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { name?: string };
    return packageJson.name !== PACKAGE_NAME;
  } catch {
    return true;
  }
}

function ensureConfigFile(cwd: string): void {
  if (CONFIG_FILE_NAMES.some((fileName) => existsSync(resolve(cwd, fileName)))) {
    return;
  }

  const configPath = resolve(cwd, CONFIG_FILE_NAME);

  if (existsSync(configPath)) {
    return;
  }

  try {
    writeFileSync(configPath, `${JSON.stringify(getBootstrapConfig(), null, 2)}\n`);
  } catch (error) {
    console.error('[Blyp] Warning: Failed to create blyp.config.json:', error);
  }
}

function ensureLogsIgnored(cwd: string): void {
  const gitignorePath = resolve(cwd, GITIGNORE_FILE_NAME);

  if (!existsSync(gitignorePath)) {
    try {
      writeFileSync(gitignorePath, 'logs\n');
    } catch (error) {
      console.error('[Blyp] Warning: Failed to create .gitignore:', error);
    }
    return;
  }

  try {
    const currentContent = readFileSync(gitignorePath, 'utf-8');
    if (/^(?:\/?logs\/?)\s*$/m.test(currentContent)) {
      return;
    }

    const separator = currentContent.endsWith('\n') ? '' : '\n';
    appendFileSync(gitignorePath, `${separator}logs\n`);
  } catch (error) {
    console.error('[Blyp] Warning: Failed to update .gitignore:', error);
  }
}

function bootstrapProjectFiles(): void {
  const cwd = process.cwd();

  if (!shouldBootstrapProjectFiles(cwd)) {
    return;
  }

  ensureConfigFile(cwd);
  ensureLogsIgnored(cwd);
}

function findConfigFile(): ConfigFileMatch | null {
  const cwd = process.cwd();
  const matches = CONFIG_FILE_NAMES
    .map((fileName) => resolve(cwd, fileName))
    .filter((filePath) => existsSync(filePath));

  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    const preferred = matches[0]!;
    warnOnce(
      `config-multiple:${preferred}`,
      `[Blyp] Warning: Multiple config files found. Using ${preferred} and ignoring ${matches.slice(1).join(', ')}.`
    );
  }

  const selectedPath = matches[0]!;
  return {
    path: selectedPath,
    type: selectedPath.endsWith('.json') ? 'json' : 'jiti',
  };
}

function normalizeLoadedConfig(
  value: unknown,
  configPath: string
): Partial<BlypConfig> {
  const normalized = (
    value &&
    typeof value === 'object' &&
    'default' in value &&
    (value as { default?: unknown }).default !== undefined
  )
    ? (value as { default: unknown }).default
    : value;

  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    warnOnce(
      `config-invalid:${configPath}`,
      `[Blyp] Warning: Config file ${configPath} did not export an object. Falling back to defaults.`
    );
    return {};
  }

  return normalized as Partial<BlypConfig>;
}

function parseJsonConfigFile(configPath: string): Partial<BlypConfig> {
  try {
    const content = readFileSync(configPath, 'utf-8');
    return normalizeLoadedConfig(JSON.parse(content), configPath);
  } catch (error) {
    console.error('[Blyp] Warning: Failed to parse blyp.config.json:', error);
    return {};
  }
}

function parseExecutableConfigFile(configPath: string): Partial<BlypConfig> {
  try {
    const jiti = createJiti(process.cwd(), {
      interopDefault: true,
      moduleCache: false,
      fsCache: false,
    });
    return normalizeLoadedConfig(jiti(configPath), configPath);
  } catch (error) {
    console.error(`[Blyp] Warning: Failed to load ${configPath}:`, error);
    return {};
  }
}

function parseConfigFile(config: ConfigFileMatch): Partial<BlypConfig> {
  return config.type === 'json'
    ? parseJsonConfigFile(config.path)
    : parseExecutableConfigFile(config.path);
}

function mergeRotationConfig(
  base: LogRotationConfig | undefined,
  override: LogRotationConfig | undefined
): Required<LogRotationConfig> {
  return {
    ...DEFAULT_ROTATION_CONFIG,
    ...base,
    ...override,
  };
}

function mergeFileConfig(
  base: LogFileConfig | undefined,
  override: LogFileConfig | undefined
): Required<LogFileConfig> {
  return {
    ...DEFAULT_FILE_CONFIG,
    ...base,
    ...override,
    rotation: mergeRotationConfig(base?.rotation, override?.rotation),
  };
}

function mergeClientLoggingConfig(
  base: ClientLoggingConfig | undefined,
  override: ClientLoggingConfig | undefined
): Required<ClientLoggingConfig> {
  return {
    ...DEFAULT_CLIENT_LOGGING_CONFIG,
    ...base,
    ...override,
    path: override?.path ?? base?.path ?? DEFAULT_CLIENT_LOGGING_CONFIG.path,
  };
}

function mergePostHogConnectorConfig(
  base: PostHogConnectorConfig | undefined,
  override: PostHogConnectorConfig | undefined
): ResolvedPostHogConnectorConfig {
  const enabled = override?.enabled ?? base?.enabled ?? false;
  const projectKey = override?.projectKey ?? base?.projectKey;
  const baseErrorTracking = base?.enabled === true ? base?.errorTracking : undefined;
  const errorTrackingMode =
    override?.errorTracking?.mode ??
    baseErrorTracking?.mode ??
    'auto';
  const errorTrackingEnabled =
    override?.errorTracking?.enabled ??
    baseErrorTracking?.enabled ??
    enabled;
  const errorTrackingReady =
    enabled &&
    errorTrackingEnabled &&
    typeof projectKey === 'string' &&
    projectKey.trim().length > 0;

  return {
    enabled,
    mode: override?.mode ?? base?.mode ?? 'auto',
    projectKey,
    host: override?.host ?? base?.host ?? DEFAULT_POSTHOG_HOST,
    serviceName:
      override?.serviceName ??
      base?.serviceName ??
      resolveDefaultConnectorServiceName(),
    errorTracking: {
      enabled: errorTrackingEnabled,
      mode: errorTrackingMode,
      enableExceptionAutocapture:
        override?.errorTracking?.enableExceptionAutocapture ??
        baseErrorTracking?.enableExceptionAutocapture ??
        (errorTrackingMode === 'auto'),
      ready: errorTrackingReady,
      status: errorTrackingReady ? 'enabled' : 'missing',
    },
  };
}

function mergeSentryConnectorConfig(
  base: SentryConnectorConfig | undefined,
  override: SentryConnectorConfig | undefined
): ResolvedSentryConnectorConfig {
  const dsn = override?.dsn ?? base?.dsn;
  const enabled = override?.enabled ?? base?.enabled ?? false;
  const ready = enabled && typeof dsn === 'string' && dsn.trim().length > 0;

  return {
    enabled,
    mode: override?.mode ?? base?.mode ?? 'auto',
    dsn,
    environment: override?.environment ?? base?.environment,
    release: override?.release ?? base?.release,
    ready,
    status: ready ? 'enabled' : 'missing',
  };
}

function mergeOTLPConnectorConfig(
  base: OTLPConnectorConfig | undefined,
  override: OTLPConnectorConfig | undefined
): ResolvedOTLPConnectorConfig {
  const endpoint = override?.endpoint ?? base?.endpoint;
  const enabled = override?.enabled ?? base?.enabled ?? false;
  const resolvedHeaders = {
    ...(base?.headers ?? {}),
    ...(override?.headers ?? {}),
  };
  const ready = enabled && isAbsoluteHttpUrl(endpoint);

  return {
    name: override?.name ?? base?.name ?? '',
    enabled,
    mode: override?.mode ?? base?.mode ?? 'auto',
    endpoint,
    headers: resolvedHeaders,
    auth: override?.auth ?? base?.auth,
    serviceName:
      override?.serviceName ??
      base?.serviceName ??
      resolveDefaultConnectorServiceName(),
    ready,
    status: ready ? 'enabled' : 'missing',
  };
}

function mergeOTLPConnectorsConfig(
  base: OTLPConnectorConfig[] | undefined,
  override: OTLPConnectorConfig[] | undefined
): ResolvedOTLPConnectorConfig[] {
  const source = override ?? base ?? [];
  const deduped = new Map<string, ResolvedOTLPConnectorConfig>();

  for (const connector of source) {
    if (!connector || typeof connector.name !== 'string' || connector.name.length === 0) {
      continue;
    }

    if (deduped.has(connector.name)) {
      warnOnce(
        `otlp-duplicate:${connector.name}`,
        `[Blyp] Warning: Duplicate OTLP connector name "${connector.name}" found. Using the last definition.`
      );
    }

    deduped.set(connector.name, mergeOTLPConnectorConfig(undefined, connector));
  }

  return Array.from(deduped.values());
}

function mergeConnectorsConfig(
  base: BlypConnectorsConfig | undefined,
  override: BlypConnectorsConfig | undefined
): Required<BlypConnectorsConfig> {
  return {
    posthog: mergePostHogConnectorConfig(base?.posthog, override?.posthog),
    sentry: mergeSentryConnectorConfig(base?.sentry, override?.sentry),
    otlp: mergeOTLPConnectorsConfig(base?.otlp, override?.otlp),
  };
}

export function mergeBlypConfig(
  base: BlypConfig,
  override: Partial<BlypConfig> = {}
): BlypConfig {
  return {
    ...base,
    ...override,
    file: mergeFileConfig(base.file, override.file),
    clientLogging: mergeClientLoggingConfig(base.clientLogging, override.clientLogging),
    connectors: mergeConnectorsConfig(base.connectors, override.connectors),
  };
}

export function loadConfig(): BlypConfig {
  if (cachedConfig !== null) {
    return cachedConfig;
  }

  bootstrapProjectFiles();
  const configFile = findConfigFile();

  if (configFile) {
    const userConfig = parseConfigFile(configFile);
    cachedConfig = mergeBlypConfig(DEFAULT_CONFIG, userConfig);
  } else {
    cachedConfig = mergeBlypConfig(DEFAULT_CONFIG);
  }

  return cachedConfig;
}

export function resolveConfig(overrides: Partial<BlypConfig> = {}): BlypConfig {
  return mergeBlypConfig(loadConfig(), overrides);
}

export function getConfig(): BlypConfig {
  return loadConfig();
}

export function resetConfigCache(): void {
  cachedConfig = null;
  warnedKeys.clear();
}
