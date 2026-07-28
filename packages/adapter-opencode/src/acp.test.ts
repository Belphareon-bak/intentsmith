import { describe, expect, it } from 'vitest';

import { AcpClient, AcpProtocolError, LineBuffer, parseInbound, type AcpTransport } from './acp.js';
import {
  GATEWAY_TOKEN_ENV,
  PROVIDER_ID,
  assertConfigHasNoDirectInference,
  buildOpenCodeConfig,
} from './runtime-config.js';

/** ACP framing, validation and the generated OpenCode runtime config. */

function loopback(): { transport: AcpTransport; sent: string[]; deliver: (line: string) => void } {
  const sent: string[] = [];
  const listeners = new Set<(line: string) => void>();
  return {
    sent,
    transport: {
      send: line => sent.push(line),
      onLine: listener => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    deliver: line => {
      for (const listener of [...listeners]) listener(line);
    },
  };
}

describe('inbound validation', () => {
  it('accepts a well-formed request, notification and response', () => {
    expect(parseInbound({ jsonrpc: '2.0', id: 1, method: 'm' })).toMatchObject({ id: 1, method: 'm' });
    expect(parseInbound({ jsonrpc: '2.0', method: 'note' })).toMatchObject({ method: 'note' });
    expect(parseInbound({ jsonrpc: '2.0', id: 'a', result: 5 })).toMatchObject({ id: 'a', result: 5 });
  });

  it.each([
    ['not an object', 42],
    ['null', null],
    ['missing jsonrpc', { id: 1, method: 'm' }],
    ['wrong jsonrpc', { jsonrpc: '1.0', id: 1, method: 'm' }],
    ['response with no id', { jsonrpc: '2.0', result: 1 }],
    ['non-scalar request id', { jsonrpc: '2.0', id: {}, method: 'm' }],
    ['malformed error object', { jsonrpc: '2.0', id: 1, error: { message: 'no code' } }],
  ])('rejects %s', (_label, payload) => {
    expect(() => parseInbound(payload)).toThrow(AcpProtocolError);
  });

  it('accepts a well-formed error response', () => {
    const parsed = parseInbound({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'nope' } });
    expect(parsed).toMatchObject({ id: 1, error: { code: -1, message: 'nope' } });
  });
});

describe('line buffer', () => {
  it('splits records across arbitrary chunk boundaries', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('{"a"')).toEqual([]);
    expect(buffer.push(':1}\n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('rejects a line that grows past the cap', () => {
    const buffer = new LineBuffer(64);
    expect(() => buffer.push('x'.repeat(100))).toThrow(AcpProtocolError);
  });
});

