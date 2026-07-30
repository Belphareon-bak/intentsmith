#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  buildGate0ExecutionPlan,
  environmentForExecution,
  GATE0_EVIDENCE_MANIFEST_TYPE,
  GATE0_EVIDENCE_SCHEMA_VERSION,
  gate0EvidenceLayout,
  sha256,
} from './gate0-evidence-contract.js';
import {
  runLogged,
  runWithOwnedProcessTerminationHandling,
} from './nightly-orchestrator.js';

const root = process.cwd();

export async function main(argv = process.argv.slice(2)) {
  let completedProvenancePath = null;
  try {
    return await runWithOwnedProcessTerminationHandling(async () => {
    if (argv.length > 0) {
      throw new Error(
        'Gate 0 candidate evidence uses a locked plan and accepts no arguments',
      );
    }
    const sourceRoot = await canonicalRepositoryRoot(root);
    const candidateSha = git(['rev-parse', 'HEAD'], sourceRoot);
    const initialState = sourceState(sourceRoot);
    if (initialState.statusPorcelain !== '') {
      throw new Error(
        `Gate 0 candidate evidence requires a clean worktree:\n`
        + initialState.statusPorcelain,
      );
    }
    const initialIgnoredState = assertPristineIgnoredState(
      git(
        [
          'status',
          '--porcelain=v1',
          '--ignored=matching',
          '--untracked-files=all',
        ],
        sourceRoot,
      ),
    );

    const registry = JSON.parse(
      await readText(path.join(sourceRoot, 'tests', 'registry.json')),
    );
    const registrySha256 = sha256(JSON.stringify(registry));
    const layout = gate0EvidenceLayout(candidateSha);
    const evidenceRoot = path.join(sourceRoot, layout.evidenceRoot);
    await createFreshEvidenceBoundary(sourceRoot, evidenceRoot);

    const plan = buildGate0ExecutionPlan({
      root: sourceRoot,
      candidateSha,
    });
    const startedAt = new Date().toISOString();
    await prepareExecutionDirectories(sourceRoot, plan);
    const toolchain = await captureToolchain(
      sourceRoot,
      environmentForExecution(plan[2]),
    );

    const executions = [];
    for (const recipe of plan) {
      console.log(`Gate 0 phase: ${recipe.id}`);
      const preSourceState = sourceState(sourceRoot);
      assertCandidateSourceState(preSourceState, candidateSha, `${recipe.id} pre-state`);
      const preIgnoredState = await ignoredState(
        sourceRoot,
        layout.evidenceRoot,
        recipe,
      );
      const phaseStartedAt = new Date().toISOString();
      const result = await runLogged(
        [recipe.executable, ...recipe.argv],
        {
          cwd: recipe.cwd,
          env: environmentForExecution(recipe),
          logPath: path.join(sourceRoot, recipe.logPath),
          allowFailure: true,
          timeoutMs: recipe.timeoutMs,
        },
      );
      const phaseEndedAt = new Date().toISOString();
      const postSourceState = sourceState(sourceRoot);
      assertCandidateSourceState(postSourceState, candidateSha, `${recipe.id} post-state`);
      const postIgnoredState = await ignoredState(
        sourceRoot,
        layout.evidenceRoot,
        recipe,
      );
      const logMetadata = await stat(path.join(sourceRoot, recipe.logPath));
      const logContents = await readFile(path.join(sourceRoot, recipe.logPath));
      const reportBinding = await artifactBinding(
        sourceRoot,
        recipe.reportPath,
        `${recipe.id} report`,
      );
      const inventoryBinding = await artifactBinding(
        sourceRoot,
        recipe.inventoryPath,
        `${recipe.id} inventory`,
      );
      executions.push({
        ...recipe,
        startedAt: phaseStartedAt,
        endedAt: phaseEndedAt,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        leakDetected: result.leakDetected,
        cleanupTerminated: result.cleanupTerminated,
        preSourceState,
        postSourceState,
        preIgnoredState,
        postIgnoredState,
        logBytes: logMetadata.size,
        logSha256: sha256(logContents),
        reportBytes: reportBinding.bytes,
        reportSha256: reportBinding.sha256,
        inventoryBytes: inventoryBinding.bytes,
        inventorySha256: inventoryBinding.sha256,
      });
      console.log(`Gate 0 phase result: ${recipe.id} exit ${result.exitCode}`);
    }

    const provenance = {
      schemaVersion: GATE0_EVIDENCE_SCHEMA_VERSION,
      manifestType: GATE0_EVIDENCE_MANIFEST_TYPE,
      candidateSha,
      registrySha256,
      sourceRoot,
      evidenceRoot: layout.evidenceRoot,
      startedAt,
      endedAt: new Date().toISOString(),
      secretValuesRecorded: false,
      initialIgnoredState,
      toolchain,
      executions,
    };
    completedProvenancePath = path.join(sourceRoot, layout.provenance);
    await writePrivateJsonAtomic(completedProvenancePath, provenance);

    const successful = executions.every(execution => (
      execution.id === 'soak-guard'
        ? execution.exitCode === 2
        : execution.exitCode === 0
    ));
    console.log(`Gate 0 provenance: ${layout.provenance}`);
    console.log(`Gate 0 candidate: ${candidateSha}`);
    console.log(`Gate 0 runner result: ${successful ? 'COMPLETE' : 'RED'}`);
    return successful ? 0 : 1;
    });
  } catch (error) {
    if (completedProvenancePath !== null) {
      try {
        await unlink(completedProvenancePath);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          console.error(
            `Unable to invalidate interrupted Gate 0 provenance: ${cleanupError.message}`,
          );
        }
      }
    }
    console.error(error.stack || error.message);
    return 2;
  }
}

