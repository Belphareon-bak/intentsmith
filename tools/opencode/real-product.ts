import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { AuditEvent, Task, TaskResult } from '@intentsmith/contracts';
import { FakeTimer, createTaskInput } from '@intentsmith/testing';
import type { GrantAudit } from '@intentsmith/worker-sdk';

import type { ServerRuntime } from '../../apps/server/src/app.js';
import { buildServer } from '../../apps/server/src/app.js';
import { createRuntime } from '../../apps/server/src/runtime.js';
import { startGateway, type GatewayHandle } from '../../apps/server/src/gateway/lifecycle.js';
import type { ApprovalDesk, PendingApprovalView } from '../../apps/server/src/opencode/approval-desk.js';
import { OPENCODE_ENV, WORKER_SELECTION_ENV } from '../../apps/server/src/opencode/config.js';

/**
 * Product-level real-binary harness for Phase 3 run 2C.
 *
 * Everything here is reached the way an operator reaches it: the composition
 * root selects the worker from `INTENTSMITH_WORKER`, `buildServer` serves the
 * real HTTP surface on loopback, the gateway is the real one, the worker is the
 * pinned real `opencode-ai@1.18.8` binary, and inference is real local Ollama on
 * this machine's GPU. Nothing in this file substitutes a fixture for any of
 * them; a harness that faked one would prove the opposite of what 2C exists to
 * establish.
 *
 * The one thing that is *not* real is the wall clock for the product's own
 * run timeout, and only in the scenario that is about that timeout: the injected
 * `FakeTimer` drives IntentSmith's own timeout mechanism rather than replacing
 * it, so the path under test is the product's, bounded instead of waited out.
 *
 * Sanitization is structural. Nothing here reads a prompt, a model response, an
 * ACP wire message, a gateway token or a GPU UUID, so no evidence written from
 * it can contain one.
 */

export const PINNED_VERSION = '1.18.8';

/** Opt-in switch. The suite is invisible to `pnpm test` and `pnpm verify`. */
export const OPT_IN = process.env.INTENTSMITH_RUN_REAL_OPENCODE === '1';

/** Operator-installed binary. IntentSmith never installs or upgrades OpenCode. */
export const BIN = process.env.INTENTSMITH_OPENCODE_BIN;

/** Local model. Never silently substituted: an absent one is a blocker. */
export const MODEL = process.env.INTENTSMITH_OPENCODE_TEST_MODEL ?? 'qwen3:14b';

export const LOOPBACK = '127.0.0.1';

export type Cleanups = Array<() => void | Promise<void>>;

export function requireBinary(): string {
  if (!BIN) {
    throw new Error(
      `BLOCKED: set INTENTSMITH_OPENCODE_BIN to the installed opencode-ai@${PINNED_VERSION} executable.`,
    );
  }
  return BIN;
}

export async function command(
  executable: string,
  args: string[],
  timeoutMs = 10_000,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise(resolve => {
    execFile(executable, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        code:
          typeof (error as { code?: unknown } | null)?.code === 'number'
            ? (error as { code: number }).code
            : error
              ? null
              : 0,
        stdout: String(stdout),
        stderr: String(stderr),
      });
    });
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms).unref?.();
  });
}

export async function poll<T>(
  label: string,
  attempt: () => Promise<T | undefined> | T | undefined,
  { timeoutMs = 120_000, intervalMs = 250 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await attempt();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await sleep(intervalMs);
  }
}

/* ----------------------------------------------------------------- preflight */

export type Preflight = {
  binary: string;
  binaryVersion: string;
  ollamaVersion: string;
  model: string;
  gpu: string;
  driverVersion: string;
};

/**
 * Refuses to run unless every real dependency 2C claims is actually present.
 *
 * Each failure is a BLOCKED report naming the exact missing thing. Nothing here
 * installs, pulls or substitutes: a missing model must not become a different
 * model, and an absent GPU must not become a CPU run reported as a GPU one.
 */
