import { createHash } from 'node:crypto';
import {
  lstat,
  realpath,
  readFile,
} from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const GATE0_EVIDENCE_SCHEMA_VERSION = 1;
export const GATE0_EVIDENCE_MANIFEST_TYPE =
  'intentsmith.gate0-candidate-evidence';
export const GATE0_OFFLINE_COUNT = 191;
export const GATE0_DATABASE_COUNT = 36;
export const GATE0_DETERMINISTIC_COUNT =
  GATE0_OFFLINE_COUNT + GATE0_DATABASE_COUNT;
export const GATE0_PILOT_SUITE_ID =
  'IS-T2-TESTS-PILOT-C1C2C3-TEST';
export const GATE0_MODEL_SOAK_IDS = Object.freeze([
  'IS-T5-TESTS-SOAK-ATTACHMENT-HEAVY-TEST',
  'IS-T5-TESTS-SOAK-BREAK-PATTERN-PROBE-TEST',
  'IS-T5-TESTS-SOAK-FOLLOWUP-LOAD-TEST',
  'IS-T5-TESTS-SOAK-MIXED-SESSION-SIMULATION-TEST',
  'IS-T5-TESTS-SOAK-SHORT-INPUT-STRESS-TEST',
]);

const SAFE_INHERITED_ENVIRONMENT_KEYS = Object.freeze([
  'PATH',
  'SYSTEMROOT',
  'WINDIR',
  'PATHEXT',
  'COMSPEC',
]);
const INSTALL_TIMEOUT_MS = 30 * 60 * 1000;
const DETERMINISTIC_TIMEOUT_MS = (8 * 60 * 60 * 1000) + (5 * 60 * 1000);
const PILOT_TIMEOUT_MS = 65 * 60 * 1000;
const SOAK_GUARD_TIMEOUT_MS = 65 * 60 * 1000;
const TOOLCHAIN_KEYS = Object.freeze([
  'schemaVersion',
  'platform',
  'architecture',
  'nodeVersion',
  'nodeExecutableSha256',
  'npmVersion',
  'yarnVersion',
  'pythonVersion',
  'gitVersion',
  'bashVersion',
  'pathSha256',
]);

export function gate0EvidenceLayout(candidateSha) {
  assertCandidateSha(candidateSha);
  const evidenceRoot =
    `.intentsmith-artifacts/gate0/candidate-${candidateSha}`;
  const deterministicRunId = `deterministic-${candidateSha}`;
  const soakRunId = `soak-guard-${candidateSha}`;
  const pilotRuns = Array.from({ length: 5 }, (_, index) => {
    const runId = `pilot-${String(index + 1).padStart(2, '0')}-${candidateSha}`;
    return {
      runId,
      report: `${evidenceRoot}/pilot/${runId}/report.json`,
      inventory: `${evidenceRoot}/pilot/${runId}/inventory.json`,
    };
  });
  return {
    evidenceRoot,
    provenance: `${evidenceRoot}/provenance.json`,
    installRoot: `${evidenceRoot}/install-root`,
    installLogs: {
      clean: `${evidenceRoot}/logs/install-clean.log`,
      repeat: `${evidenceRoot}/logs/install-repeat.log`,
    },
    deterministic: {
      runId: deterministicRunId,
      report: `${evidenceRoot}/deterministic/${deterministicRunId}/report.json`,
      inventory: `${evidenceRoot}/deterministic/${deterministicRunId}/inventory.json`,
    },
    pilots: pilotRuns,
    soak: {
      runId: soakRunId,
      report: `${evidenceRoot}/soak/${soakRunId}/report.json`,
      inventory: `${evidenceRoot}/soak/${soakRunId}/inventory.json`,
    },
  };
}

