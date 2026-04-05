import fs from 'fs';
import os from 'os';
import path from 'path';

export function makeTempDir(prefix: string = 'blyp-'): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const packageDir = path.join(tempDir, 'node_modules', '@blyp', 'core');

  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    JSON.stringify({
      name: '@blyp/core',
      main: './index.js',
      type: 'commonjs',
    }, null, 2)
  );
  fs.writeFileSync(
    path.join(packageDir, 'index.js'),
    'exports.defineConfig = (config) => config;\n'
  );

  return tempDir;
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
