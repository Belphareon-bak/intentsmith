import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { Task, TaskRun } from '@intentsmith/contracts';
import { createRedactor, type InferenceGrant } from '@intentsmith/worker-sdk';

import { OpenCodeWorker, type ToolProposal } from './adapter.js';
import { createFakeAgent, type FakeAgentBehaviour } from './fixtures.js';
import { SUPPORTED_STOP_REASONS, outcomeForStopReason, parsePromptResponse } from './stop-reason.js';

/**
 * WorkerAdapter contract correctness and per-run secret containment.
 *
 * Every case runs a real fake-ACP child process, because terminal-event
 * counting, cancellation timing and token leakage are all properties of an
 * actual process rather than of a mock.
 */

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'intentsmith-cc-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A recognisably secret value, long enough to be redactable. */
const TOKEN = 'gwtok-6f2a9c4e8b1d7f30a5c6e9b2d4f70183';

const GRANT: InferenceGrant = { baseUrl: 'http://127.0.0.1:65500', token: TOKEN, modelId: 'qwen3:14b' };

function fakeTask(): Task {
  return {
    id: 'task_1',
    projectId: 'project_1',
    dependencyIds: [],
    type: 'code',
    goal: 'do the fixture work',
    scope: {
      fsReadRoots: ['/'],
      fsWriteRoots: [],
      allowedCommandFamilies: [],
      deniedCommandPatterns: [],
      network: { mode: 'disabled', allowlist: [] },
      envAllowlist: ['PATH'],
      secrets: 'none',
      processSpawning: 'disabled',
      timeoutMs: 1000,
      maxActions: 0,
      approvalRules: [],
    },
    inputs: [],
    expectedOutputs: ['out'],
    acceptanceCriteria: ['ok'],
    workerPreference: { kind: 'fake', scenario: 'success' },
    timeoutMs: 1000,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    status: 'running',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
  };
}

const fakeRun: TaskRun = {
  id: 'run_1',
  taskId: 'task_1',
  attempt: 1,
  status: 'running',
  startedAt: '2026-07-28T00:00:00.000Z',
};

/**
 * Waits until the fake agent records a milestone.
 *
 * Polling an observable condition keeps these tests independent of machine
 * speed; a fixed sleep would be a latent flake under coverage instrumentation.
 */
