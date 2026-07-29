import { open, access, mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { readCheckpoint } from './checkpoint.js';
import { buildDryRunPlan } from './dry-run.js';
import { LOCAL_GPU_SMOKE_MANIFEST } from './manifest.js';
import { executeOwnedCommand, type CommandResult } from './process.js';
import { probeLocalGpuProfile, RTX_3090_QWEN3_PROFILE } from './profile.js';
import { compareBaseline, writeReports } from './report.js';
import { buildLeakCheck, scanRedaction, snapshotResources } from './resources.js';
import { fingerprint, managedRunPaths, ValidationSafetyError } from './safety.js';
import { runScenarioManifest, type ScenarioExecutor } from './runner.js';
import type { RunArtifact, RunCheckpoint, RunFingerprints } from './types.js';
import {
  assertCleanSource,
  createManagedWorkspace,
  destroyManagedWorkspace,
  resolveSourceCommit,
} from './workspace.js';

const RUNNER_VERSION = '0.1.0';

type CliOptions = {
  execute: boolean;
  resume: boolean;
  sourceRoot: string;
  runsRoot: string;
  runId: string;
  revision: string;
  opencodeBin?: string;
};

function defaultRunId(): string {
  return `lv-${new Date().toISOString().replaceAll(/[-:.TZ]/g, '').slice(0, 14)}-${process.pid}`;
}

function parseArguments(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (part === '--') continue;
    if (!part?.startsWith('--')) throw new ValidationSafetyError('CLI_ARGUMENT_INVALID', `Unexpected argument ${part}.`);
    if (part === '--execute' || part === '--resume' || part === '--dry-run') {
      flags.add(part);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new ValidationSafetyError('CLI_ARGUMENT_INVALID', `${part} requires a value.`);
    }
    values.set(part, value);
    index += 1;
  }
  const sourceRoot = resolve(values.get('--source') ?? process.cwd());
  return {
    execute: flags.has('--execute'),
    resume: flags.has('--resume'),
    sourceRoot,
    runsRoot: resolve(values.get('--runs-root') ?? resolve(sourceRoot, '.intentsmith', 'local-validation')),
    runId: values.get('--run-id') ?? defaultRunId(),
    revision: values.get('--revision') ?? 'HEAD',
    opencodeBin: values.get('--opencode-bin') ?? process.env.INTENTSMITH_OPENCODE_BIN,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadBaseline(path: string): Promise<RunArtifact | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as RunArtifact;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  await assertCleanSource(options.sourceRoot);
  const sourceCommit = await resolveSourceCommit(options.sourceRoot, options.revision);
  const paths = managedRunPaths(options.runsRoot, options.runId);
  const fingerprints: RunFingerprints = {
    sourceCommit,
    runnerVersion: RUNNER_VERSION,
    scenarioManifest: fingerprint(LOCAL_GPU_SMOKE_MANIFEST),
    modelProfile: fingerprint(RTX_3090_QWEN3_PROFILE),
    options: fingerprint({ mode: 'bounded-real-smoke', concurrency: 1 }),
  };
  const plan = buildDryRunPlan({
    sourceCommit,
    runsRoot: options.runsRoot,
    runId: options.runId,
    scenarios: LOCAL_GPU_SMOKE_MANIFEST,
    profile: RTX_3090_QWEN3_PROFILE,
    runnerOptions: { mode: 'bounded-real-smoke', concurrency: 1 },
  });

  if (!options.execute) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  if (process.env.INTENTSMITH_RUN_LOCAL_VALIDATION !== '1') {
    throw new ValidationSafetyError(
      'EXECUTION_NOT_OPTED_IN',
      'Execution requires both --execute and INTENTSMITH_RUN_LOCAL_VALIDATION=1.',
    );
  }

  await mkdir(options.runsRoot, { recursive: true, mode: 0o700 });
  const lock = await open(paths.lock, 'wx', 0o600).catch((error: NodeJS.ErrnoException) => {
    throw new ValidationSafetyError('RUNNER_LOCKED', `Another runner owns ${paths.lock}: ${error.message}`);
  });
  try {
    let resume: RunCheckpoint | undefined;
    if (options.resume) {
      resume = await readCheckpoint(paths.checkpoint, fingerprints, { runId: options.runId });
    } else if (await pathExists(paths.runRoot)) {
      throw new ValidationSafetyError('RUN_ALREADY_EXISTS', `Refusing to rewrite historical run ${options.runId}.`);
    }

    const probe = await probeLocalGpuProfile(RTX_3090_QWEN3_PROFILE, { opencodeBin: options.opencodeBin });
    const secrets = Object.entries(process.env)
      .filter(([name, value]) => value && /TOKEN|SECRET|PASSWORD|API.?KEY|COOKIE/i.test(name))
      .map(([, value]) => value as string);
    const execute: ScenarioExecutor = async (scenario, attempt) => {
      const before = await snapshotResources(paths.runRoot);
      const workspace = await createManagedWorkspace({
        sourceRoot: options.sourceRoot,
        sourceCommit,
        runsRoot: options.runsRoot,
        runId: options.runId,
      });
      const logRoot = resolve(paths.runRoot, 'logs', `${scenario.id}-attempt-${attempt}`);
      const evidencePath = resolve(paths.runRoot, 'artifacts', `${scenario.id}-attempt-${attempt}.jsonl`);
      let commandResult: CommandResult | undefined;
      try {
        const install = await executeOwnedCommand({
          command: ['corepack', 'pnpm', 'install', '--offline', '--frozen-lockfile'],
          cwd: workspace.root,
          env: workspace.environment,
          timeoutMs: 300_000,
          stdoutPath: resolve(logRoot, 'install.stdout.log'),
          stderrPath: resolve(logRoot, 'install.stderr.log'),
          sessionId: workspace.sessionId,
          secrets,
        });
        commandResult =
          install.exitCode === 0 && !install.timedOut
            ? await executeOwnedCommand({
                command: scenario.command,
                cwd: workspace.root,
                env: {
                  ...workspace.environment,
                  INTENTSMITH_RUN_REAL_OPENCODE: '1',
                  INTENTSMITH_OPENCODE_BIN: probe.observed.opencodePath ?? '',
                  INTENTSMITH_OPENCODE_TEST_MODEL: RTX_3090_QWEN3_PROFILE.model,
                  INTENTSMITH_2C_EVIDENCE: evidencePath,
                },
                timeoutMs: scenario.timeoutMs,
                stdoutPath: resolve(logRoot, 'scenario.stdout.log'),
                stderrPath: resolve(logRoot, 'scenario.stderr.log'),
                sessionId: workspace.sessionId,
                secrets,
              })
            : install;
      } finally {
        await destroyManagedWorkspace(workspace, options.runsRoot);
      }
      if (!commandResult) throw new Error('Scenario command did not produce a result.');
      const logPaths = [
        resolve(logRoot, 'install.stdout.log'),
        resolve(logRoot, 'install.stderr.log'),
        resolve(logRoot, 'scenario.stdout.log'),
        resolve(logRoot, 'scenario.stderr.log'),
      ].filter(path => commandResult !== undefined || path.includes('install'));
      const existingPaths: string[] = [];
      for (const path of [...logPaths, evidencePath]) {
        if (await pathExists(path)) existingPaths.push(path);
      }
      const redaction = await scanRedaction(existingPaths, secrets);
      const after = await snapshotResources(paths.runRoot);
      const leakCheck = buildLeakCheck({
        before,
        after,
        processGroupMembers: commandResult.processGroupMembersAfterCleanup,
        isolatedEnvironmentPaths: (await pathExists(paths.isolatedHome)) ? [paths.isolatedHome] : [],
        operatorCredentialLeaks: redaction.findings,
      });
      return {
        command: commandResult,
        behavioralObservations: (await pathExists(evidencePath))
          ? (await readFile(evidencePath, 'utf8'))
              .split('\n')
              .filter(Boolean)
              .map(line => JSON.parse(line) as unknown)
          : [],
        runtimeVersions: {
          node: process.version,
          runner: RUNNER_VERSION,
          opencode: probe.observed.opencode,
          ollama: probe.observed.ollama,
          model: RTX_3090_QWEN3_PROFILE.model,
          gpu: probe.observed.gpu,
          driver: probe.observed.driver,
        },
        artifactPaths: (await pathExists(evidencePath)) ? [evidencePath] : [],
        logPaths: existingPaths,
        leakCheck,
        redaction,
      };
    };

    const checkpoint = await runScenarioManifest({
      runId: options.runId,
      fingerprints,
      scenarios: LOCAL_GPU_SMOKE_MANIFEST,
      checkpointPath: paths.checkpoint,
      resume,
      checkPreconditions: async () => probe.reason,
      execute,
    });
    const baselinePath = resolve(options.sourceRoot, 'artifacts', 'local-validation-baseline.json');
    const baseline = await loadBaseline(baselinePath);
    const artifact: RunArtifact = {
      ...checkpoint,
      completedAt: new Date().toISOString(),
      baselinePath,
      baselineDifferences: baseline
        ? compareBaseline(baseline, { fingerprints: checkpoint.fingerprints, scenarios: checkpoint.scenarios })
        : [],
    };
    await writeReports(paths.artifact, paths.markdown, artifact);
    process.stdout.write(`${JSON.stringify({ artifact: paths.artifact, markdown: paths.markdown }, null, 2)}\n`);
  } finally {
    await lock.close();
    await rm(paths.lock, { force: true });
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
