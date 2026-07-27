import { randomUUID } from 'node:crypto';

import type { Clock, IdGenerator, Timer } from './ports.js';

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class CryptoIdGenerator implements IdGenerator {
  next(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }
}

export class SystemTimer implements Timer {
  schedule(fn: () => void, ms: number): () => void {
    const handle = setTimeout(fn, ms);
    // Never hold the process open just to fire a worker timeout.
    handle.unref?.();
    return () => clearTimeout(handle);
  }
}