async function canonicalRepositoryRoot(requestedRoot) {
  const discovered = git(['rev-parse', '--show-toplevel'], requestedRoot);
  const [requestedReal, discoveredReal] = await Promise.all([
    realpath(requestedRoot),
    realpath(discovered),
  ]);
  if (requestedReal !== discoveredReal) {
    throw new Error(
      'Gate 0 candidate evidence must run from the canonical Git worktree root',
    );
  }
  return discoveredReal;
}

function sourceState(sourceRoot) {
  return {
    sha: git(['rev-parse', 'HEAD'], sourceRoot),
    statusPorcelain: git(
      ['status', '--porcelain=v1', '--untracked-files=all'],
      sourceRoot,
    ),
  };
}

function assertCandidateSourceState(state, candidateSha, label) {
  if (state.sha !== candidateSha || state.statusPorcelain !== '') {
    throw new Error(
      `${label} changed the candidate source tree or HEAD`,
    );
  }
}

export function assertPristineIgnoredState(statusPorcelain) {
  if (typeof statusPorcelain !== 'string' || statusPorcelain !== '') {
    throw new Error(
      'Gate 0 candidate evidence requires a fresh clone without '
      + 'pre-existing ignored dependency, build, runtime, or evidence paths',
    );
  }
  return { clean: true };
}

export function assertAllowedIgnoredState(statusPorcelain, evidenceRoot) {
  if (
    typeof statusPorcelain !== 'string'
    || typeof evidenceRoot !== 'string'
    || evidenceRoot === ''
  ) {
    throw new Error('Gate 0 ignored-state evidence is malformed');
  }
  const paths = statusPorcelain
    .split('\n')
    .filter(Boolean)
    .map(line => line.startsWith('!! ') ? line.slice(3) : null);
  const allowed = paths.every(filePath => (
    filePath !== null
    && (
      filePath === '.intentsmith-artifacts/'
      || filePath === evidenceRoot
      || filePath.startsWith(`${evidenceRoot}/`)
      || filePath === 'node_modules/'
      || filePath.startsWith('node_modules/')
      || filePath === 'c3-ide/node_modules/'
      || filePath.startsWith('c3-ide/node_modules/')
      || /^c3-ide\/(?:applications|extensions)\/[^/]+\/node_modules\//.test(filePath)
      || /^c3-ide\/applications\/electron\/(?:lib|src-gen|dist)\//.test(filePath)
      || /^c3-ide\/applications\/electron\/gen-webpack[^/]*\.js$/.test(filePath)
    )
  ));
  if (!allowed) {
    throw new Error(
      'Gate 0 phase created an ignored path outside the locked '
      + 'dependency/build/evidence allowlist',
    );
  }
  return {
    policy: 'gate0-ignored-path-boundary-v1',
    observedAllowedCount: paths.length,
    unexpectedPathCount: 0,
  };
}

