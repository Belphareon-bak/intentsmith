// Project Lifecycle E2E Test 4 — Klíčenka (Secure Keychain)
// ══════════════════════════════════════════════════════════════════════════════
// Real product E2E: existing project with files → PROPOSED → COMPLETED
//
// Key differences from Test 1:
//   - Pre-existing project files (README.md, package.json, .c3/project.json)
//   - P3 analyzer tested: existing files detected and injected as context
//   - 4 milestones: Encryption Engine, Credential Store, CLI, C3 Integration
//   - Verifies existing project analysis, git history, ROADMAP, README
//
// Run: node tests/project-lifecycle-klicenka.test.js
// ══════════════════════════════════════════════════════════════════════════════

import './helpers/isolated-test-db.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

import {
  ProjectPhase,
  MilestoneStatus,
  ProjectLifecycle,
  getBuildProgress,
} from '../src/planner/index.js';

import {
  lifecycles as lifecycleRepo,
  milestones as msRepo,
  roadmapVersions,
  driftChecks,
  projects,
  conversations,
  messages,
  lifecycleHandoffState,
  db,
} from '../src/db/database.js';

import {
  handleLifecycleBuildDetected,
  handleLifecycleInput,
} from '../src/chat/handlers/lifecycle-handoff.js';

import {
  getLcState,
  setLcState,
  clearLcState,
  initLifecycleStateDb,
} from '../src/chat/handlers/lifecycle-state.js';
import { rawId, scopeId } from '../src/planner/lifecycle-planning.js';

// ─── Assertions ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function check(condition, name, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}: ${detail}`);
    failures.push({ name, detail });
  }
}

// ─── Sample Data: Klíčenka — Secure Keychain ───────────────────────────────

const EXISTING_README = `# Klíčenka

Šifrované úložiště citlivých údajů pro C3.

## Plánované funkce

- AES-256-GCM encryption
- PBKDF2 key derivation
- File-based encrypted store
- CLI rozhraní
`;

const EXISTING_PACKAGE = {
  name: 'klicenka',
  version: '0.1.0',
  type: 'module',
  description: 'Secure credential keychain for C3',
  main: 'src/index.js',
  scripts: {},
  dependencies: {},
};

const EXISTING_C3_CONFIG = {
  name: 'klicenka',
  type: 'general',
  description: 'Šifrované úložiště citlivých údajů',
  created: '2026-02-22T14:21:10.519Z',
  lifecycle: 'SPEC',
};

const SPEC = {
  title: 'Klíčenka — Secure Keychain for C3',
  goals: [
    { id: 'G1', description: 'AES-256-GCM encryption/decryption', priority: 'MUST', success_criteria: 'Encrypt then decrypt roundtrip returns original plaintext' },
    { id: 'G2', description: 'File-based encrypted credential store', priority: 'MUST', success_criteria: 'Store file contains only encrypted data, no plaintext credentials' },
    { id: 'G3', description: 'CLI interface for credential management', priority: 'MUST', success_criteria: 'All CRUD commands execute successfully via CLI' },
    { id: 'G4', description: 'C3 config integration', priority: 'SHOULD', success_criteria: 'C3 config resolves credentials from keychain store' },
  ],
  requirements: [
    { id: 'R1', description: 'AES-256-GCM encrypt/decrypt with IV', type: 'functional', goal_id: 'G1', acceptance_test: 'Encrypt "secret" and decrypt; verify output equals "secret"' },
    { id: 'R2', description: 'PBKDF2 key derivation from master password', type: 'functional', goal_id: 'G1', acceptance_test: 'Derive key from password and verify 256-bit key length' },
    { id: 'R3', description: 'JSON-based encrypted store file', type: 'functional', goal_id: 'G2', acceptance_test: 'After add, verify store.json values are base64-encoded ciphertext' },
    { id: 'R4', description: 'CRUD operations: add, get, list, remove', type: 'functional', goal_id: 'G2', acceptance_test: 'Add key, get it back, list shows it, remove deletes it' },
    { id: 'R5', description: 'CLI commands: add, get, list, remove, export, import', type: 'functional', goal_id: 'G3', acceptance_test: 'Run each CLI command and verify exit code 0' },
    { id: 'R6', description: 'Export/import for backup', type: 'functional', goal_id: 'G3', acceptance_test: 'Export store, delete it, import backup, verify data intact' },
    { id: 'R7', description: 'C3 config reads credentials from store', type: 'functional', goal_id: 'G4', acceptance_test: 'C3 config getter resolves credential key to decrypted value' },
  ],
  tech_stack: {
    languages: ['JavaScript'],
    frameworks: ['Node.js'],
    tools: ['crypto (built-in)'],
    rationale: 'Native Node.js crypto, no external dependencies',
  },
  architecture: {
    pattern: 'Layered: crypto → store → CLI',
    components: ['crypto.js', 'store.js', 'cli.js', 'integration.js'],
    data_model: 'JSON file with encrypted values',
  },
  risks: [
    { id: 'RISK1', description: 'Key derivation performance', severity: 'LOW', mitigation: 'Async PBKDF2' },
    { id: 'RISK2', description: 'File corruption', severity: 'MEDIUM', mitigation: 'Atomic writes with temp file' },
  ],
  constraints: ['No external crypto libraries', 'Must work offline'],
  out_of_scope: ['GUI', 'Network sync', 'Multi-user'],
  design_decisions: [
    {
      id: 'DD1',
      decision: 'Encryption algorithm',
      chosen: 'AES-256-GCM',
      alternatives_considered: ['AES-256-CBC', 'ChaCha20-Poly1305'],
      rationale: 'GCM provides authenticated encryption with built-in integrity verification',
    },
    {
      id: 'DD2',
      decision: 'Key derivation function',
      chosen: 'PBKDF2',
      alternatives_considered: ['scrypt', 'Argon2'],
      rationale: 'PBKDF2 is available in Node.js crypto built-in without external dependencies',
    },
  ],
  acceptance_criteria: [
    'Encrypt/decrypt roundtrip preserves plaintext',
    'Store file contains no plaintext credentials',
    'All CLI commands execute with exit code 0',
    'C3 config resolves credentials from store',
  ],
};

