import fs from 'fs';
import { gunzipSync } from 'zlib';
import type { LogRecord } from './file-logger';

export interface ReadLogFileOptions {
  format?: 'pretty' | 'json';
  limit?: number;
}

function createFallbackRecord(line: string): LogRecord {
  return {
    timestamp: '',
    level: 'unknown',
    message: line,
  };
}

function parseLogLine(line: string): LogRecord {
  try {
    return JSON.parse(line) as LogRecord;
  } catch {
    return createFallbackRecord(line);
  }
}

function readRawFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  if (filePath.endsWith('.gz')) {
    return gunzipSync(content).toString('utf8');
  }
  return content.toString('utf8');
}

export function formatLogRecord(record: LogRecord): string {
  const prefix = record.timestamp ? `[${record.timestamp}] ` : '';
  const level = record.level ? record.level.toUpperCase() : 'UNKNOWN';
  const caller = record.caller ? ` (${record.caller})` : '';
  return `${prefix}${level} ${record.message}${caller}`.trim();
}

export async function readLogFile(
  filePath: string,
  options: ReadLogFileOptions = {}
): Promise<string | LogRecord[]> {
  const { format = 'pretty', limit } = options;
  const rawContent = readRawFile(filePath);
  const allLines = rawContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lines = typeof limit === 'number' && limit >= 0 ? allLines.slice(-limit) : allLines;
  const records = lines.map(parseLogLine);

  if (format === 'json') {
    return records;
  }

  return records.map(formatLogRecord).join('\n');
}