/** Polls until a predicate holds, so no test depends on a fixed delay. */
async function waitUntil(predicate: () => boolean, what: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

async function waitForMilestone(
  agent: { readLog(workspaceRoot: string): Array<Record<string, unknown>> },
  workspace: string,
  kind: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (agent.readLog(workspace).some(entry => entry.kind === kind)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Fake agent never reached the "${kind}" milestone.`);
}

function start(behaviour: FakeAgentBehaviour, options: { onPermissionRequest?: (p: ToolProposal) => Promise<{ allowed: boolean; reason?: string }> } = {}) {
  const agent = createFakeAgent({ behaviour });
  cleanups.push(() => agent.cleanup());
  const workspace = tempDir();

  const worker = new OpenCodeWorker({
    executable: process.execPath,
    args: [agent.scriptPath],
    expectedVersion: 'fake-opencode/0.0.0',
    preferSandbox: false,
    limits: { startupMs: 3_000, idleMs: 3_000, overallMs: 8_000, terminationGraceMs: 200 },
    ...(options.onPermissionRequest ? { onPermissionRequest: options.onPermissionRequest } : {}),
  });

  const handle = worker.start({
    task: fakeTask(),
    run: fakeRun,
    signal: new AbortController().signal,
    workspaceRoot: workspace,
    inference: GRANT,
  });
  return { worker, handle, workspace, agent };
}

const typesOf = (events: unknown[]): string[] => events.map(e => (e as { type: string }).type);
const terminals = (events: unknown[]): string[] =>
  typesOf(events).filter(type => type === 'completed' || type === 'failed');
const failureOf = (events: unknown[]) =>
  (events.find(e => (e as { type: string }).type === 'failed') as { error: { code: string; message: string } } | undefined)
    ?.error;

describe('stop reason handling', () => {
  it('accepts every supported stop reason and rejects anything else', () => {
    for (const reason of SUPPORTED_STOP_REASONS) {
      expect(parsePromptResponse({ stopReason: reason })).toBe(reason);
    }
    // An unrecognised reason must never be read as success: a future ACP
    // version could add one that means "I gave up".
    expect(() => parsePromptResponse({ stopReason: 'i_gave_up' })).toThrow(/unsupported stopReason/);
    expect(() => parsePromptResponse({})).toThrow(/without a stopReason/);
    expect(() => parsePromptResponse(null)).toThrow(/not an object/);
    expect(() => parsePromptResponse({ stopReason: 42 })).toThrow(/without a stopReason/);
  });

  it('maps only end_turn to success', () => {
    expect(outcomeForStopReason('end_turn').kind).toBe('completed');
    expect(outcomeForStopReason('cancelled').kind).toBe('cancelled');
    for (const reason of ['refusal', 'max_tokens', 'max_turn_requests'] as const) {
      expect(outcomeForStopReason(reason).kind).toBe('failed');
    }
  });

  it.each([
    ['refusal', 'WORKER_REFUSED'],
    ['max-tokens', 'WORKER_OUTPUT_TRUNCATED'],
  ] as const)('does not present %s as success', async (behaviour, code) => {
    const { handle } = start(behaviour);
    const result = await handle.done;
    expect(terminals(result.events)).toEqual(['failed']);
    expect(failureOf(result.events)?.code).toBe(code);
  });

  it('treats an unknown stop reason as a protocol failure', async () => {
    const { handle } = start('unknown-stop-reason');
    const result = await handle.done;
    expect(terminals(result.events)).toEqual(['failed']);
    expect(failureOf(result.events)?.message).toContain('unsupported stopReason');
  });

  it('emits exactly one terminal event on success', async () => {
    const { handle } = start('success');
    const result = await handle.done;
    expect(terminals(result.events)).toEqual(['completed']);
  });

  it('emits exactly one terminal event when the agent answers twice', async () => {
    const { handle } = start('duplicate-terminal');
    const result = await handle.done;
    // The second response is a duplicate id; the run still yields one terminal.
    expect(terminals(result.events)).toHaveLength(1);
  });

  it('records a tool call as evidence but a message only as an artifact', async () => {
    const { handle } = start('tool-call-success');
    const result = await handle.done;
    const evidence = result.events.filter(e => (e as { type: string }).type === 'evidence');
    expect(evidence.length).toBeGreaterThan(0);

    const plain = await start('success').handle.done;
    // A chat message is talk, not evidence, so it must not be able to satisfy
    // Core's requirement for deterministic passing evidence.
    const plainEvidence = plain.events.filter(e => (e as { type: string }).type === 'evidence');
    expect(plainEvidence).toHaveLength(0);
    expect(typesOf(plain.events)).toContain('artifact');
  });
});

describe('session ownership', () => {
  it('rejects a session update naming a session this run does not own', async () => {
    const { handle } = start('foreign-session');
    const result = await handle.done;
    const violations = result.events.filter(
      e => (e as { type: string; evidence?: { kind: string } }).evidence?.kind === 'security',
    ) as Array<{ evidence: { summary: string } }>;
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.evidence.summary).toContain('does not own');
  });

  it('rejects a session update after the turn ended', async () => {
    const { handle } = start('update-after-terminal');
    const result = await handle.done;
    const violations = result.events.filter(
      e => (e as { evidence?: { kind: string } }).evidence?.kind === 'security',
    ) as Array<{ evidence: { summary: string } }>;
    expect(violations.some(v => v.evidence.summary.includes('after the turn ended'))).toBe(true);
    // Still exactly one terminal event.
    expect(terminals(result.events)).toHaveLength(1);
  });
});

describe('cancellation at every stage', () => {
  it('cancels before initialize', async () => {
    const { handle } = start('hangs');
    await handle.cancel();
    const result = await handle.done;
    expect(terminals(result.events)).toEqual(['failed']);
    expect(failureOf(result.events)?.code).toBe('WORKER_CANCELLED');
  });

  it('cancels during session/prompt', async () => {
    const { handle, agent, workspace } = start('hangs');
    await waitForMilestone(agent, workspace, 'session-created');
    await handle.cancel();
    const result = await handle.done;
    expect(terminals(result.events)).toHaveLength(1);
    expect(failureOf(result.events)?.code).toBe('WORKER_CANCELLED');
  });

  it('cancels an agent that ignores the cooperative signal', async () => {
    const { handle, agent, workspace } = start('ignores-cancel');
    await waitForMilestone(agent, workspace, 'session-created');
    await handle.cancel();
    const result = await handle.done;
    // Cooperative first, SIGKILL to the group second; the run still ends.
    expect(terminals(result.events)).toHaveLength(1);
  });

  it('is idempotent and adds no second terminal after one already exists', async () => {
    const { handle } = start('success');
    const result = await handle.done;
    expect(terminals(result.events)).toEqual(['completed']);

    // Cancelling a finished run must not turn a success into a cancellation.
    await handle.cancel();
    await handle.cancel();
    expect(terminals(result.events)).toEqual(['completed']);
  });

  it('does not mark a normal successful shutdown as cancelled', async () => {
    const { handle } = start('success');
    const result = await handle.done;
    expect(failureOf(result.events)).toBeUndefined();
    expect(JSON.stringify(result.events)).not.toContain('cancelled');
  });
});

describe('per-run token containment', () => {
  it('keeps a token out of a permission proposal the agent controls', async () => {
    const decisions: ToolProposal[] = [];
    const { handle } = start('leaks-token-permission', {
      onPermissionRequest: async proposal => {
        decisions.push(proposal);
        return { allowed: false, reason: `refused ${proposal.title}` };
      },
    });
    await waitUntil(() => decisions.length > 0, 'the agent to request permission');
    await handle.cancel();
    const result = await handle.done;

    const redactor = createRedactor([TOKEN]);
    expect(decisions).toHaveLength(1);
    // The agent put its token in both the title and an option name.
    expect(redactor.leaks(decisions)).toBe(false);
    expect(decisions[0]?.title).toContain('[redacted');
    expect(redactor.leaks(result.events)).toBe(false);
  });

  it('keeps a token out of a failure message built from stderr, and out of evidence', async () => {
    const { handle, workspace } = start('leaks-token-stderr');
    const result = await handle.done;

    const redactor = createRedactor([TOKEN]);
    expect(redactor.leaks(result.events)).toBe(false);
    expect(JSON.stringify(result.events)).not.toContain(TOKEN);

    // Non-vacuous: the agent really did write the token where it could.
    const leaked = path.join(workspace, 'src', 'leaked.js');
    expect(readFileSync(leaked, 'utf8')).toContain(TOKEN);
  });

  it('ends the run and redacts when a token arrives on an invalid ACP line', async () => {
    const { handle } = start('leaks-token-stdout');
    const result = await handle.done;

    // stdout pollution is a protocol failure, not something to tolerate.
    expect(failureOf(result.events)?.code).toBe('WORKER_PROTOCOL_ERROR');
    expect(JSON.stringify(result.events)).not.toContain(TOKEN);
    // The message names the problem without quoting the offending line.
    expect(failureOf(result.events)?.message).toContain('not valid JSON');
  });
});

describe('redactor', () => {
  it('replaces every occurrence in strings, arrays, objects and keys', () => {
    const redactor = createRedactor([TOKEN]);
    const value = {
      [`key-${TOKEN}`]: `value ${TOKEN}`,
      nested: [{ deep: `${TOKEN}${TOKEN}` }],
    };
    const cleaned = redactor.value(value);
    expect(redactor.leaks(cleaned)).toBe(false);
    expect(JSON.stringify(cleaned)).not.toContain(TOKEN);
  });

  it('ignores secrets too short to match safely', () => {
    // Redacting a 3-character string would corrupt unrelated output.
    const redactor = createRedactor(['abc']);
    expect(redactor.text('abcdef')).toBe('abcdef');
    expect(redactor.leaks('abcdef')).toBe(false);
  });

  it('redacts a percent-encoded form of the secret', () => {
    const secret = 'tok/with+special=chars-1234567890';
    const redactor = createRedactor([secret]);
    expect(redactor.text(encodeURIComponent(secret))).not.toContain(encodeURIComponent(secret));
  });

  it('reports no leak when there are no secrets registered', () => {
    expect(createRedactor().leaks('anything at all')).toBe(false);
  });
});
