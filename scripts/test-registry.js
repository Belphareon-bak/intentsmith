import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const TEST_REGISTRY_PATH = 'tests/registry.json';
export const TEST_REGISTRY_DOC_PATH = 'docs/convergence/TEST-REGISTRY.md';
export const TEST_REGISTRY_SCHEMA_VERSION = 1;

export const TEST_PROFILES = [
  'offline',
  'database',
  'server',
  'model',
  'soak',
  'manual',
];

const TEST_TIERS = new Set(['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6']);
const TEST_STATES = new Set([
  'ACTIVE',
  'BLOCKED',
  'KNOWN_DEFECTIVE',
  'HISTORICAL',
]);
const NETWORK_REQUIREMENTS = new Set(['none', 'loopback', 'external']);
const EXECUTOR_BY_EXTENSION = new Map([
  ['.js', 'node'],
  ['.cjs', 'node'],
  ['.py', 'python3'],
  ['.sh', 'bash'],
]);

export async function loadTestRegistry(root) {
  const registryPath = path.join(root, TEST_REGISTRY_PATH);
  let registry;
  try {
    registry = JSON.parse(await readFile(registryPath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read test registry ${TEST_REGISTRY_PATH}: ${error.message}`);
  }

  const candidates = await discoverRunnablePrograms(root);
  const errors = validateTestRegistry(registry, candidates);
  if (errors.length > 0) {
    throw new Error(`Invalid test registry:\n- ${errors.join('\n- ')}`);
  }

  return registry;
}

export async function discoverRunnablePrograms(root) {
  const candidates = [];
  const testsDir = path.join(root, 'tests');
  for (const absolutePath of await walk(testsDir)) {
    const relativePath = normalizePath(path.relative(root, absolutePath));
    if (isRunnableProgram(relativePath)) candidates.push(relativePath);
  }

  const rootE2eRunner = path.join(root, 'e2e', 'run-e2e.js');
  if (await isFile(rootE2eRunner)) candidates.push('e2e/run-e2e.js');

  return [...new Set(candidates)].sort();
}

export function validateTestRegistry(registry, candidates) {
  const errors = [];
  if (!registry || typeof registry !== 'object') return ['registry must be an object'];
  if (registry.schemaVersion !== TEST_REGISTRY_SCHEMA_VERSION) {
    errors.push(`schemaVersion must equal ${TEST_REGISTRY_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(registry.suites)) {
    errors.push('suites must be an array');
    return errors;
  }

  const ids = new Set();
  const registeredPaths = new Set();

  for (const [index, suite] of registry.suites.entries()) {
    const label = `suites[${index}]`;
    if (!suite || typeof suite !== 'object') {
      errors.push(`${label} must be an object`);
      continue;
    }

    if (!/^[A-Z0-9][A-Z0-9_.-]{2,127}$/.test(suite.id || '')) {
      errors.push(`${label}.id is invalid`);
    } else if (ids.has(suite.id)) {
      errors.push(`duplicate id ${suite.id}`);
    } else {
      ids.add(suite.id);
    }

    if (!isSafeRelativePath(suite.path)) {
      errors.push(`${label}.path is unsafe: ${suite.path}`);
    } else if (registeredPaths.has(suite.path)) {
      errors.push(`duplicate path ${suite.path}`);
    } else {
      registeredPaths.add(suite.path);
    }

    if (!TEST_PROFILES.includes(suite.profile)) {
      errors.push(`${label}.profile is invalid: ${suite.profile}`);
    }
    if (!TEST_TIERS.has(suite.tier)) {
      errors.push(`${label}.tier is invalid: ${suite.tier}`);
    }
    if (!TEST_STATES.has(suite.state)) {
      errors.push(`${label}.state is invalid: ${suite.state}`);
    }
    if (typeof suite.required !== 'boolean') {
      errors.push(`${label}.required must be boolean`);
    }
    if (suite.state === 'HISTORICAL' && suite.required !== false) {
      errors.push(`${label} historical suites must not be required`);
    }
    if (typeof suite.capabilityId !== 'string' || !/^C3-\d{3}$/.test(suite.capabilityId)) {
      errors.push(`${label}.capabilityId is invalid`);
    }
    if (typeof suite.fixture !== 'string' || !suite.fixture) {
      errors.push(`${label}.fixture is required`);
    }
    if (typeof suite.owner !== 'string' || !suite.owner) {
      errors.push(`${label}.owner is required`);
    }
    if (!Number.isInteger(suite.timeoutMs) || suite.timeoutMs <= 0) {
      errors.push(`${label}.timeoutMs must be a positive integer`);
    }
    if (!Number.isInteger(suite.expectedDurationMs) || suite.expectedDurationMs <= 0) {
      errors.push(`${label}.expectedDurationMs must be a positive integer`);
    } else if (
      Number.isInteger(suite.timeoutMs)
      && suite.expectedDurationMs > suite.timeoutMs
    ) {
      errors.push(`${label}.expectedDurationMs must not exceed timeoutMs`);
    }
    if (!Array.isArray(suite.argv) || suite.argv.length !== 2 || suite.argv.some(arg => typeof arg !== 'string')) {
      errors.push(`${label}.argv must contain exactly executable and path`);
    } else {
      const extension = typeof suite.path === 'string'
        ? path.posix.extname(suite.path)
        : '';
      const expectedExecutor = EXECUTOR_BY_EXTENSION.get(extension);
      if (!expectedExecutor) {
        errors.push(`${label}.path has no approved executor: ${suite.path}`);
      } else if (suite.argv[0] !== expectedExecutor) {
        errors.push(
          `${label}.argv[0] must equal ${expectedExecutor} for ${suite.path}`,
        );
      }
      if (suite.argv[1] !== suite.path) {
        errors.push(`${label}.argv[1] must equal path`);
      }
    }

    const requirements = suite.requirements;
    if (!requirements || typeof requirements !== 'object') {
      errors.push(`${label}.requirements is required`);
    } else {
      if (!NETWORK_REQUIREMENTS.has(requirements.network)) {
        errors.push(`${label}.requirements.network is invalid`);
      }
      for (const field of ['database', 'server', 'ollama', 'gpu']) {
        if (typeof requirements[field] !== 'boolean') {
          errors.push(`${label}.requirements.${field} must be boolean`);
        }
      }
    }

    if (!suite.lastGreen || !Object.hasOwn(suite.lastGreen, 'commit') || !Object.hasOwn(suite.lastGreen, 'artifact')) {
      errors.push(`${label}.lastGreen must contain commit and artifact`);
    }
    if (!Number.isInteger(suite.flakeCount) || suite.flakeCount < 0) {
      errors.push(`${label}.flakeCount must be a non-negative integer`);
    }
    if (!Object.hasOwn(suite, 'quarantineExpiry')) {
      errors.push(`${label}.quarantineExpiry is required`);
    }

  }

  const candidateSet = new Set(candidates);
  for (const candidate of candidates) {
    if (!registeredPaths.has(candidate)) errors.push(`unregistered runnable program: ${candidate}`);
  }
  for (const registeredPath of registeredPaths) {
    if (!candidateSet.has(registeredPath)) errors.push(`registered path is missing or no longer runnable: ${registeredPath}`);
  }

  return errors;
}

export function registryFingerprint(registry) {
  return createHash('sha256')
    .update(JSON.stringify(registry))
    .digest('hex');
}

export function renderTestRegistry(registry) {
  const suites = [...registry.suites].sort((a, b) => {
    const pathOrder = a.path.localeCompare(b.path);
    return pathOrder || a.profile.localeCompare(b.profile);
  });
  const profileCounts = Object.fromEntries(TEST_PROFILES.map(profile => [profile, 0]));
  const stateCounts = {};
  for (const suite of suites) {
    profileCounts[suite.profile] += 1;
    stateCounts[suite.state] = (stateCounts[suite.state] || 0) + 1;
  }

  const lines = [
    '# IntentSmith Test Registry',
    '',
    'This is the canonical rendered ledger for `tests/registry.json`.',
    'It is generated deterministically; edit the JSON manifest and run',
    '`node scripts/validate-test-registry.js --write-doc`.',
    '',
    'A suite verdict is derived from child exit status, signal, timeout, required',
    'evidence, and cleanup. Printed assertion totals are metrics only and cannot',
    'override a failed or blocked suite.',
    '',
    '## Inventory',
    '',
    `- Runnable programs: ${suites.length}`,
    `- Profiles: ${formatCounts(profileCounts)}`,
    `- States: ${formatCounts(stateCounts)}`,
    '',
    '## Execution profiles',
    '',
    '| Profile | Scope | Default prerequisites |',
    '|---|---|---|',
    '| `offline` | tests declared deterministic and network-independent | isolated HOME/temp; strict OS egress proof is a separate gate |',
    '| `database` | deterministic SQLite/integration checks | per-suite temporary DB |',
    '| `server` | local API/WS programs | hard-blocked until an owned, identity-verified server supervisor exists |',
    '| `model` | real-model or external-network programs | pinned model/GPU; external network remains hard-blocked |',
    '| `soak` | long-running stability programs | dedicated clean commit and artifact root |',
    '| `manual` | historical/operator tools | never release evidence by default |',
    '',
    '## Suites',
    '',
    '| ID | Path | Capability | Tier | Profile | Expected | Timeout | Requirements | Required | State | Last green | Owner |',
    '|---|---|---|---|---|---:|---:|---|---:|---|---|---|',
  ];

  for (const suite of suites) {
    const lastGreen = suite.lastGreen.commit
      ? `${suite.lastGreen.commit}${suite.lastGreen.artifact ? ` / ${suite.lastGreen.artifact}` : ''}`
      : '—';
    lines.push(`| ${[
      `\`${escapeCell(suite.id)}\``,
      `\`${escapeCell(suite.path)}\``,
      `\`${escapeCell(suite.capabilityId)}\``,
      suite.tier,
      `\`${suite.profile}\``,
      formatDuration(suite.expectedDurationMs),
      formatDuration(suite.timeoutMs),
      escapeCell(formatRequirements(suite.requirements)),
      suite.required ? 'yes' : 'no',
      `\`${suite.state}\``,
      escapeCell(lastGreen),
      escapeCell(suite.owner),
    ].join(' | ')} |`);
  }

  lines.push(
    '',
    'Required fields per run: exact command and commit, clean-tree status, start/end',
    'time, isolated environment paths, stdout/stderr artifact and hash, exit code',
    'or signal, timeout classification, cleanup result, and deterministic verdict.',
    '',
  );
  return lines.join('\n');
}

function isRunnableProgram(relativePath) {
  const base = path.basename(relativePath);
  if (relativePath === 'tests/output-gate.js') return true;
  if (relativePath === 'tests/e2e/220-e2e-suite-runner.js') return true;
  if (/^tests\/test_[^/]+\.py$/.test(relativePath)) return true;
  if (base.endsWith('-self-test.js')) return true;
  if (relativePath.includes('/_legacy/')) {
    return /\.(?:cjs|js|sh)$/.test(relativePath);
  }
  return /\.(?:test\.js|test\.cjs|e2e\.js)$/.test(relativePath);
}

async function walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolutePath));
    else if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

async function isFile(filePath) {
  try {
    const { stat } = await import('node:fs/promises');
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) return false;
  if (value.includes('\\') || value.includes('\0')) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== '..' && !normalized.startsWith('../');
}

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function formatCounts(counts) {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([name, count]) => `${name}=${count}`)
    .join(', ');
}

function formatRequirements(requirements) {
  const values = [`network:${requirements.network}`];
  if (requirements.database) values.push('temp-db');
  if (requirements.server) values.push('server');
  if (requirements.ollama) values.push('ollama');
  if (requirements.gpu) values.push('gpu');
  return values.join(', ');
}

function formatDuration(durationMs) {
  if (durationMs % 60_000 === 0) return `${durationMs / 60_000} min`;
  if (durationMs % 1_000 === 0) return `${durationMs / 1_000} s`;
  return `${durationMs} ms`;
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
