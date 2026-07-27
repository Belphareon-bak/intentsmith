import { describe, expect, it } from 'vitest';

import {
  PROVIDER_ERROR_CODES,
  ProviderError,
  isProviderErrorCode,
  normalizeProviderError,
} from './inference.js';
import {
  COMMAND_SOURCE_STATES,
  assertCommand,
  canRunCommand,
  isTerminal,
  targetStatusFor,
} from './lifecycle.js';
import { KeyedMutex } from './mutex.js';
import { CryptoIdGenerator, SystemClock, SystemTimer } from './runtime-adapters.js';

describe('runtime adapters', () => {
  it('SystemClock returns an ISO UTC instant', () => {
    expect(new SystemClock().now()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('CryptoIdGenerator prefixes unique ids', () => {
    const ids = new CryptoIdGenerator();
    const first = ids.next('task');
    const second = ids.next('task');
    expect(first.startsWith('task_')).toBe(true);
    expect(first).not.toBe(second);
  });

  it('SystemTimer fires a scheduled callback', async () => {
    const fired = await new Promise<boolean>(resolve => {
      new SystemTimer().schedule(() => resolve(true), 1);
    });
    expect(fired).toBe(true);
  });

  it('SystemTimer cancel prevents the callback', async () => {
    let fired = false;
    const cancel = new SystemTimer().schedule(() => {
      fired = true;
    }, 1);
    cancel();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(fired).toBe(false);
  });
});

describe('KeyedMutex', () => {
  it('serializes work for one key and interleaves across keys', async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];
    const work = (key: string, label: string) =>
      mutex.run(key, async () => {
        order.push(`${label}:start`);
        await Promise.resolve();
        order.push(`${label}:end`);
      });

    await Promise.all([work('a', 'a1'), work('a', 'a2')]);
    // Same key never overlaps.
    expect(order).toEqual(['a1:start', 'a1:end', 'a2:start', 'a2:end']);
  });

  it('does not let a rejection poison later waiters on the same key', async () => {
    const mutex = new KeyedMutex();
    const failed = mutex.run('k', async () => {
      throw new Error('nope');
    });
    await expect(failed).rejects.toThrow('nope');
    await expect(mutex.run('k', async () => 'ok')).resolves.toBe('ok');
  });
});

describe('lifecycle command guards', () => {
  it('classifies terminal statuses', () => {
    expect(isTerminal('passed')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('pending')).toBe(false);
    expect(isTerminal('running')).toBe(false);
    expect(isTerminal('paused')).toBe(false);
  });

  it('allows resume only from paused', () => {
    expect([...(COMMAND_SOURCE_STATES.get('resume') ?? [])]).toEqual(['paused']);
    expect(canRunCommand('resume', 'paused')).toBe(true);
    expect(canRunCommand('resume', 'pending')).toBe(false);
    expect(canRunCommand('resume', 'running')).toBe(false);
  });

  it('allows start only from pending', () => {
    expect(canRunCommand('start', 'pending')).toBe(true);
    expect(canRunCommand('start', 'running')).toBe(false);
    expect(canRunCommand('start', 'paused')).toBe(false);
  });

  it('maps each command to its target status', () => {
    expect(targetStatusFor('start')).toBe('running');
    expect(targetStatusFor('pause')).toBe('paused');
    expect(targetStatusFor('resume')).toBe('running');
    expect(targetStatusFor('cancel')).toBe('cancelled');
  });

  it('rejects an unknown command', () => {
    expect(() => targetStatusFor('detonate' as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_TASK_TRANSITION' }),
    );
  });

  it('rejects a command from a terminal status', () => {
    for (const status of ['passed', 'failed', 'cancelled'] as const) {
      expect(() => assertCommand('cancel', status)).toThrowError(
        expect.objectContaining({ code: 'INVALID_TASK_TRANSITION' }),
      );
    }
  });

  it('returns the target status for a valid command', () => {
    expect(assertCommand('start', 'pending')).toBe('running');
    expect(assertCommand('resume', 'paused')).toBe('running');
  });
});

describe('provider error normalization', () => {
  it('recognizes every stable provider error code', () => {
    for (const code of PROVIDER_ERROR_CODES) expect(isProviderErrorCode(code)).toBe(true);
    expect(isProviderErrorCode('MODEL_TOO_LARGE')).toBe(false);
    expect(isProviderErrorCode(42)).toBe(false);
    expect(isProviderErrorCode(undefined)).toBe(false);
  });

  it('passes a ProviderError through unchanged', () => {
    const error = new ProviderError('MODEL_NOT_FOUND', 'missing', true);
    expect(normalizeProviderError(error)).toEqual({
      code: 'MODEL_NOT_FOUND',
      message: 'missing',
      retryable: true,
    });
  });

  it('maps an AbortError to REQUEST_CANCELLED', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(normalizeProviderError(abort).code).toBe('REQUEST_CANCELLED');
  });

  it('maps an unknown failure to PROVIDER_PROTOCOL_ERROR without leaking detail', () => {
    const normalized = normalizeProviderError(new Error('boom at /home/x/y.ts:1:1'));
    expect(normalized.code).toBe('PROVIDER_PROTOCOL_ERROR');
    expect(normalized.message).toBe('Provider protocol error');
    expect(normalized.message).not.toContain('/home/');
  });

  it('maps a non-error throw to PROVIDER_PROTOCOL_ERROR', () => {
    expect(normalizeProviderError('string failure').code).toBe('PROVIDER_PROTOCOL_ERROR');
  });

  it('does not define MODEL_TOO_LARGE, which is a Phase 2 policy concern', () => {
    expect(PROVIDER_ERROR_CODES).not.toContain('MODEL_TOO_LARGE' as never);
  });
});
