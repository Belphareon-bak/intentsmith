import { describe, expect, it } from 'vitest';

import { DeterministicIdGenerator, FakeClock } from './fakes.js';

describe('deterministic test utilities', () => {
  it('advances a fake clock explicitly', () => {
    const clock = new FakeClock('2026-07-27T00:00:00.000Z');
    clock.tick(1500);
    expect(clock.now()).toBe('2026-07-27T00:00:01.500Z');
  });

  it('generates stable per-prefix IDs', () => {
    const ids = new DeterministicIdGenerator();
    expect([ids.next('task'), ids.next('task'), ids.next('run')]).toEqual([
      'task_0001',
      'task_0002',
      'run_0001',
    ]);
  });
});
