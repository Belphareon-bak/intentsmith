import { afterEach, describe, expect, it } from 'vitest';

import { fixtureTransport } from '@intentsmith/adapter-ollama/fixtures';
import { DisposableWorkspace, createTaskInput, createTestRuntime, type TestRuntime } from '@intentsmith/testing';

import { buildServer } from './app.js';
import { startGateway, type GatewayHandle } from './gateway/lifecycle.js';
import { GatewayTokenStore } from './gateway/token-store.js';
import {
  DEFAULT_API_HOST,
  REMOTE_ACCESS_ENV,
  RemoteAccessConfigError,
  describeRemoteAccess,
  isLoopbackBindTarget,
  readRemoteAccessConfig,
  type RemoteAccessConfig,
} from './remote-access.js';
import { createTestServerRuntime } from './test-runtime.js';

/**
 * Authenticated remote access over a private VPN.
 *
 * Two properties are under test and they pull in opposite directions. The
 * default must be exactly what it was — loopback, no configuration, no
 * credential — and the moment an operator asks for anything else, every route
 * that carries authority or content must be behind a credential that was
 * supplied, not invented.
 *
 * Nothing here reaches a network. The one real socket belongs to the worker
 * gateway, because where the gateway binds is the thing being proved.
 */

const TOKEN = 'x7Kq2mVt9Rb4LpZs6Wc1Nd8Fh3Gj5Yu0';
const OTHER_TOKEN = 'a1Bc2De3Fg4Hi5Jk6Lm7No8Pq9Rs0Tu1';
const VPN_HOST = '10.8.0.4';

const cleanups: Array<() => void | Promise<void>> = [];
const handles: GatewayHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.close();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function core(): TestRuntime {
  const runtime = createTestRuntime();
  cleanups.push(() => runtime.cleanup());
  return runtime;
}

/** The remote deployment: a VPN bind behind the operator credential. */
const REMOTE: RemoteAccessConfig = { authentication: 'operator-token', host: VPN_HOST, token: TOKEN };

