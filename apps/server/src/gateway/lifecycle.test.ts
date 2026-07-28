import { afterEach, describe, expect, it } from 'vitest';

import { fixtureTransport } from '@intentsmith/adapter-ollama/fixtures';
import { createTestRuntime, type TestRuntime } from '@intentsmith/testing';

import { createTestServerRuntime } from '../test-runtime.js';
import { isGatewayEnabled, readGatewayPort, startGateway, type GatewayHandle } from './lifecycle.js';
import { GatewayTokenStore } from './token-store.js';

/**
 * Gateway lifecycle tests.
 *
 * These are the only tests in the suite that open a real socket, because
 * binding behaviour is exactly what they verify. Every handle is closed in
 * `afterEach`, and the port is ephemeral so parallel runs cannot collide.
 */

const cores: TestRuntime[] = [];
const handles: GatewayHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.close();
  for (const core of cores.splice(0)) {
    await core.core.shutdown();
    core.cleanup();
  }
});

async function start(port?: number): Promise<{ handle: GatewayHandle; tokens: GatewayTokenStore }> {
  const core = createTestRuntime();
  cores.push(core);
  const tokens = new GatewayTokenStore();
  const runtime = createTestServerRuntime({
    core: core.core,
    transport: fixtureTransport(),
    gatewayTokens: tokens,
  });
  const handle = await startGateway({ runtime, tokens, ...(port === undefined ? {} : { port }) });
  handles.push(handle);
  return { handle, tokens };
}

describe('gateway enablement', () => {
  it('is off unless explicitly enabled', () => {
    expect(isGatewayEnabled({})).toBe(false);
    expect(isGatewayEnabled({ INTENTSMITH_GATEWAY: '0' })).toBe(false);
    expect(isGatewayEnabled({ INTENTSMITH_GATEWAY: '1' })).toBe(true);
    // Configuring a port implies wanting it.
    expect(isGatewayEnabled({ INTENTSMITH_GATEWAY_PORT: '41234' })).toBe(true);
  });

  it('defaults to an ephemeral port and ignores nonsense values', () => {
    expect(readGatewayPort({})).toBe(0);
    expect(readGatewayPort({ INTENTSMITH_GATEWAY_PORT: '41234' })).toBe(41_234);
    for (const bad of ['-1', '99999', 'abc', '1.5']) {
      expect(readGatewayPort({ INTENTSMITH_GATEWAY_PORT: bad })).toBe(0);
    }
  });
});

describe('gateway lifecycle', () => {
  it('binds loopback on an ephemeral port', async () => {
    const { handle } = await start();
    expect(handle.port).toBeGreaterThan(0);
    expect(handle.url).toBe(`http://127.0.0.1:${handle.port}`);
  });

  it('serves models to a holder of a per-run token', async () => {
    const { handle } = await start();
    const token = handle.issueToken('run_1', 'task_1');

    const response = await fetch(`${handle.url}/v1/models`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ id: string }> };
    expect(body.data[0]?.id).toBe('qwen3:14b');
  });

  it('refuses a request with no token over the real socket', async () => {
    const { handle } = await start();
    handle.issueToken('run_1');
    const response = await fetch(`${handle.url}/v1/models`);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('GATEWAY_TOKEN_INVALID');
  });

  it('stops honouring a token once its run is revoked', async () => {
    const { handle } = await start();
    const token = handle.issueToken('run_1');
    const auth = { authorization: `Bearer ${token}` };

    expect((await fetch(`${handle.url}/v1/models`, { headers: auth })).status).toBe(200);
    expect(handle.revokeRun('run_1')).toBe(true);
    expect((await fetch(`${handle.url}/v1/models`, { headers: auth })).status).toBe(401);
  });

  it('revokes every token when the gateway closes', async () => {
    const { handle, tokens } = await start();
    handle.issueToken('run_1');
    handle.issueToken('run_2');
    expect(tokens.size).toBe(2);

    await handle.close();
    handles.length = 0;
    // No token may outlive the listener that honours it.
    expect(tokens.size).toBe(0);
  });

  it('releases the port on close', async () => {
    const { handle } = await start();
    const url = handle.url;
    await handle.close();
    handles.length = 0;

    await expect(fetch(`${url}/v1/models`)).rejects.toBeDefined();
  });
});