const ROADMAP = {
  milestones: [
    {
      id: 'ms-1',
      title: 'Encryption Engine',
      description: 'AES-256-GCM encrypt/decrypt + PBKDF2 key derivation',
      dependencies: [],
      estimated_loc: 120,
      estimated_files: 2,
      estimated_complexity: 'MEDIUM',
      goals_addressed: ['G1'],
      requirements_addressed: ['R1', 'R2'],
      deliverables: ['src/crypto.js', 'tests/crypto.test.js'],
      acceptance_criteria: ['Encryption roundtrip and key derivation tests pass'],
      test_strategy: {
        type: 'unit',
        command: 'node tests/crypto.test.js',
        specific_tests: ['PBKDF2 key length', 'AES-GCM roundtrip'],
      },
    },
    {
      id: 'ms-2',
      title: 'Credential Store',
      description: 'File-based encrypted credential store with CRUD',
      dependencies: ['ms-1'],
      estimated_loc: 150,
      estimated_files: 2,
      estimated_complexity: 'MEDIUM',
      goals_addressed: ['G2'],
      requirements_addressed: ['R3', 'R4'],
      deliverables: ['src/store.js', 'tests/store.test.js'],
      acceptance_criteria: ['Encrypted store CRUD tests pass without plaintext persistence'],
      test_strategy: {
        type: 'unit',
        command: 'node tests/store.test.js',
        specific_tests: ['Credential CRUD', 'Encrypted storage'],
      },
    },
    {
      id: 'ms-3',
      title: 'CLI Interface',
      description: 'Command-line interface: add, get, list, remove, export, import',
      dependencies: ['ms-2'],
      estimated_loc: 200,
      estimated_files: 3,
      estimated_complexity: 'MEDIUM',
      goals_addressed: ['G3'],
      requirements_addressed: ['R5', 'R6'],
      deliverables: ['src/cli.js', 'bin/klicenka', 'tests/cli-source.test.js'],
      acceptance_criteria: ['CLI command module and executable entry point are syntactically valid'],
      test_strategy: {
        type: 'structural',
        command: 'node tests/cli-source.test.js',
        specific_tests: ['CLI module parses successfully', 'Executable entry point parses successfully'],
      },
    },
    {
      id: 'ms-4',
      title: 'C3 Integration',
      description: 'Integration module for C3 config system',
      dependencies: ['ms-2'],
      estimated_loc: 80,
      estimated_files: 3,
      estimated_complexity: 'LOW',
      goals_addressed: ['G4'],
      requirements_addressed: ['R7'],
      deliverables: ['src/integration.js', 'src/index.js', 'tests/integration-source.test.js'],
      acceptance_criteria: ['C3 credential lookup and package exports are syntactically valid'],
      test_strategy: {
        type: 'structural',
        command: 'node tests/integration-source.test.js',
        specific_tests: ['C3 integration module parses successfully', 'Package export module parses successfully'],
      },
    },
  ],
  total_estimated_loc: 550,
  total_milestones: 4,
  critical_path: ['ms-1', 'ms-2', 'ms-3'],
  requirements_coverage: {
    covered: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'],
    uncovered: [],
  },
};

const ARCHITECTURE = {
  layers: ['encryption', 'storage', 'application'],
  rules: [
    { from: 'encryption', canImport: [], cannotImport: ['storage', 'application'] },
    { from: 'storage', canImport: ['encryption'], cannotImport: ['application'] },
    { from: 'application', canImport: ['storage', 'encryption'], cannotImport: [] },
  ],
  fileStructure: {
    encryption: 'src/crypto.js',
    storage: 'src/store.js',
    application: 'src',
  },
};

