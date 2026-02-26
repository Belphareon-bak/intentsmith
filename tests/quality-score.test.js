// Test 9: Quality Score — Deterministic Diagnostic Metrics
// ══════════════════════════════════════════════════════════════════════════════
//
// Quality Score ≠ Quality Gate.
// Gates say PASS/FAIL. Scores say HOW GOOD on 0.0–1.0.
//
// Test tiers:
//   T1: High quality spec (>0.85 EXCELLENT)
//   T2: Mid quality spec (0.50–0.80 GOOD/ACCEPTABLE)
//   T3: Low quality spec (<0.50 WEAK)
//   T4: Edge case — validates but scores low (PASS ≠ high score)
//   T5: Roadmap scoring
//   T6: Change scoring
//   T7: Lifecycle aggregate scoring
//   T8: Edge cases & robustness
//
// ══════════════════════════════════════════════════════════════════════════════

import {
  computeSpecScore,
  computeRoadmapScore,
  computeChangeScore,
  computeLifecycleScore,
} from '../src/planner/quality-score.js';

import { validateSpec } from '../src/planner/lifecycle-spec.js';

let passed = 0;
let failed = 0;
const failures = [];

function check(condition, name, detail) {
  if (condition) {
    console.log(`  \u2713 ${name}`);
    passed++;
  } else {
    console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ''}`);
    failed++;
    failures.push({ name, detail: detail || '' });
  }
}

function inRange(value, min, max) {
  return value >= min && value <= max;
}

// ─── T1: High Quality Spec ──────────────────────────────────────────────────

function makeHighQualitySpec() {
  return {
    title: 'Klicenka — Encrypted Password Manager CLI',
    goals: [
      {
        id: 'G1', description: 'Store passwords encrypted at rest',
        priority: 'MUST',
        success_criteria: 'AES-256-GCM encrypted file on disk, verified with openssl enc -d',
      },
      {
        id: 'G2', description: 'Retrieve passwords by key name',
        priority: 'MUST',
        success_criteria: 'klicenka get <key> prints password to stdout in <100ms',
      },
      {
        id: 'G3', description: 'Cross-platform CLI (Linux, macOS)',
        priority: 'SHOULD',
        success_criteria: 'CI passes on ubuntu-latest and macos-latest runners',
      },
    ],
    requirements: {
      functional: [
        { id: 'R1', description: 'Store key-value encrypted entries', goal_id: 'G1', acceptance_test: 'klicenka set test 123 → klicenka get test → "123"' },
        { id: 'R2', description: 'List all stored keys', goal_id: 'G2', acceptance_test: 'klicenka list → shows "test" after set' },
        { id: 'R3', description: 'Delete entries by key', goal_id: 'G2', acceptance_test: 'klicenka delete test → klicenka get test → error "key not found"' },
        { id: 'R4', description: 'Master password authentication', goal_id: 'G1', acceptance_test: 'Wrong password → "Authentication failed" exit code 1' },
        { id: 'R5', description: 'Export vault as encrypted backup', goal_id: 'G1', acceptance_test: 'klicenka export → vault.enc file, importable on another machine' },
      ],
      non_functional: [
        { id: 'NF1', category: 'security', description: 'AES-256-GCM encryption for vault', metric: 'No plaintext in vault file (verified with strings command)' },
        { id: 'NF2', category: 'performance', description: 'Startup under 500ms', metric: 'time klicenka get test < 0.5s on cold start' },
        { id: 'NF3', category: 'portability', description: 'No native dependencies', metric: 'npm install without node-gyp compilation on all platforms' },
      ],
    },
    tech_stack: {
      languages: ['Node.js 22'],
      frameworks: ['commander 12'],
      tools: ['better-sqlite3', 'node:crypto'],
      rationale: 'Node.js for cross-platform CLI, better-sqlite3 for embedded storage',
    },
    design_decisions: [
      {
        id: 'DD1', decision: 'Encryption algorithm for G1',
        chosen: 'AES-256-GCM',
        alternatives_considered: ['ChaCha20-Poly1305', 'XSalsa20', 'AES-256-CBC'],
        rationale: 'AES-256-GCM has hardware acceleration on modern CPUs via AES-NI. ChaCha20 is better for mobile but not our target. CBC lacks authenticated encryption, however GCM provides both confidentiality and integrity.',
      },
      {
        id: 'DD2', decision: 'Key derivation function',
        chosen: 'Argon2id',
        alternatives_considered: ['scrypt', 'PBKDF2'],
        rationale: 'Argon2id is memory-hard (resists GPU attacks). PBKDF2 is legacy with known weaknesses, but scrypt is a viable alternative despite being less configurable on the other hand.',
      },
      {
        id: 'DD3', decision: 'Storage backend',
        chosen: 'SQLite via better-sqlite3',
        alternatives_considered: ['JSON file', 'LevelDB'],
        rationale: 'SQLite provides ACID transactions for vault integrity. JSON file is simpler but lacks atomic writes, however SQLite is well-tested and has excellent Node.js bindings.',
      },
    ],
    risks: [
      { id: 'RISK1', description: 'Vault corruption on crash during write', severity: 'HIGH', likelihood: 'LOW', mitigation: 'Atomic write with temp file + rename, WAL mode in SQLite' },
      { id: 'RISK2', description: 'Master password forgotten — permanent data loss', severity: 'HIGH', likelihood: 'MEDIUM', mitigation: 'Recovery key printed on first setup, stored separately by user' },
      { id: 'RISK3', description: 'Argon2 native binding not available on all platforms', severity: 'MEDIUM', likelihood: 'LOW', mitigation: 'Fallback to scrypt with security warning logged to stderr' },
    ],
    acceptance_criteria: [
      'klicenka set/get/list/delete work end-to-end',
      'Vault file is encrypted (no plaintext visible)',
      'Master password required for all operations',
      'CI green on Linux and macOS',
    ],
  };
}

// ─── T2: Mid Quality Spec ───────────────────────────────────────────────────

function makeMidQualitySpec() {
  return {
    title: 'Task Manager Web App',
    goals: [
      { id: 'G1', description: 'Create and manage tasks', priority: 'MUST', success_criteria: 'Tasks can be created and viewed' },
      { id: 'G2', description: 'Assign tasks to users', priority: 'MUST', success_criteria: 'Assignment works' },
      { id: 'G3', description: 'Track task status', priority: 'SHOULD', success_criteria: 'Status changes are persisted' },
    ],
    requirements: {
      functional: [
        { id: 'R1', description: 'Create task', goal_id: 'G1', acceptance_test: 'POST /tasks creates task' },
        { id: 'R2', description: 'List tasks', goal_id: 'G1', acceptance_test: 'GET /tasks returns array' },
        { id: 'R3', description: 'Update task status', acceptance_test: 'PUT /tasks/:id updates status' },
        { id: 'R4', description: 'Delete task', acceptance_test: 'DELETE /tasks/:id removes task' },
        { id: 'R5', description: 'Assign user to task', goal_id: 'G2', acceptance_test: 'POST /tasks/:id/assign sets assignee' },
      ],
      non_functional: [
        { id: 'NF1', category: 'performance', description: 'Page load under 2s', metric: 'Lighthouse score > 80' },
      ],
    },
    tech_stack: {
      languages: ['TypeScript'],
      frameworks: ['Express', 'React'],
      tools: ['PostgreSQL'],
    },
    design_decisions: [
      {
        id: 'DD1', decision: 'Database choice',
        chosen: 'PostgreSQL',
        alternatives_considered: ['MySQL', 'MongoDB'],
        rationale: 'PostgreSQL has good JSON support',
      },
    ],
    risks: [
      { id: 'RISK1', description: 'Data migration complexity', severity: 'MEDIUM', likelihood: 'LOW', mitigation: 'Use migration tool' },
      { id: 'RISK2', description: 'Performance under load', severity: 'HIGH', likelihood: 'MEDIUM', mitigation: 'Add caching layer with Redis' },
    ],
    acceptance_criteria: [
      'CRUD operations work end-to-end',
      'Tasks can be assigned',
    ],
  };
}

// ─── T3: Low Quality Spec ───────────────────────────────────────────────────

function makeLowQualitySpec() {
  return {
    title: 'App',
    goals: [
      { id: 'G1', description: 'Build the app', success_criteria: 'It works' },
      { id: 'G2', description: 'Make it good', success_criteria: 'TBD' },
      { id: 'G3', description: 'Ship it', success_criteria: 'Later' },
    ],
    requirements: [
      { id: 'R1', description: 'Feature 1', acceptance_test: 'Maybe test later' },
      { id: 'R2', description: 'Feature 2', acceptance_test: 'TBD' },
      { id: 'R3', description: 'Feature 3', acceptance_test: 'Good enough' },
      { id: 'R4', description: 'Feature 4', acceptance_test: 'If possible' },
      { id: 'R5', description: 'Feature 5', acceptance_test: 'Various tests' },
    ],
    tech_stack: { languages: ['JavaScript'] },
    risks: [
      { id: 'RISK1', description: 'Stuff might break', severity: 'LOW', mitigation: 'Fix it' },
    ],
    design_decisions: [
      { id: 'DD1', decision: 'Use React', alternatives_considered: ['Vue', 'Angular'], rationale: 'Popular' },
    ],
    acceptance_criteria: ['App works'],
  };
}

// ─── T4: Edge — Validates but Scores Low ────────────────────────────────────

function makeValidButShallowSpec() {
  // Passes validateSpec() — has all mandatory fields at minimum counts
  // But content is shallow, vague, unlinked
  return {
    title: 'Dashboard',
    goals: [
      { id: 'G1', description: 'Show data', success_criteria: 'Data is displayed' },
      { id: 'G2', description: 'Filter data', success_criteria: 'Filtering works' },
      { id: 'G3', description: 'Export data', success_criteria: 'Export button exists' },
    ],
    requirements: {
      functional: [
        // No goal_id linkage — coverage_quality will be 0
        { id: 'R1', description: 'Display charts', acceptance_test: 'Charts render' },
        { id: 'R2', description: 'Filter by date', acceptance_test: 'Date filter works' },
        { id: 'R3', description: 'Export CSV', acceptance_test: 'CSV downloads' },
        { id: 'R4', description: 'User auth', acceptance_test: 'Login works' },
        { id: 'R5', description: 'Notifications', acceptance_test: 'Alerts show up' },
      ],
      non_functional: [
        { id: 'NF1', category: 'performance', description: 'Fast', metric: 'Loads in adequate time' },
      ],
    },
    tech_stack: { languages: ['Python'] },
    design_decisions: [
      {
        id: 'DD1', decision: 'Use Django',
        alternatives_considered: ['Flask', 'FastAPI'],
        rationale: 'Good framework',
      },
    ],
    risks: [
      { id: 'RISK1', description: 'Might be slow', severity: 'LOW', mitigation: 'Optimize' },
    ],
    acceptance_criteria: ['Dashboard loads'],
  };
}

// ─── T5: Roadmap Fixtures ───────────────────────────────────────────────────

function makeHighQualityRoadmap() {
  return {
    milestones: [
      {
        id: 'ms-1', title: 'Core Vault Engine', sequence: 1,
        description: 'Implement AES-256-GCM encryption with Argon2id key derivation for secure vault storage',
        dependencies: [],
        estimated_loc: 600, estimated_files: 4, estimated_complexity: 'HIGH',
        goals_addressed: ['G1'],
        requirements_addressed: ['R1', 'R4'],
        acceptance_criteria: [
          'encrypt(key, value, password) produces ciphertext',
          'decrypt(ciphertext, password) returns original',
          'wrong password throws AuthenticationError',
        ],
        test_strategy: {
          type: 'unit',
          description: 'Round-trip encrypt/decrypt, error cases',
          specific_tests: ['encrypt→decrypt roundtrip', 'wrong password error'],
          expected_test_count: 8,
        },
      },
      {
        id: 'ms-2', title: 'CLI Interface', sequence: 2,
        description: 'Commander-based CLI with set/get/list/delete commands',
        dependencies: ['ms-1'],
        estimated_loc: 400, estimated_files: 3, estimated_complexity: 'MEDIUM',
        goals_addressed: ['G2'],
        requirements_addressed: ['R2', 'R3'],
        acceptance_criteria: [
          'klicenka set key value stores entry',
          'klicenka get key retrieves entry',
          'klicenka list shows all keys',
        ],
        test_strategy: {
          type: 'integration',
          description: 'CLI e2e tests with child_process.exec',
          expected_test_count: 6,
        },
      },
    ],
    requirements_coverage: {
      covered: ['R1', 'R2', 'R3', 'R4'],
      uncovered: ['R5'],
      rationale_for_uncovered: 'R5 (export) deferred to post-MVP milestone',
    },
  };
}

function makeMinimalRoadmap() {
  return {
    milestones: [
      { id: 'ms-1', title: 'Everything', dependencies: [] },
    ],
  };
}

// ─── T6: Change Fixtures ────────────────────────────────────────────────────

function makeHighQualityChange() {
  return {
    affected_milestones: ['ms-3', 'ms-4'],
    impact: {
      milestones_to_add: [{ title: 'Key Rotation', estimated_loc: 400 }],
      milestones_to_remove: [],
      milestones_to_modify: [{ id: 'ms-3', changes: 'Add re-encryption support' }],
      effort_delta: '+1 milestone, ~400 LOC',
      risk_level: 'MEDIUM',
    },
    feasibility: 'FEASIBLE',
    recommendation: 'Approve — key rotation is important for security hygiene and follows G1 goals',
    preserved_milestones: ['ms-1', 'ms-2'],
  };
}

function makeMinimalChange() {
  return {
    affected_milestones: ['ms-1'],
    impact: { risk_level: 'LOW' },
    feasibility: 'FEASIBLE',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════

async function run() {
  console.log('\u2550'.repeat(70));
  console.log('  Test 9: Quality Score \u2014 Deterministic Diagnostic Metrics');
  console.log('\u2550'.repeat(70));

  // ─── T1: High Quality Spec ────────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T1: HIGH QUALITY SPEC (>0.85 EXCELLENT) \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  const highSpec = makeHighQualitySpec();
  const highResult = computeSpecScore(highSpec);

  console.log(`    Score: ${highResult.score} (${highResult.label})`);
  console.log(`    Breakdown: ${JSON.stringify(highResult.breakdown)}`);

  check(highResult.score > 0.85,
    'T1.1: high quality spec scores >0.85',
    `got ${highResult.score}`);
  check(highResult.label === 'EXCELLENT',
    'T1.2: label is EXCELLENT',
    `got ${highResult.label}`);
  check(highResult.breakdown.decision_depth > 0.70,
    'T1.3: decision_depth >0.70',
    `got ${highResult.breakdown.decision_depth}`);
  check(highResult.breakdown.measurability > 0.80,
    'T1.4: measurability >0.80',
    `got ${highResult.breakdown.measurability}`);
  check(highResult.breakdown.coverage_quality > 0.70,
    'T1.5: coverage_quality >0.70',
    `got ${highResult.breakdown.coverage_quality}`);
  check(highResult.breakdown.risk_quality > 0.80,
    'T1.6: risk_quality >0.80',
    `got ${highResult.breakdown.risk_quality}`);

  // ─── T2: Mid Quality Spec ─────────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T2: MID QUALITY SPEC (0.50\u20130.80) \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  const midSpec = makeMidQualitySpec();
  const midResult = computeSpecScore(midSpec);

  console.log(`    Score: ${midResult.score} (${midResult.label})`);
  console.log(`    Breakdown: ${JSON.stringify(midResult.breakdown)}`);

  check(inRange(midResult.score, 0.50, 0.80),
    'T2.1: mid quality spec scores 0.50\u20130.80',
    `got ${midResult.score}`);
  check(midResult.label === 'GOOD' || midResult.label === 'ACCEPTABLE',
    'T2.2: label is GOOD or ACCEPTABLE',
    `got ${midResult.label}`);
  check(midResult.score < highResult.score,
    'T2.3: mid < high',
    `mid=${midResult.score} high=${highResult.score}`);

  // ─── T3: Low Quality Spec ─────────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T3: LOW QUALITY SPEC (<0.50 WEAK) \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  const lowSpec = makeLowQualitySpec();
  const lowResult = computeSpecScore(lowSpec);

  console.log(`    Score: ${lowResult.score} (${lowResult.label})`);
  console.log(`    Breakdown: ${JSON.stringify(lowResult.breakdown)}`);

  check(lowResult.score < 0.50,
    'T3.1: low quality spec scores <0.50',
    `got ${lowResult.score}`);
  check(lowResult.label === 'WEAK',
    'T3.2: label is WEAK',
    `got ${lowResult.label}`);
  check(lowResult.score < midResult.score,
    'T3.3: low < mid',
    `low=${lowResult.score} mid=${midResult.score}`);

  // Vague phrases should penalize measurability (without penalty would be ~0.80)
  check(lowResult.breakdown.measurability < 0.70,
    'T3.4: measurability penalized by vague phrases (<0.70)',
    `got ${lowResult.breakdown.measurability}`);

  // ─── T4: Validates but Scores Low ─────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T4: VALIDATES but SCORES LOW (PASS \u2260 high score) \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  const shallowSpec = makeValidButShallowSpec();

  // First: confirm it PASSES validation
  const validation = validateSpec(shallowSpec);
  check(validation.valid === true,
    'T4.1: shallow spec PASSES validateSpec()',
    validation.valid ? '' : `errors: ${validation.errors.join('; ')}`);

  // Then: confirm it scores LOW
  const shallowResult = computeSpecScore(shallowSpec);

  console.log(`    Score: ${shallowResult.score} (${shallowResult.label})`);
  console.log(`    Breakdown: ${JSON.stringify(shallowResult.breakdown)}`);

  check(shallowResult.score < 0.60,
    'T4.2: valid but shallow spec scores <0.60',
    `got ${shallowResult.score}`);
  check(shallowResult.label !== 'EXCELLENT',
    'T4.3: label is NOT EXCELLENT despite valid spec',
    `got ${shallowResult.label}`);

  // KEY assertion: coverage_quality should be 0 (no goal_id linkage)
  check(shallowResult.breakdown.coverage_quality < 0.10,
    'T4.4: coverage_quality ~0 (no goal_id on requirements)',
    `got ${shallowResult.breakdown.coverage_quality}`);

  // Specificity should be low (no concrete indicators)
  check(shallowResult.breakdown.specificity < 0.30,
    'T4.5: specificity low (no concrete symbols)',
    `got ${shallowResult.breakdown.specificity}`);

  // ─── T5: Roadmap Scoring ──────────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T5: ROADMAP SCORING \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  const highRoadmap = makeHighQualityRoadmap();
  const highRmResult = computeRoadmapScore(highRoadmap);

  console.log(`    High roadmap: ${highRmResult.score} (${highRmResult.label})`);
  console.log(`    Breakdown: ${JSON.stringify(highRmResult.breakdown)}`);

  check(highRmResult.score > 0.75,
    'T5.1: high quality roadmap scores >0.75',
    `got ${highRmResult.score}`);

  const minRoadmap = makeMinimalRoadmap();
  const minRmResult = computeRoadmapScore(minRoadmap);

  console.log(`    Minimal roadmap: ${minRmResult.score} (${minRmResult.label})`);

  check(minRmResult.score < 0.40,
    'T5.2: minimal roadmap scores <0.40',
    `got ${minRmResult.score}`);
  check(highRmResult.score > minRmResult.score,
    'T5.3: high roadmap > minimal roadmap',
    `${highRmResult.score} vs ${minRmResult.score}`);

  // Null/empty roadmap
  const nullRm = computeRoadmapScore(null);
  check(nullRm.score === 0,
    'T5.4: null roadmap scores 0',
    `got ${nullRm.score}`);

  // Roadmap with dependency errors
  const brokenDeps = {
    milestones: [
      { ...makeHighQualityRoadmap().milestones[0] },
      { ...makeHighQualityRoadmap().milestones[1], dependencies: ['ms-99'] },
    ],
    requirements_coverage: makeHighQualityRoadmap().requirements_coverage,
  };
  const brokenResult = computeRoadmapScore(brokenDeps);
  check(brokenResult.breakdown.dependency_coherence < 1.0,
    'T5.5: broken dependencies lower coherence score',
    `got ${brokenResult.breakdown.dependency_coherence}`);

  // ─── T6: Change Scoring ───────────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T6: CHANGE SCORING \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  const highChange = makeHighQualityChange();
  const highChResult = computeChangeScore(highChange);

  console.log(`    High change: ${highChResult.score} (${highChResult.label})`);
  console.log(`    Breakdown: ${JSON.stringify(highChResult.breakdown)}`);

  check(highChResult.score > 0.75,
    'T6.1: high quality change scores >0.75',
    `got ${highChResult.score}`);

  const minChange = makeMinimalChange();
  const minChResult = computeChangeScore(minChange);

  console.log(`    Minimal change: ${minChResult.score} (${minChResult.label})`);

  check(minChResult.score < highChResult.score,
    'T6.2: minimal change < high change',
    `${minChResult.score} vs ${highChResult.score}`);

  // Null change
  const nullCh = computeChangeScore(null);
  check(nullCh.score === 0,
    'T6.3: null change scores 0',
    `got ${nullCh.score}`);

  // ─── T7: Lifecycle Aggregate ──────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T7: LIFECYCLE AGGREGATE SCORING \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  // Without change score
  const lcNoChange = computeLifecycleScore({ spec_score: 0.90, roadmap_score: 0.80 });
  check(inRange(lcNoChange.score, 0.85, 0.87),
    'T7.1: lifecycle (no change) = 0.60*0.90 + 0.40*0.80 = 0.86',
    `got ${lcNoChange.score}`);

  // With change score
  const lcWithChange = computeLifecycleScore({ spec_score: 0.90, roadmap_score: 0.80, change_score: 0.70 });
  check(inRange(lcWithChange.score, 0.82, 0.84),
    'T7.2: lifecycle (with change) = 0.50*0.90 + 0.30*0.80 + 0.20*0.70 = 0.83',
    `got ${lcWithChange.score}`);

  // All zeros
  const lcZero = computeLifecycleScore({ spec_score: 0, roadmap_score: 0, change_score: 0 });
  check(lcZero.score === 0,
    'T7.3: all-zero lifecycle = 0',
    `got ${lcZero.score}`);

  // Labels
  check(lcNoChange.label === 'EXCELLENT',
    'T7.4: 0.86 = EXCELLENT',
    `got ${lcNoChange.label}`);

  // ─── T8: Edge Cases ───────────────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T8: EDGE CASES & ROBUSTNESS \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  // Null spec
  const nullSpec = computeSpecScore(null);
  check(nullSpec.score === 0 && nullSpec.label === 'NONE',
    'T8.1: null spec → score 0, label NONE',
    `got ${nullSpec.score} ${nullSpec.label}`);

  // Empty spec
  const emptySpec = computeSpecScore({});
  check(emptySpec.score === 0,
    'T8.2: empty spec → score 0',
    `got ${emptySpec.score}`);

  // Score always 0.0–1.0
  check(highResult.score >= 0 && highResult.score <= 1,
    'T8.3: high spec score in [0, 1]',
    `got ${highResult.score}`);
  check(lowResult.score >= 0 && lowResult.score <= 1,
    'T8.4: low spec score in [0, 1]',
    `got ${lowResult.score}`);

  // Breakdown values always 0.0–1.0
  const allBreakdowns = [highResult, midResult, lowResult, shallowResult].flatMap(
    r => Object.values(r.breakdown)
  );
  const allInRange = allBreakdowns.every(v => v >= 0 && v <= 1);
  check(allInRange,
    'T8.5: all breakdown values in [0, 1]',
    allInRange ? '' : `out of range: ${allBreakdowns.filter(v => v < 0 || v > 1).join(', ')}`);

  // Monotonicity: high > mid > low
  check(highResult.score > midResult.score && midResult.score > lowResult.score,
    'T8.6: monotonic ordering high > mid > low',
    `${highResult.score} > ${midResult.score} > ${lowResult.score}`);

  // ═══ Summary ═══════════════════════════════════════════════════════════

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  Quality Score: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log('\n  FAILURES:');
    for (const f of failures) {
      console.log(`    \u2717 ${f.name}: ${f.detail}`);
    }
  }

  if (failed === 0) {
    console.log('\n  ALL QUALITY SCORE TESTS PASSED \u2014 diagnostic layer operational!');
  }

  console.log('═'.repeat(70) + '\n');
  process.exit(failed > 0 ? 1 : 0);
}

run();