function server(remoteAccess?: RemoteAccessConfig) {
  const runtime = createTestServerRuntime({ core: core().core, transport: fixtureTransport() });
  const app = remoteAccess ? buildServer(runtime, remoteAccess) : buildServer(runtime);
  cleanups.push(() => app.close());
  return app;
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('the remote-access configuration contract', () => {
  it('defaults to loopback with no authentication and no credential', () => {
    expect(readRemoteAccessConfig({})).toEqual({ authentication: 'none', host: DEFAULT_API_HOST });
  });

  it('keeps every loopback bind that already worked working', () => {
    for (const host of ['127.0.0.1', '127.0.0.2', '::1', 'localhost']) {
      expect(readRemoteAccessConfig({ [REMOTE_ACCESS_ENV.host]: host })).toEqual({
        authentication: 'none',
        host,
      });
    }
    expect(isLoopbackBindTarget('localhost')).toBe(true);
    expect(isLoopbackBindTarget('10.8.0.4')).toBe(false);
  });

  it('refuses a non-loopback bind that nobody opted into', () => {
    const error = attempt({ [REMOTE_ACCESS_ENV.host]: VPN_HOST });
    expect(error).toBeInstanceOf(RemoteAccessConfigError);
    expect(error.message).toContain(REMOTE_ACCESS_ENV.mode);
    expect(error.message).toContain(REMOTE_ACCESS_ENV.token);
  });

  it('refuses the opt-in with no credential at all', () => {
    const error = attempt({ [REMOTE_ACCESS_ENV.host]: VPN_HOST, [REMOTE_ACCESS_ENV.mode]: 'vpn' });
    expect(error).toBeInstanceOf(RemoteAccessConfigError);
    expect(error.message).toContain('never generates, stores or substitutes one');
    // An empty credential is the same as none: nothing is substituted for it.
    expect(
      attempt({ [REMOTE_ACCESS_ENV.host]: VPN_HOST, [REMOTE_ACCESS_ENV.mode]: 'vpn', [REMOTE_ACCESS_ENV.token]: '' }),
    ).toBeInstanceOf(RemoteAccessConfigError);
  });

  it('refuses a credential that is too weak, and never quotes it back', () => {
    const weak = ['hunter2', 'change-me-please', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', `${TOKEN} `, `to ken${TOKEN}`];
    for (const token of weak) {
      const error = attempt({
        [REMOTE_ACCESS_ENV.host]: VPN_HOST,
        [REMOTE_ACCESS_ENV.mode]: 'vpn',
        [REMOTE_ACCESS_ENV.token]: token,
      });
      expect(error).toBeInstanceOf(RemoteAccessConfigError);
      // The rule is named; the value never is.
      expect(error.message).not.toContain(token.trim());
    }
  });

  it('refuses a credential that nothing would enforce', () => {
    const error = attempt({ [REMOTE_ACCESS_ENV.token]: TOKEN });
    expect(error).toBeInstanceOf(RemoteAccessConfigError);
    expect(error.message).toContain('nothing');
    expect(error.message).not.toContain(TOKEN);
  });

  it('refuses an opt-in value that is not the supported transport', () => {
    for (const mode of ['1', 'true', 'lan', 'internet', 'public']) {
      expect(attempt({ [REMOTE_ACCESS_ENV.mode]: mode, [REMOTE_ACCESS_ENV.token]: TOKEN })).toBeInstanceOf(
        RemoteAccessConfigError,
      );
    }
  });

  it('refuses a wildcard bind and a name, so the operator names an interface', () => {
    for (const host of ['0.0.0.0', '::', 'vpn.example.internal', '']) {
      expect(
        attempt({
          [REMOTE_ACCESS_ENV.host]: host,
          [REMOTE_ACCESS_ENV.mode]: 'vpn',
          [REMOTE_ACCESS_ENV.token]: TOKEN,
        }),
      ).toBeInstanceOf(RemoteAccessConfigError);
    }
  });

  it('accepts a named VPN address with a supplied credential', () => {
    const config = readRemoteAccessConfig({
      [REMOTE_ACCESS_ENV.host]: VPN_HOST,
      [REMOTE_ACCESS_ENV.mode]: 'vpn',
      [REMOTE_ACCESS_ENV.token]: TOKEN,
    });
    expect(config).toEqual({ authentication: 'operator-token', host: VPN_HOST, token: TOKEN });
    // What may be logged carries the shape of the boundary and not the secret.
    expect(JSON.stringify(describeRemoteAccess(config))).not.toContain(TOKEN);
  });

  it('allows an authenticated loopback bind, which is strictly stronger than the default', () => {
    expect(
      readRemoteAccessConfig({
        [REMOTE_ACCESS_ENV.mode]: 'vpn',
        [REMOTE_ACCESS_ENV.token]: TOKEN,
      }),
    ).toEqual({ authentication: 'operator-token', host: DEFAULT_API_HOST, token: TOKEN });
  });
});

describe('the loopback default is unchanged', () => {
  it('serves every route with no credential and no configuration', async () => {
    const app = server();
    const runtime = createTestRuntime();
    cleanups.push(() => runtime.cleanup());

    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/version' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/hardware' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/inference/models' })).statusCode).toBe(200);

    const workspace = new DisposableWorkspace();
    cleanups.push(() => workspace.cleanup());
    const project = await app.inject({
      method: 'POST',
      url: '/projects',
      payload: { name: 'default-mode', rootPath: workspace.path },
    });
    expect(project.statusCode).toBe(200);
    // An unauthenticated approval decision from off-machine is still refused by
    // the peer-address guard, exactly as before.
    const remote = await app.inject({
      method: 'GET',
      url: '/runs/run_1/approvals',
      remoteAddress: '10.1.2.3',
    });
    expect(remote.statusCode).toBe(403);
    expect(remote.json()).toMatchObject({ error: { code: 'APPROVAL_SURFACE_REMOTE' } });
  });
});

describe('remote mode protects every route', () => {
  const surface = [
    { method: 'GET' as const, url: '/health' },
    { method: 'GET' as const, url: '/version' },
    { method: 'POST' as const, url: '/projects', payload: { name: 'x', rootPath: '/tmp' } },
    { method: 'GET' as const, url: '/projects/proj_1' },
    { method: 'POST' as const, url: '/tasks', payload: {} },
    { method: 'GET' as const, url: '/tasks/task_1' },
    { method: 'POST' as const, url: '/tasks/task_1/start' },
    { method: 'POST' as const, url: '/tasks/task_1/pause' },
    { method: 'POST' as const, url: '/tasks/task_1/resume' },
    { method: 'POST' as const, url: '/tasks/task_1/cancel' },
    { method: 'GET' as const, url: '/tasks/task_1/result' },
    { method: 'GET' as const, url: '/tasks/task_1/audit' },
    { method: 'GET' as const, url: '/runs/run_1/approvals' },
    { method: 'POST' as const, url: '/runs/run_1/approvals/approval_1/approve' },
    { method: 'POST' as const, url: '/runs/run_1/approvals/approval_1/deny' },
    { method: 'GET' as const, url: '/inference/providers' },
    { method: 'GET' as const, url: '/inference/providers/ollama/health' },
    { method: 'GET' as const, url: '/inference/models' },
    { method: 'GET' as const, url: '/inference/models/qwen3:14b' },
    { method: 'POST' as const, url: '/inference/models/qwen3:14b/assess', payload: {} },
    { method: 'POST' as const, url: '/inference/generate', payload: { modelId: 'qwen3:14b', prompt: 'ping' } },
    { method: 'GET' as const, url: '/hardware' },
    { method: 'GET' as const, url: '/runtime/recovery' },
    // Even an unknown route answers with the credential check, so the surface
    // cannot be mapped from outside it.
    { method: 'GET' as const, url: '/not-a-route' },
  ];

  it('answers 401 on every route when no credential is presented', async () => {
    const app = server(REMOTE);
    for (const request of surface) {
      const response = await app.inject(request);
      expect({ url: request.url, status: response.statusCode }).toEqual({ url: request.url, status: 401 });
      expect(response.json()).toEqual({
        error: { code: 'OPERATOR_AUTH_REQUIRED', message: 'A valid operator bearer token is required.', retryable: false },
      });
    }
  });

  it('answers 401 identically for a malformed scheme and a wrong credential', async () => {
    const app = server(REMOTE);
    const rejected = [
      { authorization: TOKEN },
      { authorization: `Basic ${TOKEN}` },
      { authorization: 'Bearer' },
      { authorization: 'Bearer ' },
      { authorization: `Bearer ${TOKEN} extra` },
      { authorization: `Bearer ${TOKEN},Bearer ${OTHER_TOKEN}` },
      { authorization: `Bearer${TOKEN}` },
      { authorization: `Bearer ${OTHER_TOKEN}` },
      { authorization: `Bearer ${TOKEN}x` },
      { authorization: `Bearer ${TOKEN.slice(0, -1)}` },
    ];
    for (const headers of rejected) {
      const response = await app.inject({ method: 'GET', url: '/hardware', headers });
      expect({ headers, status: response.statusCode }).toEqual({ headers, status: 401 });
      expect(response.json().error.code).toBe('OPERATOR_AUTH_REQUIRED');
    }
  });

  it('lets the correct credential through to an ordinary protected route', async () => {
    const app = server(REMOTE);
    const workspace = new DisposableWorkspace();
    cleanups.push(() => workspace.cleanup());

    const created = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: bearer(TOKEN),
      payload: { name: 'vpn-alpha', rootPath: workspace.path },
    });
    expect(created.statusCode).toBe(200);

    const read = await app.inject({
      method: 'GET',
      url: `/projects/${(created.json() as { id: string }).id}`,
      // The scheme is case-insensitive, as RFC 7235 requires.
      headers: { authorization: `bearer ${TOKEN}` },
    });
    expect(read.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/hardware', headers: bearer(TOKEN) })).statusCode).toBe(200);
  });

  it('cannot be used to learn whether an id exists', async () => {
    const app = server(REMOTE);
    const workspace = new DisposableWorkspace();
    cleanups.push(() => workspace.cleanup());
    const project = (
      await app.inject({
        method: 'POST',
        url: '/projects',
        headers: bearer(TOKEN),
        payload: { name: 'probe', rootPath: workspace.path },
      })
    ).json() as { id: string };

    // A real id and an invented one are indistinguishable without the
    // credential: same status, same body, same headers.
    const pairs = [
      [`/projects/${project.id}`, '/projects/proj_does_not_exist'],
      ['/tasks/task_real/audit', '/tasks/task_invented/audit'],
      ['/runs/run_real/approvals', '/runs/run_invented/approvals'],
    ];
    for (const [real, invented] of pairs) {
      const a = await app.inject({ method: 'GET', url: real as string, headers: bearer(OTHER_TOKEN) });
      const b = await app.inject({ method: 'GET', url: invented as string });
      expect(a.statusCode).toBe(401);
      expect(a.body).toBe(b.body);
      expect(a.body).not.toContain(project.id);
    }
  });

  it('rejects streamed generation before any model content exists', async () => {
    const app = server(REMOTE);
    for (const headers of [undefined, bearer(OTHER_TOKEN)]) {
      const response = await app.inject({
        method: 'POST',
        url: '/inference/generate',
        ...(headers ? { headers } : {}),
        payload: { modelId: 'qwen3:14b', prompt: 'ping', stream: true },
      });
      expect(response.statusCode).toBe(401);
      // Not a stream: no NDJSON content type, no started event, no token text.
      expect(response.headers['content-type']).not.toContain('x-ndjson');
      expect(response.body).not.toContain('"started"');
      expect(response.body).not.toContain('completed');
      expect(response.json().error.code).toBe('OPERATOR_AUTH_REQUIRED');
    }
  });

  it('never returns, echoes or records the credential', async () => {
    const runtime = createTestRuntime();
    cleanups.push(() => runtime.cleanup());
    const serverRuntime = createTestServerRuntime({ core: runtime.core, transport: fixtureTransport() });
    const app = buildServer(serverRuntime, REMOTE);
    cleanups.push(() => app.close());
    const workspace = new DisposableWorkspace();
    cleanups.push(() => workspace.cleanup());

    const project = (
      await app.inject({
        method: 'POST',
        url: '/projects',
        headers: bearer(TOKEN),
        payload: { name: 'sanitization', rootPath: workspace.path },
      })
    ).json() as { id: string };
    const task = (
      await app.inject({
        method: 'POST',
        url: '/tasks',
        headers: bearer(TOKEN),
        payload: createTaskInput(project.id, workspace.path),
      })
    ).json() as { id: string };
    await app.inject({ method: 'POST', url: `/tasks/${task.id}/start`, headers: bearer(TOKEN) });
    await runtime.core.waitForTask(task.id);

    // Everything durable this run produced, serialized the way an artifact or a
    // bug report would serialize it.
    const evidence = JSON.stringify({
      task: await runtime.core.getTask(task.id),
      result: await runtime.core.getTaskResult(task.id),
      audit: await runtime.core.listAuditEvents(task.id),
      errors: [
        (await app.inject({ method: 'GET', url: '/tasks/task_missing', headers: bearer(TOKEN) })).json(),
        (await app.inject({ method: 'GET', url: '/tasks/task_missing' })).json(),
        (await app.inject({ method: 'GET', url: '/nope', headers: bearer(TOKEN) })).json(),
      ],
      headers: (await app.inject({ method: 'GET', url: '/health', headers: bearer(TOKEN) })).headers,
    });
    expect(evidence).not.toContain(TOKEN);
    expect(evidence.toLowerCase()).not.toContain('authorization');
    // No credential-shaped value anywhere either. The word "bearer" survives
    // only inside the fixed 401 message, which carries nothing after it.
    expect(evidence).not.toMatch(/bearer\s+\S{12,}/i);
  });
});

describe('the worker gateway is not part of the remote surface', () => {
  it('stays on loopback and refuses the operator credential', async () => {
    const tokens = new GatewayTokenStore();
    const runtime = createTestServerRuntime({
      core: core().core,
      transport: fixtureTransport(),
      gatewayTokens: tokens,
    });
    const handle = await startGateway({ runtime, tokens });
    handles.push(handle);

    // The gateway takes no host from configuration; it has nowhere to put one.
    expect(handle.url).toBe(`http://127.0.0.1:${handle.port}`);

    // The operator credential is not a gateway token and buys nothing here.
    const asOperator = await fetch(`${handle.url}/v1/models`, { headers: bearer(TOKEN) });
    expect(asOperator.status).toBe(401);
    expect(((await asOperator.json()) as { error: { code: string } }).error.code).toBe('GATEWAY_TOKEN_INVALID');

    // Only the run-scoped token issued for this run works, and only until the
    // run reaches a terminal path.
    const runToken = handle.issueToken('run_1', 'task_1');
    expect(runToken).not.toBe(TOKEN);
    expect((await fetch(`${handle.url}/v1/models`, { headers: bearer(runToken) })).status).toBe(200);
    expect(handle.revokeRun('run_1')).toBe(true);
    expect((await fetch(`${handle.url}/v1/models`, { headers: bearer(runToken) })).status).toBe(401);
    // Nothing was persisted: the store is the only place a token ever lived.
    expect(tokens.list()).toEqual([]);
  });
});

function attempt(env: NodeJS.ProcessEnv): Error {
  try {
    readRemoteAccessConfig(env);
  } catch (error) {
    return error as Error;
  }
  throw new Error(`Expected ${JSON.stringify(Object.keys(env))} to be refused.`);
}
