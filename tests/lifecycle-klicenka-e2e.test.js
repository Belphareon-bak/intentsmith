// Lifecycle E2E Test — Klíčenka (Credential Vault for C3)
// ══════════════════════════════════════════════════════════════════════════════
// Real scenario: User creates a secure credential vault that C3 will use
// to store API keys, tokens, and sensitive config (Ollama URL, SMTP creds, etc.)
//
// Full lifecycle WITH change management:
//   PROPOSED → SPEC → SPEC_REVIEW → PLAN_REVIEW → BUILD (2 ms)
//   → CHANGE (add backup/export) → BUILD (ms-3) → COMPLETED
//
// Project: c3-keychain — encrypted credential vault
//   ms-1: Encrypted storage core (crypto + vault store)
//   ms-2: REST API for C3 integration (Express endpoints + auth middleware)
//   ms-3: CLI management interface (added via change request)
//
// Run: node tests/lifecycle-klicenka-e2e.test.js
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

import {
  ProjectPhase,
  MilestoneStatus,
  getBuildProgress,
  computeLifecycleProgress,
  formatLifecycleProgress,
  formatMilestoneTable,
} from '../src/planner/index.js';

import {
  lifecycles as lifecycleRepo,
  milestones as msRepo,
  roadmapVersions,
  changeRequests as crRepo,
  driftChecks,
  projects,
  lifecycleHandoffState,
  db,
} from '../src/db/database.js';

import {
  handleLifecycleBuildDetected,
  handleLifecycleInput,
} from '../src/chat/handlers/lifecycle-handoff.js';

import { getLcState, setLcState, clearLcState, initLifecycleStateDb } from '../src/chat/handlers/lifecycle-state.js';


// ─── Test Infra ─────────────────────────────────────────────────────────────

const transcript = [];
let turnNum = 0;
let passed = 0;
let failed = 0;
const failures = [];

function userTurn(message) {
  turnNum++;
  transcript.push({ turn: turnNum, role: 'USER', content: message });
  console.log(`\n${'─'.repeat(70)}`);
  console.log(` TURN ${turnNum} │ USER`);
  console.log(`${'─'.repeat(70)}`);
  console.log(message);
  return message;
}

function systemTurn(phase, response) {
  turnNum++;
  const content = typeof response === 'string' ? response : (response?.content || JSON.stringify(response));
  transcript.push({ turn: turnNum, role: 'SYSTEM', phase, content });
  console.log(`\n${'─'.repeat(70)}`);
  console.log(` TURN ${turnNum} │ SYSTEM — Phase: ${phase}`);
  console.log(`${'─'.repeat(70)}`);
  console.log(content?.substring(0, 500) + (content?.length > 500 ? '\n  ...(truncated)' : ''));
}

function check(condition, name, detail = '') {
  if (condition) {
    passed++;
    console.log(`    ✅ ${name}`);
  } else {
    failed++;
    console.log(`    ❌ ${name}: ${detail}`);
    failures.push({ name, detail });
  }
}

// ─── Sample Data — c3-keychain ──────────────────────────────────────────────

const SAMPLE_SPEC = {
  title: 'c3-keychain — Encrypted Credential Vault',
  goals: [
    { id: 'G1', description: 'Securely store credentials with AES-256-GCM encryption', priority: 'MUST', success_criteria: 'Credentials encrypted at rest, master key never stored in plaintext' },
    { id: 'G2', description: 'REST API for C3 agent to read/write credentials', priority: 'MUST', success_criteria: 'GET/POST/DELETE /api/credentials with bearer auth' },
    { id: 'G3', description: 'CLI for manual credential management', priority: 'SHOULD', success_criteria: 'keychain get/set/list/delete commands work from terminal' },
  ],
  requirements: [
    { id: 'R1', description: 'AES-256-GCM encryption with PBKDF2-derived key', type: 'security', goal_id: 'G1', acceptance_test: 'Encrypt value, decrypt it, verify plaintext matches original' },
    { id: 'R2', description: 'Master password hashing with scrypt', type: 'security', goal_id: 'G1', acceptance_test: 'Hash password with scrypt, verify derived key length is 32 bytes' },
    { id: 'R3', description: 'RESTful CRUD for credentials', type: 'functional', goal_id: 'G2', acceptance_test: 'POST credential, GET it back, PUT update, DELETE, verify 404' },
    { id: 'R4', description: 'Bearer token authentication middleware', type: 'security', goal_id: 'G2', acceptance_test: 'Request without token returns 401, with valid token returns 200' },
    { id: 'R5', description: 'CLI commands: get, set, list, delete', type: 'functional', goal_id: 'G3', acceptance_test: 'Run set command, then get command, verify stored value returned' },
  ],
  tech_stack: {
    languages: ['JavaScript'],
    frameworks: ['Node.js', 'Express'],
    tools: ['better-sqlite3', 'crypto (built-in)'],
    rationale: 'Node.js for C3 integration. Built-in crypto for no external deps. SQLite for single-file DB.',
  },
  architecture: {
    pattern: 'Service layer with encrypted storage',
    components: ['src/crypto.js', 'src/vault.js', 'src/api.js', 'src/cli.js'],
    data_model: 'credentials (id, namespace, key, encrypted_value, iv, tag, created_at, updated_at)',
  },
  risks: [
    { id: 'RISK1', description: 'Master key in memory during runtime', severity: 'MEDIUM', mitigation: 'Key derived on demand, zeroed after use' },
    { id: 'RISK2', description: 'SQLite file accessible on disk', severity: 'LOW', mitigation: 'Values encrypted before storage, only ciphertext in DB' },
  ],
  constraints: ['No external crypto libraries — use Node.js built-in crypto only', 'Must work offline'],
  out_of_scope: ['Cloud key management (KMS)', 'Hardware security modules', 'Multi-user access'],
  design_decisions: [
    { id: 'DD1', decision: 'Encryption algorithm', chosen: 'AES-256-GCM', alternatives_considered: ['ChaCha20-Poly1305', 'AES-256-CBC'], rationale: 'GCM provides authenticated encryption (integrity + confidentiality) in one operation' },
    { id: 'DD2', decision: 'Key derivation', chosen: 'scrypt', alternatives_considered: ['PBKDF2', 'argon2'], rationale: 'scrypt is memory-hard (resistant to ASIC attacks), available in Node.js crypto' },
  ],
  acceptance_criteria: [
    'Credentials encrypted with AES-256-GCM, master key derived via scrypt',
    'REST API with bearer auth works for C3 integration',
    'CLI can manage credentials from terminal',
  ],
};

