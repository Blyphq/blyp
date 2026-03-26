import fs from 'fs';
import os from 'os';
import path from 'path';

export function makeBenchmarkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeBenchmarkTempDir(tempDir: string): void {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
