import fs from 'fs';
import type { RealIoValidationResult } from '../types';

type WriteFunction = (...args: any[]) => any;

function wrapCounter<T extends WriteFunction>(
  fn: T,
  increment: () => void
): T {
  return ((...args: unknown[]) => {
    increment();
    return fn(...args);
  }) as T;
}

export async function assertZeroRealIo(
  action: () => void | Promise<void>
): Promise<RealIoValidationResult> {
  const originalStdout = process.stdout.write.bind(process.stdout);
  const originalStderr = process.stderr.write.bind(process.stderr);
  const originalAppendFileSync = fs.appendFileSync;
  const originalWriteFileSync = fs.writeFileSync;
  const originalWriteSync = fs.writeSync;
  const originalCreateWriteStream = fs.createWriteStream;

  const result: RealIoValidationResult = {
    stdoutWrites: 0,
    stderrWrites: 0,
    fsWrites: 0,
  };

  process.stdout.write = wrapCounter(originalStdout, () => {
    result.stdoutWrites += 1;
  });
  process.stderr.write = wrapCounter(originalStderr, () => {
    result.stderrWrites += 1;
  });
  fs.appendFileSync = wrapCounter(originalAppendFileSync, () => {
    result.fsWrites += 1;
  });
  fs.writeFileSync = wrapCounter(originalWriteFileSync, () => {
    result.fsWrites += 1;
  });
  fs.writeSync = wrapCounter(originalWriteSync, () => {
    result.fsWrites += 1;
  });
  fs.createWriteStream = wrapCounter(originalCreateWriteStream, () => {
    result.fsWrites += 1;
  });

  try {
    await action();
  } finally {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
    fs.appendFileSync = originalAppendFileSync;
    fs.writeFileSync = originalWriteFileSync;
    fs.writeSync = originalWriteSync;
    fs.createWriteStream = originalCreateWriteStream;
  }

  if (result.stdoutWrites > 0 || result.stderrWrites > 0 || result.fsWrites > 0) {
    throw new Error(
      `Expected zero real I/O, saw stdout=${result.stdoutWrites}, stderr=${result.stderrWrites}, fs=${result.fsWrites}`
    );
  }

  return result;
}