export async function assertPreflight(): Promise<Preflight> {
  const binary = requireBinary();

  const version = await command(binary, ['--version']);
  const reported = `${version.stdout}\n${version.stderr}`.trim();
  if (version.code !== 0 || !new RegExp(`\\b${PINNED_VERSION.replaceAll('.', '\\.')}\\b`).test(reported)) {
    throw new Error(
      `BLOCKED: expected opencode-ai@${PINNED_VERSION}, but "${binary} --version" reported ${JSON.stringify(reported)}.`,
    );
  }

  const ollama = await command('ollama', ['--version']);
  if (ollama.code !== 0) throw new Error('BLOCKED: the local Ollama CLI is unavailable.');
  const ollamaVersion = ollama.stdout.trim();

  const models = await command('ollama', ['list']);
  if (models.code !== 0) throw new Error('BLOCKED: the local Ollama daemon did not answer "ollama list".');
  if (!models.stdout.split('\n').some(line => line.trim().startsWith(MODEL))) {
    throw new Error(`BLOCKED: local model "${MODEL}" is not installed. IntentSmith never pulls a model for you.`);
  }

  const gpu = await command('nvidia-smi', ['--query-gpu=name,driver_version', '--format=csv,noheader']);
  if (gpu.code !== 0) throw new Error('BLOCKED: nvidia-smi reported no visible NVIDIA GPU.');
  const [gpuName = '', driverVersion = ''] = gpu.stdout.split('\n')[0]?.split(/\s*,\s*/) ?? [];

  return {
    binary,
    binaryVersion: reported,
    ollamaVersion,
    model: MODEL,
    gpu: gpuName.trim(),
    driverVersion: driverVersion.trim(),
  };
}

/* ------------------------------------------------------------------ process */

/** Process group of a supervised pid, resolved before anything is terminated. */
export function processGroupOf(pid: number): number | undefined {
  try {
    const raw = execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { timeout: 5_000 }).toString().trim();
    const pgid = Number(raw);
    return Number.isInteger(pgid) && pgid > 0 ? pgid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Live members of one process group.
 *
 * Scoped to a pgid this run created, never a name pattern: a broad match could
 * report — or in a careless variant, kill — a process that has nothing to do
 * with the test.
 */
export function processGroupMembers(pgid: number): number[] {
  try {
    return execFileSync('pgrep', ['-g', String(pgid)], { timeout: 5_000 })
      .toString()
      .split('\n')
      .map(line => Number(line.trim()))
      .filter(pid => Number.isInteger(pid) && pid > 0);
  } catch {
    // `pgrep` exits non-zero when the group has no members, which is the answer.
    return [];
  }
}

/** Polls until the group is empty, and reports what was still there if not. */
export async function awaitProcessGroupExit(pgid: number, timeoutMs = 15_000): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const members = processGroupMembers(pgid);
    if (members.length === 0) return [];
    if (Date.now() > deadline) return members;
    await sleep(200);
  }
}

/* ----------------------------------------------------------------- gpu view */

/**
 * One sanitized GPU/inference placement sample.
 *
 * `ollama ps` reports which model is resident and whether it is on the GPU;
 * `nvidia-smi` reports the device and the compute processes on it. No UUID is
 * queried, and no prompt, response or environment value is reachable from here.
 */
export type GpuSample = {
  at: string;
  gpuName?: string;
  /** `name | size | processor | context` rows from `ollama ps`. */
  residentModels: string[];
  /** `pid | process_name | used_memory` rows for Ollama compute processes. */
  computeProcesses: string[];
};

function run(executable: string, args: string[]): string | undefined {
  try {
    return execFileSync(executable, args, { timeout: 8_000 }).toString();
  } catch {
    return undefined;
  }
}

export function sampleGpu(): GpuSample {
  const at = new Date().toISOString();
  const gpuName = run('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'])?.split('\n')[0]?.trim();

  const psOutput = run('ollama', ['ps']) ?? '';
  const residentModels = psOutput
    .split('\n')
    .slice(1)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => line.split(/\s{2,}/).join(' | '));

  const computeProcesses = (run('nvidia-smi', ['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader']) ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => /ollama/i.test(line))
    .map(line => line.split(/\s*,\s*/).join(' | '));

  return { at, ...(gpuName ? { gpuName } : {}), residentModels, computeProcesses };
}

/** True when a sample shows the model resident with GPU placement. */
export function sampleShowsGpu(sample: GpuSample, model: string): boolean {
  return sample.residentModels.some(row => row.startsWith(model) && /\d+%\s*GPU/i.test(row));
}

/**
 * Samples GPU placement while the model is actually executing.
 *
 * Evidence taken only before or after a turn proves nothing: Ollama unloads,
 * and an empty `ollama ps` afterwards is indistinguishable from a CPU run.
 */
export function startGpuSampler(intervalMs = 1_000): { stop(): GpuSample[] } {
  const samples: GpuSample[] = [];
  const timer = setInterval(() => {
    const sample = sampleGpu();
    if (sample.residentModels.length > 0 || sample.computeProcesses.length > 0) samples.push(sample);
  }, intervalMs);
  timer.unref?.();
  return {
    stop: () => {
      clearInterval(timer);
      return samples;
    },
  };
}

/* ------------------------------------------------------------------ fixture */

export type Fixture = { root: string; target: string; gatesPath: string; baseCommit: string };

/**
 * A disposable Git repository with a deterministic initial commit.
 *
 * The gate is behavioural rather than textual: it requires the module to export
 * `4`, so the model is judged on the effect of its edit and not on producing
 * one exact byte sequence.
 */
