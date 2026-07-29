import { describe, expect, it } from 'vitest';

import { createStrictAcpStream, DEFAULT_STREAM_LIMITS, type StreamViolation } from './strict-stream.js';

/**
 * Strict transport tests.
 *
 * This layer replaces the SDK's `ndJsonStream`, so the guarantees it adds --
 * deterministic failure, no console output, no shared state -- are asserted
 * directly rather than only through the adapter.
 */

type Harness = {
  feed: (text: string) => void;
  written: string[];
  violations: StreamViolation[];
  inbound: unknown[];
  outbound: unknown[];
  stream: ReturnType<typeof createStrictAcpStream>;
  read: () => Promise<unknown[]>;
};

function harness(limits?: Partial<typeof DEFAULT_STREAM_LIMITS>): Harness {
  let listener: ((chunk: Buffer) => void) | undefined;
  const written: string[] = [];
  const violations: StreamViolation[] = [];
  const inbound: unknown[] = [];
  const outbound: unknown[] = [];

  const stream = createStrictAcpStream({
    subscribe: fn => {
      listener = fn;
      return () => {
        listener = undefined;
      };
    },
    write: line => written.push(line),
    ...(limits ? { limits } : {}),
    onViolation: violation => violations.push(violation),
    onInbound: message => inbound.push(message),
    onOutbound: message => outbound.push(message),
  });

  return {
    feed: text => listener?.(Buffer.from(text, 'utf8')),
    written,
    violations,
    inbound,
    outbound,
    stream,
    read: async () => {
      const reader = stream.readable.getReader();
      const out: unknown[] = [];
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          out.push(value);
        }
      } catch {
        // An errored stream is expected in violation cases.
      } finally {
        reader.releaseLock();
      }
      return out;
    },
  };
}

describe('strict acp stream', () => {
  it('parses newline-delimited messages', async () => {
    const h = harness();
    h.feed('{"a":1}\n{"b":2}\n');
    h.stream.close();
    expect(await h.read()).toEqual([{ a: 1 }, { b: 2 }]);
    expect(h.violations).toEqual([]);
  });

  it('reassembles a message split across chunks', async () => {
    const h = harness();
    h.feed('{"a":');
    h.feed('1}\n');
    h.stream.close();
    expect(await h.read()).toEqual([{ a: 1 }]);
  });

  it('accepts a batch array', async () => {
    const h = harness();
    h.feed('[{"a":1}]\n');
    h.stream.close();
    expect(await h.read()).toEqual([[{ a: 1 }]]);
  });

  it('fails deterministically on malformed JSON, without quoting it', async () => {
    const h = harness();
    h.feed('not json at all\n');
    expect(h.violations).toHaveLength(1);
    expect(h.violations[0]?.kind).toBe('malformed_json');
    // The offending text is worker-controlled and may carry a token.
    expect(h.violations[0]?.message).not.toContain('not json at all');
  });

  it('fails on a JSON line that is not an object or array', async () => {
    const h = harness();
    h.feed('42\n');
    expect(h.violations[0]?.kind).toBe('non_object_message');
  });

  it('fails on an oversized complete line', async () => {
    const h = harness({ maxLineBytes: 32 });
    h.feed(`{"a":"${'x'.repeat(200)}"}\n`);
    expect(h.violations[0]?.kind).toBe('oversized_line');
  });

  it('fails on an unterminated line that keeps growing', async () => {
    const h = harness({ maxLineBytes: 32 });
    // No newline ever arrives; the buffer must be capped rather than grow.
    h.feed('x'.repeat(20));
    h.feed('x'.repeat(20));
    expect(h.violations[0]?.kind).toBe('oversized_line');
  });

  it('fails when total stdout exceeds the cap', async () => {
    const h = harness({ maxTotalBytes: 16 });
    h.feed('{"a":1}\n');
    h.feed('{"a":2}\n');
    h.feed('{"a":3}\n');
    expect(h.violations[0]?.kind).toBe('stream_too_large');
  });

  it('reports a violation once and stops consuming afterwards', async () => {
    const h = harness();
    h.feed('garbage\n');
    h.feed('{"valid":true}\n');
    h.feed('more garbage\n');
    // One violation, and nothing after it is interpreted.
    expect(h.violations).toHaveLength(1);
    expect(h.inbound).toEqual([]);
  });

  it('ignores blank lines', async () => {
    const h = harness();
    h.feed('\n\n{"a":1}\n');
    h.stream.close();
    expect(await h.read()).toEqual([{ a: 1 }]);
    expect(h.violations).toEqual([]);
  });

  it('serializes outbound messages and observes them', async () => {
    const h = harness();
    const writer = h.stream.writable.getWriter();
    await writer.write({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    writer.releaseLock();
    expect(h.written[0]).toBe('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
    expect(h.outbound[0]).toMatchObject({ method: 'initialize' });
  });

  it('stops writing after a violation', async () => {
    const h = harness();
    h.feed('garbage\n');
    const writer = h.stream.writable.getWriter();
    await writer.write({ jsonrpc: '2.0', id: 1, method: 'session/new' });
    writer.releaseLock();
    expect(h.written).toEqual([]);
  });

  it('detaches from the process on close, and close is idempotent', () => {
    const h = harness();
    h.stream.close();
    h.stream.close();
    h.feed('{"a":1}\n');
    // Nothing is consumed once closed.
    expect(h.inbound).toEqual([]);
  });

  it('keeps two streams completely independent', () => {
    const first = harness();
    const second = harness();

    first.feed('garbage\n');
    second.feed('{"ok":true}\n');

    // One stream's violation must not affect the other: two concurrent workers
    // share no buffers, counters or handlers.
    expect(first.violations).toHaveLength(1);
    expect(second.violations).toEqual([]);
    expect(second.inbound).toEqual([{ ok: true }]);
  });
});