const MS_PLANS = {
  'ms-1': {
    milestone_id: 'ms-1',
    files: [
      { path: 'src/crypto.js', action: 'create', purpose: 'Encryption engine' },
      { path: 'tests/crypto.test.js', action: 'create', purpose: 'Crypto unit tests' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create PBKDF2 key derivation', file: 'src/crypto.js' },
      { step: 2, action: 'Create AES-256-GCM encrypt/decrypt', file: 'src/crypto.js' },
      { step: 3, action: 'Write unit tests', file: 'tests/crypto.test.js' },
    ],
    scope_files: ['src/crypto.js', 'tests/crypto.test.js'],
  },
  'ms-2': {
    milestone_id: 'ms-2',
    files: [
      { path: 'src/store.js', action: 'create', purpose: 'Credential store' },
      { path: 'tests/store.test.js', action: 'create', purpose: 'Store unit tests' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create credential store with CRUD', file: 'src/store.js' },
      { step: 2, action: 'Write store tests', file: 'tests/store.test.js' },
      { step: 3, action: 'Validate encrypted CRUD persistence', file: 'tests/store.test.js' },
    ],
    scope_files: ['src/store.js', 'tests/store.test.js'],
  },
  'ms-3': {
    milestone_id: 'ms-3',
    files: [
      { path: 'src/cli.js', action: 'create', purpose: 'CLI interface' },
      { path: 'bin/klicenka', action: 'create', purpose: 'CLI entry point' },
      { path: 'tests/cli-source.test.js', action: 'create', purpose: 'CLI source syntax contract' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create CLI parser', file: 'src/cli.js' },
      { step: 2, action: 'Create bin entry point', file: 'bin/klicenka' },
      { step: 3, action: 'Integrate CLI commands with the credential store', file: 'src/cli.js' },
      { step: 4, action: 'Validate CLI and executable entry-point syntax', file: 'tests/cli-source.test.js' },
    ],
    scope_files: ['src/cli.js', 'bin/klicenka', 'tests/cli-source.test.js'],
  },
  'ms-4': {
    milestone_id: 'ms-4',
    files: [
      { path: 'src/integration.js', action: 'create', purpose: 'C3 integration' },
      { path: 'src/index.js', action: 'create', purpose: 'Main export' },
      { path: 'tests/integration-source.test.js', action: 'create', purpose: 'Integration source syntax contract' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create C3 integration module', file: 'src/integration.js' },
      { step: 2, action: 'Create main index export', file: 'src/index.js' },
      { step: 3, action: 'Validate credential lookup handling', file: 'src/integration.js' },
      { step: 4, action: 'Validate integration and package export syntax', file: 'tests/integration-source.test.js' },
    ],
    scope_files: ['src/integration.js', 'src/index.js', 'tests/integration-source.test.js'],
  },
};

const FILES = {
  'ms-1': {
    'src/crypto.js': `import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;

export function deriveKey(password, salt) {
  const s = salt || randomBytes(SALT_LENGTH);
  const key = pbkdf2Sync(password, s, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512');
  return { key, salt: s };
}

export function encrypt(plaintext, key) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { encrypted: encrypted.toString('base64'), iv: iv.toString('base64'), authTag: authTag.toString('base64') };
}

export function decrypt(encryptedData, key) {
  const { encrypted, iv, authTag } = encryptedData;
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  return decipher.update(Buffer.from(encrypted, 'base64')) + decipher.final('utf8');
}
`,
    'tests/crypto.test.js': `import { deriveKey, encrypt, decrypt } from '../src/crypto.js';
import assert from 'assert';

const { key, salt } = deriveKey('test-password');

// Encrypt + Decrypt roundtrip
const data = 'secret-api-key-12345';
const enc = encrypt(data, key);
const dec = decrypt(enc, key);
assert.strictEqual(dec, data, 'roundtrip failed');

// Same password + salt = same key
const { key: key2 } = deriveKey('test-password', salt);
assert.deepStrictEqual(key, key2, 'key derivation mismatch');

console.log('crypto tests: 2 passed');
`,
  },
  'ms-2': {
    'src/store.js': `import { readFileSync, writeFileSync, existsSync } from 'fs';
import { deriveKey, encrypt, decrypt } from './crypto.js';

export class CredentialStore {
  constructor(filePath, password) {
    this.filePath = filePath;
    this.password = password;
    const { key, salt } = deriveKey(password);
    this.key = key;
    this.salt = salt;
    this.data = {};
    if (existsSync(filePath)) this.load();
  }

  load() {
    const raw = JSON.parse(readFileSync(this.filePath, 'utf-8'));
    this.salt = Buffer.from(raw.salt, 'base64');
    const { key } = deriveKey(this.password, this.salt);
    this.key = key;
    for (const [k, v] of Object.entries(raw.entries || {})) {
      this.data[k] = decrypt(v, this.key);
    }
  }

  save() {
    const entries = {};
    for (const [k, v] of Object.entries(this.data)) {
      entries[k] = encrypt(v, this.key);
    }
    writeFileSync(this.filePath, JSON.stringify({ salt: this.salt.toString('base64'), entries }, null, 2));
  }

  add(key, value) { this.data[key] = value; this.save(); }
  get(key) { return this.data[key] || null; }
  list() { return Object.keys(this.data); }
  remove(key) { delete this.data[key]; this.save(); }
}
`,
    'tests/store.test.js': `import { CredentialStore } from '../src/store.js';
import { readFileSync, unlinkSync } from 'fs';
import assert from 'assert';

const testFile = '.klicenka-test-store.json';
try { unlinkSync(testFile); } catch {}

const store = new CredentialStore(testFile, 'master-pass');
store.add('api-key', 'sk-12345');
store.add('db-pass', 'p@ssw0rd');

assert.strictEqual(store.get('api-key'), 'sk-12345');
assert.deepStrictEqual(store.list(), ['api-key', 'db-pass']);

const rawStore = readFileSync(testFile, 'utf8');
assert.ok(!rawStore.includes('sk-12345'), 'store leaked API key plaintext');
assert.ok(!rawStore.includes('p@ssw0rd'), 'store leaked DB password plaintext');

const reloaded = new CredentialStore(testFile, 'master-pass');
assert.strictEqual(reloaded.get('api-key'), 'sk-12345');
assert.strictEqual(reloaded.get('db-pass'), 'p@ssw0rd');

reloaded.remove('api-key');
assert.strictEqual(reloaded.get('api-key'), null);

try { unlinkSync(testFile); } catch {}
console.log('store tests: ciphertext and reload checks passed');
`,
  },
  'ms-3': {
    'src/cli.js': `import { CredentialStore } from './store.js';

const DEFAULT_STORE = '.klicenka.json';

export function runCLI(args, storePath = DEFAULT_STORE) {
  const [command, ...rest] = args;
  const store = new CredentialStore(storePath, process.env.KLICENKA_PASS || 'default');

  switch (command) {
    case 'add': {
      const [key, value] = rest;
      if (!key || !value) return 'Usage: klicenka add <key> <value>';
      store.add(key, value);
      return \`Added: \${key}\`;
    }
    case 'get': {
      const val = store.get(rest[0]);
      return val || \`Not found: \${rest[0]}\`;
    }
    case 'list':
      return store.list().join('\\n') || '(empty)';
    case 'remove':
      store.remove(rest[0]);
      return \`Removed: \${rest[0]}\`;
    case 'export':
      return JSON.stringify(Object.fromEntries(store.list().map(k => [k, store.get(k)])));
    case 'import': {
      const data = JSON.parse(rest[0]);
      for (const [k, v] of Object.entries(data)) store.add(k, v);
      return \`Imported \${Object.keys(data).length} entries\`;
    }
    default:
      return 'Commands: add, get, list, remove, export, import';
  }
}
`,
    'bin/klicenka': `#!/usr/bin/env node
import { runCLI } from '../src/cli.js';
console.log(runCLI(process.argv.slice(2)));
`,
    'tests/cli-source.test.js': `import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const entryPath = fileURLToPath(new URL('../bin/klicenka', import.meta.url));
execFileSync(process.execPath, ['--check', cliPath], { stdio: 'pipe' });
execFileSync(process.execPath, ['--check', entryPath], { stdio: 'pipe' });
console.log('CLI source syntax checks passed');
`,
  },
  'ms-4': {
    'src/integration.js': `import { CredentialStore } from './store.js';

const DEFAULT_STORE_PATH = '.klicenka.json';

export function getC3Credential(key, storePath = DEFAULT_STORE_PATH) {
  const store = new CredentialStore(storePath, process.env.KLICENKA_PASS || 'default');
  return store.get(key);
}

export function listC3Credentials(storePath = DEFAULT_STORE_PATH) {
  const store = new CredentialStore(storePath, process.env.KLICENKA_PASS || 'default');
  return store.list();
}
`,
    'src/index.js': `export { deriveKey, encrypt, decrypt } from './crypto.js';
export { CredentialStore } from './store.js';
export { runCLI } from './cli.js';
export { getC3Credential, listC3Credentials } from './integration.js';
`,
    'tests/integration-source.test.js': `import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const integrationPath = fileURLToPath(new URL('../src/integration.js', import.meta.url));
const indexPath = fileURLToPath(new URL('../src/index.js', import.meta.url));
execFileSync(process.execPath, ['--check', integrationPath], { stdio: 'pipe' });
execFileSync(process.execPath, ['--check', indexPath], { stdio: 'pipe' });
console.log('Integration source syntax checks passed');
`,
  },
};

// ─── Fake LLM ───────────────────────────────────────────────────────────────

let capturedProjectContext = null;

function createFakeLLM() {
  return async function fakeLLM(role, prompt) {
    const p = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

    // SPEC: analyze — capture projectContext for P3 verification
    if (p.includes('## User Request') && p.includes('## Task')) {
      // Capture the context section injected by P3 analyzer
      if (p.includes('Existing Project')) {
        capturedProjectContext = p;
      }
      return {
        content: JSON.stringify({
          core_goal: 'Build a secure credential keychain for C3',
          implicit_assumptions: [
            'Single-user desktop usage',
            'Master password is the only auth factor',
          ],
          technical_decisions: [
            {
              decision: 'Encryption algorithm',
              alternatives: [
                { option: 'AES-256-GCM', pros: ['HW acceleration', 'NIST standard'], cons: ['Slower without AES-NI'] },
                { option: 'ChaCha20-Poly1305', pros: ['Fast on all CPUs', 'No side-channel'], cons: ['Less adoption'] },
              ],
              recommendation: 'AES-256-GCM — standard, HW-accelerated on modern CPUs',
            },
          ],
          clarifying_questions: [
            'Jaký encryption algorithm?',
            'Jak se bude zadávat master password?',
            'Chceš CLI nebo API?',
          ],
          initial_assessment: {
            estimated_complexity: 'MEDIUM',
            key_risks: [
              { risk: 'Key derivation performance', severity: 'MEDIUM', likelihood: 'HIGH', mitigation: 'Use Argon2id with tunable params' },
              { risk: 'File corruption', severity: 'HIGH', likelihood: 'LOW', mitigation: 'Atomic write with temp file + rename' },
            ],
            suggested_tech_stack: ['Node.js 22', 'crypto (built-in)', 'better-sqlite3'],
            tech_stack_rationale: 'Native crypto avoids external deps, SQLite for structured storage',
          },
        }),
      };
    }

    // SPEC: document
    if (p.includes('thorough project specification') || p.includes('creating a project specification') || p.includes('structured project specification')) {
      return { content: JSON.stringify(SPEC) };
    }

    // PLANNING: roadmap
    if (p.includes('creating a project roadmap') || p.includes('Break the project into milestones')) {
      return { content: JSON.stringify(ROADMAP) };
    }

    // PLANNING: architecture contract
    if (p.includes('generate an ARCHITECTURE.json file')) {
      return { content: JSON.stringify(ARCHITECTURE) };
    }

    // BUILD: milestone plan
    if (p.includes('implementing a specific milestone') || p.includes('implementation plan for THIS milestone')) {
      const msMatch = p.match(/"id"\s*:\s*"(ms-\d+)"/);
      const msId = msMatch?.[1];
      if (!msId || !MS_PLANS[msId]) throw new Error(`Unknown milestone plan prompt: ${msId}`);
      return { content: JSON.stringify(MS_PLANS[msId]) };
    }

    // BUILD: checkpoint
    if (p.includes('reviewing a completed milestone') || p.includes('Compare the actual output')) {
      return {
        content: JSON.stringify({
          passed: true,
          deliverables_check: [{ deliverable: 'Files', status: 'DONE', note: 'All present' }],
          scope_violations: [],
          test_summary: { total: 5, passed: 5, failed: 0 },
          security_findings: [],
          error_handling_gaps: [],
          discovered_requirements: [],
          quality_notes: [],
          overall_assessment: 'Milestone completed successfully',
        }),
      };
    }

    // BUILD: health score
    if (p.includes('computing health metrics') || p.includes('health metrics for a completed milestone')) {
      return {
        content: JSON.stringify({
          scope_adherence: 0.95,
          test_coverage: 0.85,
          complexity_delta: 0.15,
          tech_debt_delta: 0.05,
        }),
      };
    }

    // REVIEW: project review
    if (p.includes('conducting a project review') || p.includes('4 drift checks')) {
      return {
        content: JSON.stringify({
          spec_alignment: { addressed_goals: ['G1', 'G2', 'G3', 'G4'], unaddressed_goals: [], confidence: 0.95 },
          scope_creep: { severity: 'NONE', confidence: 0.9 },
          architecture_consistency: { consistent: true, violations: [], confidence: 0.9 },
          tech_debt: { items: [], trend: 'STABLE', confidence: 0.8 },
          overall_health: 'GREEN',
          recommendations: [],
        }),
      };
    }

    console.warn(`    ⚠️ fakeLLM: unmatched prompt (role=${role})`);
    return { content: '{}' };
  };
}

// ─── Fake Executor ──────────────────────────────────────────────────────────

function createFakeExecutor(projectPath) {
  return {
    async start(request, context) {
      const msId = rawId(context.milestoneId);
      const files = FILES[msId];
      if (!files) throw new Error(`No executor fixture for ${context.milestoneId}`);

      for (const [relPath, content] of Object.entries(files)) {
        const fullPath = path.join(projectPath, relPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content);
      }

      try {
        execSync('git add -A', { cwd: projectPath, stdio: 'pipe' });
        execSync(`git commit -m "executor: ${msId}" --allow-empty`, { cwd: projectPath, stdio: 'pipe' });
      } catch { /* ignore */ }

      return { state: 'COMPLETED', sessionId: `mock-wf-${msId}` };
    },
    async approve(sessionId) {
      return { state: 'COMPLETED', sessionId };
    },
  };
}

// ─── DB Cleanup ─────────────────────────────────────────────────────────────

function cleanDB() {
  // Clean lifecycle data — NEVER wipe user projects/conversations
  for (const t of ['lifecycle_handoff_state', 'drift_checks', 'change_requests',
                    'milestones', 'roadmap_versions', 'project_lifecycles']) {
    try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ }
  }
  // Clean only this test's previous conversations (idempotent re-run)
  try {
    const oldConvs = db.prepare(`SELECT id FROM conversations WHERE title LIKE '%Klíčenka%'`).all();
    for (const c of oldConvs) {
      db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(c.id);
      db.prepare(`DELETE FROM conversations WHERE id = ?`).run(c.id);
    }
  } catch { /* ignore */ }
  // Only remove temp test projects
  try { db.prepare(`DELETE FROM projects WHERE path LIKE '/tmp/%'`).run(); } catch { /* ignore */ }
  initLifecycleStateDb(lifecycleHandoffState, lifecycleRepo);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── MAIN TEST ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function run() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  Test 4: Klíčenka — Secure Keychain (Existing Project E2E)');
  console.log('══════════════════════════════════════════════════════════════════════');

  cleanDB();

  const SESSION_ID = 'klicenka-e2e';

  // Unique temporary project path: never overwrite a user's projects/ tree.
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-klicenka-'));
  const projectName = path.basename(projectPath);

  // ─── Register project in DB ───────────────────────────────────────────────
  const project = projects.getOrCreate(projectName, projectPath,
    'Šifrované úložiště citlivých údajů pro C3 — Secure Keychain');
  const projectId = Number(project.id);

  // ─── Create conversation linked to project ────────────────────────────────
  const CONV_ID = `conv-klicenka-${Date.now()}`;
  const conv = conversations.getOrCreate(CONV_ID, projectId,
    'Klíčenka — Secure Keychain Lifecycle');

  /** Helper: log user input + agent response as messages in conversation */
  function logTurn(userInput, response) {
    messages.addMessage(CONV_ID, 'user', userInput, null, { source: 'lifecycle-test' });
    const content = typeof response?.content === 'string' ? response.content : JSON.stringify(response || {});
    messages.addMessage(CONV_ID, 'assistant', content, null, { source: 'lifecycle-test' });
  }

  // ─── Pre-populate: Simulate existing project ──────────────────────────────

  console.log('\n═══ SETUP: Existing Project ═════════════════════════════════════════');

  // Write existing project files BEFORE lifecycle starts
  fs.writeFileSync(path.join(projectPath, 'README.md'), EXISTING_README);
  fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify(EXISTING_PACKAGE, null, 2));
  fs.mkdirSync(path.join(projectPath, '.c3'), { recursive: true });
  fs.writeFileSync(path.join(projectPath, '.c3/project.json'), JSON.stringify(EXISTING_C3_CONFIG, null, 2));

  // Git init with existing files committed
  execSync('git init', { cwd: projectPath, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: projectPath, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: projectPath, stdio: 'pipe' });
  execSync('git add -A', { cwd: projectPath, stdio: 'pipe' });
  execSync('git commit -m "initial: existing project files"', { cwd: projectPath, stdio: 'pipe' });

  check(fs.existsSync(path.join(projectPath, 'README.md')), 'Setup.1: README.md exists before lifecycle');
  check(fs.existsSync(path.join(projectPath, 'package.json')), 'Setup.2: package.json exists before lifecycle');
  check(fs.existsSync(path.join(projectPath, '.c3/project.json')), 'Setup.3: .c3/project.json exists before lifecycle');

  try {
    const gitLog = execSync('git log --oneline', { cwd: projectPath, encoding: 'utf8' });
    check(gitLog.includes('initial'), 'Setup.4: git has initial commit');
  } catch {
    check(false, 'Setup.4: git has initial commit');
  }

  const fakeLLM = createFakeLLM();
  const fakeExecutor = createFakeExecutor(projectPath);

  const context = {
    sessionId: SESSION_ID,
    callLLM: fakeLLM,
    executor: fakeExecutor,
    projectPath,
    projectId,
  };

  try {
    // ═══ PHASE 1: PROPOSED ══════════════════════════════════════════════════

    console.log('\n═══ PHASE 1: PROPOSED ═══════════════════════════════════════════════');

    const userRequest = 'Chci vytvořit šifrované úložiště citlivých údajů (klíčenku) pro C3 s AES-256 encryption, CLI a file-based store';
    const r1 = handleLifecycleBuildDetected(userRequest, { intent: 'BUILD' }, context);
    logTurn(userRequest, r1);

    check(r1?.content?.includes('lifecycle'), 'P1.1: response mentions lifecycle');
    check(r1?.content?.includes('ano/ne'), 'P1.2: asks for confirmation');
    const s1 = getLcState(SESSION_ID);
    check(s1?.phase === 'PROPOSED', 'P1.3: state is PROPOSED');

    // ═══ PHASE 2: SPEC (P3 analyzer runs here) ═════════════════════════════

    console.log('\n═══ PHASE 2: SPEC (P3 analyzer active) ══════════════════════════════');

    const r2 = await handleLifecycleInput('ano', context);
    logTurn('ano', r2);
    const s2 = getLcState(SESSION_ID);
    check(s2?.phase === 'SPEC', 'P3.1: state is SPEC');
    check(s2?.lifecycleId != null, 'P3.2: lifecycleId set');

    // P3: Verify project analysis was injected into LLM prompt
    check(capturedProjectContext != null, 'P3.3: project context captured by LLM');
    if (capturedProjectContext) {
      check(capturedProjectContext.includes('README.md') || capturedProjectContext.includes('Klíčenka'),
        'P3.4: context includes README info');
      check(capturedProjectContext.includes('package.json') || capturedProjectContext.includes('klicenka'),
        'P3.5: context includes package.json info');
      check(capturedProjectContext.includes('Git') || capturedProjectContext.includes('commit'),
        'P3.6: context includes git info');
      check(capturedProjectContext.includes('.c3') || capturedProjectContext.includes('project.json'),
        'P3.7: context includes .c3/project.json info');
    } else {
      // Skip dependent checks
      check(false, 'P3.4: context includes README info', 'capturedProjectContext is null');
      check(false, 'P3.5: context includes package.json info', 'capturedProjectContext is null');
      check(false, 'P3.6: context includes git info', 'capturedProjectContext is null');
      check(false, 'P3.7: context includes .c3/project.json info', 'capturedProjectContext is null');
    }

    // Answer spec questions → SPEC_REVIEW
    const specAnswer = 'AES-256-GCM, PBKDF2, CLI + API, Node.js native crypto';
    const r3 = await handleLifecycleInput(specAnswer, context);
    logTurn(specAnswer, r3);
    const s3 = getLcState(SESSION_ID);
    check(s3?.phase === 'SPEC_REVIEW', 'P3.8: state is SPEC_REVIEW');

    // ═══ PHASE 3: SPEC_REVIEW → PLAN_REVIEW ════════════════════════════════

    console.log('\n═══ PHASE 3: SPEC_REVIEW → PLAN_REVIEW ═════════════════════════════');

    const r4 = await handleLifecycleInput('schvaluji', context);
    logTurn('schvaluji', r4);
    const s4 = getLcState(SESSION_ID);
    check(s4?.phase === 'PLAN_REVIEW', 'Plan.1: state is PLAN_REVIEW');

    // ROADMAP.md should exist and contain all 4 milestones
    const roadmapPath = path.join(projectPath, 'ROADMAP.md');
    check(fs.existsSync(roadmapPath), 'Plan.2: ROADMAP.md exists after planning');
    check(fs.existsSync(path.join(projectPath, 'ARCHITECTURE.json')),
      'Plan.2b: ARCHITECTURE.json exists after planning');

    if (fs.existsSync(roadmapPath)) {
      const rmContent = fs.readFileSync(roadmapPath, 'utf-8');
      check(rmContent.includes('Encryption Engine'), 'Plan.3: ROADMAP has ms-1 title');
      check(rmContent.includes('Credential Store'), 'Plan.4: ROADMAP has ms-2 title');
      check(rmContent.includes('CLI'), 'Plan.5: ROADMAP has ms-3 title');
      check(rmContent.includes('C3 Integration'), 'Plan.6: ROADMAP has ms-4 title');
      check(rmContent.includes('v1'), 'Plan.7: ROADMAP is version 1');
    }

    // ═══ PHASE 4: BUILD — Milestones 1-4 ════════════════════════════════════

    console.log('\n═══ PHASE 4: BUILD — Milestone 1 (Encryption Engine) ═════════════');

    // Approve roadmap → first milestone plan
    const r5 = await handleLifecycleInput('schvaluji', context);
    logTurn('schvaluji', r5);
    const s5 = getLcState(SESSION_ID);
    check(s5?.currentMilestoneId === scopeId(s5.lifecycleId, 'ms-1'), 'MS1.1: currentMilestoneId is scoped ms-1');

    // Execute ms-1
    const r6 = await handleLifecycleInput('ano', context);
    logTurn('ano', r6);
    const ms1 = msRepo.getMilestone(scopeId(s5.lifecycleId, 'ms-1'));
    check(ms1?.status === 'PASSED', 'MS1.2: ms-1 PASSED in DB');
    check(fs.existsSync(path.join(projectPath, 'src/crypto.js')), 'MS1.3: src/crypto.js on disk');
    check(fs.existsSync(path.join(projectPath, 'tests/crypto.test.js')), 'MS1.4: tests/crypto.test.js on disk');

    // ROADMAP.md updated
    if (fs.existsSync(roadmapPath)) {
      const rm = fs.readFileSync(roadmapPath, 'utf-8');
      check(rm.includes('DONE'), 'MS1.5: ROADMAP shows DONE after ms-1');
    }

    // README.md refreshed
    check(fs.existsSync(path.join(projectPath, 'README.md')), 'MS1.6: README.md exists after ms-1');

    console.log('\n═══ PHASE 5: BUILD — Milestone 2 (Credential Store) ═══════════════');

    const s6 = getLcState(SESSION_ID);
    check(s6?.currentMilestoneId === scopeId(s6.lifecycleId, 'ms-2'), 'MS2.1: auto-advanced to scoped ms-2');

    const r7 = await handleLifecycleInput('ano', context);
    logTurn('ano', r7);
    const ms2 = msRepo.getMilestone(scopeId(s6.lifecycleId, 'ms-2'));
    check(ms2?.status === 'PASSED', 'MS2.2: ms-2 PASSED in DB');
    check(fs.existsSync(path.join(projectPath, 'src/store.js')), 'MS2.3: src/store.js on disk');

    console.log('\n═══ PHASE 6: BUILD — Milestone 3 (CLI Interface) ══════════════════');

    const s7 = getLcState(SESSION_ID);
    check(s7?.currentMilestoneId === scopeId(s7.lifecycleId, 'ms-3'), 'MS3.1: auto-advanced to scoped ms-3');

    const r8 = await handleLifecycleInput('ano', context);
    logTurn('ano', r8);
    const ms3 = msRepo.getMilestone(scopeId(s7.lifecycleId, 'ms-3'));
    check(ms3?.status === 'PASSED', 'MS3.2: ms-3 PASSED in DB');
    check(fs.existsSync(path.join(projectPath, 'src/cli.js')), 'MS3.3: src/cli.js on disk');
    check(fs.existsSync(path.join(projectPath, 'bin/klicenka')), 'MS3.4: bin/klicenka on disk');

    // After ms-3, a REVIEW is triggered (3 milestones completed)
    console.log('\n═══ PHASE 7: REVIEW (after ms-3) ════════════════════════════════════');

    const sAfterMs3 = getLcState(SESSION_ID);
    check(sAfterMs3?.phase === 'REVIEW', 'Review.1: review triggered after 3 milestones',
      `got: ${sAfterMs3?.phase}`);
    if (sAfterMs3?.phase === 'REVIEW') {
      console.log('  Review triggered after ms-3, acknowledging...');
      const rReview = await handleLifecycleInput('pokračovat', context);
      logTurn('pokračovat', rReview);
    }

    console.log('\n═══ PHASE 8: BUILD — Milestone 4 (C3 Integration) ═════════════════');

    const s8 = getLcState(SESSION_ID);
    check(s8?.currentMilestoneId === scopeId(s8.lifecycleId, 'ms-4'), 'MS4.1: auto-advanced to scoped ms-4',
      `got: ${s8?.currentMilestoneId}, phase: ${s8?.phase}`);

    const r9 = await handleLifecycleInput('ano', context);
    logTurn('ano', r9);
    const ms4 = msRepo.getMilestone(scopeId(s8.lifecycleId, 'ms-4'));
    check(ms4?.status === 'PASSED', 'MS4.2: ms-4 PASSED in DB', `got: ${ms4?.status}`);
    check(fs.existsSync(path.join(projectPath, 'src/integration.js')), 'MS4.3: src/integration.js on disk');
    check(fs.existsSync(path.join(projectPath, 'src/index.js')), 'MS4.4: src/index.js on disk');

    // ═══ PHASE 9: COMPLETED ═════════════════════════════════════════════════

    console.log('\n═══ PHASE 9: COMPLETED ═════════════════════════════════════════════');

    // After ms-4, if another REVIEW is triggered, acknowledge it
    const sAfterMs4 = getLcState(SESSION_ID);
    if (sAfterMs4?.phase === 'REVIEW') {
      console.log('  Final review triggered, acknowledging...');
      const rFinalReview = await handleLifecycleInput('pokračovat', context);
      logTurn('pokračovat', rFinalReview);
    }

    // ═══ FINAL VERIFICATION ═════════════════════════════════════════════════

    console.log('\n═══ FINAL VERIFICATION ═════════════════════════════════════════════');

    const lifecycleId = s4.lifecycleId;

    // DB: lifecycle COMPLETED
    const lcDb = lifecycleRepo.findById.get(lifecycleId);
    check(lcDb?.phase === 'COMPLETED', 'Final.1: lifecycle is COMPLETED');

    // DB: all 4 milestones PASSED
    const allMs = msRepo.listByLifecycle(lifecycleId);
    check(allMs.length === 4, 'Final.2: 4 milestones exist', `got: ${allMs.length}`);
    const allPassed = allMs.every(m => m.status === 'PASSED');
    check(allPassed, 'Final.3: all milestones PASSED',
      `statuses: ${allMs.map(m => `${m.id}=${m.status}`).join(', ')}`);

    // DB: roadmap version
    const rv = roadmapVersions.getLatestVersion(lifecycleId);
    check(rv === 1, 'Final.4: roadmap version is 1');

    // lcState cleared after COMPLETED
    const sEnd = getLcState(SESSION_ID);
    check(sEnd === null, 'Final.5: lcState cleared after COMPLETED');

    // ROADMAP.md final state — all DONE
    if (fs.existsSync(roadmapPath)) {
      const rmFinal = fs.readFileSync(roadmapPath, 'utf-8');
      const doneCount = (rmFinal.match(/DONE/g) || []).length;
      check(doneCount === 4, 'Final.6: ROADMAP.md has all 4 DONE', `got: ${doneCount}`);
      check(!rmFinal.includes('PENDING'), 'Final.7: ROADMAP.md has no PENDING');
      console.log('\n  ─── ROADMAP.md content ───');
      console.log(rmFinal.split('\n').map(l => `    ${l}`).join('\n'));
    }

    // README.md exists
    check(fs.existsSync(path.join(projectPath, 'README.md')), 'Final.8: README.md exists');

    // Git: commits (init + 4 milestones = 5+)
    try {
      const gitLog = execSync('git log --oneline', { cwd: projectPath, encoding: 'utf8' });
      const commits = gitLog.trim().split('\n');
      check(commits.length >= 5, 'Final.9: git has 5+ commits (init + 4 milestones)',
        `got: ${commits.length}`);
      console.log('\n  ─── Git log ───');
      commits.forEach(l => console.log(`    ${l}`));
    } catch (e) {
      check(false, 'Final.9: git log available', e.message);
    }

    // Source files on disk
    const expectedFiles = [
      'src/crypto.js', 'src/store.js', 'src/cli.js',
      'src/integration.js', 'src/index.js',
      'tests/crypto.test.js', 'tests/store.test.js',
      'bin/klicenka',
    ];
    let fileCount = 0;
    for (const f of expectedFiles) {
      if (fs.existsSync(path.join(projectPath, f))) fileCount++;
    }
    check(fileCount === expectedFiles.length,
      `Final.10: all ${expectedFiles.length} source files exist`,
      `got: ${fileCount}/${expectedFiles.length}`);

    // Build progress
    const progress = getBuildProgress(lifecycleId);
    check(progress.percentage === 100, 'Final.11: progress is 100%', `got: ${progress.percentage}%`);

    // ═══ CONVERSATION & PROJECT IN DB ═════════════════════════════════════

    console.log('\n═══ DB VERIFICATION (projekt + konverzace) ═════════════════════════');

    // Project registered in DB
    const dbProject = projects.findByPath.get(projectPath);
    check(dbProject != null, 'DB.1: project registered in DB');
    check(dbProject?.name === projectName, 'DB.2: project name matches isolated project',
      `got: ${dbProject?.name}, expected: ${projectName}`);

    // Conversation linked to project
    const dbConv = conversations.findById.get(CONV_ID);
    check(dbConv != null, 'DB.3: conversation exists in DB');
    check(Number(dbConv?.project_id) === projectId, 'DB.4: conversation linked to project',
      `got project_id: ${dbConv?.project_id}, expected: ${projectId}`);

    // Messages in conversation
    const dbMessages = messages.listByConversation.all(CONV_ID);
    check(dbMessages.length >= 14, 'DB.5: conversation has 14+ messages (7+ turns)',
      `got: ${dbMessages.length}`);

    const userMsgs = dbMessages.filter(m => m.role === 'user');
    const assistantMsgs = dbMessages.filter(m => m.role === 'assistant');
    check(userMsgs.length >= 7, 'DB.6: 7+ user messages', `got: ${userMsgs.length}`);
    check(assistantMsgs.length >= 7, 'DB.7: 7+ assistant messages', `got: ${assistantMsgs.length}`);

    // Conversation has messages — show summary
    console.log(`\n  ─── Conversation: ${CONV_ID} ───`);
    console.log(`    Project: ${dbProject?.name} (id: ${projectId})`);
    console.log(`    Messages: ${dbMessages.length} (${userMsgs.length} user, ${assistantMsgs.length} assistant)`);
    console.log(`    Title: ${dbConv?.title}`);

    console.log(`\n  ── Dočasný projekt: ${projectPath}`);
    console.log(`  ── Konverzace v DB: ${CONV_ID}`);
    console.log(`  ── Projekt v DB: id=${projectId}, name=${dbProject?.name}`);

  } catch (err) {
    console.error(`\n\nFATAL ERROR: ${err.message}`);
    console.error(err.stack);
    failed++;
    failures.push({ name: 'FATAL', detail: err.message });
  }

  if (failed === 0 && process.env.KEEP_PROJECT !== '1') {
    fs.rmSync(projectPath, { recursive: true, force: true });
    console.log(`\n  🧹 Dočasný projekt odstraněn: ${projectPath}`);
  } else {
    console.log(`\n  ℹ️ Dočasný projekt ponechán pro diagnostiku: ${projectPath}`);
  }

  // ═══ Summary ════════════════════════════════════════════════════════════

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`  Test 4 Klíčenka: ${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.log('\n  FAILURES:');
    for (const f of failures) {
      console.log(`    ❌ ${f.name}: ${f.detail}`);
    }
  }

  console.log('══════════════════════════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

run();
