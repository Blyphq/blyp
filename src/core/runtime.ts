import type { RuntimeAdapter, RuntimeType } from '../types/frameworks/standalone';
import fs from 'fs';
import path from 'path';

class RuntimeDetector {
  private static instance: RuntimeDetector;
  private _type: RuntimeType | null = null;

  private constructor() {}

  static getInstance(): RuntimeDetector {
    if (!RuntimeDetector.instance) {
      RuntimeDetector.instance = new RuntimeDetector();
    }
    return RuntimeDetector.instance;
  }

  get type(): RuntimeType {
    if (this._type === null) {
      this._type = this.detectRuntime();
    }
    return this._type;
  }

  get isBun(): boolean {
    return this.type === 'bun';
  }

  get isNode(): boolean {
    return this.type === 'node';
  }

  private detectRuntime(): RuntimeType {
    if (typeof Bun !== 'undefined' && typeof Bun.file === 'function') {
      return 'bun';
    }
    return 'node';
  }
}

class BunAdapter implements RuntimeAdapter {
  readonly type = 'bun' as const;
  readonly isBun = true;
  readonly isNode = false;

  file = {
    existsSync: (filePath: string): boolean => {
      try {
        const file = Bun.file(filePath);
        return file.size > 0 || file.name !== '';
      } catch {
        return false;
      }
    },
    mkdirSync: (filePath: string, options?: { recursive?: boolean }): void => {
      try {
        fs.mkdirSync(filePath, options);
      } catch {}
    },
    writeFileSync: (filePath: string, data: string): void => {
      Bun.write(filePath, data);
    }
  };

  path = {
    join: (...paths: string[]): string => {
      return path.join(...paths);
    }
  };

  env = {
    get: (key: string): string | undefined => Bun.env[key]
  };

  cwd = (): string => {
    return process.cwd();
  };
}

class NodeAdapter implements RuntimeAdapter {
  readonly type = 'node' as const;
  readonly isBun = false;
  readonly isNode = true;

  file = {
    existsSync: (filePath: string): boolean => fs.existsSync(filePath),
    mkdirSync: (filePath: string, options?: { recursive?: boolean }): void => {
      fs.mkdirSync(filePath, options);
    },
    writeFileSync: (filePath: string, data: string): void => {
      fs.writeFileSync(filePath, data);
    }
  };

  path = {
    join: (...paths: string[]): string => path.join(...paths)
  };

  env = {
    get: (key: string): string | undefined => process.env[key]
  };

  cwd = (): string => process.cwd();
}

export function createRuntimeAdapter(): RuntimeAdapter {
  const detector = RuntimeDetector.getInstance();
  
  if (detector.isBun) {
    return new BunAdapter();
  }
  
  return new NodeAdapter();
}

export const runtime = createRuntimeAdapter();

export function createLogDir(customPath?: string): string {
  const logDir = customPath ?? runtime.path.join(runtime.cwd(), 'logs');
  
  if (!runtime.file.existsSync(logDir)) {
    runtime.file.mkdirSync(logDir, { recursive: true });
  }
  
  return logDir;
}
