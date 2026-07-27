import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { AuditEvent } from '@intentsmith/contracts';

import { openIntentSmithDatabase, type SQLiteStore } from './database.js';

/**
 * Transaction context isolation between independent SQLiteStore instances.
 *
 * A store detects a reentrant transaction so it does not attempt a nested
 * `BEGIN IMMEDIATE` on the one connection better-sqlite3 gives it. That
 * detection must be scoped to the store that owns the connection: if it were
 * shared across stores, a transaction opened on store A would make a
 * transaction on store B look reentrant, and B would run its writes with no
 * transaction at all -- silently losing its rollback.
 */

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function newStore(label: string): SQLiteStore {
  const root = mkdtempSync(path.join(tmpdir(), `intentsmith-tx-${label}-`));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const store = openIntentSmithDatabase(path.join(root, 'state.db'));
  cleanups.push(() => {
    try {
      store.close();
    } catch {
      // Already closed by the test.
    }
  });
  return store;
}

const TASK_ID = 'task_iso';

function event(id: string): AuditEvent {
  return {
    id,
    taskId: TASK_ID,
    type: 'task.transition',
    message: id,
    data: {},
    createdAt: '2026-07-27T00:00:00.000Z',
  };
}

const idsIn = async (store: SQLiteStore): Promise<string[]> =>
  (await store.listByTask(TASK_ID)).map(entry => entry.id);

describe('transaction context isolation', () => {
  it('joins a reentrant transaction on the same store and rolls the whole thing back', async () => {
    const store = newStore('same');

    await expect(
      store.transaction(async () => {
        await store.append(event('outer'));
        // Reentrant: must join the open transaction, not start a second one.
        await store.transaction(async () => {
          await store.append(event('inner'));
        });
        throw new Error('fail the outer transaction');
      }),
    ).rejects.toThrow('fail the outer transaction');

    // The inner write joined the outer transaction, so it rolls back with it.
    expect(await idsIn(store)).toEqual([]);
  });

  it('gives a second store its own real transaction when nested inside the first', async () => {
    const a = newStore('a');
    const b = newStore('b');

    await a.transaction(async () => {
      await a.append(event('a-outer'));
      // B is a different database. This is not reentrancy, so B must open its
      // own transaction and must roll back on failure.
      await expect(
        b.transaction(async () => {
          await b.append(event('b-inner'));
          throw new Error('fail the inner store');
        }),
      ).rejects.toThrow('fail the inner store');
    });

    expect(await idsIn(a)).toEqual(['a-outer']);
    expect(await idsIn(b)).toEqual([]);
  });

  it('does not let a rollback on one database affect the other', async () => {
    const a = newStore('a');
    const b = newStore('b');

    await expect(
      a.transaction(async () => {
        await a.append(event('a-doomed'));
        await b.transaction(async () => {
          await b.append(event('b-survivor'));
        });
        throw new Error('roll A back');
      }),
    ).rejects.toThrow('roll A back');

    expect(await idsIn(a)).toEqual([]);
    expect(await idsIn(b)).toEqual(['b-survivor']);
  });

  it('does not let a commit on one database close the other transaction', async () => {
    const a = newStore('a');
    const b = newStore('b');

    await expect(
      a.transaction(async () => {
        await a.append(event('a-before'));
        // B commits while A is still open.
        await b.transaction(async () => {
          await b.append(event('b-committed'));
        });
        // If B's COMMIT had closed A's transaction, this write would autocommit
        // and survive the rollback below.
        await a.append(event('a-after'));
        throw new Error('roll A back');
      }),
    ).rejects.toThrow('roll A back');

    expect(await idsIn(a)).toEqual([]);
    expect(await idsIn(b)).toEqual(['b-committed']);
  });

  it('runs two independent stores concurrently without cross-serialization', async () => {
    const a = newStore('a');
    const b = newStore('b');

    const write = (store: SQLiteStore, prefix: string, count: number) =>
      Array.from({ length: count }, (_, index) =>
        store.transaction(async () => {
          await store.append(event(`${prefix}-${index}`));
        }),
      );

    // Interleave both stores' work in one batch.
    await Promise.all([...write(a, 'a', 5), ...write(b, 'b', 5)]);

    expect((await idsIn(a)).sort()).toEqual(['a-0', 'a-1', 'a-2', 'a-3', 'a-4']);
    expect((await idsIn(b)).sort()).toEqual(['b-0', 'b-1', 'b-2', 'b-3', 'b-4']);
  });

  it('keeps each store serialized on its own connection', async () => {
    const a = newStore('a');
    const b = newStore('b');
    const order: string[] = [];

    const tracked = (store: SQLiteStore, label: string) =>
      store.transaction(async () => {
        order.push(`${label}:enter`);
        await Promise.resolve();
        await store.append(event(`${label}`));
        order.push(`${label}:exit`);
      });

    await Promise.all([tracked(a, 'a1'), tracked(a, 'a2'), tracked(b, 'b1')]);

    // Same store never overlaps itself.
    expect(order.indexOf('a1:exit')).toBeLessThan(order.indexOf('a2:enter'));
    expect(await idsIn(a)).toHaveLength(2);
    expect(await idsIn(b)).toHaveLength(1);
  });
});
