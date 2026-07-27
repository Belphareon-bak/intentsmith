import { FakeInferenceProvider } from './fake-provider.js';
import {
  fakeProviderContractHarness,
  runInferenceProviderContract,
  runProviderStreamViolationChecks,
} from './provider-contract.js';

runInferenceProviderContract(fakeProviderContractHarness);

runProviderStreamViolationChecks(
  'FakeInferenceProvider',
  mode => new FakeInferenceProvider({ mode }),
  fakeProviderContractHarness.knownModelId,
);
