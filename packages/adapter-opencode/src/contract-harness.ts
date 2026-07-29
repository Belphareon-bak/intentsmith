import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { CreateTaskInput } from '@intentsmith/contracts';
import type {
  WorkerAdapter,
  WorkerDescriptor,
  WorkerExecutionContext,
  WorkerHandle,
} from '@intentsmith/worker-sdk';

import { OpenCodeWorker } from './adapter.js';
import { createFakeAgent, type FakeAgent, type FakeAgentBehaviour } from './fixtures.js';

/**
 * Binds the shared WorkerAdapter contract suite to OpenCodeWorker.
 *
 * The suite is not copied or forked. It builds a runtime before it knows which
 * scenario a test wants, so this adapter selects the fake ACP agent from the
 * task's declared scenario at `start()` time. That selection is test-only
 * wiring and lives here rather than in the production adapter.
 */

/** Maps a task's declared scenario onto a fake agent behaviour. */
const BEHAVIOUR_FOR_SCENARIO: Record<string, FakeAgentBehaviour> = {
  // Core needs a passing deterministic evidence item plus a claim to reach
  // `passed`; a tool-call result is the honest source of that.
  success: 'tool-call-success',
  failure: 'refusal',
  timeout: 'hangs',
  'pauseable-success': 'hangs',
  'invalid-event': 'protocol-garbage',
  'event-after-terminal': 'update-after-terminal',
  'two-terminal-events': 'duplicate-terminal',
  'claim-without-evidence': 'success',
  'failing-evidence': 'refusal',
  throwing: 'crashes',
};

export type ScenarioSelectingWorkerOptions = {
  /** Collects temp dirs so a test can clean them up. */
  track: (cleanup: () => void) => void;
};

/**
 * A WorkerAdapter that picks its fake agent from the task under test.
 *
 * Production `OpenCodeWorker` is used unchanged underneath; only the choice of
 * executable arguments differs per scenario.
 */
export class ScenarioSelectingOpenCodeWorker implements WorkerAdapter {
  private readonly agents = new Map<FakeAgentBehaviour, FakeAgent>();
  private lastDescriptor: WorkerDescriptor | undefined;

  constructor(private readonly options: ScenarioSelectingWorkerOptions) {}

  describe(): WorkerDescriptor {
    return (
      this.lastDescriptor ?? {
        id: 'opencode',
        version: 'fake-opencode/0.0.0',
        // ACP has no pause primitive; the suite gates on this.
        capabilities: { pause: false, cancel: true },
      }
    );
  }

  start(context: WorkerExecutionContext): WorkerHandle {
    const scenario = context.task.workerPreference.scenario;
    const behaviour = BEHAVIOUR_FOR_SCENARIO[scenario] ?? 'success';

    let agent = this.agents.get(behaviour);
    if (!agent) {
      agent = createFakeAgent({ behaviour });
      this.agents.set(behaviour, agent);
      this.options.track(() => agent?.cleanup());
    }

    // `throwing` maps onto a real spawn failure rather than a crashing script,
    // so the missing-executable path is exercised end to end.
    const executable = scenario === 'throwing' ? path.join(tmpdir(), 'intentsmith-absent-opencode') : process.execPath;
    const args = scenario === 'throwing' ? [] : [agent.scriptPath];

    const worker = new OpenCodeWorker({
      executable,
      args,
      expectedVersion: 'fake-opencode/0.0.0',
      preferSandbox: false,
      limits: { startupMs: 3_000, idleMs: 3_000, overallMs: 10_000, terminationGraceMs: 200 },
    });

    const workspace = mkdtempSync(path.join(tmpdir(), 'intentsmith-contract-ws-'));
    this.options.track(() => rmSync(workspace, { recursive: true, force: true }));

    const handle = worker.start({
      ...context,
      workspaceRoot: workspace,
      inference: { baseUrl: 'http://127.0.0.1:65500', token: 'contract-suite-token-0123456789', modelId: 'fixture' },
    });

    void handle.done.then(() => {
      this.lastDescriptor = worker.describe();
    });
    return handle;
  }
}

export function createTaskInputForScenario(
  projectId: string,
  rootPath: string,
  scenario: CreateTaskInput['workerScenario'],
): CreateTaskInput {
  return {
    projectId,
    type: 'code',
    goal: 'contract suite goal',
    scope: {
      fsReadRoots: [rootPath],
      fsWriteRoots: [rootPath],
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
    expectedOutputs: ['a contract outcome'],
    acceptanceCriteria: ['contract satisfied'],
    ...(scenario === undefined ? {} : { workerScenario: scenario }),
    timeoutMs: 1000,
  };
}
