// Project Lifecycle Test 6 — Advanced Stress: Multi-round SPEC, Adaptive Roadmap, Pressure Test
// ══════════════════════════════════════════════════════════════════════════════
//
// This test verifies that the lifecycle engine acts as an ENGINEERING PARTNER,
// not a workflow automaton. It tests:
//
//   Phase 1: SPEC with conflict — trade-off analysis, alternatives, recommendations
//   Phase 2: SPEC refinement — user changes requirements, spec re-generated
//   Phase 3: Roadmap change BEFORE build — milestone reordering
//   Phase 4: Change DURING build — key rotation added mid-project
//   Phase 5: Pressure test — product usability verification
//   Phase 6: FakeLLM context audit — engine passes correct context to LLM
//
// Run: node tests/lifecycle-stress-advanced.test.js
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
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
  changeRequests,
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

// ─── Data: Enhanced Spec with trade-offs ────────────────────────────────────

const SPEC_V1 = {
  title: 'Klíčenka — Secure Keychain for C3',
  goals: [
    { id: 'G1', description: 'AES-256-GCM encryption/decryption', priority: 'MUST', success_criteria: 'Encrypt/decrypt round-trip with no data loss' },
    { id: 'G2', description: 'File-based encrypted credential store', priority: 'MUST', success_criteria: 'CRUD operations on encrypted store file' },
    { id: 'G3', description: 'CLI interface for credential management', priority: 'MUST', success_criteria: 'All commands work from terminal' },
    { id: 'G4', description: 'C3 config integration', priority: 'SHOULD', success_criteria: 'C3 can read credentials from keychain' },
  ],
  requirements: {
    functional: [
      { id: 'R1', description: 'AES-256-GCM encrypt/decrypt with IV', goal_id: 'G1', acceptance_test: 'Round-trip encrypt+decrypt returns original data' },
      { id: 'R2', description: 'Argon2id key derivation from master password', goal_id: 'G1', acceptance_test: 'Derived key is deterministic for same password+salt' },
      { id: 'R3', description: 'JSON-based encrypted store file', goal_id: 'G2', acceptance_test: 'Store file is valid JSON but values are encrypted' },
      { id: 'R4', description: 'CRUD operations: add, get, list, remove', goal_id: 'G2', acceptance_test: 'Each op modifies store correctly' },
      { id: 'R5', description: 'CLI commands: add, get, list, remove, export, import', goal_id: 'G3', acceptance_test: 'CLI exits 0 on success, 1 on failure' },
      { id: 'R6', description: 'Export/import for backup', goal_id: 'G3', acceptance_test: 'Export → import round-trip preserves all entries' },
      { id: 'R7', description: 'C3 config reads credentials from store', goal_id: 'G4', acceptance_test: 'config.getSecret() returns decrypted value' },
    ],
    non_functional: [
      { id: 'NF1', category: 'security', description: 'Master password never stored in plaintext', metric: 'No plaintext password in memory after derivation' },
      { id: 'NF2', category: 'performance', description: 'Key derivation under 500ms on modern HW', metric: '<500ms for Argon2id with default params' },
      { id: 'NF3', category: 'portability', description: 'Works on Linux, macOS, Windows', metric: 'No platform-specific native modules' },
    ],
  },
  tech_stack: {
    languages: ['JavaScript (Node.js 22)'],
    frameworks: [],
    tools: ['crypto (built-in)', 'argon2 (npm)'],
    rationale: 'Native crypto for AES-GCM, argon2 npm for key derivation — no external crypto libs needed',
  },
  architecture: {
    pattern: 'Layered CLI: crypto → store → CLI → integration',
    components: [
      { name: 'crypto.js', responsibility: 'Encryption/decryption + key derivation', interfaces: ['encrypt()', 'decrypt()', 'deriveKey()'] },
      { name: 'store.js', responsibility: 'Credential CRUD on encrypted file', interfaces: ['add()', 'get()', 'list()', 'remove()'] },
      { name: 'cli.js', responsibility: 'CLI argument parsing + command dispatch', interfaces: ['main()'] },
      { name: 'integration.js', responsibility: 'C3 config bridge', interfaces: ['getSecret()'] },
    ],
    data_flow: 'CLI → Store → Crypto → File',
    data_model: 'JSON file: { salt, entries: { key: { iv, ciphertext, tag } } }',
  },
  design_decisions: [
    { id: 'DD1', decision: 'Encryption algorithm', chosen: 'AES-256-GCM', alternatives_considered: ['ChaCha20-Poly1305'], rationale: 'AES has HW acceleration on modern CPUs, GCM provides authenticated encryption' },
    { id: 'DD2', decision: 'Key derivation', chosen: 'Argon2id', alternatives_considered: ['PBKDF2', 'scrypt'], rationale: 'Argon2id is memory-hard (resists GPU attacks), recommended by OWASP' },
    { id: 'DD3', decision: 'Storage format', chosen: 'JSON file', alternatives_considered: ['SQLite encrypted', 'Binary format'], rationale: 'JSON is human-debuggable, encryption at value level keeps structure inspectable' },
  ],
  security_model: {
    threat_model: 'Local attacker with file access, brute-force master password',
    mitigations: ['Argon2id with high memory cost', 'Unique IV per entry', 'GCM authentication tag prevents tampering'],
    sensitive_data: ['Master password (never stored)', 'Decrypted credentials (in memory only)'],
  },
  risks: [
    { id: 'RISK1', description: 'Key derivation too slow on weak HW', severity: 'MEDIUM', likelihood: 'MEDIUM', mitigation: 'Tunable Argon2 params', contingency: 'Fall back to scrypt' },
    { id: 'RISK2', description: 'File corruption during write', severity: 'HIGH', likelihood: 'LOW', mitigation: 'Atomic write with temp file + rename', contingency: 'Backup file before write' },
    { id: 'RISK3', description: 'Memory leak of decrypted credentials', severity: 'HIGH', likelihood: 'LOW', mitigation: 'Zero-fill buffers after use', contingency: 'Process isolation' },
  ],
  constraints: ['No external crypto libraries besides argon2', 'Must work offline', 'Single-user only'],
  out_of_scope: ['GUI', 'Network sync', 'Multi-user', 'Browser support'],
  acceptance_criteria: [
    'All CLI commands work end-to-end',
    'Encrypted file cannot be decrypted without master password',
    'Round-trip export/import preserves all data',
    'C3 config integration reads secrets successfully',
  ],
};

// Spec v2: after user changes (wants weak HW support → switch to scrypt)
const SPEC_V2 = {
  ...SPEC_V1,
  design_decisions: [
    { id: 'DD1', decision: 'Encryption algorithm', chosen: 'AES-256-GCM', alternatives_considered: ['ChaCha20-Poly1305'], rationale: 'AES has HW acceleration, GCM provides authenticated encryption' },
    { id: 'DD2', decision: 'Key derivation', chosen: 'scrypt', alternatives_considered: ['Argon2id', 'PBKDF2'], rationale: 'User requires weak HW support — scrypt is memory-hard but has no native dependency, unlike argon2' },
    { id: 'DD3', decision: 'Storage format', chosen: 'JSON file', alternatives_considered: ['SQLite encrypted'], rationale: 'JSON is human-debuggable' },
  ],
  tech_stack: {
    ...SPEC_V1.tech_stack,
    tools: ['crypto (built-in)'],
    rationale: 'Native crypto for both AES-GCM and scrypt — zero external deps',
  },
};

