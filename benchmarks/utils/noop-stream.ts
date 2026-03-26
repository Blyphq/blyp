import { Writable } from 'stream';
import type { NoopDestinationStats } from '../types';

export class NoopWritableStream extends Writable {
  private writes = 0;
  private bytes = 0;

  _write(
    chunk: string | Uint8Array,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.writes += 1;
    this.bytes += Buffer.byteLength(chunk);
    callback();
  }

  stats(): NoopDestinationStats {
    return {
      writes: this.writes,
      bytes: this.bytes,
    };
  }
}