export async function assertOwnedArtifactRoot(sourceRoot, evidenceRoot) {
  const artifactRoot = path.join(sourceRoot, '.intentsmith-artifacts');
  const gateRoot = path.join(artifactRoot, 'gate0');
  const candidateRoot = path.join(sourceRoot, evidenceRoot);
  const artifactEntries = await readdir(artifactRoot);
  const gateEntries = await readdir(gateRoot);
  if (
    artifactEntries.length !== 1
    || artifactEntries[0] !== 'gate0'
    || gateEntries.length !== 1
    || path.join(gateRoot, gateEntries[0]) !== candidateRoot
  ) {
    throw new Error(
      'Gate 0 artifact root contains an unowned sibling path',
    );
  }
  for (const directory of [artifactRoot, gateRoot, candidateRoot]) {
    const metadata = await lstat(directory);
    if (
      metadata.isSymbolicLink()
      || !metadata.isDirectory()
      || (metadata.mode & 0o777) !== 0o700
      || await realpath(directory) !== directory
    ) {
      throw new Error('Gate 0 artifact root is not a canonical owned directory');
    }
  }
}

async function ignoredState(sourceRoot, evidenceRoot, recipe) {
  const state = assertAllowedIgnoredState(
    git(
      [
        'status',
        '--porcelain=v1',
        '--ignored=matching',
        '--untracked-files=all',
      ],
      sourceRoot,
    ),
    evidenceRoot,
  );
  await assertOwnedArtifactRoot(sourceRoot, evidenceRoot);
  await assertOwnedExecutionBoundary(sourceRoot, evidenceRoot, recipe);
  await assertOwnedDependencyRoots(sourceRoot);
  return state;
}

export async function assertOwnedExecutionBoundary(
  sourceRoot,
  evidenceRoot,
  recipe,
) {
  const candidateRoot = path.join(sourceRoot, evidenceRoot);
  const fileTargets = new Set([
    'GIT_CONFIG_GLOBAL',
    'C3_DB_PATH',
    'C3_PORT_FILE',
  ]);
  for (const [key, value] of Object.entries(recipe.environmentOverrides)) {
    if (!path.isAbsolute(value)) continue;
    if (['INTENTSMITH_PDF_PYTHON', 'C3_PDF_PYTHON'].includes(key)) continue;
    if (fileTargets.has(key)) {
      await assertPrivateDirectoryPath(
        candidateRoot,
        path.dirname(value),
        `${key} parent`,
      );
      await assertPrivateFileIfPresent(candidateRoot, value, key);
    } else {
      await assertPrivateDirectoryPath(candidateRoot, value, key);
    }
  }
  for (const relativePath of [
    recipe.logPath,
    recipe.reportPath,
    recipe.inventoryPath,
  ].filter(Boolean)) {
    const absolutePath = path.join(sourceRoot, relativePath);
    await assertPrivateDirectoryPath(
      candidateRoot,
      path.dirname(absolutePath),
      `${recipe.id} output parent`,
      { allowMissingTail: true },
    );
    await assertPrivateFileIfPresent(
      candidateRoot,
      absolutePath,
      `${recipe.id} output`,
    );
  }
}