export function buildGate0ExecutionPlan({
  root,
  candidateSha,
}) {
  assertAbsoluteRoot(root);
  const layout = gate0EvidenceLayout(candidateSha);
  const installRoot = path.join(root, layout.installRoot);
  const pdfPython = path.join(
    installRoot,
    'xdg-data',
    'intentsmith',
    'python',
    'pdf',
    'bin',
    'python',
  );
  const overrides = {
    HOME: path.join(installRoot, 'home'),
    XDG_CONFIG_HOME: path.join(installRoot, 'xdg-config'),
    XDG_CACHE_HOME: path.join(installRoot, 'xdg-cache'),
    XDG_DATA_HOME: path.join(installRoot, 'xdg-data'),
    XDG_STATE_HOME: path.join(installRoot, 'xdg-state'),
    TMPDIR: path.join(installRoot, 'tmp'),
    TMP: path.join(installRoot, 'tmp'),
    TEMP: path.join(installRoot, 'tmp'),
    GIT_CONFIG_GLOBAL: path.join(installRoot, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    npm_config_cache: path.join(installRoot, 'npm-cache'),
    YARN_CACHE_FOLDER: path.join(installRoot, 'yarn-cache'),
    PIP_CACHE_DIR: path.join(installRoot, 'pip-cache'),
    COREPACK_HOME: path.join(installRoot, 'corepack'),
    C3_DB_PATH: path.join(installRoot, 'runtime', 'install.sqlite'),
    C3_PROJECTS_DIR: path.join(installRoot, 'runtime', 'projects'),
    C3_PORT_FILE: path.join(installRoot, 'runtime', 'intentsmith.port'),
    C3_LIFECYCLE_AUTO_COMMIT: 'false',
    C3_ENABLE_AUTONOMY: 'false',
    C3_LOG_LEVEL: 'warn',
    NODE_ENV: 'test',
    CI: '1',
    NO_COLOR: '1',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TZ: 'UTC',
    PYTHONNOUSERSITE: '1',
  };
  const auditOverrides = {
    ...overrides,
    INTENTSMITH_PDF_PYTHON: pdfPython,
    C3_PDF_PYTHON: pdfPython,
  };
  // Keep the plan host-independent. The runner and the rendered replay both
  // materialize this fixed allowlist, using an empty value when the host does
  // not define a key.
  const inheritedEnvironmentKeys = [...SAFE_INHERITED_ENVIRONMENT_KEYS];
  const common = {
    cwd: root,
    inheritedEnvironmentKeys,
  };
  const execution = ({
    id,
    executable,
    argv,
    environmentOverrides,
    logPath,
    reportPath = null,
    inventoryPath = null,
    timeoutMs,
  }) => ({
    id,
    ...common,
    executable,
    argv,
    environmentOverrides,
    logPath,
    reportPath,
    inventoryPath,
    timeoutMs,
  });
  const auditArgv = ({
    selector,
    runId,
    outDir,
    timeoutMinutes,
    deadlineHours,
  }) => [
    'scripts/nightly-audit.js',
    selector,
    `--run-id=${runId}`,
    `--out-dir=${outDir}`,
    `--timeout-minutes=${timeoutMinutes}`,
    `--deadline-hours=${deadlineHours}`,
    '--concurrency=1',
  ];
  return [
    execution({
      id: 'install-clean',
      executable: './scripts/install.sh',
      argv: ['--minimal'],
      environmentOverrides: overrides,
      logPath: layout.installLogs.clean,
      timeoutMs: INSTALL_TIMEOUT_MS,
    }),
    execution({
      id: 'install-repeat',
      executable: './scripts/install.sh',
      argv: ['--minimal'],
      environmentOverrides: overrides,
      logPath: layout.installLogs.repeat,
      timeoutMs: INSTALL_TIMEOUT_MS,
    }),
    execution({
      id: 'deterministic',
      executable: 'node',
      argv: auditArgv({
        selector: '--profile=offline,database',
        runId: layout.deterministic.runId,
        outDir: `${layout.evidenceRoot}/deterministic`,
        timeoutMinutes: 10,
        deadlineHours: 8,
      }),
      environmentOverrides: auditOverrides,
      logPath: `${layout.evidenceRoot}/logs/deterministic.log`,
      reportPath: layout.deterministic.report,
      inventoryPath: layout.deterministic.inventory,
      timeoutMs: DETERMINISTIC_TIMEOUT_MS,
    }),
    ...layout.pilots.map((pilot, index) => execution({
      id: `pilot-${String(index + 1).padStart(2, '0')}`,
      executable: 'node',
      argv: auditArgv({
        selector: `--suite=${GATE0_PILOT_SUITE_ID}`,
        runId: pilot.runId,
        outDir: `${layout.evidenceRoot}/pilot`,
        timeoutMinutes: 5,
        deadlineHours: 1,
      }),
      environmentOverrides: auditOverrides,
      logPath:
        `${layout.evidenceRoot}/logs/pilot-${String(index + 1).padStart(2, '0')}.log`,
      reportPath: pilot.report,
      inventoryPath: pilot.inventory,
      timeoutMs: PILOT_TIMEOUT_MS,
    })),
    execution({
      id: 'soak-guard',
      executable: 'node',
      argv: auditArgv({
        selector: `--suite=${GATE0_MODEL_SOAK_IDS.join(',')}`,
        runId: layout.soak.runId,
        outDir: `${layout.evidenceRoot}/soak`,
        timeoutMinutes: 60,
        deadlineHours: 1,
      }),
      environmentOverrides: auditOverrides,
      logPath: `${layout.evidenceRoot}/logs/soak-guard.log`,
      reportPath: layout.soak.report,
      inventoryPath: layout.soak.inventory,
      timeoutMs: SOAK_GUARD_TIMEOUT_MS,
    }),
  ];
}

export function makePortableInvocation(execution, root) {
  assertAbsoluteRoot(root);
  if (execution?.cwd !== root) {
    throw new Error('execution cwd does not equal the canonical repository root');
  }
  return {
    cwd: '$PWD',
    executable: execution.executable,
    argv: execution.argv.map(value => portableValue(value, root)),
    inheritedEnvironmentKeys: [...execution.inheritedEnvironmentKeys],
    environmentOverrides: Object.fromEntries(
      Object.entries(execution.environmentOverrides)
        .map(([key, value]) => [key, portableValue(value, root)]),
    ),
  };
}

export function validateGate0Provenance({
  provenance,
  root,
  candidateSha,
  registrySha256,
  inheritedEnvironment = process.env,
}) {
  const errors = [];
  const expectedPlan = buildGate0ExecutionPlan({
    root,
    candidateSha,
    inheritedEnvironment,
  });
  if (!isPlainObject(provenance)) {
    return { valid: false, errors: ['provenance must be an object'], expectedPlan };
  }
  requireExactKeys(provenance, [
    'schemaVersion',
    'manifestType',
    'candidateSha',
    'registrySha256',
    'sourceRoot',
    'evidenceRoot',
    'startedAt',
    'endedAt',
    'secretValuesRecorded',
    'initialIgnoredState',
    'toolchain',
    'executions',
  ], 'provenance', errors);
  if (provenance.schemaVersion !== GATE0_EVIDENCE_SCHEMA_VERSION) {
    errors.push(
      `provenance schemaVersion must equal ${GATE0_EVIDENCE_SCHEMA_VERSION}`,
    );
  }
  if (provenance.manifestType !== GATE0_EVIDENCE_MANIFEST_TYPE) {
    errors.push(`provenance manifestType must equal ${GATE0_EVIDENCE_MANIFEST_TYPE}`);
  }
  if (provenance.candidateSha !== candidateSha) {
    errors.push('provenance candidate SHA mismatch');
  }
  if (provenance.registrySha256 !== registrySha256) {
    errors.push(
      'provenance parsed-registry serialization fingerprint mismatch',
    );
  }
  if (provenance.sourceRoot !== root) {
    errors.push('provenance source root mismatch');
  }
  if (provenance.evidenceRoot !== gate0EvidenceLayout(candidateSha).evidenceRoot) {
    errors.push('provenance evidence root mismatch');
  }
  if (!validIsoTimestamp(provenance.startedAt) || !validIsoTimestamp(provenance.endedAt)) {
    errors.push('provenance timestamps must be ISO-8601 strings');
  } else if (Date.parse(provenance.startedAt) > Date.parse(provenance.endedAt)) {
    errors.push('provenance timestamps are reversed');
  }
  if (provenance.secretValuesRecorded !== false) {
    errors.push('provenance must declare secretValuesRecorded=false');
  }
  if (!isDeepStrictEqual(provenance.initialIgnoredState, { clean: true })) {
    errors.push('provenance must prove an initially pristine ignored-file state');
  }
  if (!validGate0Toolchain(provenance.toolchain)) {
    errors.push('provenance toolchain identity is invalid');
  }
  if (!Array.isArray(provenance.executions)) {
    errors.push('provenance executions must be an array');
    return { valid: false, errors, expectedPlan };
  }
  if (provenance.executions.length !== expectedPlan.length) {
    errors.push(
      `provenance has ${provenance.executions.length} executions; `
      + `expected ${expectedPlan.length}`,
    );
  }
  const actualIds = new Set();
  let previousExecutionEnd = validIsoTimestamp(provenance.startedAt)
    ? Date.parse(provenance.startedAt)
    : null;
  const provenanceEnd = validIsoTimestamp(provenance.endedAt)
    ? Date.parse(provenance.endedAt)
    : null;
  for (const [index, expected] of expectedPlan.entries()) {
    const actual = provenance.executions[index];
    const label = `provenance execution ${index + 1} (${expected.id})`;
    if (!isPlainObject(actual)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    requireExactKeys(actual, [
      ...Object.keys(expected),
      'startedAt',
      'endedAt',
      'exitCode',
      'signal',
      'timedOut',
      'leakDetected',
      'cleanupTerminated',
      'preSourceState',
      'postSourceState',
      'preIgnoredState',
      'postIgnoredState',
      'logBytes',
      'logSha256',
      'reportBytes',
      'reportSha256',
      'inventoryBytes',
      'inventorySha256',
    ], label, errors);
    if (actualIds.has(actual.id)) errors.push(`${label} duplicates execution id`);
    actualIds.add(actual.id);
    for (const key of Object.keys(expected)) {
      if (!isDeepStrictEqual(actual[key], expected[key])) {
        errors.push(`${label} ${key} differs from the locked execution plan`);
      }
    }
    if (!validIsoTimestamp(actual.startedAt) || !validIsoTimestamp(actual.endedAt)) {
      errors.push(`${label} timestamps must be ISO-8601 strings`);
    } else {
      const executionStart = Date.parse(actual.startedAt);
      const executionEnd = Date.parse(actual.endedAt);
      if (
        executionStart > executionEnd
        || (previousExecutionEnd !== null && executionStart < previousExecutionEnd)
        || provenanceEnd !== null && executionEnd > provenanceEnd
      ) {
        errors.push(`${label} chronology differs from the locked serial plan`);
      }
      previousExecutionEnd = executionEnd;
    }
    if (!Number.isInteger(actual.exitCode) || actual.exitCode < 0) {
      errors.push(`${label} exitCode must be a non-negative integer`);
    }
    if (actual.signal !== null) errors.push(`${label} must not terminate by signal`);
    if (actual.timedOut !== false) errors.push(`${label} must not time out`);
    if (actual.leakDetected !== false || actual.cleanupTerminated !== true) {
      errors.push(`${label} process cleanup evidence is not clean`);
    }
    for (const stateKey of ['preSourceState', 'postSourceState']) {
      const state = actual[stateKey];
      if (
        !isPlainObject(state)
        || state.sha !== candidateSha
        || typeof state.statusPorcelain !== 'string'
      ) {
        errors.push(`${label} ${stateKey} is not bound to the candidate`);
      }
    }
    for (const stateKey of ['preIgnoredState', 'postIgnoredState']) {
      const state = actual[stateKey];
      if (isPlainObject(state)) {
        requireExactKeys(
          state,
          ['policy', 'observedAllowedCount', 'unexpectedPathCount'],
          `${label} ${stateKey}`,
          errors,
        );
      }
      if (
        !isPlainObject(state)
        || state.policy !== 'gate0-ignored-path-boundary-v1'
        || !Number.isInteger(state.observedAllowedCount)
        || state.observedAllowedCount < 1
        || state.unexpectedPathCount !== 0
      ) {
        errors.push(`${label} ${stateKey} violates the ignored-path boundary`);
      }
    }
    if (!Number.isInteger(actual.logBytes) || actual.logBytes < 1) {
      errors.push(`${label} logBytes must be a positive integer`);
    }
    if (!/^[a-f0-9]{64}$/.test(actual.logSha256 || '')) {
      errors.push(`${label} logSha256 must be a SHA-256 digest`);
    }
    for (const [pathKey, bytesKey, digestKey] of [
      ['reportPath', 'reportBytes', 'reportSha256'],
      ['inventoryPath', 'inventoryBytes', 'inventorySha256'],
    ]) {
      if (expected[pathKey] === null) {
        if (actual[bytesKey] !== null || actual[digestKey] !== null) {
          errors.push(`${label} ${bytesKey}/${digestKey} must be null`);
        }
      } else if (
        !Number.isInteger(actual[bytesKey])
        || actual[bytesKey] < 1
        || !/^[a-f0-9]{64}$/.test(actual[digestKey] || '')
      ) {
        errors.push(`${label} ${bytesKey}/${digestKey} must bind the artifact`);
      }
    }
  }
  return { valid: errors.length === 0, errors, expectedPlan };
}

export async function resolveOwnedEvidenceFile({
  root,
  evidenceRoot,
  relativePath,
  label,
}) {
  assertAbsoluteRoot(root);
  if (!isSafeRelativePath(evidenceRoot) || !isSafeRelativePath(relativePath)) {
    throw new Error(`${label} path must be a normalized repository-relative path`);
  }
  const evidenceAbsolute = path.resolve(root, evidenceRoot);
  const fileAbsolute = path.resolve(root, relativePath);
  if (!isPathInside(evidenceAbsolute, fileAbsolute)) {
    throw new Error(`${label} escapes the fixed evidence root`);
  }
  const resolvedRepository = await realpath(root);
  await assertPrivateDirectoryChain(
    root,
    evidenceRoot,
    `${label} evidence root`,
  );
  const resolvedRoot = await realpath(evidenceAbsolute);
  const evidenceMetadata = await lstat(evidenceAbsolute);
  if (
    resolvedRepository !== root
    || resolvedRoot !== evidenceAbsolute
    || !evidenceMetadata.isDirectory()
    || evidenceMetadata.isSymbolicLink()
    || !isPathInside(resolvedRepository, resolvedRoot)
  ) {
    throw new Error(`${label} evidence root is not a canonical owned directory`);
  }
  const relativeWithinEvidence = path.relative(evidenceAbsolute, fileAbsolute);
  await assertPrivateDirectoryChain(
    evidenceAbsolute,
    path.dirname(relativeWithinEvidence),
    `${label} parent`,
  );
  const metadata = await lstat(fileAbsolute);
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || privateMode(metadata) !== 0o600
  ) {
    throw new Error(`${label} must be a private regular non-symlink file`);
  }
  const resolvedFile = await realpath(fileAbsolute);
  if (
    resolvedFile !== fileAbsolute
    || !isPathInside(resolvedRoot, resolvedFile)
  ) {
    throw new Error(`${label} does not have a canonical path in the fixed evidence root`);
  }
  const contents = await readFile(resolvedFile);
  if (contents.length !== metadata.size) {
    throw new Error(`${label} changed while it was being read`);
  }
  return {
    absolutePath: resolvedFile,
    relativePath,
    bytes: contents.length,
    sha256: sha256(contents),
    contents,
  };
}

export function buildSanitizedExecutionEvidence(execution, root) {
  return {
    id: execution.id,
    portableReplay: makePortableInvocation(execution, root),
    startedAt: execution.startedAt,
    endedAt: execution.endedAt,
    exitCode: execution.exitCode,
    signal: execution.signal,
    timedOut: execution.timedOut,
    leakDetected: execution.leakDetected,
    cleanupTerminated: execution.cleanupTerminated,
    log: execution.logPath,
    logBytes: execution.logBytes,
    logSha256: execution.logSha256,
    report: execution.reportPath,
    reportBytes: execution.reportBytes,
    reportSha256: execution.reportSha256,
    inventory: execution.inventoryPath,
    inventoryBytes: execution.inventoryBytes,
    inventorySha256: execution.inventorySha256,
    preSourceState: sanitizeSourceState(execution.preSourceState),
    postSourceState: sanitizeSourceState(execution.postSourceState),
    preIgnoredState: sanitizeIgnoredState(execution.preIgnoredState),
    postIgnoredState: sanitizeIgnoredState(execution.postIgnoredState),
  };
}

export function buildSanitizedToolchainEvidence(toolchain) {
  if (!validGate0Toolchain(toolchain)) {
    throw new Error('cannot sanitize an invalid Gate 0 toolchain identity');
  }
  return Object.fromEntries(
    TOOLCHAIN_KEYS.map(key => [key, toolchain[key]]),
  );
}

export function validGate0Toolchain(toolchain) {
  const safeVersion = value => (
    typeof value === 'string'
    && value.length >= 1
    && value.length <= 200
    && /^[\x20-\x7e]+$/.test(value)
  );
  return isPlainObject(toolchain)
    && isDeepStrictEqual(Object.keys(toolchain).sort(), [...TOOLCHAIN_KEYS].sort())
    && toolchain.schemaVersion === 1
    && ['linux', 'darwin', 'win32'].includes(toolchain.platform)
    && /^[a-zA-Z0-9_.-]+$/.test(toolchain.architecture || '')
    && /^v22\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(
      toolchain.nodeVersion || '',
    )
    && /^[a-f0-9]{64}$/.test(toolchain.nodeExecutableSha256 || '')
    && /^[a-f0-9]{64}$/.test(toolchain.pathSha256 || '')
    && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(
      toolchain.npmVersion || '',
    )
    && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(
      toolchain.yarnVersion || '',
    )
    && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(
      toolchain.pythonVersion || '',
    )
    && /^git version [0-9A-Za-z.+-]+$/.test(toolchain.gitVersion || '')
    && /^GNU bash, version [\x20-\x7e]+$/.test(toolchain.bashVersion || '')
    && ['npmVersion', 'yarnVersion', 'pythonVersion', 'gitVersion', 'bashVersion']
      .every(key => safeVersion(toolchain[key]));
}

export function environmentForExecution(execution, inheritedEnvironment = process.env) {
  const environment = {};
  for (const key of execution.inheritedEnvironmentKeys) {
    environment[key] = inheritedEnvironment[key] ?? '';
  }
  return {
    ...environment,
    ...execution.environmentOverrides,
  };
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function portableValue(value, root) {
  if (typeof value !== 'string') {
    throw new Error('portable invocation values must be strings');
  }
  if (value === root) return '$PWD';
  if (path.isAbsolute(value)) {
    if (!isPathInside(root, value)) {
      throw new Error('portable invocation contains a host-absolute path outside the repository');
    }
    return `$PWD/${path.relative(root, value).split(path.sep).join('/')}`;
  }
  if (value.includes(root)) {
    throw new Error('portable invocation refuses embedded repository-root substrings');
  }
  return value;
}

function assertCandidateSha(candidateSha) {
  if (!/^[a-f0-9]{40}$/.test(candidateSha || '')) {
    throw new Error('candidate SHA must be a full lowercase SHA-1');
  }
}

function assertAbsoluteRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new Error('repository root must be absolute');
  }
}

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value === '' || path.isAbsolute(value)) return false;
  const normalized = path.normalize(value);
  return (
    normalized === value
    && normalized !== '.'
    && !normalized.startsWith(`..${path.sep}`)
    && normalized !== '..'
  );
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== ''
    && !relative.startsWith(`..${path.sep}`)
    && relative !== '..'
    && !path.isAbsolute(relative);
}

async function assertPrivateDirectoryChain(root, relativePath, label) {
  if (relativePath === '.') return;
  let cursor = root;
  for (const component of relativePath.split(path.sep)) {
    cursor = path.join(cursor, component);
    const metadata = await lstat(cursor);
    if (
      !metadata.isDirectory()
      || metadata.isSymbolicLink()
      || privateMode(metadata) !== 0o700
      || await realpath(cursor) !== cursor
    ) {
      throw new Error(`${label} contains a non-private or non-canonical directory`);
    }
  }
}

function privateMode(metadata) {
  return metadata.mode & 0o777;
}

function sanitizeSourceState(state) {
  return {
    sha: state.sha,
    clean: state.statusPorcelain === '',
  };
}

function sanitizeIgnoredState(state) {
  return {
    policy: state.policy,
    observedAllowedCount: state.observedAllowedCount,
    unexpectedPathCount: state.unexpectedPathCount,
  };
}

function validIsoTimestamp(value) {
  return typeof value === 'string'
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value);
}

function requireExactKeys(value, expectedKeys, label, errors) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (!isDeepStrictEqual(actual, expected)) {
    errors.push(`${label} keys differ from the locked schema`);
  }
}