export function repository(cleanups: Cleanups, label: string): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), `intentsmith-2c-${label}-`));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));

  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: root, env, timeout: 20_000 }).toString();

  git('init', '--initial-branch=main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'IntentSmith Real Binary Test');
  mkdirSync(path.join(root, 'src'));
  const target = path.join(root, 'src', 'answer.js');
  writeFileSync(target, 'module.exports = 3;\n');
  writeFileSync(
    path.join(root, 'check.cjs'),
    [
      `const answer = require('./src/answer.js');`,
      `if (answer !== 4) { console.error('expected 4, got ' + answer); process.exit(1); }`,
      `console.log('gate passed');`,
    ].join('\n'),
  );
  git('add', '.');
  git('commit', '-m', 'fixture base');
  const baseCommit = git('rev-parse', 'HEAD').trim();

  // Gate configuration lives outside the repository: a gate file inside it would
  // show up as a change the worker made.
  const configRoot = mkdtempSync(path.join(tmpdir(), `intentsmith-2c-cfg-${label}-`));
  cleanups.push(() => rmSync(configRoot, { recursive: true, force: true }));
  const gatesPath = path.join(configRoot, 'gates.json');
  writeFileSync(
    gatesPath,
    JSON.stringify([
      {
        id: 'answer',
        description: 'src/answer.js exports 4',
        executable: process.execPath,
        args: [path.join(root, 'check.cjs')],
      },
    ]),
  );

  return { root, target, gatesPath, baseCommit };
}

/* ------------------------------------------------------------------ harness */

export type HarnessOptions = {
  label: string;
  /** Product-owned run timeout. Real by default; driven by `timer` when given. */
  timeoutMs?: number;
  timer?: FakeTimer;
};

export type HttpResponse<T> = { status: number; body: T };

export type RealProductHarness = {
  runtime: ServerRuntime;
  desk: ApprovalDesk;
  gateway: GatewayHandle;
  fixture: Fixture;
  baseUrl: string;
  /** Address the API listener actually bound to. Asserted to be loopback. */
  boundAddress: string;
  grantAudits: GrantAudit[];
  get(path: string): Promise<HttpResponse<unknown>>;
  post(path: string, body?: unknown): Promise<HttpResponse<unknown>>;
  createTask(goal: string): Promise<string>;
  startTask(taskId: string): Promise<void>;
  runIdFor(taskId: string): Promise<string>;
  task(taskId: string): Promise<Task>;
  result(taskId: string): Promise<HttpResponse<TaskResult>>;
  audit(taskId: string): Promise<AuditEvent[]>;
  pending(runId: string): Promise<PendingApprovalView[]>;
  awaitPending(runId: string, timeoutMs?: number): Promise<PendingApprovalView>;
  decide(runId: string, approvalId: string, verdict: 'approve' | 'deny'): Promise<HttpResponse<unknown>>;
  awaitTerminal(taskId: string, timeoutMs?: number): Promise<Task>;
  /** The persisted `worker.process_start` pid: the evidence anchor for 2C. */
  awaitWorkerPid(taskId: string, timeoutMs?: number): Promise<number>;
  gitStatus(): string;
  targetContent(): string;
};

const terminalTaskStatuses = new Set(['passed', 'failed', 'cancelled']);

