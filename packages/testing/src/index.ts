/**
 * Production entry point for `@intentsmith/testing`.
 *
 * `apps/server` depends on this package for the Phase 1 fake worker runtime
 * (an explicitly documented boundary exception), so nothing reachable from
 * here may import a test framework. The reusable contract suites live in
 * `./worker-contract.js` and `./provider-contract.js` and are imported
 * directly by test files.
 */
export {
  DeterministicIdGenerator,
  DisposableWorkspace,
  FakeClock,
  FakeTimer,
  createCapabilityEnvelope,
  createTaskInput,
  createTestRuntime,
  type TestRuntime,
} from './fakes.js';
export { FAKE_WORKER_VERSION, FakeWorker, FakeWorkerHandle } from './fake-worker.js';
export {
  DEFAULT_FAKE_MODEL,
  FakeInferenceProvider,
  type FakeProviderMode,
  type FakeProviderOptions,
} from './fake-provider.js';
