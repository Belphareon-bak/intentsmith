import { resolve } from 'node:path';

import { fingerprint, managedRunPaths } from './safety.js';
import type { ModelProfile, ScenarioDefinition } from './types.js';

export type DryRunPlan = {
  mode: 'dry-run';
  createsWorktree: false;
  startsExternalTools: false;
  modifiesDatabase: false;
  executesScenarios: false;
  exactSourceRevision: string;
  paths: ReturnType<typeof managedRunPaths>;
  environmentIsolation: {
    HOME: string;
    XDG_CONFIG_HOME: string;
    XDG_DATA_HOME: string;
    XDG_CACHE_HOME: string;
    XDG_STATE_HOME: string;
    inheritedCredentials: false;
  };
  scenarios: Array<ScenarioDefinition & { commandDisplay: string }>;
  expectedVersions: {
    worker: string;
    model: string;
    gpu: string;
  };
  blockerPolicy: string;
  artifactDestinations: string[];
  fingerprints: {
    scenarioManifest: string;
    modelProfile: string;
    options: string;
  };
};

export function buildDryRunPlan(options: {
  sourceCommit: string;
  runsRoot: string;
  runId: string;
  scenarios: ScenarioDefinition[];
  profile: ModelProfile;
  runnerOptions: unknown;
}): DryRunPlan {
  const paths = managedRunPaths(resolve(options.runsRoot), options.runId);
  return {
    mode: 'dry-run',
    createsWorktree: false,
    startsExternalTools: false,
    modifiesDatabase: false,
    executesScenarios: false,
    exactSourceRevision: options.sourceCommit,
    paths,
    environmentIsolation: {
      HOME: paths.isolatedHome,
      XDG_CONFIG_HOME: paths.xdg.config,
      XDG_DATA_HOME: paths.xdg.data,
      XDG_CACHE_HOME: paths.xdg.cache,
      XDG_STATE_HOME: paths.xdg.state,
      inheritedCredentials: false,
    },
    scenarios: options.scenarios.map(scenario => ({
      ...scenario,
      commandDisplay: scenario.command.map(part => JSON.stringify(part)).join(' '),
    })),
    expectedVersions: {
      worker: `opencode-ai@${options.profile.opencodeVersion}`,
      model: `${options.profile.provider}/${options.profile.model}`,
      gpu: options.profile.gpu,
    },
    blockerPolicy:
      'BLOCKED is only a missing precondition. TIMEOUT, non-zero exit, crash, leak, redaction failure and invariant failure are FAIL.',
    artifactDestinations: [paths.checkpoint, paths.artifact, paths.markdown],
    fingerprints: {
      scenarioManifest: fingerprint(options.scenarios),
      modelProfile: fingerprint(options.profile),
      options: fingerprint(options.runnerOptions),
    },
  };
}
