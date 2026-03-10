import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { DEFAULT_CLIENT_LOG_ENDPOINT } from '../shared/client-log';

export interface LogRotationConfig {
  enabled?: boolean;
  maxSizeBytes?: number;
  maxArchives?: number;
  compress?: boolean;
}

export interface LogFileConfig {
  enabled?: boolean;
  dir?: string;
  archiveDir?: string;
  format?: 'ndjson';
  rotation?: LogRotationConfig;
}

export interface ClientLoggingConfig {
  enabled?: boolean;
  path?: string;
}

export interface BlypConfig {
  pretty: boolean;
  level: string;
  logDir?: string;
  file?: LogFileConfig;
  clientLogging?: ClientLoggingConfig;
}

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
};

let cachedConfig: BlypConfig | null = null;
const PACKAGE_NAME = 'blyp-js';
const CONFIG_FILE_NAME = 'blyp.config.json';
const GITIGNORE_FILE_NAME = '.gitignore';

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

function findConfigFile(): string | null {
  const cwd = process.cwd();
  const configPath = resolve(cwd, CONFIG_FILE_NAME);
  
  if (existsSync(configPath)) {
    return configPath;
  }
  
  return null;
}

function parseConfigFile(configPath: string): Partial<BlypConfig> {
  try {
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('[Blyp] Warning: Failed to parse blyp.config.json:', error);
    return {};
  }
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

export function mergeBlypConfig(
  base: BlypConfig,
  override: Partial<BlypConfig> = {}
): BlypConfig {
  return {
    ...base,
    ...override,
    file: mergeFileConfig(base.file, override.file),
    clientLogging: mergeClientLoggingConfig(base.clientLogging, override.clientLogging),
  };
}

export function loadConfig(): BlypConfig {
  if (cachedConfig !== null) {
    return cachedConfig;
  }

  bootstrapProjectFiles();
  const configPath = findConfigFile();
  
  if (configPath) {
    const userConfig = parseConfigFile(configPath);
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
}
