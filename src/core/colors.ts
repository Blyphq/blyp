export function getMethodColor(method: string): string {
  const colors: Record<string, string> = {
    GET: '\x1b[32m',
    POST: '\x1b[36m',
    PUT: '\x1b[33m',
    PATCH: '\x1b[34m',
    DELETE: '\x1b[31m',
  };
  const reset = '\x1b[0m';
  return `${colors[method.toUpperCase()] || ''}${method}${reset}`;
}

export function getStatusColor(statusCode: number): string {
  const reset = '\x1b[0m';
  if (statusCode >= 500) return `\x1b[31m${statusCode}${reset}`;
  if (statusCode >= 400) return `\x1b[33m${statusCode}${reset}`;
  if (statusCode >= 300) return `\x1b[36m${statusCode}${reset}`;
  if (statusCode >= 200) return `\x1b[32m${statusCode}${reset}`;
  return `\x1b[37m${statusCode}${reset}`;
}

export function getArrowForMethod(method: string): string {
  const arrows: Record<string, string> = {
    GET: '→',
    POST: '↑',
    PUT: '⇑',
    PATCH: '↗',
    DELETE: '✕',
  };
  return arrows[method.toUpperCase()] || '•';
}

export function getResponseTimeColor(ms: number): string {
  const reset = '\x1b[0m';
  if (ms < 100) return `\x1b[32m${ms}ms${reset}`;
  if (ms < 300) return `\x1b[33m${ms}ms${reset}`;
  if (ms < 1000) return `\x1b[31m${ms}ms${reset}`;
  return `\x1b[41m\x1b[37m${ms}ms${reset}`;
}

export function getColoredLevel(level: string): string {
  const colors: Record<string, string> = {
    error: '\x1b[31m',
    critical: '\x1b[35m',
    warning: '\x1b[33m',
    info: '\x1b[34m',
    success: '\x1b[32m',
    debug: '\x1b[36m',
  };
  const reset = '\x1b[0m';
  return `${colors[level.toLowerCase()] || ''}${level.toUpperCase()}${reset}`;
}

export const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  underscore: '\x1b[4m',
  blink: '\x1b[5m',
  reverse: '\x1b[7m',
  hidden: '\x1b[8m',
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
};