describe('acp client', () => {
  it('resolves a request when the agent responds', async () => {
    const { transport, sent, deliver } = loopback();
    const client = new AcpClient({ transport });
    const pending = client.request('initialize', { protocolVersion: 1 });

    const request = JSON.parse(sent[0] as string) as { id: number; method: string };
    expect(request.method).toBe('initialize');
    deliver(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1 } }));
    await expect(pending).resolves.toMatchObject({ protocolVersion: 1 });
  });

  it('rejects a request when the agent returns an error', async () => {
    const { transport, sent, deliver } = loopback();
    const client = new AcpClient({ transport });
    const pending = client.request('session/new');
    const { id } = JSON.parse(sent[0] as string) as { id: number };
    deliver(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32_601, message: 'unsupported' } }));
    await expect(pending).rejects.toThrow(/unsupported/);
  });

  it('reports a duplicate response as a protocol violation', async () => {
    const { transport, sent, deliver } = loopback();
    const client = new AcpClient({ transport });
    const errors: string[] = [];
    client.onProtocolError = error => errors.push(error.message);

    const pending = client.request('initialize');
    const { id } = JSON.parse(sent[0] as string) as { id: number };
    deliver(JSON.stringify({ jsonrpc: '2.0', id, result: {} }));
    await pending;
    deliver(JSON.stringify({ jsonrpc: '2.0', id, result: {} }));
    expect(errors.join(' ')).toContain('duplicate response');
  });

  it('reports a response to an unknown id', () => {
    const { transport, deliver } = loopback();
    const client = new AcpClient({ transport });
    const errors: string[] = [];
    client.onProtocolError = error => errors.push(error.message);
    deliver(JSON.stringify({ jsonrpc: '2.0', id: 999, result: {} }));
    expect(errors.join(' ')).toContain('unknown request id');
    client.close();
  });

  it('reports non-JSON stdout pollution', () => {
    const { transport, deliver } = loopback();
    const client = new AcpClient({ transport });
    const errors: string[] = [];
    client.onProtocolError = error => errors.push(error.message);
    deliver('warning: not json at all');
    expect(errors.join(' ')).toContain('non-JSON line');
    client.close();
  });

  it('rejects an oversized message', () => {
    const { transport, deliver } = loopback();
    const client = new AcpClient({ transport, maxMessageBytes: 32 });
    const errors: string[] = [];
    client.onProtocolError = error => errors.push(error.message);
    deliver(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'x'.repeat(200) }));
    expect(errors.join(' ')).toContain('larger than the allowed size');
    client.close();
  });

  it('answers an agent-initiated request through the installed handler', async () => {
    const { transport, sent, deliver } = loopback();
    const client = new AcpClient({ transport });
    client.onRequest = async method => ({ handled: method });

    deliver(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'session/request_permission', params: {} }));
    await Promise.resolve();
    await Promise.resolve();

    const reply = sent.map(line => JSON.parse(line) as { id?: number; result?: unknown }).find(m => m.id === 7);
    expect(reply?.result).toEqual({ handled: 'session/request_permission' });
    client.close();
  });

  it('returns a JSON-RPC error when the handler refuses', async () => {
    const { transport, sent, deliver } = loopback();
    const client = new AcpClient({ transport });
    client.onRequest = async () => {
      throw new Error('denied by policy');
    };
    deliver(JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'session/request_permission' }));
    await Promise.resolve();
    await Promise.resolve();

    const reply = sent.map(line => JSON.parse(line) as { id?: number; error?: { message: string } }).find(m => m.id === 8);
    expect(reply?.error?.message).toContain('denied by policy');
    client.close();
  });

  it('times out a request on the injected timer', async () => {
    let fire: (() => void) | undefined;
    const { transport } = loopback();
    const client = new AcpClient({
      transport,
      schedule: fn => {
        fire = fn;
        return () => {
          fire = undefined;
        };
      },
    });
    const pending = client.request('session/prompt');
    fire?.();
    await expect(pending).rejects.toThrow(/did not answer/);
    client.close();
  });

  it('rejects every outstanding request when closed', async () => {
    const { transport } = loopback();
    const client = new AcpClient({ transport });
    const pending = client.request('session/prompt');
    client.close('agent went away');
    await expect(pending).rejects.toThrow(/agent went away/);
    // A closed client refuses new work rather than hanging.
    await expect(client.request('anything')).rejects.toThrow(/closed/);
  });
});

describe('generated OpenCode config', () => {
  const grant = { baseUrl: 'http://127.0.0.1:41234', token: 'secret-token', modelId: 'qwen3:14b' };

  it('points the only provider at the gateway', () => {
    const config = buildOpenCodeConfig(grant) as {
      provider: Record<string, { options: { baseURL: string; apiKey: string } }>;
      model: string;
    };
    expect(Object.keys(config.provider)).toEqual([PROVIDER_ID]);
    expect(config.provider[PROVIDER_ID]?.options.baseURL).toBe('http://127.0.0.1:41234/v1');
    expect(config.model).toBe(`${PROVIDER_ID}/qwen3:14b`);
  });

  it('references the token by environment indirection, never inline', () => {
    const config = buildOpenCodeConfig(grant);
    const serialized = JSON.stringify(config);
    // The file lands on disk; a secret written into it would outlive the process.
    expect(serialized).not.toContain('secret-token');
    expect(serialized).toContain(`{env:${GATEWAY_TOKEN_ENV}}`);
  });

  it('accepts a config that only reaches the gateway', () => {
    expect(() => assertConfigHasNoDirectInference(buildOpenCodeConfig(grant), grant.baseUrl)).not.toThrow();
  });

  it('rejects a config that reaches Ollama directly', () => {
    const rogue = { provider: { x: { options: { baseURL: 'http://127.0.0.1:11434/v1' } } } };
    expect(() => assertConfigHasNoDirectInference(rogue, grant.baseUrl)).toThrow(/directly/);
  });

  it('rejects a config that reaches a cloud host', () => {
    const rogue = { provider: { x: { options: { baseURL: 'https://api.openai.com/v1' } } } };
    expect(() => assertConfigHasNoDirectInference(rogue, grant.baseUrl)).toThrow(/cloud/);
  });

  it('rejects a config that does not mention the gateway at all', () => {
    const rogue = { provider: {} };
    expect(() => assertConfigHasNoDirectInference(rogue, grant.baseUrl)).toThrow(/does not point at/);
  });
});
