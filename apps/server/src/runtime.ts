import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { CryptoIdGenerator, IntentSmithCore, SystemClock } from '@intentsmith/core';
import { openIntentSmithDatabase } from '@intentsmith/persistence';
import { FakeWorker } from '@intentsmith/testing';

import type { ServerRuntime } from './app.js';

export function createRuntime(dbPath = defaultDbPath()): ServerRuntime {
  const store = openIntentSmithDatabase(dbPath);
  const core = new IntentSmithCore({
    clock: new SystemClock(),
    ids: new CryptoIdGenerator(),
    projects: store,
    tasks: store,
    audit: store,
    transactions: store,
    worker: new FakeWorker(),
  });
  return {
    core,
    close: async () => {
      await core.shutdown();
      store.close();
    },
  };
}

export function defaultDbPath(): string {
  // Only create the directory that is actually used; an explicit override must
  // not leave a stray `.intentsmith` folder in the current working directory.
  const override = process.env.INTENTSMITH_DB_PATH;
  if (override) return override;
  const root = path.join(process.cwd(), '.intentsmith');
  mkdirSync(root, { recursive: true });
  return path.join(root, 'intentsmith.db');
}