export async function realProductHarness(
  cleanups: Cleanups,
  options: HarnessOptions,
): Promise<RealProductHarness> {
  const executable = requireBinary();
  const fixture = repository(cleanups, options.label);
  const timeoutMs = options.timeoutMs ?? 240_000;

  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    [WORKER_SELECTION_ENV]: 'opencode',
    [OPENCODE_ENV.executable]: executable,
    [OPENCODE_ENV.args]: '[]',
    [OPENCODE_ENV.version]: `opencode-ai/${PINNED_VERSION}`,
    [OPENCODE_ENV.workspaceRoot]: fixture.root,
    [OPENCODE_ENV.model]: MODEL,
    [OPENCODE_ENV.gates]: fixture.gatesPath,
  };

  const grantAudits: GrantAudit[] = [];
  const runtime = createRuntime({
    env,
    dbPath: ':memory:',
    ...(options.timer ? { timer: options.timer } : {}),
    opencode: {
      // The bubblewrap sandbox is not what 2C is proving, and an unavailable
      // one would change the failure being measured rather than the one under
      // test. The attestation is still recorded and still travels with the run.
      preferSandbox: false,
      limits: {
        startupMs: 60_000,
        idleMs: 180_000,
        overallMs: 280_000,
        terminationGraceMs: 2_000,
      },
      onGrantAudit: audit => grantAudits.push(audit),
    },
  });
  cleanups.push(() => runtime.close());

  const server = buildServer(runtime);
  // Loopback only. 2D adds authenticated remote access; 2C must not widen this.
  await server.listen({ host: LOOPBACK, port: 0 });
  cleanups.push(async () => {
    await server.close();
  });
  const address = server.server.address();
  if (typeof address !== 'object' || address === null) throw new Error('The API server did not bind a port.');
  const baseUrl = `http://${LOOPBACK}:${address.port}`;

  const gateway = await startGateway({ runtime, tokens: runtime.gatewayTokens });
  cleanups.push(() => gateway.close());
  runtime.bindWorkerGateway?.(gateway.url);

  const request = async <T>(method: string, url: string, body?: unknown): Promise<HttpResponse<T>> => {
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as T };
  };

  const projectResponse = await request<{ id: string }>('POST', '/projects', {
    name: `real-2c-${options.label}`,
    rootPath: fixture.root,
  });
  if (projectResponse.status !== 200) throw new Error(`Project creation failed: ${JSON.stringify(projectResponse)}`);
  const projectId = projectResponse.body.id;

  const self: RealProductHarness = {
    runtime,
    desk: runtime.approvals as ApprovalDesk,
    gateway,
    fixture,
    baseUrl,
    boundAddress: address.address,
    grantAudits,
    get: async url => await request('GET', url),
    post: async (url, body) => await request('POST', url, body),

    createTask: async goal => {
      const input = createTaskInput(projectId, fixture.root, {
        goal,
        timeoutMs,
        expectedOutputs: ['src/answer.js exports 4'],
        acceptanceCriteria: ['The fixture gate passes'],
        scope: { ...createTaskInput(projectId, fixture.root).scope, timeoutMs },
      });
      // `workerScenario` only means something to the fake worker.
      const { workerScenario: _ignored, ...body } = input;
      const created = await request<{ id: string }>('POST', '/tasks', body);
      if (created.status !== 200) throw new Error(`Task creation failed: ${JSON.stringify(created)}`);
      return created.body.id;
    },

    startTask: async taskId => {
      const started = await request('POST', `/tasks/${taskId}/start`);
      if (started.status !== 200) throw new Error(`Task start failed: ${JSON.stringify(started)}`);
    },

    task: async taskId => (await request<Task>('GET', `/tasks/${taskId}`)).body,

    runIdFor: async taskId =>
      await poll('the task to have a run', async () => (await self.task(taskId)).latestRunId, {
        timeoutMs: 30_000,
      }),

    result: async taskId => await request<TaskResult>('GET', `/tasks/${taskId}/result`),

    audit: async taskId => (await request<{ events: AuditEvent[] }>('GET', `/tasks/${taskId}/audit`)).body.events,

    pending: async runId =>
      (await request<{ approvals: PendingApprovalView[] }>('GET', `/runs/${runId}/approvals`)).body.approvals,

    awaitPending: async (runId, waitMs = 240_000) =>
      await poll('a pending approval', async () => (await self.pending(runId))[0], { timeoutMs: waitMs }),

    decide: async (runId, approvalId, verdict) =>
      await request('POST', `/runs/${runId}/approvals/${approvalId}/${verdict}`),

    awaitTerminal: async (taskId, waitMs = 300_000) =>
      await poll(
        'the task to reach a terminal state',
        async () => {
          const task = await self.task(taskId);
          return terminalTaskStatuses.has(task.status) ? task : undefined;
        },
        { timeoutMs: waitMs, intervalMs: 500 },
      ),

    awaitWorkerPid: async (taskId, waitMs = 90_000) =>
      await poll(
        'the persisted worker.process_start pid',
        async () => {
          const event = (await self.audit(taskId)).find(entry => entry.type === 'worker.process_start');
          const pid = (event?.data as { pid?: unknown } | undefined)?.pid;
          return typeof pid === 'number' ? pid : undefined;
        },
        { timeoutMs: waitMs },
      ),

    gitStatus: () =>
      execFileSync('git', ['status', '--porcelain'], { cwd: fixture.root, timeout: 20_000 }).toString().trim(),

    targetContent: () => readFileSync(fixture.target, 'utf8'),
  };

  return self;
}

/* ----------------------------------------------------------------- evidence */

export type ScenarioRecord = Record<string, unknown> & { scenario: string; outcome: string };

/**
 * Appends one scenario record to the sanitized evidence log.
 *
 * Each test file runs in its own fork, so the log is a file rather than module
 * state. Only named, structured fields are written: nothing in this module can
 * reach a prompt, a model response, an ACP payload, a gateway token or a GPU
 * UUID, so there is no path by which one could land in the artifact built from
 * this log.
 */
export function recordScenario(record: ScenarioRecord): void {
  const target = process.env.INTENTSMITH_2C_EVIDENCE;
  if (!target) return;
  mkdirSync(path.dirname(target), { recursive: true });
  appendFileSync(target, `${JSON.stringify(record)}\n`);
}
