import fs from 'fs';
import os from 'os';
import path from 'path';

export function makeTempDir(prefix: string = 'blyp-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function readJsonLines(filePath: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) {
    return [];
  }

  return content.split('\n').map((line) => JSON.parse(line));
}

export async function waitForFileFlush(duration: number = 10): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, duration));
}