export async function assertOwnedDependencyRoots(sourceRoot) {
  const directoryCandidates = [
    'node_modules',
    'c3-ide/node_modules',
    'c3-ide/applications/electron/lib',
    'c3-ide/applications/electron/src-gen',
    'c3-ide/applications/electron/dist',
  ];
  for (const collection of ['c3-ide/applications', 'c3-ide/extensions']) {
    const absoluteCollection = path.join(sourceRoot, collection);
    let entries;
    try {
      entries = await readdir(absoluteCollection, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        directoryCandidates.push(`${collection}/${entry.name}/node_modules`);
      }
    }
  }
  for (const relativePath of directoryCandidates) {
    await assertOwnedOptionalDirectory(
      sourceRoot,
      path.join(sourceRoot, relativePath),
      relativePath,
    );
  }
  const electronRoot = path.join(
    sourceRoot,
    'c3-ide',
    'applications',
    'electron',
  );
  let electronEntries;
  try {
    electronEntries = await readdir(electronRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of electronEntries) {
    if (!/^gen-webpack[^/]*\.js$/.test(entry.name)) continue;
    const absolutePath = path.join(electronRoot, entry.name);
    const metadata = await lstat(absolutePath);
    if (
      metadata.isSymbolicLink()
      || !metadata.isFile()
      || (metadata.mode & 0o022) !== 0
      || await realpath(absolutePath) !== absolutePath
    ) {
      throw new Error(`Gate 0 generated root is not owned: ${entry.name}`);
    }
  }
}

async function assertPrivateDirectoryPath(
  boundaryRoot,
  targetDirectory,
  label,
  { allowMissingTail = false } = {},
) {
  if (!isPathAtOrInside(boundaryRoot, targetDirectory)) {
    throw new Error(`${label} escapes the owned Gate 0 evidence root`);
  }
  const relative = path.relative(boundaryRoot, targetDirectory);
  let cursor = boundaryRoot;
  for (const component of relative === '' ? [] : relative.split(path.sep)) {
    cursor = path.join(cursor, component);
    let metadata;
    try {
      metadata = await lstat(cursor);
    } catch (error) {
      if (error.code === 'ENOENT' && allowMissingTail) return;
      throw new Error(`${label} is missing from the owned evidence root`);
    }
    if (
      metadata.isSymbolicLink()
      || !metadata.isDirectory()
      || (metadata.mode & 0o002) !== 0
      || await realpath(cursor) !== cursor
    ) {
      throw new Error(`${label} contains a non-private or non-canonical directory`);
    }
    if ((metadata.mode & 0o777) !== 0o700) {
      await chmod(cursor, 0o700);
      const normalized = await lstat(cursor);
      if ((normalized.mode & 0o777) !== 0o700) {
        throw new Error(`${label} could not be normalized to private mode 0700`);
      }
    }
  }
}

async function assertPrivateFileIfPresent(boundaryRoot, targetFile, label) {
  if (!isPathAtOrInside(boundaryRoot, targetFile)) {
    throw new Error(`${label} escapes the owned Gate 0 evidence root`);
  }
  let metadata;
  try {
    metadata = await lstat(targetFile);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (
    metadata.isSymbolicLink()
    || !metadata.isFile()
    || (metadata.mode & 0o777) !== 0o600
    || await realpath(targetFile) !== targetFile
  ) {
    throw new Error(`${label} is not a private canonical file`);
  }
}

async function assertOwnedOptionalDirectory(sourceRoot, directory, label) {
  let metadata;
  try {
    metadata = await lstat(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (
    metadata.isSymbolicLink()
    || !metadata.isDirectory()
    || (metadata.mode & 0o002) !== 0
    || await realpath(directory) !== directory
    || !isPathAtOrInside(sourceRoot, directory)
  ) {
    throw new Error(`Gate 0 dependency/build root is not owned: ${label}`);
  }
  if ((metadata.mode & 0o777) !== 0o700) {
    await chmod(directory, 0o700);
    const normalized = await lstat(directory);
    if ((normalized.mode & 0o777) !== 0o700) {
      throw new Error(
        `Gate 0 dependency/build root could not be made private: ${label}`,
      );
    }
  }
}

async function createFreshEvidenceBoundary(sourceRoot, evidenceRoot) {
  try {
    await lstat(evidenceRoot);
    throw new Error(
      `Refusing to reuse an existing Gate 0 evidence root: ${evidenceRoot}`,
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const relative = path.relative(sourceRoot, evidenceRoot);
  if (
    relative === ''
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error('Gate 0 evidence root must be below the repository root');
  }
  let cursor = sourceRoot;
  for (const component of relative.split(path.sep)) {
    cursor = path.join(cursor, component);
    try {
      const metadata = await lstat(cursor);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error(`Unsafe Gate 0 evidence path component: ${cursor}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(cursor, { mode: 0o700 });
    }
    await chmod(cursor, 0o700);
    const resolved = await realpath(cursor);
    if (!isPathAtOrInside(sourceRoot, resolved)) {
      throw new Error(`Gate 0 evidence path escapes the repository: ${cursor}`);
    }
  }
}

async function prepareExecutionDirectories(sourceRoot, plan) {
  const directories = new Set();
  for (const recipe of plan) {
    directories.add(path.dirname(path.join(sourceRoot, recipe.logPath)));
    for (const [key, value] of Object.entries(recipe.environmentOverrides)) {
      if (!path.isAbsolute(value)) continue;
      if (['GIT_CONFIG_GLOBAL', 'C3_DB_PATH', 'C3_PORT_FILE'].includes(key)) {
        directories.add(path.dirname(value));
      } else if (!['INTENTSMITH_PDF_PYTHON', 'C3_PDF_PYTHON'].includes(key)) {
        directories.add(value);
      }
    }
  }
  for (const directory of directories) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
  }
  const gitConfig = plan[0].environmentOverrides.GIT_CONFIG_GLOBAL;
  await writeFile(gitConfig, '', {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
}

async function writePrivateJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600, flag: 'wx' },
  );
  await rename(temporaryPath, filePath);
  await chmod(filePath, 0o600);
}

async function artifactBinding(sourceRoot, relativePath, label) {
  if (relativePath === null) return { bytes: null, sha256: null };
  const absolutePath = path.join(sourceRoot, relativePath);
  let metadata;
  try {
    metadata = await stat(absolutePath);
  } catch (error) {
    throw new Error(`${label} is missing after its producer exited: ${error.message}`);
  }
  if (!metadata.isFile()) throw new Error(`${label} is not a regular file`);
  return {
    bytes: metadata.size,
    sha256: sha256(await readFile(absolutePath)),
  };
}

async function readText(filePath) {
  return readFile(filePath, 'utf8');
}

export async function captureToolchain(sourceRoot, environment) {
  const version = (command, args, cwd = sourceRoot) => execFileSync(command, args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  }).trim().split('\n')[0];
  const nodeIdentity = JSON.parse(version('node', [
    '-e',
    'process.stdout.write(JSON.stringify({'
      + 'execPath:process.execPath,'
      + 'version:process.version,'
      + 'platform:process.platform,'
      + 'architecture:process.arch'
      + '}))',
  ]));
  if (
    typeof nodeIdentity.execPath !== 'string'
    || !path.isAbsolute(nodeIdentity.execPath)
    || typeof nodeIdentity.version !== 'string'
    || typeof nodeIdentity.platform !== 'string'
    || typeof nodeIdentity.architecture !== 'string'
  ) {
    throw new Error('unable to capture the planned Node executable identity');
  }
  const packageManagerVersion = async (relativePath, expectedName) => {
    const manifest = JSON.parse(
      await readFile(path.join(sourceRoot, relativePath), 'utf8'),
    );
    const match = new RegExp(
      `^${expectedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@(.+)$`,
    ).exec(manifest.packageManager || '');
    if (!match) {
      throw new Error(
        `${relativePath} must declare packageManager=${expectedName}@<version>`,
      );
    }
    return match[1];
  };
  return {
    schemaVersion: 1,
    platform: nodeIdentity.platform,
    architecture: nodeIdentity.architecture,
    nodeVersion: nodeIdentity.version,
    nodeExecutableSha256: sha256(await readFile(nodeIdentity.execPath)),
    // Do not execute Corepack/npm/yarn before install-clean: doing so could
    // bootstrap the isolated cache and mutate the state being measured.
    // The install logs independently prove the effective versions.
    npmVersion: await packageManagerVersion('package.json', 'npm'),
    yarnVersion: await packageManagerVersion('c3-ide/package.json', 'yarn'),
    pythonVersion: version(
      'python3.12',
      ['-c', 'import platform; print(platform.python_version())'],
    ),
    gitVersion: version('git', ['--version']),
    bashVersion: version('bash', ['--version']),
    pathSha256: sha256(environment.PATH || ''),
  };
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function isPathAtOrInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === ''
    || (
      relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    );
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exitCode = await main();
}
