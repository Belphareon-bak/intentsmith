import { afterEach } from 'vitest';

import { DeterministicIdGenerator, FakeClock, FakeTimer, type TestRuntime } from '@intentsmith/testing';
// The contract suite imports vitest, so it is reached by its own subpath and
// never through the package's production entry point.
import {
  runWorkerAdapterContract,
  type WorkerContractHarness,
  type WorkerContractScenario,
} from '@intentsmith/testing/worker-contract';
import { IntentSmithCore } from '@intentsmith/core';
import { openIntentSmithDatabase } from '@intentsmith/persistence';

import { ScenarioSelectingOpenCodeWorker, createTaskInputForScenario } from './contract-harness.js';

/**
 * The shared WorkerAdapter contract suite, run against OpenCodeWorker with a
 * real fake-ACP child process.
 *
 * Same suite as FakeWorker uses -- not a copy. If the two adapters ever
 * disagree about the contract, one of them fails here.
 */

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const harness: WorkerContractHarness = {
  name: 'OpenCodeWorker (fake ACP process)',
  advancePastTimeout: (runtime: TestRuntime) => runtime.timer.advance(5000),
  taskInputFor: (scenario: WorkerContractScenario, projectId: string, rootPath: string) => {
    const scenarios: Record<WorkerContractScenario, 'success' | 'failure' | 'timeout' | 'pauseable-success' | 'invalid-event' | 'event-after-terminal' | 'two-terminal-events' | 'claim-without-evidence' | 'throwing'> = {
      'deterministic-success': 'success',
      'worker-failure': 'failure',
      timeout: 'timeout',
      cancellation: 'pauseable-success',
      'pause-resume': 'pauseable-success',
      'invalid-event': 'invalid-event',
      'event-after-terminal': 'event-after-terminal',
      'two-terminal-events': 'two-terminal-events',
      'claim-without-evidence': 'claim-without-evidence',
      'worker-exception': 'throwing',
    };
    return createTaskInputForScenario(projectId, rootPath, scenarios[scenario]);
  },
  createRuntime: (): TestRuntime => {
    const store = openIntentSmithDatabase(':memory:');
    const worker = new ScenarioSelectingOpenCodeWorker({ track: cleanup => cleanups.push(cleanup) });
    const clock = new FakeClock();
    const timer = new FakeTimer();
    const ids = new DeterministicIdGenerator();
    const core = new IntentSmithCore({
      clock,
      ids,
      timer,
      projects: store,
      tasks: store,
      audit: store,
      transactions: store,
      worker,
    });
    return {
      core,
      store,
      worker: worker as unknown as TestRuntime['worker'],
      clock,
      timer,
      ids,
      cleanup: () => store.close(),
    };
  },
};

runWorkerAdapterContract(harness);
