import os from 'node:os';
import path from 'node:path';

export function getDefaultConnectorQueuePath(): string {
  return path.join(os.homedir(), '.blyp', 'queue.db');
}