const SAMPLE_ROADMAP = {
  milestones: [
    {
      id: 'ms-1',
      title: 'Encrypted Storage Core',
      description: 'Crypto module (AES-256-GCM + scrypt) and vault store (SQLite)',
      dependencies: [],
      estimated_loc: 200,
      estimated_files: 3,
      estimated_complexity: 'MEDIUM',
      goals_addressed: ['G1'],
      requirements_addressed: ['R1', 'R2'],
      deliverables: ['package.json', 'src/crypto.js', 'src/vault.js'],
    },
    {
      id: 'ms-2',
      title: 'REST API for C3 Integration',
      description: 'Express REST API with bearer token auth middleware',
      dependencies: ['ms-1'],
      estimated_loc: 250,
      estimated_files: 3,
      estimated_complexity: 'MEDIUM',
      goals_addressed: ['G2'],
      requirements_addressed: ['R3', 'R4'],
      deliverables: ['src/api.js', 'src/middleware/auth.js', 'src/server.js'],
    },
  ],
  total_estimated_loc: 450,
  total_milestones: 2,
  critical_path: ['ms-1', 'ms-2'],
};

// Roadmap after change request adds ms-3
const ROADMAP_WITH_CLI = {
  milestones: [
    ...SAMPLE_ROADMAP.milestones,
    {
      id: 'ms-3',
      title: 'CLI Management Interface',
      description: 'Commander.js CLI for managing credentials from terminal',
      dependencies: ['ms-1'],
      estimated_loc: 120,
      estimated_files: 1,
      estimated_complexity: 'LOW',
      goals_addressed: ['G3'],
      requirements_addressed: ['R5'],
      deliverables: ['src/cli.js'],
    },
  ],
  total_estimated_loc: 570,
  total_milestones: 3,
  critical_path: ['ms-1', 'ms-2', 'ms-3'],
};