// Roadmap v1 (original order: crypto → store → CLI → integration)
const ROADMAP_V1 = {
  milestones: [
    {
      id: 'ms-1', title: 'Encryption Engine', status: 'PENDING',
      description: 'AES-256-GCM encrypt/decrypt + scrypt key derivation — foundation for all other milestones',
      dependencies: [], dependency_rationale: 'No dependencies — foundational layer',
      estimated_loc: 150, estimated_files: 2, estimated_complexity: 'MEDIUM',
      goals_addressed: ['G1'], requirements_addressed: ['R1', 'R2'],
      risk: { description: 'scrypt param tuning for weak HW', mitigation: 'Benchmark on target HW', fallback: 'Reduce N/r/p params' },
      test_strategy: { type: 'unit', description: 'Round-trip encrypt/decrypt', specific_tests: ['encrypt then decrypt returns original', 'different passwords produce different ciphertext', 'tampered ciphertext throws'], expected_test_count: 5 },
      acceptance_criteria: ['Round-trip works', 'Wrong password fails gracefully'],
      deliverables: ['src/crypto.js', 'tests/crypto.test.js'],
    },
    {
      id: 'ms-2', title: 'Credential Store', status: 'PENDING',
      description: 'File-based encrypted credential store with CRUD',
      dependencies: ['ms-1'], dependency_rationale: 'Store needs crypto for encrypt/decrypt',
      estimated_loc: 180, estimated_files: 2, estimated_complexity: 'MEDIUM',
      goals_addressed: ['G2'], requirements_addressed: ['R3', 'R4'],
      risk: { description: 'File corruption during write', mitigation: 'Atomic write pattern', fallback: 'Backup before write' },
      test_strategy: { type: 'integration', description: 'CRUD operations on store', specific_tests: ['add entry then get returns it', 'list shows all entries', 'remove deletes entry', 'concurrent writes handled'], expected_test_count: 8 },
      acceptance_criteria: ['All CRUD ops work', 'File survives process crash'],
      deliverables: ['src/store.js', 'tests/store.test.js'],
    },
    {
      id: 'ms-3', title: 'CLI Interface', status: 'PENDING',
      description: 'Command-line interface: add, get, list, remove, export, import',
      dependencies: ['ms-2'], dependency_rationale: 'CLI dispatches to Store',
      estimated_loc: 220, estimated_files: 3, estimated_complexity: 'MEDIUM',
      goals_addressed: ['G3'], requirements_addressed: ['R5', 'R6'],
      risk: { description: 'TTY vs piped input handling', mitigation: 'Detect TTY and switch mode', fallback: 'Interactive-only' },
      test_strategy: { type: 'e2e', description: 'CLI commands end-to-end', specific_tests: ['klicenka add key=val', 'klicenka get key', 'klicenka list', 'export | import round-trip'], expected_test_count: 10 },
      acceptance_criteria: ['All commands exit 0 on success', 'Export/import round-trip'],
      deliverables: ['src/cli.js', 'bin/klicenka', 'tests/cli.test.js'],
    },
    {
      id: 'ms-4', title: 'C3 Integration', status: 'PENDING',
      description: 'Integration module for C3 config system',
      dependencies: ['ms-2'], dependency_rationale: 'Integration reads from Store',
      estimated_loc: 80, estimated_files: 2, estimated_complexity: 'LOW',
      goals_addressed: ['G4'], requirements_addressed: ['R7'],
      risk: { description: 'C3 config API changes', mitigation: 'Version-locked import', fallback: 'Fallback to env vars' },
      test_strategy: { type: 'integration', description: 'C3 config reads secrets', specific_tests: ['getSecret returns decrypted value', 'missing key returns null'], expected_test_count: 3 },
      acceptance_criteria: ['C3 config.getSecret() works'],
      deliverables: ['src/integration.js', 'tests/integration.test.js'],
    },
  ],
  total_estimated_loc: 630,
  total_milestones: 4,
  critical_path: ['ms-1', 'ms-2', 'ms-3'],
  requirements_coverage: { covered: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'], uncovered: [], rationale_for_uncovered: '' },
};

// Roadmap v2: CLI first (user request), then encryption
const ROADMAP_V2 = {
  milestones: [
    { ...ROADMAP_V1.milestones[2], id: 'ms-1', dependencies: [], dependency_rationale: 'CLI first per user request — stub crypto', status: 'PENDING' },
    { ...ROADMAP_V1.milestones[0], id: 'ms-2', dependencies: ['ms-1'], dependency_rationale: 'Encryption replaces CLI stubs', status: 'PENDING' },
    { ...ROADMAP_V1.milestones[1], id: 'ms-3', dependencies: ['ms-2'], dependency_rationale: 'Store needs real crypto', status: 'PENDING' },
    { ...ROADMAP_V1.milestones[3], id: 'ms-4', dependencies: ['ms-3'], dependency_rationale: 'Integration reads from Store', status: 'PENDING' },
  ],
  total_estimated_loc: 630,
  total_milestones: 4,
  critical_path: ['ms-1', 'ms-2', 'ms-3'],
  requirements_coverage: ROADMAP_V1.requirements_coverage,
};

// Roadmap v3: after change request (key rotation added as ms-5)
const ROADMAP_V3 = {
  milestones: [
    { ...ROADMAP_V2.milestones[0], status: 'PASSED' },
    { ...ROADMAP_V2.milestones[1] },
    { ...ROADMAP_V2.milestones[2] },
    { ...ROADMAP_V2.milestones[3] },
    {
      id: 'ms-5', title: 'Key Rotation', status: 'PENDING',
      description: 'Re-encrypt all entries with new master password',
      dependencies: ['ms-3'], dependency_rationale: 'Needs store + crypto',
      estimated_loc: 100, estimated_files: 2, estimated_complexity: 'MEDIUM',
      goals_addressed: ['G1', 'G2'], requirements_addressed: ['R1', 'R4'],
      risk: { description: 'Partial rotation on crash', mitigation: 'Transaction-like approach', fallback: 'Backup before rotation' },
      test_strategy: { type: 'integration', description: 'Rotate and verify all entries', specific_tests: ['rotate changes ciphertext', 'old password fails after rotate', 'new password works'], expected_test_count: 5 },
      acceptance_criteria: ['All entries re-encrypted', 'Old password rejected'],
      deliverables: ['src/rotate.js', 'tests/rotate.test.js'],
    },
  ],
  changes_summary: 'Added ms-5 (Key Rotation) per user change request',
  diff: { added: ['ms-5'], removed: [], modified: [], preserved: ['ms-1', 'ms-2', 'ms-3', 'ms-4'] },
  total_estimated_loc: 730,
  total_milestones: 5,
  critical_path: ['ms-1', 'ms-2', 'ms-3', 'ms-5'],
  requirements_coverage: ROADMAP_V1.requirements_coverage,
};

const MS_PLANS = {
  'ms-1': {
    milestone_id: 'ms-1',
    technical_approach: 'Build CLI with stub crypto — parseArgs for command dispatch, prompt for master password, JSON store with plaintext initially.',
    files: [
      { path: 'src/cli.js', action: 'create', purpose: 'CLI entry point — parseArgs + command dispatch' },
      { path: 'bin/klicenka', action: 'create', purpose: 'Executable shebang wrapper' },
    ],
    implementation_steps: [
      { step: 1, action: 'Create parseArgs-based CLI with add/get/list/remove commands', file: 'src/cli.js', validation: 'klicenka --help shows all commands' },
    ],
    test_plan: [{ name: 'CLI help', type: 'e2e', description: 'Shows help', input: '--help', expected_output: 'Usage:' }],
    error_handling: [{ scenario: 'Unknown command', handling: 'Print usage and exit 1' }],
    scope_files: ['src/cli.js', 'bin/klicenka'],
    rollback_strategy: 'Delete created files',
  },
  'ms-2': {
    milestone_id: 'ms-2',
    technical_approach: 'Implement AES-256-GCM with scrypt key derivation using Node.js crypto built-in.',
    files: [{ path: 'src/crypto.js', action: 'create', purpose: 'Encryption engine' }],
    implementation_steps: [{ step: 1, action: 'Implement encrypt/decrypt with scrypt', file: 'src/crypto.js', validation: 'Round-trip test passes' }],
    test_plan: [{ name: 'Round-trip', type: 'unit', description: 'Encrypt then decrypt', input: 'test data', expected_output: 'test data' }],
    error_handling: [{ scenario: 'Wrong password', handling: 'GCM auth tag mismatch → throw DecryptionError' }],
    scope_files: ['src/crypto.js'],
    rollback_strategy: 'Delete crypto.js',
  },
  'ms-3': {
    milestone_id: 'ms-3',
    technical_approach: 'File-based JSON store using crypto layer for per-value encryption.',
    files: [{ path: 'src/store.js', action: 'create', purpose: 'Credential store' }],
    implementation_steps: [{ step: 1, action: 'Implement CRUD with atomic write', file: 'src/store.js', validation: 'Add/get/list/remove all work' }],
    test_plan: [{ name: 'CRUD', type: 'integration', description: 'All operations', input: 'key=val', expected_output: 'val' }],
    error_handling: [{ scenario: 'Corrupted file', handling: 'Detect invalid JSON, offer recovery from backup' }],
    scope_files: ['src/store.js'],
    rollback_strategy: 'Delete store.js',
  },
  'ms-4': {
    milestone_id: 'ms-4',
    technical_approach: 'Bridge module exposing getSecret() for C3 config consumption.',
    files: [{ path: 'src/integration.js', action: 'create', purpose: 'C3 integration' }],
    implementation_steps: [{ step: 1, action: 'Implement getSecret() that reads from store', file: 'src/integration.js', validation: 'getSecret returns correct value' }],
    test_plan: [{ name: 'Integration', type: 'integration', description: 'getSecret works', input: 'known key', expected_output: 'decrypted value' }],
    error_handling: [{ scenario: 'Store file missing', handling: 'Return null, log warning' }],
    scope_files: ['src/integration.js'],
    rollback_strategy: 'Delete integration.js',
  },
  'ms-5': {
    milestone_id: 'ms-5',
    technical_approach: 'Key rotation: re-derive key with new password, re-encrypt all entries, atomic save.',
    files: [{ path: 'src/rotate.js', action: 'create', purpose: 'Key rotation module' }],
    implementation_steps: [{ step: 1, action: 'Implement rotate(oldPass, newPass) with backup', file: 'src/rotate.js', validation: 'All entries re-encrypted' }],
    test_plan: [{ name: 'Rotation', type: 'integration', description: 'Rotate and verify', input: 'old+new password', expected_output: 'All entries accessible with new password' }],
    error_handling: [{ scenario: 'Crash mid-rotation', handling: 'Restore from backup file' }],
    scope_files: ['src/rotate.js'],
    rollback_strategy: 'Delete rotate.js, restore backup',
  },
};

// ─── Tracking ───────────────────────────────────────────────────────────────

let specAnalyzeCallCount = 0;
let lastSpecAnalyzePrompt = null;
let specDocumentCallCount = 0;
let roadmapVersion = 0;

// FakeLLM prompt context audit — validates engine passes correct context
const promptContextErrors = [];
const specDocumentPrompts = [];
const roadmapPrompts = [];
const milestonePlanPrompts = [];

// ─── Fake LLM (with context validation) ──────────────────────────────────────

function createFakeLLM() {
  return async function fakeLLM(role, prompt) {
    const p = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

    // SPEC: analyze (called multiple times for refinement)
    if (p.includes('## User Request') && p.includes('## Task') && !p.includes('thorough project specification')) {
      specAnalyzeCallCount++;
      lastSpecAnalyzePrompt = p;

      // ── Context validation: refinement calls MUST include previous spec context ──
      if (specAnalyzeCallCount >= 2) {
        if (!p.includes('Previous spec') && !p.includes('"title"') && !p.includes('Klíčenka')) {
          promptContextErrors.push(`specAnalyze call #${specAnalyzeCallCount}: missing previous spec context in prompt`);
        }
        if (!p.includes('feedback') && !p.includes('slabém') && !p.includes('scrypt') && !p.includes('Musí')) {
          promptContextErrors.push(`specAnalyze call #${specAnalyzeCallCount}: missing user revision feedback in prompt`);
        }
      }

      return {
        content: JSON.stringify({
          core_goal: 'Build a secure credential keychain for C3',
          implicit_assumptions: [
            'Single-user desktop usage',
            'Master password is the only auth factor',
            'Storage is local file, not database',
          ],
          technical_decisions: [
            {
              decision: 'Encryption algorithm',
              alternatives: [
                { option: 'AES-256-GCM', pros: ['HW acceleration', 'NIST standard', 'Authenticated'], cons: ['Slower without AES-NI'] },
                { option: 'ChaCha20-Poly1305', pros: ['Fast on all CPUs', 'No side-channel attacks'], cons: ['Less industry adoption'] },
              ],
              recommendation: 'AES-256-GCM — standard, HW-accelerated, authenticated encryption',
            },
            {
              decision: 'Key derivation function',
              alternatives: [
                { option: 'Argon2id', pros: ['Memory-hard', 'GPU-resistant', 'OWASP recommended'], cons: ['Native dependency (argon2 npm)'] },
                { option: 'scrypt', pros: ['Memory-hard', 'Built into Node.js crypto', 'No deps'], cons: ['Older, less configurable'] },
                { option: 'PBKDF2', pros: ['Universal, built-in'], cons: ['NOT memory-hard', 'GPU-vulnerable'] },
              ],
              recommendation: 'Argon2id for max security; scrypt if zero-dep is required',
            },
            {
              decision: 'Storage backend',
              alternatives: [
                { option: 'JSON file', pros: ['Human-readable', 'No deps', 'Debuggable'], cons: ['No query support', 'Full file rewrite'] },
                { option: 'SQLite encrypted', pros: ['ACID, fast queries'], cons: ['External dep', 'Not human-readable'] },
              ],
              recommendation: 'JSON file — simplicity wins for single-user credential store',
            },
          ],
          clarifying_questions: [
            'Should the CLI support piped input (echo "secret" | klicenka store) or only interactive?',
            'Expected data volume — tens of entries or thousands?',
            'Does this need key rotation (re-encrypt with new master password)?',
            'Should entries support metadata (tags, creation date, expiry)?',
            'Is there a maximum acceptable key derivation time?',
          ],
          initial_assessment: {
            estimated_complexity: 'MEDIUM',
            key_risks: [
              { risk: 'Key derivation performance on weak HW', severity: 'MEDIUM', likelihood: 'MEDIUM', mitigation: 'Tunable params' },
              { risk: 'File corruption during atomic write', severity: 'HIGH', likelihood: 'LOW', mitigation: 'Temp file + rename' },
              { risk: 'Memory exposure of decrypted secrets', severity: 'HIGH', likelihood: 'LOW', mitigation: 'Zero-fill buffers' },
            ],
            suggested_tech_stack: ['Node.js 22', 'crypto (built-in)', 'argon2 (npm)'],
            tech_stack_rationale: 'Native crypto for AES-GCM, argon2 npm for best-in-class key derivation',
          },
        }),
      };
    }

    // SPEC: document (returns different spec based on call count + prompt content)
    if (p.includes('thorough project specification') || p.includes('creating a project specification') || p.includes('structured project specification')) {
      specDocumentCallCount++;
      specDocumentPrompts.push(p);

      // If the prompt mentions "weak HW" or "scrypt", return v2 spec (refined)
      if (p.includes('weak') || p.includes('scrypt') || p.includes('slabém HW') || specDocumentCallCount > 1) {
        return { content: JSON.stringify(SPEC_V2) };
      }
      return { content: JSON.stringify(SPEC_V1) };
    }

    // PLANNING: roadmap (returns different roadmap based on version)
    if (p.includes('creating a project roadmap') || p.includes('Break the project into milestones')) {
      roadmapVersion++;
      roadmapPrompts.push(p);

      // ── Context validation: revision calls MUST include previous roadmap + feedback ──
      if (roadmapVersion >= 2) {
        if (!p.includes('Feedback') && !p.includes('feedback') && !p.includes('Previous Roadmap') && !p.includes('Přeuspořádej') && !p.includes('CLI')) {
          promptContextErrors.push(`roadmap call #${roadmapVersion}: missing revision context (no feedback or previous roadmap)`);
        }
      }

      if (roadmapVersion > 1) {
        return { content: JSON.stringify(ROADMAP_V2) };
      }
      return { content: JSON.stringify(ROADMAP_V1) };
    }

    // BUILD: milestone plan
    if (p.includes('implementation plan for THIS milestone') || p.includes('implementing a specific milestone')) {
      const msMatch = p.match(/"id"\s*:\s*"(ms-\d+)"/);
      const msId = msMatch ? msMatch[1] : 'ms-1';
      milestonePlanPrompts.push({ msId, prompt: p });

      // ── Context validation: prompt must identify which milestone ──
      if (!msMatch) {
        promptContextErrors.push(`milestonePlan: cannot extract milestone ID from prompt (first 200 chars: ${p.substring(0, 200)})`);
      }

      return { content: JSON.stringify(MS_PLANS[msId] || MS_PLANS['ms-1']) };
    }

    // BUILD: checkpoint
    if (p.includes('reviewing a completed milestone') || p.includes('Compare the actual output')) {
      return {
        content: JSON.stringify({
          passed: true,
          deliverables_check: [{ deliverable: 'Files', status: 'DONE', note: 'All present' }],
          scope_violations: [],
          test_summary: { total: 5, passed: 5, failed: 0, coverage_estimate: '85%' },
          security_findings: [],
          error_handling_gaps: [],
          discovered_requirements: [],
          quality_notes: ['Clean implementation'],
          overall_assessment: 'Milestone completed successfully',
        }),
      };
    }

    // BUILD: health score
    if (p.includes('computing health metrics') || p.includes('health metrics for a completed milestone')) {
      return {
        content: JSON.stringify({
          scope_adherence: 0.95, test_coverage: 0.85, complexity_delta: 0.1, tech_debt_delta: 0.05,
        }),
      };
    }

    // REVIEW: project review
    if (p.includes('conducting a project review') || p.includes('4 drift checks')) {
      return {
        content: JSON.stringify({
          spec_alignment: { addressed_goals: ['G1', 'G2', 'G3', 'G4'], unaddressed_goals: [], confidence: 0.9 },
          scope_creep: { severity: 'NONE', confidence: 0.9 },
          architecture_consistency: { consistent: true, violations: [], confidence: 0.9 },
          tech_debt: { items: [], trend: 'STABLE', confidence: 0.8 },
          overall_health: 'GREEN',
          recommendations: [],
        }),
      };
    }

    // CHANGE: analyze
    if (p.includes('analyzing a change request') || p.includes('impact of this change')) {
      return {
        content: JSON.stringify({
          affected_milestones: ['ms-3'],
          impact: {
            milestones_to_add: [{ title: 'Key Rotation', estimated_loc: 100 }],
            milestones_to_remove: [],
            milestones_to_modify: [],
            effort_delta: '+1 milestone, ~100 LOC',
            risk_level: 'LOW',
          },
          feasibility: 'FEASIBLE',
          recommendation: 'Approve — key rotation is essential for security hygiene',
        }),
      };
    }

    // CHANGE: rewrite roadmap
    if (p.includes('rewriting a project roadmap') || p.includes('incorporate an approved change')) {
      return { content: JSON.stringify(ROADMAP_V3) };
    }

    // Default — log for debugging
    return { content: JSON.stringify({ fallback: true, prompt_snippet: p.substring(0, 100) }) };
  };
}

// ─── Fake Executor (domain-specific file content) ────────────────────────────

function createFakeExecutor(projectPath) {
  // Content templates with domain-specific symbols for pressure test validation
  const contentTemplates = {
    'src/cli.js': `// CLI entry point — parseArgs + command dispatch
import { parseArgs } from 'node:util';
// Usage: klicenka add <key> <value> | klicenka get <key> | klicenka list | klicenka remove <key>
const { values, positionals } = parseArgs({ strict: false });
export function main() { /* command dispatch */ }
export default { main };
`,
    'src/crypto.js': `// Encryption engine — AES-256-GCM + scrypt
import { createCipheriv, createDecipheriv, scryptSync, randomBytes } from 'node:crypto';
export function encrypt(data, password) { const key = scryptSync(password, salt, 32); /* ... */ }
export function decrypt(ciphertext, password) { /* ... */ }
export function deriveKey(password, salt) { return scryptSync(password, salt, 32); }
export default { encrypt, decrypt, deriveKey };
`,
    'src/store.js': `// Credential store — file-based encrypted JSON
import { encrypt, decrypt } from './crypto.js';
import { writeFileSync, readFileSync, renameSync } from 'node:fs';
export function add(store, key, value, password) { /* atomic write */ }
export function get(store, key, password) { /* decrypt + return */ }
export function list(store) { /* return keys */ }
export function remove(store, key, password) { /* remove + rewrite */ }
export default { add, get, list, remove };
`,
    'src/integration.js': `// C3 config bridge — getSecret()
import { get } from './store.js';
export function getSecret(key) { return get(defaultStore, key, masterPassword); }
export default { getSecret };
`,
    'src/rotate.js': `// Key rotation — re-encrypt all entries with new master password
import { encrypt, decrypt, deriveKey } from './crypto.js';
export function rotate(storePath, oldPassword, newPassword) { /* re-encrypt all */ }
export default { rotate };
`,
    'bin/klicenka': `#!/usr/bin/env node
// Executable shebang wrapper
import { main } from '../src/cli.js';
main();
`,
  };

  return {
    async run(plan) {
      const msId = plan?.milestone_id || 'ms-unknown';
      const files = plan?.files || [];
      for (const f of files) {
        const fullPath = path.join(projectPath, f.path);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        // Use domain-specific content if available, otherwise generic
        const content = contentTemplates[f.path]
          || `// ${f.purpose || msId}\n// Auto-generated by lifecycle executor\nexport default {};\n`;
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
  try {
    const oldConvs = db.prepare(`SELECT id FROM conversations WHERE title LIKE '%Stress-Test%'`).all();
    for (const c of oldConvs) {
      db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(c.id);
      db.prepare(`DELETE FROM conversations WHERE id = ?`).run(c.id);
    }
  } catch { /* ignore */ }
  try { db.prepare(`DELETE FROM projects WHERE path LIKE '/tmp/%'`).run(); } catch { /* ignore */ }
  initLifecycleStateDb(lifecycleHandoffState, lifecycleRepo);
}

// ═══════════════════════════════════════════════════════════════════════════════

async function run() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  Test 6: Advanced Stress — Multi-round SPEC, Adaptive Roadmap');
  console.log('══════════════════════════════════════════════════════════════════════');

  cleanDB();

  const SESSION_ID = 'stress-e2e';
  const projectPath = `/tmp/lc-stress-${Date.now()}`;
  fs.mkdirSync(projectPath, { recursive: true });
  execSync('git init', { cwd: projectPath, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: projectPath, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: projectPath, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "init"', { cwd: projectPath, stdio: 'pipe' });

  // Register project + conversation
  const project = projects.getOrCreate('stress-test-klicenka', projectPath, 'Advanced stress test');
  const projectId = Number(project.id);
  const CONV_ID = `conv-stress-${Date.now()}`;
  conversations.getOrCreate(CONV_ID, projectId, 'Stress-Test — Advanced Lifecycle');

  function logTurn(userInput, response) {
    messages.addMessage(CONV_ID, 'user', userInput, null, { source: 'stress-test' });
    const content = typeof response?.content === 'string' ? response.content : JSON.stringify(response || {});
    messages.addMessage(CONV_ID, 'assistant', content, null, { source: 'stress-test' });
  }

  const fakeLLM = createFakeLLM();
  const fakeExecutor = createFakeExecutor(projectPath);
  const context = { sessionId: SESSION_ID, callLLM: fakeLLM, executor: fakeExecutor, projectPath, projectId };

  try {

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 1: SPEC WITH CONFLICT — Trade-off analysis validation
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n═══ PHASE 1: SPEC WITH CONFLICT ════════════════════════════════════');

    const userRequest = 'Chci kličenu pro C3, musí být rychlá, bezpečná a přenosná';
    const r1 = handleLifecycleBuildDetected(userRequest, { intent: 'BUILD' }, context);
    logTurn(userRequest, r1);

    check(r1?.content?.includes('lifecycle'), 'P1.1: lifecycle explanation shown');
    const s1 = getLcState(SESSION_ID);
    check(s1?.phase === 'PROPOSED', 'P1.2: state is PROPOSED');

    // Accept lifecycle
    const r2 = await handleLifecycleInput('ano', context);
    logTurn('ano', r2);
    const s2 = getLcState(SESSION_ID);
    check(s2?.phase === 'SPEC', 'P1.3: state is SPEC after acceptance');
    check(specAnalyzeCallCount === 1, 'P1.4: specAnalyze called once', `got ${specAnalyzeCallCount}`);

    // Validate trade-off content in response
    const specResponse = r2?.content || '';
    check(specResponse.includes('AES') || specResponse.includes('encrypt') || specResponse.includes('decision'),
      'TD.1: response mentions technical decisions');

    // Verify LLM received trade-off structured response
    const specDraft = lifecycleRepo.getSpec(s2.lifecycleId);
    check(specDraft?._technicalDecisions?.length >= 1,
      'TD.2: technical decisions stored in spec draft', `got ${specDraft?._technicalDecisions?.length}`);

    // ── Structural validation: every decision must have alternatives[{option, pros[], cons[]}] ──
    if (specDraft?._technicalDecisions?.length > 0) {
      let structurallyValid = true;
      const structErrors = [];
      for (const td of specDraft._technicalDecisions) {
        if (!td.decision || typeof td.decision !== 'string') {
          structurallyValid = false;
          structErrors.push('missing decision name');
        }
        if (!Array.isArray(td.alternatives) || td.alternatives.length < 2) {
          structurallyValid = false;
          structErrors.push(`"${td.decision}": <2 alternatives`);
          continue;
        }
        for (const alt of td.alternatives) {
          if (!alt.option || typeof alt.option !== 'string') {
            structurallyValid = false;
            structErrors.push(`"${td.decision}": alternative missing option name`);
          }
          if (!Array.isArray(alt.pros) || alt.pros.length === 0) {
            structurallyValid = false;
            structErrors.push(`"${td.decision}/${alt.option}": missing or empty pros[]`);
          }
          if (!Array.isArray(alt.cons) || alt.cons.length === 0) {
            structurallyValid = false;
            structErrors.push(`"${td.decision}/${alt.option}": missing or empty cons[]`);
          }
        }
        if (!td.recommendation || td.recommendation.length < 10) {
          structurallyValid = false;
          structErrors.push(`"${td.decision}": recommendation <10 chars or missing`);
        }
      }
      check(structurallyValid,
        'TD.3: all decisions structurally valid {decision, alternatives[{option,pros[],cons[]}], recommendation}',
        structErrors.join('; '));
      check(specDraft._technicalDecisions.length >= 3,
        'TD.4: ≥3 technical decisions (encryption, KDF, storage)', `got ${specDraft._technicalDecisions.length}`);

      // Cross-check: recommendation must reference one of the listed alternatives
      for (const td of specDraft._technicalDecisions) {
        if (td.recommendation && td.alternatives) {
          const altNames = td.alternatives.map(a => a.option);
          const recRefsAlt = altNames.some(name => td.recommendation.includes(name));
          check(recRefsAlt,
            `TD.4b: "${td.decision}" recommendation references a listed alternative`,
            `recommendation: "${td.recommendation}", alternatives: [${altNames.join(', ')}]`);
        }
      }
    } else {
      check(false, 'TD.3: no decisions — structural validation skipped');
      check(false, 'TD.4: no decisions — count check skipped');
    }

    check(specDraft?._implicitAssumptions?.length >= 2,
      'TD.5: ≥2 implicit assumptions captured', `got ${specDraft?._implicitAssumptions?.length}`);

    // Verify assumptions are substantive (not empty strings)
    if (specDraft?._implicitAssumptions?.length > 0) {
      const allSubstantive = specDraft._implicitAssumptions.every(a => typeof a === 'string' && a.length > 10);
      check(allSubstantive, 'TD.6: all implicit assumptions are substantive (>10 chars)');
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 2: SPEC REFINEMENT — User changes requirements
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n═══ PHASE 2: SPEC REFINEMENT ════════════════════════════════════════');

    // Answer spec questions (first round)
    const answer1 = 'AES-256-GCM, Argon2id, JSON file, CLI + API, pod 500ms key derivation';
    const r3 = await handleLifecycleInput(answer1, context);
    logTurn(answer1, r3);
    const s3 = getLcState(SESSION_ID);
    check(s3?.phase === 'SPEC_REVIEW', 'SR.1: state is SPEC_REVIEW after answers');
    check(specDocumentCallCount === 1, 'SR.2: specDocument called once', `got ${specDocumentCallCount}`);

    // Verify spec has design_decisions with rationale
    const spec1 = lifecycleRepo.getSpec(s3.lifecycleId);
    check(spec1?.design_decisions?.length >= 1,
      'SR.3: spec v1 has design_decisions', `got ${spec1?.design_decisions?.length}`);

    // Verify spec v1 has correct KDF (argon2)
    const v1HasArgon2 = JSON.stringify(spec1).includes('Argon2id') || JSON.stringify(spec1).includes('argon2');
    check(v1HasArgon2, 'SR.3b: spec v1 uses Argon2id', `spec: ${JSON.stringify(spec1?.design_decisions?.[1]?.chosen)}`);

    // USER REJECTS — "Musí fungovat i na slabém HW, použij scrypt místo argon2"
    const revisionFeedback = 'Musí fungovat i na slabém HW bez native závislostí. Použij scrypt místo argon2.';
    const r4 = await handleLifecycleInput(revisionFeedback, context);
    logTurn(revisionFeedback, r4);
    const s4 = getLcState(SESSION_ID);

    check(s4?.phase === 'SPEC' || s4?.phase === 'SPEC_REVIEW',
      'SR.4: state returns to SPEC or SPEC_REVIEW for refinement', `got ${s4?.phase}`);
    check(specAnalyzeCallCount >= 2,
      'SR.5: specAnalyze called again for refinement', `calls: ${specAnalyzeCallCount}`);

    // If back in SPEC, answer again to get to SPEC_REVIEW
    if (s4?.phase === 'SPEC') {
      const answer2 = 'scrypt, zero deps, funguje na slabém HW';
      const r4b = await handleLifecycleInput(answer2, context);
      logTurn(answer2, r4b);
    }

    const s4b = getLcState(SESSION_ID);
    check(s4b?.phase === 'SPEC_REVIEW', 'SR.6: back in SPEC_REVIEW after refinement', `got ${s4b?.phase}`);

    // Verify spec v2 reflects the change
    const spec2 = lifecycleRepo.getSpec(s4b.lifecycleId);
    const spec2Str = JSON.stringify(spec2);
    check(spec2Str.includes('scrypt'), 'SR.7: refined spec mentions scrypt');
    check(!spec2Str.includes('argon2 (npm)') || spec2Str.includes('scrypt'),
      'SR.8: spec v2 tech_stack no longer depends on argon2 npm');

    // Capture roadmap version before spec approval (should be 0 — no roadmap yet)
    const roadmapVersionBeforeApproval = roadmapVersion;

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 3: ROADMAP CHANGE BEFORE BUILD — Milestone reordering
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n═══ PHASE 3: ROADMAP CHANGE BEFORE BUILD ════════════════════════════');

    // Approve spec v2 → PLANNING
    const r5 = await handleLifecycleInput('schvaluji', context);
    logTurn('schvaluji', r5);
    const s5 = getLcState(SESSION_ID);
    check(s5?.phase === 'PLAN_REVIEW', 'RC.1: state is PLAN_REVIEW after spec approval', `got ${s5?.phase}`);

    // Verify roadmap was generated after spec approval
    check(roadmapVersion === roadmapVersionBeforeApproval + 1,
      'RC.1b: roadmap generated exactly once after spec approval',
      `before: ${roadmapVersionBeforeApproval}, after: ${roadmapVersion}`);

    // Verify ROADMAP.md exists
    const roadmapPath = path.join(projectPath, 'ROADMAP.md');
    check(fs.existsSync(roadmapPath), 'RC.2: ROADMAP.md created');

    // USER REJECTS ROADMAP — "Nejdřív chci CLI, encryption až potom"
    const roadmapFeedback = 'Nejdřív chci CLI, encryption až potom. Přeuspořádej milníky.';
    const r6 = await handleLifecycleInput(roadmapFeedback, context);
    logTurn(roadmapFeedback, r6);
    const s6 = getLcState(SESSION_ID);

    // Should regenerate roadmap
    check(s6?.phase === 'PLAN_REVIEW' || s6?.phase === 'BUILD',
      'RC.3: roadmap regenerated, back in PLAN_REVIEW or BUILD', `got ${s6?.phase}`);
    check(roadmapVersion >= 2, 'RC.4: roadmap regenerated (version ≥2)', `v${roadmapVersion}`);

    // Check roadmap_versions in DB
    const rvAll = db.prepare('SELECT * FROM roadmap_versions WHERE lifecycle_id = ? ORDER BY version DESC')
      .all(s6.lifecycleId);
    check(rvAll.length >= 2, 'RC.5: ≥2 roadmap versions in DB', `got ${rvAll.length}`);

    // Verify roadmap V2 structurally differs from V1 (not just re-generated identical)
    if (rvAll.length >= 2) {
      const rv1 = JSON.parse(rvAll[rvAll.length - 1].roadmap_json);
      const rv2 = JSON.parse(rvAll[0].roadmap_json);
      const v1FirstMs = rv1.milestones?.[0]?.title;
      const v2FirstMs = rv2.milestones?.[0]?.title;
      check(v1FirstMs !== v2FirstMs,
        'RC.6: roadmap V2 first milestone differs from V1 (reordering happened)',
        `V1[0]: "${v1FirstMs}", V2[0]: "${v2FirstMs}"`);

      const v1Order = rv1.milestones?.map(m => m.title).join(' → ');
      const v2Order = rv2.milestones?.map(m => m.title).join(' → ');
      check(v1Order !== v2Order,
        'RC.7: milestone ordering changed between V1 and V2',
        `V1: ${v1Order} | V2: ${v2Order}`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 4: BUILD — Execute milestones + CHANGE during BUILD
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n═══ PHASE 4: BUILD + CHANGE ═════════════════════════════════════════');

    // Approve roadmap v2 → BUILD
    if (s6?.phase === 'PLAN_REVIEW') {
      const r7 = await handleLifecycleInput('schvaluji', context);
      logTurn('schvaluji', r7);
    }
    const s7 = getLcState(SESSION_ID);
    check(s7?.phase === 'BUILD' || s7?.currentMilestoneId != null,
      'BLD.1: in BUILD phase', `phase=${s7?.phase}`);

    // Execute ms-1 (CLI stub)
    const r8 = await handleLifecycleInput('ano', context);
    logTurn('ano — build ms-1', r8);

    // Check ms-1 files created
    check(fs.existsSync(path.join(projectPath, 'src/cli.js')) || fs.existsSync(path.join(projectPath, 'bin/klicenka')),
      'BLD.2: ms-1 deliverables created');

    // BUILD progress
    const s8 = getLcState(SESSION_ID);
    const progress = getBuildProgress(s8.lifecycleId);
    check(progress.completed >= 1, 'BLD.3: ≥1 milestone completed', `completed: ${progress.completed}`);

    // === CHANGE REQUEST DURING BUILD ===
    // Snapshot: capture passed milestones BEFORE change request
    const lcIdForChange = s8.lifecycleId;
    const passedBeforeChange = lcIdForChange
      ? db.prepare(`SELECT id, title, status FROM milestones WHERE lifecycle_id = ? AND status = 'PASSED'`).all(lcIdForChange)
      : [];
    const totalMilestonesBeforeChange = lcIdForChange
      ? db.prepare(`SELECT COUNT(*) as cnt FROM milestones WHERE lifecycle_id = ?`).get(lcIdForChange)?.cnt || 0
      : 0;

    // User asks for key rotation AFTER ms-1 is done
    // NOTE: Engine regex requires prefix: /^(zm[eě]n[ai]|change|upravit|p[rř]idat)\s*:?\s/i
    const changeRequest = 'změna: přidat key rotation — re-encrypt s novým heslem';
    const r9 = await handleLifecycleInput(changeRequest, context);
    logTurn(changeRequest, r9);
    const s9 = getLcState(SESSION_ID);

    // Engine should detect this as a change request
    check(s9?.phase === 'CHANGE' || r9?.content?.includes('change') || r9?.content?.includes('rotation') || r9?.content?.includes('milník'),
      'CHG.1: change request detected and acknowledged', `phase=${s9?.phase}`);

    // If in CHANGE phase, approve the change
    if (s9?.phase === 'CHANGE') {
      const rApprove = await handleLifecycleInput('schvaluji', context);
      logTurn('schvaluji — change', rApprove);
      const sAfterChange = getLcState(SESSION_ID);
      check(sAfterChange?.phase === 'BUILD',
        'CHG.2: back in BUILD after change approval', `phase=${sAfterChange?.phase}`);

      // Verify CHANGE preserved completed milestones (passedBefore ⊆ passedAfter)
      const lcIdAfterChange = sAfterChange?.lifecycleId || lcIdForChange;
      const passedAfterChange = db.prepare(
        `SELECT id, title, status FROM milestones WHERE lifecycle_id = ? AND status = 'PASSED'`
      ).all(lcIdAfterChange);

      if (passedBeforeChange.length > 0) {
        const allPreserved = passedBeforeChange.every(before =>
          passedAfterChange.some(after => after.title === before.title && after.status === 'PASSED'));
        check(allPreserved,
          'CHG.3: all PASSED milestones before change remain PASSED after',
          `before: [${passedBeforeChange.map(m => m.title).join(', ')}], after: [${passedAfterChange.map(m => m.title).join(', ')}]`);
      }

      // Verify change ADDED milestone(s) — total count grew
      const totalMilestonesAfterChange = db.prepare(
        `SELECT COUNT(*) as cnt FROM milestones WHERE lifecycle_id = ?`
      ).get(lcIdAfterChange)?.cnt || 0;
      check(totalMilestonesAfterChange > totalMilestonesBeforeChange,
        'CHG.4: change request added new milestone(s)',
        `before: ${totalMilestonesBeforeChange}, after: ${totalMilestonesAfterChange}`);
    }

    // Continue building remaining milestones
    let buildIter = 0;
    let currentState = getLcState(SESSION_ID);
    while (currentState?.phase === 'BUILD' && buildIter < 20) {
      const rN = await handleLifecycleInput('ano', context);
      logTurn(`ano — build iter ${buildIter}`, rN);
      currentState = getLcState(SESSION_ID);
      buildIter++;
      if (currentState?.phase !== 'BUILD') break;
    }

    check(buildIter > 0, 'BLD.4: build iterations completed', `iterations: ${buildIter}`);

    const finalState = getLcState(SESSION_ID);
    check(finalState?.phase === 'COMPLETED' || finalState?.phase === 'BUILD',
      'BLD.5: reached COMPLETED or still building', `phase=${finalState?.phase}`);

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 5: PRESSURE TEST — Product usability verification
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n═══ PHASE 5: PRESSURE TEST ══════════════════════════════════════════');

    // Verify product files exist
    const srcFiles = ['src/cli.js', 'src/crypto.js', 'src/store.js', 'src/integration.js'];
    let filesExist = 0;
    for (const f of srcFiles) {
      if (fs.existsSync(path.join(projectPath, f))) filesExist++;
    }
    check(filesExist >= 3, 'PT.1: ≥3 product source files exist', `got ${filesExist}/4`);

    // Verify source files contain domain-specific symbols (not just empty stubs)
    const cryptoPath = path.join(projectPath, 'src/crypto.js');
    if (fs.existsSync(cryptoPath)) {
      const cryptoContent = fs.readFileSync(cryptoPath, 'utf-8');
      const hasCryptoSymbols = cryptoContent.includes('createCipheriv') || cryptoContent.includes('scryptSync')
        || cryptoContent.includes('encrypt') || cryptoContent.includes('randomBytes');
      check(hasCryptoSymbols, 'PT.2: crypto.js contains crypto API symbols',
        `first 120 chars: ${cryptoContent.substring(0, 120)}`);
    } else {
      check(false, 'PT.2: crypto.js missing — cannot validate content');
    }

    const cliPath = path.join(projectPath, 'src/cli.js');
    if (fs.existsSync(cliPath)) {
      const cliContent = fs.readFileSync(cliPath, 'utf-8');
      const hasCliSymbols = cliContent.includes('parseArgs') || cliContent.includes('add')
        || cliContent.includes('command') || cliContent.includes('klicenka');
      check(hasCliSymbols, 'PT.3: cli.js contains CLI dispatch symbols',
        `first 120 chars: ${cliContent.substring(0, 120)}`);
    } else {
      check(false, 'PT.3: cli.js missing — cannot validate content');
    }

    // Verify ROADMAP.md has substantial content + milestone status markers
    if (fs.existsSync(roadmapPath)) {
      const rmContent = fs.readFileSync(roadmapPath, 'utf-8');
      check(rmContent.length > 100, 'PT.4: ROADMAP.md has substantial content', `${rmContent.length} chars`);

      const hasStatusMarkers = rmContent.includes('PASSED') || rmContent.includes('✅')
        || rmContent.includes('[x]') || rmContent.includes('COMPLETED')
        || rmContent.includes('PENDING') || rmContent.includes('ms-');
      check(hasStatusMarkers, 'PT.5: ROADMAP.md contains milestone identifiers or status markers',
        `first 200 chars: ${rmContent.substring(0, 200)}`);
    } else {
      check(false, 'PT.4: ROADMAP.md missing');
      check(false, 'PT.5: ROADMAP.md missing — cannot check status markers');
    }

    // Verify git history: multiple commits with milestone-tagged messages
    try {
      const gitLog = execSync('git log --oneline', { cwd: projectPath, encoding: 'utf8' });
      const commits = gitLog.trim().split('\n');
      check(commits.length >= 3, 'PT.6: git has ≥3 commits', `got ${commits.length}`);

      const hasMsCommit = commits.some(c => /executor:\s*ms-\d+|feat\(ms-\d+\)/.test(c));
      check(hasMsCommit, 'PT.7: git log contains milestone-tagged commits',
        `commits: ${commits.slice(0, 5).join(' | ')}`);
    } catch {
      check(false, 'PT.6: git log readable');
      check(false, 'PT.7: git commit pattern check skipped');
    }

    // ═══════════════════════════════════════════════════════════════════════
    // DB VERIFICATION
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n═══ DB VERIFICATION ═════════════════════════════════════════════════');

    const dbProject = projects.findById.get(projectId);
    check(dbProject != null, 'DB.1: project in DB');

    const dbConv = conversations.findById.get(CONV_ID);
    check(dbConv != null, 'DB.2: conversation in DB');

    const dbMsgs = messages.listByConversation.all(CONV_ID);
    check(dbMsgs.length >= 10, 'DB.3: ≥10 messages logged', `got ${dbMsgs.length}`);

    // Verify roadmap versions exist
    const lcId = getLcState(SESSION_ID)?.lifecycleId || s7?.lifecycleId;
    if (lcId) {
      const versions = db.prepare('SELECT * FROM roadmap_versions WHERE lifecycle_id = ?').all(lcId);
      check(versions.length >= 1, 'DB.4: roadmap versions persisted', `got ${versions.length}`);

      const milestones = db.prepare('SELECT * FROM milestones WHERE lifecycle_id = ?').all(lcId);
      check(milestones.length >= 4, 'DB.5: ≥4 milestones persisted', `got ${milestones.length}`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // QUALITY METRICS — Verify engine acted as engineering partner
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n═══ QUALITY METRICS ═════════════════════════════════════════════════');

    check(specAnalyzeCallCount >= 2,
      'QM.1: spec analyzed ≥2 times (refinement happened)', `calls: ${specAnalyzeCallCount}`);

    check(specDocumentCallCount >= 2,
      'QM.2: spec document generated ≥2 times', `calls: ${specDocumentCallCount}`);

    check(roadmapVersion >= 2,
      'QM.3: roadmap regenerated ≥2 times', `versions: ${roadmapVersion}`);

    // Verify the spec had design decisions with rationale
    const finalSpec = lcId ? lifecycleRepo.getSpec(lcId) : null;
    if (finalSpec?.design_decisions) {
      const allHaveRationale = finalSpec.design_decisions.every(dd => dd.rationale && dd.rationale.length > 5);
      check(allHaveRationale, 'QM.4: all design decisions have substantive rationale');

      const allHaveAlternatives = finalSpec.design_decisions.every(dd =>
        Array.isArray(dd.alternatives_considered) && dd.alternatives_considered.length >= 1);
      check(allHaveAlternatives, 'QM.5: all design decisions list alternatives_considered');
    } else {
      check(false, 'QM.4: design_decisions missing from final spec');
      check(false, 'QM.5: design_decisions missing — cannot check alternatives');
    }

    // Verify non-functional requirements in spec
    const nfReqs = finalSpec?.requirements?.non_functional;
    if (nfReqs) {
      check(nfReqs.length >= 1, 'QM.6: spec has non-functional requirements', `got ${nfReqs.length}`);
      const allHaveMetric = nfReqs.every(r => r.metric && r.metric.length > 5);
      check(allHaveMetric, 'QM.7: all non-functional reqs have measurable metric');

      // Verify NF requirements are reflected in acceptance criteria (not just declared)
      if (finalSpec.acceptance_criteria?.length > 0) {
        const acStr = finalSpec.acceptance_criteria.join(' ').toLowerCase();
        const nfCategories = nfReqs.map(r => r.category);
        const nfConcernInAC = acStr.includes('encrypt') || acStr.includes('password')
          || acStr.includes('secure') || acStr.includes('performance') || acStr.includes('500ms')
          || acStr.includes('portable') || acStr.includes('offline');
        check(nfConcernInAC,
          'QM.8: acceptance criteria reference non-functional concerns (security/performance/portability)',
          `AC: ${finalSpec.acceptance_criteria.join('; ')}, NF categories: ${nfCategories.join(', ')}`);
      } else {
        check(false, 'QM.8: no acceptance_criteria in spec to validate NF coverage');
      }
    } else {
      // Legacy format — check if requirements array has non-functional entries
      const reqs = Array.isArray(finalSpec?.requirements) ? finalSpec.requirements : [];
      check(reqs.length >= 5, 'QM.6: spec has requirements (legacy format)', `total: ${reqs.length}`);
      check(false, 'QM.7: cannot check non-functional metrics in legacy format');
      check(false, 'QM.8: cannot check NF coverage in legacy format');
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 6: FakeLLM CONTEXT AUDIT — Engine passes correct context
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n═══ PHASE 6: PROMPT CONTEXT AUDIT ═══════════════════════════════════');

    // Report all prompt context errors collected by FakeLLM
    check(promptContextErrors.length === 0,
      'CTX.1: all LLM prompts contained expected context (no errors)',
      promptContextErrors.join('; '));

    // specDocument prompt for v2 must reference scrypt/weak HW from user feedback flow
    if (specDocumentPrompts.length >= 2) {
      const v2Prompt = specDocumentPrompts[specDocumentPrompts.length - 1];
      const hasUserContext = v2Prompt.includes('scrypt') || v2Prompt.includes('weak')
        || v2Prompt.includes('slabém') || v2Prompt.includes('technical_decisions');
      check(hasUserContext,
        'CTX.2: specDocument v2 prompt carries user feedback context (scrypt/weak HW/technical decisions)',
        `prompt length: ${v2Prompt.length}, first 200: ${v2Prompt.substring(0, 200)}`);
    } else {
      check(false, 'CTX.2: not enough specDocument calls to validate', `got ${specDocumentPrompts.length}`);
    }

    // Roadmap revision prompt must include user reordering feedback
    if (roadmapPrompts.length >= 2) {
      const v2Prompt = roadmapPrompts[roadmapPrompts.length - 1];
      const hasRevisionContext = v2Prompt.includes('CLI') || v2Prompt.includes('Přeuspořádej')
        || v2Prompt.includes('Nejdřív') || v2Prompt.includes('feedback') || v2Prompt.includes('Previous');
      check(hasRevisionContext,
        'CTX.3: roadmap v2 prompt contains user reordering feedback',
        `prompt length: ${v2Prompt.length}, first 200: ${v2Prompt.substring(0, 200)}`);
    } else {
      check(false, 'CTX.3: not enough roadmap calls to validate', `got ${roadmapPrompts.length}`);
    }

    // Milestone plan prompts must identify the correct milestone
    if (milestonePlanPrompts.length >= 1) {
      const allIdentified = milestonePlanPrompts.every(mp => mp.msId && mp.msId.startsWith('ms-'));
      check(allIdentified,
        'CTX.4: all milestone plan prompts identify their target milestone',
        `milestones: ${milestonePlanPrompts.map(mp => mp.msId).join(', ')}`);
    } else {
      check(false, 'CTX.4: no milestone plan prompts captured');
    }

    // Audit total LLM call count (sanity — engine shouldn't over-call)
    const totalLLMCalls = specAnalyzeCallCount + specDocumentCallCount + roadmapVersion
      + milestonePlanPrompts.length;
    check(totalLLMCalls >= 6,
      'CTX.5: total LLM calls ≥6 (specAnalyze×2 + specDoc×2 + roadmap×2 + plans)',
      `total: ${totalLLMCalls} (analyze=${specAnalyzeCallCount}, doc=${specDocumentCallCount}, roadmap=${roadmapVersion}, plans=${milestonePlanPrompts.length})`);

    // Verify roadmap prompt received the full spec INCLUDING non-functional requirements
    if (roadmapPrompts.length >= 1) {
      const firstRoadmapPrompt = roadmapPrompts[0];
      const hasNFInPrompt = firstRoadmapPrompt.includes('non_functional') || firstRoadmapPrompt.includes('NF1')
        || firstRoadmapPrompt.includes('security') || firstRoadmapPrompt.includes('performance');
      check(hasNFInPrompt,
        'CTX.6: roadmap prompt includes non-functional requirements from spec',
        `prompt includes 'non_functional': ${firstRoadmapPrompt.includes('non_functional')}, 'NF1': ${firstRoadmapPrompt.includes('NF1')}`);
    } else {
      check(false, 'CTX.6: no roadmap prompts to validate NF passthrough');
    }

  } catch (err) {
    console.error('\n  FATAL ERROR:', err.message);
    console.error(err.stack);
    check(false, 'FATAL: test completed without crash', err.message);
  }

  // ═══ Summary ══════════════════════════════════════════════════════════════

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  Test 6 Advanced Stress: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`\n  Failures:`);
    for (const f of failures) {
      console.log(`    ❌ ${f.name}: ${f.detail}`);
    }
  }
  console.log('══════════════════════════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

run();
