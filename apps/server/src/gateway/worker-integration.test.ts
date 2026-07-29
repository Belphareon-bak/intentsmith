import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { fixtureTransport } from '@intentsmith/adapter-ollama/fixtures';
import { OpenCodeWorker } from '@intentsmith/adapter-opencode';
import { createFakeAgent, type FakeAgent } from '@intentsmith/adapter-opencode/fixtures';
import { createTaskInput, createTestRuntime, type TestRuntime } from '@intentsmith/testing';
import { withGrant, type GrantAudit, type GrantIssuer } from '@intentsmith/worker-sdk';

import { createTestServerRuntime } from '../test-runtime.js';
import { startGateway, type GatewayHandle } from './lifecycle.js';
import { GatewayTokenStore } from './token-store.js';

/**
 * End-to-end proof that a worker's only inference path is the IntentSmith
 * gateway, and that its token dies with the run.
 *
 * This is the integration evidence Phase 3 turns on, so it uses a real
 * gateway on a real loopback socket and a real child process. The only fake is
 * the Ollama transport, so deterministic verification needs no external
 * inference runtime.
 */

const cleanups: Array<() => void | Promise<void>> = [];
const cores: TestRuntime[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const core of cores.splice(0)) {
    await core.core.shutdown();
    core.cleanup();
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

type Harness = {
  gateway: GatewayHandle;
  tokens: GatewayTokenStore;
  /** Records every Ollama call the gateway made. */
  ollamaCalls: string[];
  issuer: GrantIssuer;
};

async function harness(): Promise<Harness> {
  const core = createTestRuntime();
  cores.push(core);
  const tokens = new GatewayTokenStore();
  const ollamaCalls: string[] = [];

  const base = fixtureTransport();
  const runtime = createTestServerRuntime({
    core: core.core,
    gatewayTokens: tokens,
    // Wraps the offline fixture so the test can prove the gateway really
    // reached the local provider on the worker's behalf.
    transport: async (url, init) => {
      ollamaCalls.push(url);
      return await base(url, init);
    },
  });

  const gateway = await startGateway({ runtime, tokens });
  cleanups.push(() => gateway.close());

  return {
    gateway,
    tokens,
    ollamaCalls,
    issuer: {
      issue: (runId, taskId) => ({
        baseUrl: gateway.url,
        token: gateway.issueToken(runId, taskId),
        modelId: 'qwen3:14b',
      }),
      revoke: runId => gateway.revokeRun(runId),
    },
  };
}

async function runWorker(
  agent: FakeAgent,
  workspace: string,
  grantBaseUrl: string,
  token: string,
  modelId: string,
): Promise<void> {
  const worker = new OpenCodeWorker({
    executable: process.execPath,
    args: [agent.scriptPath],
    expectedVersion: 'fake-opencode/0.0.0',
    preferSandbox: false,
    limits: { startupMs: 5_000, idleMs: 5_000, overallMs: 20_000, terminationGraceMs: 300 },
  });

  const core = createTestRuntime();
  cores.push(core);
  const project = await core.core.createProject({ name: 'worker', rootPath: workspace });
  const task = await core.core.createTask(createTaskInput(project.id, workspace));
  const runs = { id: 'run_fixture', taskId: task.id, attempt: 1, status: 'running' as const, startedAt: '2026-07-28T00:00:00.000Z' };

  const handle = worker.start({
    task,
    run: runs,
    signal: new AbortController().signal,
    workspaceRoot: workspace,
    inference: { baseUrl: grantBaseUrl, token, modelId },
  });
  await handle.done;
}

describe('worker inference integration', () => {
  it('proves the worker used the gateway and the gateway used the local model', async () => {
    const { gateway, ollamaCalls, issuer } = await harness();
    const workspace = tempDir('intentsmith-ws-');
    const agent = createFakeAgent({ behaviour: 'calls-gateway' });
    cleanups.push(() => agent.cleanup());

    let capturedToken = '';
    const audits: GrantAudit[] = [];
    await withGrant(
      issuer,
      'run_fixture',
      'task_fixture',
      async grant => {
        capturedToken = grant.token;
        await runWorker(agent, workspace, grant.baseUrl, grant.token, grant.modelId);
      },
      { onAudit: audit => audits.push(audit) },
    );

    const log = agent.readLog(workspace);
    const inference = log.find(entry => entry.kind === 'inference');

    // 1. OpenCode used the IntentSmith gateway.
    expect(inference).toBeDefined();
    expect(inference?.via).toBe('gateway');
    expect(inference?.status).toBe(200);
    expect(inference?.sawToken).toBe(true);

    // 2. The gateway used the local Ollama model.
    expect(ollamaCalls.some(url => url.includes('/api/generate'))).toBe(true);
    expect(ollamaCalls.every(url => url.startsWith('http://127.0.0.1:11434'))).toBe(true);

    // 3. No direct or cloud inference happened.
    expect(log.some(entry => entry.via === 'ollama-direct')).toBe(false);
    expect(JSON.stringify(log)).not.toMatch(/ollama\.com|api\.openai\.com|anthropic\.com/i);

    // 4. The token no longer works once the run has ended.
    expect(audits).toHaveLength(1);
    expect(audits[0]?.outcome).toBe('success');
    expect(audits[0]?.revoked).toBe(true);
    const afterRun = await fetch(`${gateway.url}/v1/models`, {
      headers: { authorization: `Bearer ${capturedToken}` },
    });
    expect(afterRun.status).toBe(401);
  });

  it('a worker that tries to reach Ollama directly gets nothing useful', async () => {
    const { issuer } = await harness();
    const workspace = tempDir('intentsmith-ws-');
    const agent = createFakeAgent({ behaviour: 'calls-ollama-directly' });
    cleanups.push(() => agent.cleanup());
    await withGrant(issuer, 'run_direct', 'task_direct', async grant => {
      await runWorker(agent, workspace, grant.baseUrl, grant.token, grant.modelId);
    });

    const log = agent.readLog(workspace);
    // Whether a daemon happens to be running on this machine is irrelevant:
    // what matters is that IntentSmith never told the worker where it is, and
    // that this path is not the sanctioned one.
    const direct = log.find(entry => entry.via === 'ollama-direct');
    expect(direct).toBeDefined();
    expect(log.some(entry => entry.kind === 'inference' && entry.via === 'gateway')).toBe(false);
  });

  it('revokes the token when the run fails between issue and spawn', async () => {
    const { gateway, issuer } = await harness();
    let capturedToken = '';
    const audits: GrantAudit[] = [];

    await expect(
      withGrant(
        issuer,
        'run_spawn_fail',
        'task_spawn_fail',
        async grant => {
          capturedToken = grant.token;
          // The token exists and works at this instant.
          const during = await fetch(`${gateway.url}/v1/models`, {
            headers: { authorization: `Bearer ${grant.token}` },
          });
          expect(during.status).toBe(200);
          // Now fail before the worker is ever spawned.
          throw Object.assign(new Error('spawn refused'), { reason: 'spawn_failed' });
        },
        { onAudit: audit => audits.push(audit) },
      ),
    ).rejects.toThrow('spawn refused');

    expect(audits[0]?.outcome).toBe('spawn_failed');
    expect(audits[0]?.revoked).toBe(true);
    const after = await fetch(`${gateway.url}/v1/models`, {
      headers: { authorization: `Bearer ${capturedToken}` },
    });
    expect(after.status).toBe(401);
  });

  it.each([
    ['cancelled', 'cancelled'],
    ['timeout', 'timeout'],
    ['failure', 'failure'],
  ])('revokes the token on a %s outcome', async (_label, reason) => {
    const { gateway, issuer } = await harness();
    let capturedToken = '';
    const audits: GrantAudit[] = [];

    await expect(
      withGrant(
        issuer,
        `run_${reason}`,
        `task_${reason}`,
        async grant => {
          capturedToken = grant.token;
          throw Object.assign(new Error(`${reason} happened`), { reason });
        },
        { onAudit: audit => audits.push(audit) },
      ),
    ).rejects.toThrow();

    expect(audits[0]?.revoked).toBe(true);
    const after = await fetch(`${gateway.url}/v1/models`, {
      headers: { authorization: `Bearer ${capturedToken}` },
    });
    expect(after.status).toBe(401);
  });

  it('invalidates every remaining token when the gateway closes', async () => {
    const { gateway, tokens } = await harness();
    const first = gateway.issueToken('run_a');
    const second = gateway.issueToken('run_b');
    const url = gateway.url;
    expect(tokens.size).toBe(2);

    await gateway.close();
    expect(tokens.size).toBe(0);
    for (const token of [first, second]) {
      await expect(fetch(`${url}/v1/models`, { headers: { authorization: `Bearer ${token}` } })).rejects.toBeDefined();
    }
  });

  it('never writes the token into an audit record', async () => {
    const { issuer } = await harness();
    const audits: GrantAudit[] = [];
    let capturedToken = '';

    await withGrant(
      issuer,
      'run_audit',
      'task_audit',
      async grant => {
        capturedToken = grant.token;
      },
      { onAudit: audit => audits.push(audit) },
    );

    expect(capturedToken.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain(capturedToken);
  });
});