const MILESTONE_PLANS = {
  'ms-1': {
    milestone_id: 'ms-1',
    files: [
      { path: 'package.json', action: 'create', purpose: 'Project manifest with better-sqlite3' },
      { path: 'src/crypto.js', action: 'create', purpose: 'AES-256-GCM encrypt/decrypt + scrypt key derivation' },
      { path: 'src/vault.js', action: 'create', purpose: 'Credential CRUD with encrypted storage' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create package.json with better-sqlite3 and express deps', file: 'package.json' },
      { step: 2, action: 'Create src/crypto.js with encrypt, decrypt, deriveKey functions', file: 'src/crypto.js' },
      { step: 3, action: 'Create src/vault.js with Vault class (get, set, list, delete)', file: 'src/vault.js' },
    ],
    scope_files: ['package.json', 'src/crypto.js', 'src/vault.js'],
    rollback_strategy: 'Delete created files',
  },
  'ms-2': {
    milestone_id: 'ms-2',
    files: [
      { path: 'src/api.js', action: 'create', purpose: 'Express route handlers for credentials' },
      { path: 'src/middleware/auth.js', action: 'create', purpose: 'Bearer token authentication' },
      { path: 'src/server.js', action: 'create', purpose: 'Express server entry point' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create auth middleware with bearer token validation', file: 'src/middleware/auth.js' },
      { step: 2, action: 'Create REST routes: GET/POST/DELETE /api/credentials', file: 'src/api.js' },
      { step: 3, action: 'Create server.js entry point', file: 'src/server.js' },
    ],
    scope_files: ['src/api.js', 'src/middleware/auth.js', 'src/server.js'],
    rollback_strategy: 'Delete created files',
  },
  'ms-3': {
    milestone_id: 'ms-3',
    files: [
      { path: 'src/cli.js', action: 'create', purpose: 'Commander.js CLI for credential management' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create CLI with get, set, list, delete commands using Vault', file: 'src/cli.js' },
    ],
    scope_files: ['src/cli.js'],
    rollback_strategy: 'Delete src/cli.js',
  },
};

// ─── Real Project Files ─────────────────────────────────────────────────────

const PROJECT_FILES = {
  'ms-1': {
    'package.json': JSON.stringify({
      name: 'c3-keychain',
      version: '1.0.0',
      type: 'module',
      main: 'src/server.js',
      bin: { keychain: './src/cli.js' },
      scripts: {
        start: 'node src/server.js',
        test: 'node --test',
      },
      dependencies: {
        'better-sqlite3': '^11.0.0',
        'express': '^5.0.0',
        'commander': '^12.0.0',
      },
    }, null, 2),
    'src/crypto.js': `import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export function deriveKey(masterPassword, salt) {
  const saltBuf = salt ? Buffer.from(salt, 'hex') : randomBytes(SALT_LENGTH);
  const key = scryptSync(masterPassword, saltBuf, KEY_LENGTH, SCRYPT_PARAMS);
  return { key, salt: saltBuf.toString('hex') };
}

export function encrypt(plaintext, key) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

export function decrypt(ciphertext, key, iv, tag) {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
`,
    'src/vault.js': `import Database from 'better-sqlite3';
import { encrypt, decrypt, deriveKey } from './crypto.js';

export class Vault {
  constructor(dbPath, masterPassword) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this._initSchema();

    // Derive encryption key from master password
    const meta = this.db.prepare('SELECT value FROM vault_meta WHERE key = ?').get('salt');
    const salt = meta?.value || null;
    const derived = deriveKey(masterPassword, salt);
    this.key = derived.key;
    if (!salt) {
      this.db.prepare('INSERT INTO vault_meta (key, value) VALUES (?, ?)').run('salt', derived.salt);
    }
  }

  _initSchema() {
    this.db.exec(\`
      CREATE TABLE IF NOT EXISTS credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        namespace TEXT NOT NULL DEFAULT 'default',
        key TEXT NOT NULL,
        encrypted_value TEXT NOT NULL,
        iv TEXT NOT NULL,
        tag TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(namespace, key)
      );
      CREATE TABLE IF NOT EXISTS vault_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    \`);
  }

  set(namespace, key, value) {
    const { ciphertext, iv, tag } = encrypt(value, this.key);
    this.db.prepare(\`
      INSERT INTO credentials (namespace, key, encrypted_value, iv, tag)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(namespace, key) DO UPDATE SET
        encrypted_value = excluded.encrypted_value,
        iv = excluded.iv,
        tag = excluded.tag,
        updated_at = datetime('now')
    \`).run(namespace, key, ciphertext, iv, tag);
  }

  get(namespace, key) {
    const row = this.db.prepare(
      'SELECT encrypted_value, iv, tag FROM credentials WHERE namespace = ? AND key = ?'
    ).get(namespace, key);
    if (!row) return null;
    return decrypt(row.encrypted_value, this.key, row.iv, row.tag);
  }

  list(namespace = null) {
    if (namespace) {
      return this.db.prepare('SELECT namespace, key, created_at, updated_at FROM credentials WHERE namespace = ?').all(namespace);
    }
    return this.db.prepare('SELECT namespace, key, created_at, updated_at FROM credentials').all();
  }

  delete(namespace, key) {
    return this.db.prepare('DELETE FROM credentials WHERE namespace = ? AND key = ?').run(namespace, key);
  }

  close() {
    this.db.close();
  }
}
`,
  },
  'ms-2': {
    'src/middleware/auth.js': `const BEARER_TOKEN = process.env.KEYCHAIN_TOKEN || 'dev-token-change-me';

export function bearerAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = header.slice(7);
  if (token !== BEARER_TOKEN) {
    return res.status(403).json({ error: 'Invalid token' });
  }
  next();
}
`,
    'src/api.js': `import { Router } from 'express';

export function createRouter(vault) {
  const router = Router();

  router.get('/credentials', (req, res) => {
    const ns = req.query.namespace || null;
    res.json(vault.list(ns));
  });

  router.get('/credentials/:namespace/:key', (req, res) => {
    const value = vault.get(req.params.namespace, req.params.key);
    if (value === null) return res.status(404).json({ error: 'Not found' });
    res.json({ namespace: req.params.namespace, key: req.params.key, value });
  });

  router.post('/credentials', (req, res) => {
    const { namespace = 'default', key, value } = req.body;
    if (!key || !value) return res.status(400).json({ error: 'key and value required' });
    vault.set(namespace, key, value);
    res.status(201).json({ status: 'stored', namespace, key });
  });

  router.delete('/credentials/:namespace/:key', (req, res) => {
    const result = vault.delete(req.params.namespace, req.params.key);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ status: 'deleted' });
  });

  return router;
}
`,
    'src/server.js': `import express from 'express';
import { Vault } from './vault.js';
import { createRouter } from './api.js';
import { bearerAuth } from './middleware/auth.js';

const PORT = process.env.KEYCHAIN_PORT || 3336;
const DB_PATH = process.env.KEYCHAIN_DB || './data/keychain.db';
const MASTER_PASSWORD = process.env.KEYCHAIN_MASTER || 'change-me-in-production';

const vault = new Vault(DB_PATH, MASTER_PASSWORD);
const app = express();

app.use(express.json());
app.use('/api', bearerAuth);
app.use('/api', createRouter(vault));
app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(\`c3-keychain listening on :\${PORT}\`));

process.on('SIGTERM', () => { vault.close(); process.exit(0); });
`,
  },
  'ms-3': {
    'src/cli.js': `#!/usr/bin/env node
import { Command } from 'commander';
import { Vault } from './vault.js';

const DB_PATH = process.env.KEYCHAIN_DB || './data/keychain.db';
const MASTER_PASSWORD = process.env.KEYCHAIN_MASTER || 'change-me-in-production';

const program = new Command();
program.name('keychain').description('C3 Credential Vault CLI').version('1.0.0');

program.command('set <key> <value>')
  .option('-n, --namespace <ns>', 'Namespace', 'default')
  .description('Store a credential')
  .action((key, value, opts) => {
    const vault = new Vault(DB_PATH, MASTER_PASSWORD);
    vault.set(opts.namespace, key, value);
    console.log(\`Stored: \${opts.namespace}/\${key}\`);
    vault.close();
  });

program.command('get <key>')
  .option('-n, --namespace <ns>', 'Namespace', 'default')
  .description('Retrieve a credential')
  .action((key, opts) => {
    const vault = new Vault(DB_PATH, MASTER_PASSWORD);
    const value = vault.get(opts.namespace, key);
    if (value === null) { console.error('Not found'); process.exit(1); }
    console.log(value);
    vault.close();
  });

program.command('list')
  .option('-n, --namespace <ns>', 'Filter by namespace')
  .description('List stored credentials')
  .action((opts) => {
    const vault = new Vault(DB_PATH, MASTER_PASSWORD);
    const creds = vault.list(opts.namespace);
    if (creds.length === 0) { console.log('No credentials stored.'); }
    for (const c of creds) {
      console.log(\`  \${c.namespace}/\${c.key}  (updated: \${c.updated_at})\`);
    }
    vault.close();
  });

program.command('delete <key>')
  .option('-n, --namespace <ns>', 'Namespace', 'default')
  .description('Delete a credential')
  .action((key, opts) => {
    const vault = new Vault(DB_PATH, MASTER_PASSWORD);
    vault.delete(opts.namespace, key);
    console.log(\`Deleted: \${opts.namespace}/\${key}\`);
    vault.close();
  });

program.parse();
`,
  },
};

// ─── Fake LLM ────────────────────────────────────────────────────────────────

let changeRequested = false;

function createFakeLLM() {
  return async function fakeLLM(role, prompt) {
    const p = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

    if (p.includes('## User Request') || p.includes('clarifying questions')) {
      return {
        content: JSON.stringify({
          core_goal: 'Encrypted credential vault for C3 agent platform',
          clarifying_questions: [
            'Jaký šifrovací algoritmus preferuješ? (AES-256 / ChaCha20)',
            'Má vault běžet jako REST server nebo pouze jako knihovna?',
            'Potřebuješ namespace oddělení credentialů? (ollama / smtp / telegram)',
          ],
          initial_assessment: {
            estimated_complexity: 'MEDIUM',
            key_risks: ['Master key management'],
            suggested_tech_stack: ['Node.js', 'crypto', 'better-sqlite3'],
          },
        }),
      };
    }

    if (p.includes('thorough project specification') || p.includes('creating a project specification') || p.includes('structured project specification')) {
      return { content: JSON.stringify(SAMPLE_SPEC) };
    }

    if (p.includes('creating a project roadmap') || p.includes('Break the project into milestones')) {
      return { content: JSON.stringify(SAMPLE_ROADMAP) };
    }

    if (p.includes('implementing a specific milestone') || p.includes('implementation plan for THIS milestone')) {
      const msIdMatch = p.match(/"id"\s*:\s*"(ms-\d+)"/);
      const msId = msIdMatch ? msIdMatch[1] : 'ms-1';
      return { content: JSON.stringify(MILESTONE_PLANS[msId] || MILESTONE_PLANS['ms-1']) };
    }

    if (p.includes('reviewing a completed milestone') || p.includes('Compare the actual output')) {
      return {
        content: JSON.stringify({
          passed: true,
          deliverables_check: [{ deliverable: 'Files created', status: 'DONE', note: 'All expected files present' }],
          scope_violations: [],
          test_summary: { total: 3, passed: 3, failed: 0, coverage_estimate: '70%' },
          quality_notes: ['Encryption correctly uses AES-256-GCM with authenticated tags'],
          overall_assessment: 'Milestone completed — security review passed',
        }),
      };
    }

    if (p.includes('computing health metrics') || p.includes('health metrics for a completed milestone')) {
      return {
        content: JSON.stringify({
          scope_adherence: 0.95,
          test_coverage: 0.70,
          complexity_delta: 0.12,
          tech_debt_delta: 0.05,
        }),
      };
    }

    if (p.includes('conducting a project review') || p.includes('4 drift checks')) {
      return {
        content: JSON.stringify({
          spec_alignment: { addressed_goals: ['G1', 'G2'], unaddressed_goals: ['G3'], missed_requirements: [], confidence: 0.85 },
          scope_creep: { in_scope: ['Crypto', 'Vault', 'API'], out_of_scope: [], severity: 'NONE', confidence: 0.90 },
          architecture_consistency: { consistent: true, violations: [], confidence: 0.92 },
          tech_debt: { items: [], trend: 'STABLE', confidence: 0.78 },
          overall_health: 'GREEN',
          recommendations: ['Add CLI for manual management — G3 not yet addressed'],
        }),
      };
    }

    // CHANGE: analyze
    if (p.includes('analyzing a change request') || p.includes('impact of this change')) {
      return {
        content: JSON.stringify({
          affected_milestones: [],
          impact: {
            milestones_to_add: [{ id: 'ms-3', title: 'CLI Management Interface', estimated_loc: 120 }],
            milestones_to_remove: [],
            milestones_to_modify: [],
            effort_delta: '+120 LOC',
            risk_level: 'LOW',
          },
          feasibility: 'FEASIBLE',
          recommendation: 'Low-risk addition, addresses G3 goal. Recommend approval.',
        }),
      };
    }

    // CHANGE: rewrite roadmap with CLI milestone
    if (p.includes('rewriting a project roadmap') || p.includes('incorporate an approved change')) {
      return {
        content: JSON.stringify({
          milestones: ROADMAP_WITH_CLI.milestones,
          changes_summary: 'Added ms-3: CLI Management Interface',
          diff: { added: ['ms-3'], removed: [], modified: [], preserved: ['ms-1', 'ms-2'] },
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
      const msId = context.milestoneId;
      const files = PROJECT_FILES[msId] || {};

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
  for (const t of ['lifecycle_handoff_state', 'drift_checks', 'change_requests',
                    'milestones', 'roadmap_versions', 'project_lifecycles']) {
    try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ }
  }
  try { db.prepare(`DELETE FROM projects WHERE path LIKE '/tmp/%'`).run(); } catch { /* ignore */ }
  initLifecycleStateDb(lifecycleHandoffState, lifecycleRepo);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN TEST
// ═══════════════════════════════════════════════════════════════════════════════

async function runTest() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  Lifecycle E2E: Klíčenka (c3-keychain — Credential Vault)');
  console.log('══════════════════════════════════════════════════════════════════════');

  cleanDB();

  const SESSION_ID = 'klicenka-e2e-test';
  const projectPath = `/tmp/lc-klicenka-e2e-${Date.now()}`;
  fs.mkdirSync(projectPath, { recursive: true });
  execSync('git init', { cwd: projectPath, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: projectPath, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: projectPath, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "init"', { cwd: projectPath, stdio: 'pipe' });

  const fakeLLM = createFakeLLM();
  const fakeExecutor = createFakeExecutor(projectPath);
  const context = { sessionId: SESSION_ID, callLLM: fakeLLM, executor: fakeExecutor, projectPath };

  try {
    // ═══ PHASE 1: Proposal ════════════════════════════════════════════════

    console.log('\n\n═══ PHASE 1: Detection + Proposal ═══════════════════════════════════');

    const userMsg1 = userTurn(
      'Potřebuju vytvořit kompletní klíčenku pro C3 — bezpečné úložiště credentials a citlivých údajů, ' +
      'které bude C3 používat pro API klíče, tokeny Ollama, SMTP hesla a další konfiguraci'
    );

    const response1 = handleLifecycleBuildDetected(userMsg1, { intent: 'BUILD' }, context);
    systemTurn('PROPOSED', response1);

    check(response1?.content?.includes('lifecycle'), 'T1: response mentions lifecycle');
    const state1 = getLcState(SESSION_ID);
    check(state1?.phase === 'PROPOSED', 'T1: state is PROPOSED');

    // ═══ PHASE 2: SPEC ═══════════════════════════════════════════════════

    console.log('\n\n═══ PHASE 2: SPEC ══════════════════════════════════════════════════');

    const userMsg2 = userTurn('ano');
    const response2 = await handleLifecycleInput(userMsg2, context);
    systemTurn('SPEC', response2);

    const state2 = getLcState(SESSION_ID);
    check(state2?.phase === 'SPEC', 'T2: state is SPEC', `got: ${state2?.phase}`);
    check(state2?.lifecycleId != null, 'T2: lifecycleId set');

    // Answer spec questions
    const userMsg3 = userTurn(
      'AES-256-GCM. REST server, C3 bude volat přes HTTP. Ano, namespace oddělení — ollama, smtp, telegram, custom.'
    );
    const response3 = await handleLifecycleInput(userMsg3, context);
    systemTurn('SPEC_REVIEW', response3);

    const state3 = getLcState(SESSION_ID);
    check(state3?.phase === 'SPEC_REVIEW', 'T3: state is SPEC_REVIEW', `got: ${state3?.phase}`);

    // ═══ PHASE 3: SPEC_REVIEW → PLAN_REVIEW ══════════════════════════════

    console.log('\n\n═══ PHASE 3: Approve Spec → Roadmap ═════════════════════════════════');

    const userMsg4 = userTurn('schvaluji');
    const response4 = await handleLifecycleInput(userMsg4, context);
    systemTurn('PLAN_REVIEW', response4);

    const state4 = getLcState(SESSION_ID);
    check(state4?.phase === 'PLAN_REVIEW', 'T4: state is PLAN_REVIEW', `got: ${state4?.phase}`);
    check(response4?.content?.includes('ms-1') || response4?.content?.includes('Encrypted'),
      'T4: roadmap contains ms-1');

    // ═══ PHASE 4: BUILD — ms-1 (Crypto + Vault) ══════════════════════════

    console.log('\n\n═══ PHASE 4: BUILD — ms-1 (Crypto + Vault) ══════════════════════════');

    const userMsg5 = userTurn('schvaluji');
    const response5 = await handleLifecycleInput(userMsg5, context);
    systemTurn('BUILD ms-1 plan', response5);

    const state5 = getLcState(SESSION_ID);
    check(state5?.currentMilestoneId === 'ms-1', 'T5: currentMilestoneId is ms-1');

    const userMsg6 = userTurn('ano');
    const response6 = await handleLifecycleInput(userMsg6, context);
    systemTurn('BUILD ms-1 result', response6);

    const ms1Db = msRepo.getMilestone('ms-1');
    check(ms1Db?.status === 'PASSED', 'T6: ms-1 PASSED', `got: ${ms1Db?.status}`);

    // Verify crypto code
    check(fs.existsSync(path.join(projectPath, 'src/crypto.js')), 'T6: src/crypto.js exists');
    check(fs.existsSync(path.join(projectPath, 'src/vault.js')), 'T6: src/vault.js exists');

    const cryptoContent = fs.readFileSync(path.join(projectPath, 'src/crypto.js'), 'utf8');
    check(cryptoContent.includes('aes-256-gcm'), 'T6: crypto uses AES-256-GCM');
    check(cryptoContent.includes('scryptSync'), 'T6: crypto uses scrypt for key derivation');
    check(cryptoContent.includes('getAuthTag'), 'T6: crypto uses authenticated encryption (GCM tag)');

    const vaultContent = fs.readFileSync(path.join(projectPath, 'src/vault.js'), 'utf8');
    check(vaultContent.includes('class Vault'), 'T6: vault.js has Vault class');
    check(vaultContent.includes('encrypt('), 'T6: vault.js calls encrypt()');
    check(vaultContent.includes('decrypt('), 'T6: vault.js calls decrypt()');
    check(vaultContent.includes('namespace'), 'T6: vault.js supports namespaces');

    // ═══ PHASE 5: CHANGE — Add CLI (before ms-2 approval) ═════════════

    console.log('\n\n═══ PHASE 5: CHANGE — Add CLI Management ════════════════════════════');

    // After ms-1, lifecycle auto-advanced to ms-2 BUILD_MILESTONE_REVIEW.
    // Instead of approving ms-2, inject a change request (supported in BUILD_MILESTONE_REVIEW).
    const state6 = getLcState(SESSION_ID);
    check(state6?.currentMilestoneId === 'ms-2', 'T7: auto-advanced to ms-2',
      `got: ${state6?.currentMilestoneId}`);

    const userMsg7 = userTurn('změna: přidat CLI rozhraní pro správu credentials z terminálu');
    const response7 = await handleLifecycleInput(userMsg7, context);
    systemTurn('CHANGE proposal', response7);

    const state7 = getLcState(SESSION_ID);
    check(state7?.phase === 'CHANGE', 'T8: state is CHANGE', `got: ${state7?.phase}`);
    check(response7?.content?.includes('CLI') || response7?.content?.includes('změ'),
      'T8: change proposal mentions CLI');

    // Approve change
    const userMsg8 = userTurn('ano');
    const response8 = await handleLifecycleInput(userMsg8, context);
    systemTurn('BUILD (change approved)', response8);

    const state8 = getLcState(SESSION_ID);
    check(state8?.phase === 'BUILD', 'T9: state is BUILD after change approval', `got: ${state8?.phase}`);

    // Verify roadmap version incremented
    const lifecycleId = state8?.lifecycleId || state7?.lifecycleId;
    const roadmapV = roadmapVersions.getLatestVersion(lifecycleId);
    check(roadmapV >= 2, 'T9: roadmap version ≥2 (change applied)', `got: ${roadmapV}`);

    // Verify change request in DB
    const allCR = crRepo.findByLifecycle ? crRepo.findByLifecycle.all(lifecycleId) : [];
    check(allCR.length >= 1, 'T9: change request exists in DB', `got: ${allCR.length}`);
    if (allCR.length > 0) {
      check(allCR[0].status === 'APPROVED' || allCR[0].status === 'APPLIED',
        'T9: change request APPROVED/APPLIED', `got: ${allCR[0].status}`);
    }

    // ═══ PHASE 6: BUILD — ms-2 (REST API) ════════════════════════════════

    console.log('\n\n═══ PHASE 6: BUILD — ms-2 (REST API) ════════════════════════════════');

    // After change approved, continue building — next milestone (ms-2, not yet built)
    const userMsg9 = userTurn('ano');
    const response9 = await handleLifecycleInput(userMsg9, context);
    systemTurn('BUILD ms-2', response9);

    // ms-2 should now be in BUILD_MILESTONE_REVIEW or already executed
    const state9 = getLcState(SESSION_ID);
    if (state9?.phase === 'BUILD_MILESTONE_REVIEW') {
      // Need one more approval to execute
      const userMsg9b = userTurn('ano');
      const response9b = await handleLifecycleInput(userMsg9b, context);
      systemTurn('BUILD ms-2 exec', response9b);
    }

    const ms2Db = msRepo.getMilestone('ms-2');
    check(ms2Db?.status === 'PASSED', 'T10: ms-2 PASSED', `got: ${ms2Db?.status}`);

    check(fs.existsSync(path.join(projectPath, 'src/api.js')), 'T10: src/api.js exists');
    check(fs.existsSync(path.join(projectPath, 'src/middleware/auth.js')), 'T10: src/middleware/auth.js exists');
    check(fs.existsSync(path.join(projectPath, 'src/server.js')), 'T10: src/server.js exists');

    const authContent = fs.readFileSync(path.join(projectPath, 'src/middleware/auth.js'), 'utf8');
    check(authContent.includes('Bearer'), 'T10: auth middleware checks Bearer token');
    check(authContent.includes('401'), 'T10: auth returns 401 on missing auth');
    check(authContent.includes('403'), 'T10: auth returns 403 on invalid token');

    const apiContent = fs.readFileSync(path.join(projectPath, 'src/api.js'), 'utf8');
    check(apiContent.includes('/credentials'), 'T10: API has /credentials endpoint');
    check(apiContent.includes('POST') || apiContent.includes('post'), 'T10: API supports POST');
    check(apiContent.includes('DELETE') || apiContent.includes('delete'), 'T10: API supports DELETE');

    // ═══ PHASE 7: BUILD — ms-3 (CLI — from change request) ═══════════════

    console.log('\n\n═══ PHASE 7: BUILD — ms-3 (CLI — from change request) ═══════════════');

    // After ms-2, lifecycle should auto-advance to ms-3 (added by change)
    const stateMs3 = getLcState(SESSION_ID);

    if (stateMs3?.phase === 'REVIEW') {
      // Review triggered — continue past it to get to ms-3
      const userMsgReview = userTurn('pokračovat');
      const reviewResp = await handleLifecycleInput(userMsgReview, context);
      systemTurn('POST-REVIEW', reviewResp);
    }

    const stateMs3b = getLcState(SESSION_ID);
    if (stateMs3b?.phase === 'BUILD_MILESTONE_REVIEW') {
      check(stateMs3b?.currentMilestoneId === 'ms-3', 'T11: currentMilestoneId is ms-3',
        `got: ${stateMs3b?.currentMilestoneId}`);

      const userMsg10 = userTurn('ano');
      const response10 = await handleLifecycleInput(userMsg10, context);
      systemTurn('BUILD ms-3 result', response10);
    } else if (stateMs3b?.phase === 'BUILD') {
      // Need to start next milestone
      const userMsg10 = userTurn('ano');
      const response10 = await handleLifecycleInput(userMsg10, context);
      systemTurn('BUILD ms-3 start', response10);

      const stateMs3c = getLcState(SESSION_ID);
      if (stateMs3c?.phase === 'BUILD_MILESTONE_REVIEW') {
        const userMsg10b = userTurn('ano');
        const response10b = await handleLifecycleInput(userMsg10b, context);
        systemTurn('BUILD ms-3 exec', response10b);
      }
    }

    const ms3Db = msRepo.getMilestone('ms-3');
    check(ms3Db?.status === 'PASSED', 'T12: ms-3 PASSED', `got: ${ms3Db?.status}`);

    check(fs.existsSync(path.join(projectPath, 'src/cli.js')), 'T12: src/cli.js exists');

    const cliContent = fs.readFileSync(path.join(projectPath, 'src/cli.js'), 'utf8');
    check(cliContent.includes('Commander') || cliContent.includes('Command'), 'T12: CLI uses Commander.js');
    check(cliContent.includes("'set'") || cliContent.includes("set <key>") || cliContent.includes("command('set"), 'T12: CLI has set command');
    check(cliContent.includes("'get'") || cliContent.includes("get <key>") || cliContent.includes("command('get"), 'T12: CLI has get command');
    check(cliContent.includes("'delete'") || cliContent.includes("command('delete"), 'T12: CLI has delete command');

    // ═══ PHASE 8: Completion ═══════════════════════════════════════════════

    // Handle review if triggered
    const stateAfterMs3 = getLcState(SESSION_ID);
    if (stateAfterMs3?.phase === 'REVIEW') {
      console.log('\n\n═══ PHASE 8a: Review → Completion ════════════════════════════════════');
      const userMsgContinue = userTurn('pokračovat');
      const completionResp = await handleLifecycleInput(userMsgContinue, context);
      systemTurn('COMPLETED', completionResp);
    } else if (stateAfterMs3?.phase === 'BUILD') {
      // After last milestone, may need explicit continue to trigger completion
      const userMsgContinue = userTurn('pokračovat');
      const completionResp = await handleLifecycleInput(userMsgContinue, context);
      systemTurn('COMPLETED', completionResp);
    }

    console.log('\n\n═══ PHASE 8: Final Verification ══════════════════════════════════════');

    // DB verification
    console.log('\n  ─── DB Verification ───');
    const lcDb = lifecycleRepo.findById.get(lifecycleId);
    check(lcDb != null, 'DB: lifecycle record exists');
    check(lcDb?.phase === 'COMPLETED', 'DB: lifecycle phase is COMPLETED', `got: ${lcDb?.phase}`);

    const allMs = msRepo.listByLifecycle(lifecycleId);
    check(allMs.length === 3, 'DB: 3 milestones (2 original + 1 from change)', `got: ${allMs.length}`);

    const passedMs = allMs.filter(m => m.status === 'PASSED');
    check(passedMs.length === 3, 'DB: all 3 milestones PASSED', `got: ${passedMs.length}`);

    // Full file tree
    console.log('\n  ─── File Tree ───');
    const expectedFiles = [
      'package.json', 'src/crypto.js', 'src/vault.js',
      'src/api.js', 'src/middleware/auth.js', 'src/server.js',
      'src/cli.js',
    ];
    for (const f of expectedFiles) {
      check(fs.existsSync(path.join(projectPath, f)), `File: ${f} exists`);
    }

    // Security audit of generated code
    console.log('\n  ─── Security Audit ───');
    const finalCrypto = fs.readFileSync(path.join(projectPath, 'src/crypto.js'), 'utf8');
    check(!finalCrypto.includes('aes-256-cbc'), 'Security: not using CBC mode (GCM required)');
    check(finalCrypto.includes('randomBytes'), 'Security: uses randomBytes for IV generation');
    check(!finalCrypto.includes('md5') && !finalCrypto.includes('sha1'),
      'Security: no weak hash algorithms (MD5/SHA1)');

    // Git verification
    console.log('\n  ─── Git ───');
    try {
      const gitLog = execSync('git log --oneline', { cwd: projectPath, encoding: 'utf8' });
      const commits = gitLog.trim().split('\n');
      check(commits.length >= 4, 'Git: at least 4 commits', `got: ${commits.length}`);
    } catch (e) {
      check(false, 'Git: log available', e.message);
    }

    // Cleanup
    if (process.env.KEEP_PROJECT || failed > 0) {
      console.log(`\n  📁 Project preserved at: ${projectPath}`);
    } else {
      try { fs.rmSync(projectPath, { recursive: true, force: true }); } catch { /* ignore */ }
      console.log(`  🧹 Cleaned up (KEEP_PROJECT=1 to preserve)`);
    }

  } catch (err) {
    console.error(`\n💥 FATAL: ${err.message}`);
    console.error(err.stack);
    failed++;
    failures.push({ name: 'FATAL', detail: err.message });
  }

  // Summary
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`  Klíčenka E2E: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log(`\n  FAILURES:`);
    for (const f of failures) console.log(`    ❌ ${f.name}: ${f.detail}`);
  }
  console.log('══════════════════════════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

runTest();
